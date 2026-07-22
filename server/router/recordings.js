import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import logger from "../utils/log.js";
import {
  expandTranscriptSegments,
  getTranscriptionMode,
  isRecordingApiTranscriptionEnabled,
} from "../transcription.mjs";
import { audioDir, loadDb, tempDir, updateDb } from "../db.mjs";
import { convertAudioFileToMp3, fileInfo, mergeAudioFilesToMp3 } from "../media.mjs";
import {
  requestClientIdBetter,
  requestClientNameAndDecode,
  requestTrustedWecomOwner,
  safeDownloadName,
  recordingSearchScore,
} from "../utils/recordings.js";
import { uploadWecomTemporaryFile } from "../utils/wecom.js";
import { isTencentMeetingRecording, tencentMeetingSyncInfoFromRecording } from "../utils/tencentMeeting.mjs";
// import prisma from "../plugins/prisma.js";
import {
  finalizeStagedFileDeletions,
  findRecordingTemporaryArtifacts,
  removeFileIfExists,
  restoreStagedFiles,
  stageFilesForDeletion,
} from '../utils/file.js'
import { canDeleteAllRecordings, canReadRecording } from "../utils/common.mjs";
import {
  permanentlyDeleteRecordingDataWithPrisma,
  recordingFromPrisma,
  transcriptSegmentFromPrisma,
} from "../repositories/recordings.mjs";

const prisma = await import('../plugins/prisma.cjs').then(m => m.default || m);

const router = express.Router();
const upload = multer({ dest: tempDir });

let projectRoot = "";
let dependencies = {};

export function configure(root, deps) {
  projectRoot = root;
  dependencies = deps;
}

async function sendRecordingAudio(req, res, disposition = "inline") {
  const { hasValidAudioDownloadToken, queueTencentMeetingImportSync, findRecording, resolveRecordingAudioPath } = dependencies;
  const db = await loadDb();
  const clientId = requestClientIdBetter(req);
  const clientName = requestClientNameAndDecode(req);
  const recording = findRecording(db, req.params.id);
  const audioPath = recording ? resolveRecordingAudioPath(recording, projectRoot) : "";
  const tokenAllowed = recording ? hasValidAudioDownloadToken(req.query?.token, recording.id) : false;
  if (!recording || recording.deletedAt || (!tokenAllowed && !canReadRecording(recording, clientId))) {
    res.status(404).json({ error: "音频文件不存在" });
    return;
  }

  if (!audioPath) {
    if (isTencentMeetingRecording(recording)) {
      queueTencentMeetingImportSync(recording.id, tencentMeetingSyncInfoFromRecording(recording));
      res.setHeader("Retry-After", "15");
      res.status(202).json({ ok: false, pending: true, message: "腾讯会议音频正在同步，请稍后重试。" });
      return;
    }
    res.status(404).json({ error: "音频文件不存在" });
    return;
  }

  const fileName = `${safeDownloadName(recording.name || "recording")}.mp3`;
  const asciiName = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "_");
  res.sendFile(audioPath, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Transfer-Encoding": "binary",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleMeetingOutlineRequest(req, res, next) {
  try {
    const { findRecording, findSegments, canManageRecording, generateAndStoreMeetingOutline } = dependencies;
    const db = await loadDb();
    const clientId = requestClientIdBetter(req);
    const clientName = requestClientNameAndDecode(req);
    const recording = findRecording(db, req.params.id);
    if (!recording || recording.deletedAt || !canReadRecording(recording, clientId)) {
      res.status(404).json({ error: "录音不存在" });
      return;
    }

    const forceRefresh = req.method === "POST" || req.query.refresh === "1";
    if (!forceRefresh && recording.meetingOutline) {
      res.json({
        outline: recording.meetingOutline,
        status: recording.meetingOutlineStatus || "ready",
        generatedAt: recording.meetingOutlinedAt || recording.meetingOutline.generatedAt || "",
      });
      return;
    }

    const outlineStartedAt = Date.parse(recording.meetingOutlineStartedAt || "");
    const configuredOutlineStaleMs = Number(process.env.MEETING_OUTLINE_STALE_MS);
    const outlineStaleMs = Number.isFinite(configuredOutlineStaleMs)
      ? Math.max(60_000, configuredOutlineStaleMs)
      : 20 * 60 * 1000;
    const outlineIsStale =
      recording.meetingOutlineStatus === "generating" &&
      (!Number.isFinite(outlineStartedAt) || Date.now() - outlineStartedAt >= outlineStaleMs);
    if (!forceRefresh && recording.meetingOutlineStatus === "generating" && !outlineIsStale) {
      res.json({ outline: null, status: "generating" });
      return;
    }

    const segments = expandTranscriptSegments(findSegments(db, recording.id), recording.durationMs || 0);
    if (!segments.length) {
      res.status(409).json({ error: "No transcript is available for meeting outline generation." });
      return;
    }

    const outline = await generateAndStoreMeetingOutline(recording.id, segments, {
      updateTag: canManageRecording(recording, clientId, clientName),
    });
    res.json({
      outline,
      status: outline ? "ready" : "failed",
      generatedAt: outline?.generatedAt || "",
    });
  } catch (error) {
    next(error);
  }
}

