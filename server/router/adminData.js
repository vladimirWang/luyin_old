import crypto from "node:crypto";
import express from "express";
import path from "node:path";

import { recordingFromPrisma, transcriptSegmentFromPrisma } from "../repositories/recordings.mjs";
import { resolveRecordingAudioPath } from "../utils/recordings.js";

const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);
const router = express.Router();

let projectRoot = "";

export function configure(root) {
  projectRoot = root;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

router.use((request, response, next) => {
  const configuredKey = String(process.env.ADMIN_BACKEND_API_KEY || "").trim();
  if (!configuredKey) {
    response.status(503).json({ error: "ADMIN_BACKEND_API_KEY is not configured" });
    return;
  }
  if (!safeEqual(request.get("x-admin-api-key"), configuredKey)) {
    response.status(401).json({ error: "Unauthorized admin data request" });
    return;
  }
  next();
});

function adminSegment(row) {
  const segment = transcriptSegmentFromPrisma(row);
  return {
    id: segment.id,
    recording_id: segment.recordingId,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
    confidence: segment.confidence,
    speaker_label: segment.speakerKey,
    emotion: "中性",
    event: "",
    created_at: segment.createdAt,
  };
}

function adminRecording(row) {
  const recording = recordingFromPrisma(row);
  return {
    id: recording.id,
    seq: recording.seq,
    user_id: recording.userId || null,
    folder_id: recording.folderId,
    folder_name: row.folder?.name || "",
    name: recording.name,
    speaker_name: recording.speakerName,
    speaker_map: recording.speakerMap,
    tag: recording.tag,
    created_at: recording.createdAt,
    updated_at: recording.updatedAt,
    deleted_at: recording.deletedAt,
    duration_ms: recording.durationMs,
    mime_type: recording.mimeType,
    file_size: recording.size,
    file_name: recording.fileName,
    storage_provider: row.storageProvider || "local",
    storage_key: recording.storagePath,
    transcript_path: recording.transcriptPath,
    status: recording.status,
    error_message: recording.errorMessage,
    favorite: recording.favorite,
    source: recording.source,
    user_agent: recording.userAgent,
    transcript_provider: recording.transcriptProvider,
    transcript_source: recording.transcriptSource,
    transcribed_at: recording.transcribedAt,
    summary: recording.meetingOutline,
    summary_status: recording.meetingOutlineStatus || "idle",
    summary_provider: "",
    summarized_at: recording.meetingOutlinedAt,
    summary_error: recording.meetingOutlineError,
    uploader_name: row.user?.name || recording.ownerName || "",
    uploader_department: row.user?.department || "",
    uploader_company: row.user?.company || "",
    transcript: (row.segments || []).map(adminSegment),
  };
}

const recordingInclude = {
  folder: true,
  user: true,
  segments: { orderBy: { startMs: "asc" } },
};

router.get("/recordings", async (_request, response, next) => {
  try {
    const rows = await prisma.recording.findMany({ include: recordingInclude, orderBy: { createdAt: "desc" } });
    response.json({ recordings: rows.map(adminRecording) });
  } catch (error) {
    next(error);
  }
});

router.get("/recordings/:id", async (request, response, next) => {
  try {
    const row = await prisma.recording.findUnique({ where: { id: request.params.id }, include: recordingInclude });
    if (!row) {
      response.status(404).json({ error: "录音不存在" });
      return;
    }
    response.json({ recording: adminRecording(row) });
  } catch (error) {
    next(error);
  }
});

router.get("/recordings/:id/audio", async (request, response, next) => {
  try {
    const row = await prisma.recording.findUnique({ where: { id: request.params.id } });
    const recording = row ? recordingFromPrisma(row) : null;
    const audioPath = recording ? resolveRecordingAudioPath(recording, projectRoot) : "";
    if (!audioPath) {
      response.status(404).json({ error: "音频文件不存在" });
      return;
    }
    response.sendFile(audioPath, {
      headers: {
        "Content-Type": recording.mimeType || "audio/mpeg",
        "Content-Disposition": `inline; filename="${path.basename(recording.fileName || audioPath).replace(/\"/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/folders", async (_request, response, next) => {
  try {
    const [folders, recordings] = await Promise.all([
      prisma.recordingFolder.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.recording.findMany({ select: { folderId: true, favorite: true, deletedAt: true } }),
    ]);
    const active = recordings.filter((item) => !item.deletedAt);
    const countByFolder = new Map();
    for (const item of active) countByFolder.set(item.folderId, (countByFolder.get(item.folderId) || 0) + 1);
    response.json({
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name || "",
        user_id: folder.userId || null,
        created_at: folder.createdAt,
        updated_at: folder.updatedAt,
        count: countByFolder.get(folder.id) || 0,
      })),
      uncategorizedCount: countByFolder.get(null) || 0,
      favoriteCount: active.filter((item) => item.favorite).length,
      trashCount: recordings.length - active.length,
      totalCount: active.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/profile", async (_request, response, next) => {
  try {
    const [user, members] = await Promise.all([
      prisma.appUser.findFirst({ orderBy: { updatedAt: "desc" } }),
      prisma.appUser.findMany({ orderBy: { name: "asc" } }),
    ]);
    response.json({
      profile: {
        name: user?.name || "管理员",
        company: user?.company || "",
        department: user?.department || "",
        phone: user?.phone || "",
        language: user?.language || "中文",
        recordsTitle: user?.recordsTitle || "全部录音",
      },
      members: members.map((member) => ({
        id: member.id,
        wecomUserId: member.wecomUserId || "",
        name: member.name || "",
        company: member.company || "",
        department: member.department || "",
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
