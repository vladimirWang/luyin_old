import crypto from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { attachmentDir, audioDir, tempDir, transcriptDir, ttsDir } from "../db.mjs";

const TENCENT_MEETING_SOURCE_PREFIX = "tencent-meeting";

export function safeDownloadName(name) {
  if (!name) return "recording";
  return String(name).trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}

export function safeUploadSessionId(id) {
  if (!id || typeof id !== "string") return "";
  return id.trim().replace(/[\\/:*?"<>|]+/g, "_");
}

export function uploadSessionPath(sessionId) {
  const safe = safeUploadSessionId(sessionId);
  if (!safe) return "";
  return path.join(tempDir, "upload-sessions", safe);
}

export async function readUploadSessionMeta(sessionId) {
  const dir = uploadSessionPath(sessionId);
  if (!dir) return null;
  const metaPath = path.join(dir, "meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function requestClientId(request) {
  const header = request.headers["x-client-id"] || request.headers["client-id"] || "";
  const param = request.query?.clientId || request.body?.clientId || "";
  return String(header || param).trim();
}

export function requestClientName(request) {
  const header = request.headers["x-client-name"] || request.headers["client-name"] || "";
  const param = request.query?.clientName || request.body?.clientName || "";
  return String(header || param).trim();
}

export function requestCanDeleteAllRecordings(request) {
  const flag = request.headers["x-can-delete-all"] || request.query?.canDeleteAll || "";
  return ["1", "true", "yes"].includes(String(flag).toLowerCase());
}

export function canReadRecording(recording, clientId, clientName) {
  if (!recording) return false;
  if (recording.ownerClientId === clientId) return true;
  if (recording.ownerName && recording.ownerName === clientName) return true;
  if (recording.shared && !recording.deletedAt) return true;
  return false;
}

export function canManageRecording(recording, clientId, clientName) {
  if (!recording) return false;
  if (recording.ownerClientId === clientId) return true;
  if (recording.ownerName && recording.ownerName === clientName) return true;
  return false;
}

export function canDeleteRecording(recording, clientId, clientName) {
  return canManageRecording(recording, clientId, clientName);
}

export function findRecording(db, id) {
  return db.recordings.find((r) => r.id === id);
}

export function findSegments(db, recordingId) {
  return db.transcriptSegments.filter((s) => s.recordingId === recordingId);
}

export function recordingSearchScore(recording, query) {
  let score = 0;
  if (recording.name && recording.name.toLowerCase().includes(query)) score += 20;
  if (recording.tag && recording.tag.toLowerCase().includes(query)) score += 10;
  return score;
}

export function publicRecording(recording, segments, clientId, clientName, options = {}) {
  const canManage = canManageRecording(recording, clientId, clientName);
  const canDeleteAll = options.canDeleteAllRecordings || false;
  const canDelete = canDeleteAll || canDeleteRecording(recording, clientId, clientName);
  const isOwner = recording.ownerClientId === clientId || recording.ownerName === clientName;

  return {
    id: recording.id,
    seq: recording.seq,
    name: recording.name,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
    size: recording.size,
    fileName: recording.fileName,
    favorite: recording.favorite,
    ownerClientId: canManage ? recording.ownerClientId : "",
    ownerName: recording.ownerName,
    shared: recording.shared,
    sharedAt: recording.sharedAt,
    speakerName: recording.speakerName,
    speakerMap: recording.speakerMap || {},
    tag: recording.tag,
    deletedAt: recording.deletedAt,
    transcriptProvider: recording.transcriptProvider,
    transcriptSource: recording.transcriptSource,
    transcribedAt: recording.transcribedAt,
    folderId: recording.folderId,
    status: recording.status,
    source: recording.source,
    errorMessage: recording.errorMessage || "",
    transcriptPath: canManage ? recording.transcriptPath : "",
    storagePath: canManage ? recording.storagePath : "",
    meetingOutline: recording.meetingOutline || null,
    meetingOutlineStatus: recording.meetingOutlineStatus || "",
    meetingOutlinedAt: recording.meetingOutlinedAt || "",
    canManage,
    canDelete,
    isOwner,
    segments: segments || [],
  };
}

export function resolveRecordingAudioPath(recording, projectRoot) {
  const candidates = [
    recording?.storagePath,
    recording?.storagePath ? path.resolve(projectRoot, recording.storagePath) : "",
    recording?.fileName ? path.join(audioDir, recording.fileName) : "",
    recording?.id ? path.join(audioDir, `${recording.id}.mp3`) : "",
    recording?.storagePath ? path.join(audioDir, path.basename(recording.storagePath)) : "",
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
    }
  }
  return "";
}