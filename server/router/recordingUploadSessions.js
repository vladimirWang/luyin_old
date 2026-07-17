import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import logger from "../utils/log.js";
import { getTranscriptionMode } from "../transcription.mjs";
import { audioDir, loadDb, tempDir, updateDb } from "../db.mjs";
import { mergeAudioFilesToMp3 } from "../media.mjs";
import {
  requestClientIdBetter,
  requestClientNameAndDecode,
  safeUploadSessionId,
  uploadSessionPath,
  readUploadSessionMeta,
} from "../utils/recordings.js";
import {removeFileIfExists} from '../utils/file.js'

const router = express.Router();
const upload = multer({ dest: tempDir });

let projectRoot = "";
let dependencies = {};

export function configure(root, deps) {
  projectRoot = root;
  dependencies = deps;
}

router.post("/", async (request, response, next) => {
  try {
    const sessionId = crypto.randomUUID();
    const dir = uploadSessionPath(sessionId);
    await mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const ownerClientId = requestClientIdBetter(request);
    const ownerName = requestClientNameAndDecode(request);
    const meta = {
      id: sessionId,
      createdAt: now,
      updatedAt: now,
      ownerClientId,
      ownerName,
      name: String(request.body?.name || "").trim(),
      durationMs: Math.max(0, Number(request.body?.durationMs || 0)),
      mimeType: String(request.body?.mimeType || "audio/webm").trim() || "audio/webm",
      folderId: request.body?.folderId || null,
      userAgent: request.get("user-agent") || "",
    };
    await writeFile(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    response.status(201).json({ sessionId, batchSize: 48 });
  } catch (error) {
    next(error);
  }
});

router.post("/:sessionId/segments", upload.array("audio", 80), async (request, response, next) => {
  const files = Array.isArray(request.files) ? request.files : [];
  try {
    const sessionId = safeUploadSessionId(request.params.sessionId);
    const dir = uploadSessionPath(sessionId);
    const meta = await readUploadSessionMeta(sessionId);
    if (!dir || !meta || meta.ownerClientId !== requestClientIdBetter(request)) {
      await Promise.all(files.map((file) => removeFileIfExists(file.path)));
      response.status(404).json({ error: "上传会话不存在" });
      return;
    }
    if (files.length === 0) {
      response.status(400).json({ error: "缺少录音片段" });
      return;
    }

    const startIndex = Math.max(0, Number(request.body.startIndex || 0));
    await Promise.all(
      files.map(async (file, index) => {
        const partIndex = startIndex + index;
        const targetPath = path.join(dir, `part-${String(partIndex).padStart(6, "0")}.webm`);
        await rm(targetPath, { force: true }).catch(() => {});
        await rename(file.path, targetPath);
      }),
    );

    const entries = await readdir(dir);
    const received = entries.filter((entry) => /^part-\d+\.webm$/i.test(entry)).length;
    await writeFile(path.join(dir, "meta.json"), `${JSON.stringify({ ...meta, updatedAt: new Date().toISOString(), received }, null, 2)}\n`, "utf8");
    response.json({ ok: true, received });
  } catch (error) {
    await Promise.all(files.map((file) => removeFileIfExists(file.path)));
    next(error);
  }
});

router.delete("/:sessionId", async (request, response, next) => {
  try {
    const sessionId = safeUploadSessionId(request.params.sessionId);
    const dir = uploadSessionPath(sessionId);
    const meta = await readUploadSessionMeta(sessionId);
    if (!dir || !meta || meta.ownerClientId !== requestClientIdBetter(request)) {
      response.status(404).json({ error: "上传会话不存在" });
      return;
    }
    await rm(dir, { recursive: true, force: true });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/:sessionId/finalize", async (request, response, next) => {
  const { queueTranscriptionJob, verifiedStoredRecording, publicRecording } = dependencies;
  try {
    const sessionId = safeUploadSessionId(request.params.sessionId);
    const dir = uploadSessionPath(sessionId);
    const meta = await readUploadSessionMeta(sessionId);
    if (!dir || !meta || meta.ownerClientId !== requestClientIdBetter(request)) {
      response.status(404).json({ error: "上传会话不存在" });
      return;
    }

    const partFiles = (await readdir(dir))
      .filter((entry) => /^part-\d+\.webm$/i.test(entry))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
      .map((entry) => path.join(dir, entry));
    if (partFiles.length === 0) {
      response.status(400).json({ error: "缺少录音片段" });
      return;
    }

    const id = crypto.randomUUID();
    const fileName = `${id}.mp3`;
    const storagePath = path.join(audioDir, fileName);
    const now = new Date().toISOString();
    await mergeAudioFilesToMp3(partFiles, storagePath);
    const { storedFile, durationMs } = await verifiedStoredRecording(storagePath, meta.durationMs || request.body?.durationMs);

    const recording = await updateDb((db) => {
      db.counters.recordingSeq += 1;
      const seq = db.counters.recordingSeq;
      const item = {
        id,
        seq,
        name: meta.name || request.body?.name || `录音 ${String(seq).padStart(3, "0")}`,
        createdAt: now,
        updatedAt: now,
        durationMs,
        mimeType: "audio/mpeg",
        size: storedFile.size,
        fileName,
        storagePath,
        transcriptPath: "",
        favorite: false,
        ownerClientId: meta.ownerClientId,
        ownerName: meta.ownerName || "未设置姓名",
        shared: false,
        sharedAt: "",
        speakerName: request.body?.speakerName || "说话人 1",
        speakerMap: {},
        tag: request.body?.tag || "",
        deletedAt: null,
        transcriptProvider: getTranscriptionMode(),
        transcriptSource: "",
        transcribedAt: "",
        folderId: meta.folderId || request.body?.folderId || null,
        status: "uploaded",
        source: "wecom-h5-long-session",
        userAgent: meta.userAgent || request.get("user-agent") || "",
      };

      db.recordings.push(item);
      return item;
    });

    const queued = await queueTranscriptionJob(id, recording);
    const responseRecording = queued ? { ...recording, status: "transcribing", errorMessage: "" } : recording;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    logger.info("recording.session.finalized", {recordingId: id, sessionId, ownerClientId: meta.ownerClientId, queued, partCount: partFiles.length, fileName});
    response.status(201).json({ recording: publicRecording(responseRecording, [], meta.ownerClientId, meta.ownerName) });
  } catch (error) {
    next(error);
  }
});

export default router;