router.get("/", async (request, response, next) => {
  const { publicRecording } = dependencies;
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const canDeleteAll = canDeleteAllRecordings();
  const query = String(request.query.q || request.query.search || "").trim().toLowerCase();
  const folderId = request.query.folderId || "all";
  try {
    const folderWhere =
      folderId === "trash"
        ? { deletedAt: { not: null } }
        : folderId === "favorites"
          ? { deletedAt: null, favorite: true }
          : folderId === "uncategorized"
            ? { deletedAt: null, folderId: null }
            : folderId === "all"
              ? { deletedAt: null }
              : { deletedAt: null, folderId };
    const rows = await prisma.recording.findMany({
      where: folderWhere,
      include: { segments: { orderBy: { startMs: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    // for (let i of rows) {
    //   if (i.id === "429d3888-47b1-462e-84aa-4570f6a64162") {
    //     logger.debug("排查转写数据: ", {message: `isArray: ${Array.isArray(i.segments)}`})
    //     if (Array.isArray(i.segments)) {
    //       logger.debug("排查转写数据: ", {message: `length: ${i.segments.length}`})
    //     }
    //   }
    // }
    const recordings = rows
      .map((row) => ({
        // recordings: row
        recording: recordingFromPrisma(row),
        segments: row.segments.map(transcriptSegmentFromPrisma),
      }))
      // .filter(({ recording }) => canDeleteAll || canReadRecording(recording, clientId))
      .map(({ recording, segments }) =>
        publicRecording(recording, segments, clientId, clientName, { canDeleteAllRecordings: canDeleteAll }),
      );
    // const filtered = query
    //   ? recordings
    //       .map((recording) => ({ recording, score: recordingSearchScore(recording, query) }))
    //       .filter((item) => item.score >= 18)
    //       .sort((a, b) => b.score - a.score || new Date(b.recording.createdAt) - new Date(a.recording.createdAt))
    //       .map((item) => item.recording)
    //   : recordings;
    response.json({ recordings });
  } catch (error) {
    next(error);
  }
});

router.post("/", upload.single("audio"), async (request, response, next) => {
  const { queueTranscriptionJob, verifiedStoredRecording, publicRecording } = dependencies;
  try {
    if (!request.file) {
      response.status(400).json({ error: "缺少录音文件" });
      return;
    }
    const trustedOwner = requestTrustedWecomOwner(request);
    if (!trustedOwner) {
      await removeFileIfExists(request.file.path);
      response.status(401).json({ error: "企业微信登录已失效，请重新登录" });
      return;
    }

    const id = crypto.randomUUID();
    const fileName = `${id}.mp3`;
    const storagePath = path.join(audioDir, fileName);
    const now = new Date().toISOString();
    // // ----------用本地假音频模拟上传文件 start-----------
    // const trustedOwner = {
    //   ownerClientId: 'user1231',
    //   userId: "1231",
    //   ownerName: "user1231 ownerName"
    // }
    // const mockMp3Path = path.join(projectRoot, "mock/audio/e6676bf0-0db2-4bef-9e5a-3e52719e4c43.mp3");
    // const { copyFile } = await import("node:fs/promises");
    // await copyFile(mockMp3Path, storagePath);
    // const mockOwner = { userId: "mock-user-001", ownerClientId: "mock-client-001", ownerName: "Mock测试用户" };
    // const { size: fileSize } = statSync(mockMp3Path);
    // const { probeAudioDurationMs } = await import("../media.mjs");
    // const durationMs = await probeAudioDurationMs(storagePath) || 0;
    // // ----------用本地假音频模拟上传文件 end-----------

    await convertAudioFileToMp3(request.file.path, storagePath);
    await removeFileIfExists(request.file.path);
    const { storedFile, durationMs } = await verifiedStoredRecording(storagePath, request.body.durationMs);
    const fileSize = storedFile.fileSize
    const lastRecording = await prisma.recording.findFirst({
      orderBy: {
        seq: 'desc'
      }
    })
    const seq = lastRecording ? lastRecording.seq + 1 : 1

    logger.info("recording.uploaded lastRecording", { message: `lastRecording.id: ${lastRecording.id}, seq: ${seq}` });
    logger.info("recording.uploaded mock", { message: `recordingId: ${id}, ownerClientId: ${mockOwner.ownerClientId}, ownerName: ${mockOwner.ownerName}, durationMs: ${durationMs}, fileSize: ${fileSize}` });
    const insertResult = await prisma.recording.create({
      data: {
        id,
        seq,
        name: request.body.name || `录音 ${String(seq).padStart(3, "0")}`,
        createdAt: now,
        updatedAt: now,
        durationMs: BigInt(durationMs),
        mimeType: "audio/mpeg",
        fileSize: BigInt(fileSize),
        fileName,
        storageProvider: "local",
        storageKey: storagePath,
        transcriptPath: "",
        favorite: false,
        userId: trustedOwner.userId,
        ownerClientId: trustedOwner.ownerClientId,
        ownerName: trustedOwner.ownerName,
        shared: false,
        sharedAt: null,
        speakerName: request.body.speakerName || "说话人 1",
        speakerMapJson: JSON.stringify({}),
        tag: request.body.tag || "",
        deletedAt: null,
        transcriptProvider: getTranscriptionMode(),
        transcriptSource: "",
        transcribedAt: null,
        folderId: request.body.folderId || null,
        status: "uploaded",
        source: "wecom-h5",
        userAgent: request.get("user-agent") || "",
      }
    });
    const recording = recordingFromPrisma(insertResult);
    logger.info("recording insert success", { message: `id: ${id}, durationMs: ${recording.durationMs}, size: ${recording.size}` });
    const queued = await queueTranscriptionJob(id, recording);
    logger.debug("queueTranscriptionJob success", { message: `queued: ${queued}` });
    const responseRecording = queued ? { ...recording, status: "transcribing", errorMessage: "" } : recording;
    response.status(201).json({ recording: publicRecording(responseRecording, [], mockOwner.ownerClientId, mockOwner.ownerName) });
  } catch (error) {
    next(error);
  }
});

router.post("/segments", upload.array("audio", 480), async (request, response, next) => {
  // response.status(200).json({message: 'fff'})
  const { queueTranscriptionJob, verifiedStoredRecording = fileInfo, publicRecording } = dependencies;
  logger.debug("post recording.segments", {message: `files.length: ${request.files.length}`});
  const files = Array.isArray(request.files) ? request.files : [];
  try {
    if (files.length === 0) {
      response.status(400).json({ error: "缺少录音片段" });
      return;
    }
    const trustedOwner = requestTrustedWecomOwner(request);
    if (!trustedOwner) {
      await Promise.all(files.map((file) => removeFileIfExists(file.path)));
      response.status(401).json({ error: "企业微信登录已失效，请重新登录" });
      return;
    }

    const id = crypto.randomUUID();
    const fileName = `${id}.mp3`;
    const storagePath = path.join(audioDir, fileName);
    const now = new Date().toISOString();
    const { userId, ownerClientId, ownerName } = trustedOwner;
    await mergeAudioFilesToMp3(
      files.map((file) => file.path),
      storagePath,
    );
    await Promise.all(files.map((file) => removeFileIfExists(file.path)));
    const { storedFile, durationMs } = await verifiedStoredRecording(storagePath, request.body.durationMs);

    const latestRecording = await prisma.recording.findFirst({
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (latestRecording?.seq || 0) + 1;
    const recording = {
      id,
      seq,
      name: request.body.name || `录音 ${String(seq).padStart(3, "0")}`,
      createdAt: now,
      updatedAt: now,
      durationMs,
      mimeType: "audio/mpeg",
      size: storedFile.size,
      fileName,
      storagePath,
      transcriptPath: "",
      favorite: false,
      userId,
      ownerClientId,
      ownerName,
      shared: false,
      sharedAt: "",
      speakerName: request.body.speakerName || "说话人 1",
      speakerMap: {},
      tag: request.body.tag || "",
      deletedAt: null,
      transcriptProvider: getTranscriptionMode(),
      transcriptSource: "",
      transcribedAt: "",
      folderId: request.body.folderId || null,
      status: "uploaded",
      source: files.length > 1 ? "wecom-h5-resumed" : "wecom-h5",
      userAgent: request.get("user-agent") || "",
    };
    logger.debug('request segements: ', {message: `request /segments lastSeq: ${latestRecording.seq}, durationMs: ${durationMs}`})
    await prisma.recording.create({
      data: {
        id: recording.id,
        seq: recording.seq,
        name: recording.name,
        createdAt: recording.createdAt,
        updatedAt: recording.updatedAt,
        durationMs: recording.durationMs,
        mimeType: recording.mimeType,
        fileSize: recording.size,
        fileName: recording.fileName,
        storageProvider: "local",
        storageKey: recording.storagePath,
        transcriptPath: recording.transcriptPath,
        favorite: recording.favorite,
        user: { connect: { id: recording.userId } },
        ownerClientId: recording.ownerClientId,
        ownerName: recording.ownerName,
        shared: recording.shared,
        sharedAt: null,
        speakerName: recording.speakerName,
        speakerMapJson: JSON.stringify(recording.speakerMap),
        tag: recording.tag,
        deletedAt: recording.deletedAt,
        transcriptProvider: recording.transcriptProvider,
        transcriptSource: recording.transcriptSource,
        transcribedAt: null,
        ...(recording.folderId ? { folder: { connect: { id: recording.folderId } } } : {}),
        status: recording.status,
        source: recording.source,
        userAgent: recording.userAgent,
      },
    });

    const queued = await queueTranscriptionJob(id, recording);
    const responseRecording = queued ? { ...recording, status: "transcribing", errorMessage: "" } : recording;

    logger.info("recording.segments.uploaded", {message: `recordingId: ${id}, ownerClientId: ${ownerClientId}, ownerName: ${ownerName}, queued: ${queued}, partCount: ${files.length}, fileName: ${fileName}`, recordingId: id, ownerClientId, ownerName, queued, partCount: files.length, fileName});
    response.status(201).json({ recording: publicRecording(responseRecording, [], ownerClientId, ownerName) });
  } catch (error) {
    await Promise.all(files.map((file) => removeFileIfExists(file.path)));
    next(error);
  }
});

router.get("/:id", async (request, response) => {
  const { findRecording, findSegments, publicRecording } = dependencies;
  const db = await loadDb();
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const canDeleteAll = canDeleteAllRecordings();
  const recording = findRecording(db, request.params.id);
  if (!recording || recording.deletedAt || (!canDeleteAll && !canReadRecording(recording, clientId))) {
    response.status(404).json({ error: "录音不存在" });
    return;
  }

  response.json({ recording: publicRecording(recording, findSegments(db, recording.id), clientId, clientName, { canDeleteAllRecordings: canDeleteAll }) });
});

router.patch("/:id", async (request, response) => {
  const { findRecording, canManageRecording, findSegments, publicRecording } = dependencies;
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const updated = await updateDb((db) => {
    const recording = findRecording(db, request.params.id);
    if (!recording || recording.deletedAt) return null;
    const keys = Object.keys(request.body || {});
    const readerOnlyPatch = keys.length > 0 && keys.every((key) => key === "favorite");
    if (!canManageRecording(recording, clientId, clientName) && !(readerOnlyPatch && canReadRecording(recording, clientId))) return null;
    const now = new Date().toISOString();

    if (typeof request.body.name === "string") {
      recording.name = request.body.name.trim() || recording.name;
    }
    if (typeof request.body.speakerName === "string") {
      recording.speakerName = request.body.speakerName.trim() || "说话人 1";
    }
    if (request.body.speakerMap && typeof request.body.speakerMap === "object" && !Array.isArray(request.body.speakerMap)) {
      recording.speakerMap = Object.fromEntries(
        Object.entries(request.body.speakerMap)
          .map(([key, value]) => [String(key).trim(), String(value || "").trim()])
          .filter(([key, value]) => key && value),
      );
      recording.speakerName = recording.speakerMap["speaker-1"] || recording.speakerName || "说话人 1";
    }
    if (typeof request.body.tag === "string") {
      recording.tag = request.body.tag.trim();
    }
    if (typeof request.body.favorite === "boolean") {
      recording.favorite = request.body.favorite;
    }
    if (typeof request.body.shared === "boolean") {
      recording.shared = request.body.shared;
      if (request.body.shared && !recording.sharedAt) {
        recording.sharedAt = now;
      }
    }
    if (Object.prototype.hasOwnProperty.call(request.body, "folderId")) {
      const nextFolderId = request.body.folderId || null;
      const folderExists = nextFolderId ? db.folders.some((folder) => folder.id === nextFolderId) : true;
      if (folderExists) {
        recording.folderId = nextFolderId;
      }
    }

    recording.updatedAt = now;
    return publicRecording(recording, findSegments(db, recording.id), clientId, clientName);
  });

  if (!updated) {
    response.status(404).json({ error: "录音不存在" });
    return;
  }

  response.json({ recording: updated });
});

// router.delete("/:id", async (request, response) => {
//   const { findRecording, canManageRecording, canDeleteRecording } = dependencies;
//   const clientId = requestClientIdBetter(request);
//   const clientName = requestClientNameAndDecode(request);
//   const canDeleteAll = canDeleteAllRecordings();
//   let filePath = "";
//   let transcriptPath = "";
//   const permanent = request.query.permanent === "true";
//   const deleted = await updateDb((db) => {
//     const recording = findRecording(db, request.params.id);
//     if (!recording) return false;
//     if (!canDeleteAll && !(permanent ? canManageRecording(recording, clientId, clientName) : canDeleteRecording(recording, clientId, clientName))) return false;

//     if (!permanent) {
//       recording.deletedAt = new Date().toISOString();
//       recording.updatedAt = new Date().toISOString();
//       return true;
//     }

//     filePath = recording.storagePath;
//     transcriptPath = recording.transcriptPath;
//     db.recordings = db.recordings.filter((item) => item.id !== request.params.id);
//     db.transcriptSegments = db.transcriptSegments.filter((segment) => segment.recordingId !== request.params.id);
//     db.qaMessages = db.qaMessages.filter((message) => !message.recordingIds?.includes(request.params.id));
//     return true;
//   });

//   if (!deleted) {
//     response.status(404).json({ error: "录音不存在" });
//     return;
//   }

//   if (filePath) {
//     await rm(filePath, { force: true });
//   }
//   if (transcriptPath) {
//     await rm(transcriptPath, { force: true });
//   }

//   response.json({ ok: true });
// });

router.delete("/:id", async (request, response, next) => {
  const {
    cancelRecordingJobs,
    canManageRecording,
    canDeleteRecording,
    releaseRecordingJobCancellation,
  } = dependencies;
  const recordingId = String(request.params.id || "").trim();
  const permanent = request.query.permanent === "true";
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const canDeleteAll = canDeleteAllRecordings();
  let jobsCancelled = false;
  let deletionCommitted = false;

  try {
    const row = await prisma.recording.findUnique({ where: { id: recordingId } });
    if (!row) {
      response.status(404).json({ error: "录音不存在" });
      return;
    }

    const recording = recordingFromPrisma(row);
    const allowed = canDeleteAll || (permanent
      ? canManageRecording(recording, clientId, clientName)
      : canDeleteRecording(recording, clientId, clientName));
    if (!allowed) {
      response.status(404).json({ error: "录音不存在" });
      return;
    }

    if (!permanent) {
      const now = new Date();
      cancelRecordingJobs(recordingId);
      jobsCancelled = true;
      await prisma.recording.update({
        where: { id: recordingId },
        data: { deletedAt: now, updatedAt: now },
      });
      response.json({ ok: true, permanent: false });
      return;
    }

    cancelRecordingJobs(recordingId);
    jobsCancelled = true;
    const temporaryArtifacts = await findRecordingTemporaryArtifacts(tempDir, recordingId);
    const stagedFiles = await stageFilesForDeletion(
      [
        recording.storagePath,
        recording.transcriptPath,
        recording.transcriptRawPath,
        recording.transcriptCorrectedPath,
        recording.transcriptionMetaPath,
        ...temporaryArtifacts,
      ],
      `${recordingId}-${crypto.randomUUID()}`,
    );

    let deleted;
    try {
      deleted = await permanentlyDeleteRecordingDataWithPrisma(recordingId);
      deletionCommitted = true;
    } catch (error) {
      try {
        await restoreStagedFiles(stagedFiles);
      } catch (restoreError) {
        logger.error("recording.permanent_delete.restore_failed", {
          message: restoreError instanceof Error ? restoreError.message : String(restoreError),
          recordingId,
        });
      }
      throw error;
    }

    const cleanupFailures = await finalizeStagedFileDeletions(stagedFiles);
    if (cleanupFailures.length) {
      logger.error("recording.permanent_delete.file_cleanup_failed", {
        message: cleanupFailures.map((failure) => `${failure.path}: ${failure.error?.message || failure.error}`).join("; "),
        recordingId,
      });
    }

    response.json({
      ok: true,
      permanent: true,
      deleted,
      deletedFiles: stagedFiles.length - cleanupFailures.length,
      fileCleanupPending: cleanupFailures.length,
    });
  } catch (error) {
    if (jobsCancelled && !deletionCommitted) releaseRecordingJobCancellation(recordingId);
    next(error);
  }
});

router.get("/:id/audio", async (request, response) => {
  const downloadFlag = String(request.query.download || "").toLowerCase();
  const disposition = ["1", "true", "yes", "download"].includes(downloadFlag) ? "attachment" : "inline";
  await sendRecordingAudio(request, response, disposition);
});

router.get("/:id/audio.mp3", async (request, response) => {
  await sendRecordingAudio(request, response, "attachment");
});

router.post("/:id/audio-share-url", async (request, response) => {
  const { createAudioDownloadToken, findRecording, resolveRecordingAudioPath } = dependencies;
  const db = await loadDb();
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const recording = findRecording(db, request.params.id);
  const audioPath = recording ? resolveRecordingAudioPath(recording, projectRoot) : "";
  if (!recording || recording.deletedAt || !canReadRecording(recording, clientId) || !audioPath) {
    response.status(404).json({ error: "audio file not found" });
    return;
  }

  const fileName = `${safeDownloadName(recording.name || "recording")}.mp3`;
  const token = createAudioDownloadToken(recording.id);
  response.json({
    url: `/api/recordings/${encodeURIComponent(recording.id)}/audio.mp3?token=${encodeURIComponent(token)}`,
    fileName,
    contentType: "audio/mpeg",
    size: statSync(audioPath).size,
    expiresInSeconds: 30 * 60,
  });
});

router.post("/:id/wecom-audio-media", async (request, response, next) => {
  const { findRecording, resolveRecordingAudioPath } = dependencies;
  try {
    const db = await loadDb();
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const recording = findRecording(db, request.params.id);
    const audioPath = recording ? resolveRecordingAudioPath(recording, projectRoot) : "";
    if (!recording || recording.deletedAt || !canReadRecording(recording, clientId) || !audioPath) {
      response.status(404).json({ error: "音频文件不存在" });
      return;
    }

    const fileName = `${safeDownloadName(recording.name || "recording")}.mp3`;
    const media = await uploadWecomTemporaryFile(audioPath, fileName, "audio/mpeg");
    response.json({
      mediaId: media.mediaId,
      fileName,
      contentType: "audio/mpeg",
      size: statSync(audioPath).size,
      type: media.type,
      createdAt: media.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/transcript.txt", async (request, response) => {
  const { findRecording } = dependencies;
  const db = await loadDb();
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const recording = findRecording(db, request.params.id);
  if (!recording || recording.deletedAt || !canReadRecording(recording, clientId) || !recording.transcriptPath || !existsSync(recording.transcriptPath)) {
    response.status(404).json({ error: "转写 TXT 不存在" });
    return;
  }

  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.sendFile(recording.transcriptPath);
});

router.get("/:id/meeting-outline", handleMeetingOutlineRequest);
router.post("/:id/meeting-outline", handleMeetingOutlineRequest);

router.get("/:id/meeting-outline.pdf", async (request, response, next) => {
  try {
    const { findRecording, findSegments, canManageRecording, generateAndStoreMeetingOutline, renderMeetingOutlinePdf } = dependencies;
    const db = await loadDb();
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const recording = findRecording(db, request.params.id);
    if (!recording || recording.deletedAt || !canReadRecording(recording, clientId)) {
      response.status(404).json({ error: "录音不存在" });
      return;
    }

    let outline = recording.meetingOutline || null;
    let pdfRecording = recording;
    if (!outline) {
      const segments = expandTranscriptSegments(findSegments(db, recording.id), recording.durationMs || 0);
      if (!segments.length) {
        response.status(409).json({ error: "No transcript is available for meeting outline PDF generation." });
        return;
      }
      outline = await generateAndStoreMeetingOutline(recording.id, segments, {
        updateTag: canManageRecording(recording, clientId, clientName),
      });
      const refreshedDb = await loadDb();
      pdfRecording = findRecording(refreshedDb, recording.id) || recording;
      outline = pdfRecording.meetingOutline || outline;
    }

    const pdfBuffer = await renderMeetingOutlinePdf(pdfRecording, outline);
    const fileName = `${safeDownloadName(pdfRecording.name || "会议提纲")}-会议提纲.pdf`;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/transcribe", async (request, response) => {
  const { queueTranscriptionJob, isLocalApiTranscriptionRecording, findRecording, canManageRecording } = dependencies;
  logger.info("[CALL] /api/recordings/:id/transcribe", {message: `request.params.id: ${request.params.id}`});
  const db = await loadDb();
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const recording = findRecording(db, request.params.id);
  if (!recording || recording.deletedAt || !canManageRecording(recording, clientId, clientName)) {
    response.status(404).json({ error: "录音不存在" });
    return;
  }

  if (isTencentMeetingRecording(recording)) {
    response.status(202).json({
      ok: true,
      status: "pending",
      source: "tencent-meeting",
      message: "等待腾讯会议 smart.transcripts 转写生成事件。",
    });
    return;
  }

  if (!isLocalApiTranscriptionRecording(recording)) {
    response.status(409).json({ error: "该录音来源不使用 API 转写，请使用来源自带的转写同步。" });
    return;
  }

  if (!isRecordingApiTranscriptionEnabled()) {
    response.status(409).json({ error: "录音 API 转写已停用；腾讯会议录音会使用腾讯会议自带转写。" });
    return;
  }

  const queued = await queueTranscriptionJob(recording.id, recording);

  response.status(202).json({ ok: true, status: queued ? "transcribing" : "queued" });
});

router.post("/:id/restore", async (request, response, next) => {
  const { canManageRecording, publicRecording, releaseRecordingJobCancellation } = dependencies;
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  try {
    const row = await prisma.recording.findFirst({
      where: { id: request.params.id, deletedAt: { not: null } },
      include: { segments: { orderBy: { startMs: "asc" } } },
    });
    const recording = row ? recordingFromPrisma(row) : null;
    if (!recording || !canManageRecording(recording, clientId, clientName)) {
      response.status(404).json({ error: "录音不存在" });
      return;
    }

    const restoredRow = await prisma.recording.update({
      where: { id: recording.id },
      data: { deletedAt: null, updatedAt: new Date() },
    });
    releaseRecordingJobCancellation(recording.id);
    response.json({
      recording: publicRecording(
        recordingFromPrisma(restoredRow),
        row.segments.map(transcriptSegmentFromPrisma),
        clientId,
        clientName,
      ),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/ask", async (request, response) => {
  const { findReusableQaMessage, publicQaMessage, persistQaAttachments, cacheQaMessage, persistQaMessageSnapshot, scheduleQaJob, findRecording } = dependencies;
  const clientId = requestClientIdBetter(request);
  const clientName = requestClientNameAndDecode(request);
  const rawQuestion = String(request.body?.question || "").trim();
  const images = Array.isArray(request.body?.images) ? request.body.images.slice(0, 3) : [];
  const attachments = Array.isArray(request.body?.attachments)
    ? request.body.attachments.slice(0, 6).map((item) => ({
        kind: String(item?.kind || "file").slice(0, 24),
        name: String(item?.name || "附件").slice(0, 120),
        type: String(item?.type || "").slice(0, 120),
        text: String(item?.text || "").slice(0, 6000),
        url: String(item?.url || "").slice(0, 500),
        dataUrl: String(item?.dataUrl || ""),
      }))
    : [];
  const question =
    rawQuestion ||
    (images.length || attachments.length
      ? `请结合录音内容分析这些附件：${[
          ...images.map((item) => `图片 ${String(item?.name || "未命名").slice(0, 80)}`),
          ...attachments.map((item) => `${item.kind || "附件"} ${item.name || "未命名"}`),
        ].join("、")}`
      : "");

  if (!question) {
    response.status(400).json({ error: "问题不能为空" });
    return;
  }

  const db = await loadDb();
  const recording = findRecording(db, request.params.id);
  if (!recording || recording.deletedAt || !canReadRecording(recording, clientId)) {
    response.status(404).json({ error: "录音不存在" });
    return;
  }

  const canReuseQa = images.length === 0 && attachments.length === 0 && request.body?.force !== true && request.body?.regenerate !== true;
  if (canReuseQa) {
    const reusable = findReusableQaMessage(db, {
      clientId,
      recordingIds: [recording.id],
      question,
    });
    if (reusable) {
      const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
      if (reusable.pending || reusable.status === "pending") scheduleQaJob(reusable.id);
      response.json({ message: publicQaMessage(reusable, recordingMap), reused: true });
      return;
    }
  }

  const messageId = crypto.randomUUID();
  const storedAttachments = await persistQaAttachments(messageId, images, attachments);
  const createdAt = new Date().toISOString();

  const result = cacheQaMessage({
    id: messageId,
    recordingId: recording.id,
    recordingIds: [recording.id],
    recordingNames: [recording.name].filter(Boolean),
    clientId,
    question,
    answer: "",
    structuredAnswer: null,
    jumpToMs: 0,
    citations: [],
    provider: "",
    model: "",
    reasoningContent: "",
    thinking: [],
    attachments: storedAttachments,
    favorite: false,
    deletedAt: null,
    pending: true,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  });
  persistQaMessageSnapshot(result, { removeReadyCache: false });

  const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
  scheduleQaJob(messageId);

  response.status(201).json({ message: publicQaMessage(result, recordingMap), reused: false });
});

export default router;
