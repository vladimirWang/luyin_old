import crypto from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { attachmentDir, audioDir, tempDir, transcriptDir, ttsDir } from "../db.mjs";
import { requestAccountPayload } from "./auth.mjs";
import { requestWecomIdentity, wecomOwnerClientId } from "./wecom.js";

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

/**
 * 获取可稳定标识当前访问者的客户端 ID。
 *
 * 已登录用户优先使用签名 Token 中的账号 ID；未登录用户使用请求中的合法
 * `x-client-id`；两者都不存在时，根据请求 IP 和 User-Agent 生成匿名 ID。
 * 客户端不能伪造 `account-` 前缀的账号 ID，返回值最长为 120 个字符。
 *
 * @param {import("express").Request} request Express 请求对象。
 * @returns {string} 账号、客户端或匿名访问者的稳定 ID。
 */
export function requestClientIdBetter(request) {
  const wecomIdentity = requestWecomIdentity(request);
  if (wecomIdentity) return wecomOwnerClientId(wecomIdentity);

  const accountPayload = requestAccountPayload(request);
  if (accountPayload?.accountId) return `account-${accountPayload.accountId}`;

  const raw = String(request.get("x-client-id") || request.query?.clientId || "").trim();
  if (raw && !raw.startsWith("account-") && !raw.startsWith("wecom-")) return raw.slice(0, 120);

  const fallback = `${request.ip || ""}|${request.get("user-agent") || ""}`;
  return `ip-${crypto.createHash("sha1").update(fallback).digest("hex").slice(0, 20)}`;
}

export function requestClientName(request) {
  const header = request.headers["x-client-name"] || request.headers["client-name"] || "";
  const param = request.query?.clientName || request.body?.clientName || "";
  return String(header || param).trim();
}

/**
 * 获取当前请求对应的用户名称，并安全解码 URL 编码的企业微信用户名。
 *
 * 已登录账号优先使用经过签名校验的 Token 用户名；否则依次读取企业微信用户
 * 名和通用客户端名称。缺少名称时返回“未设置姓名”，返回值最长为 80 个字符。
 * 无效的 URL 编码不会抛出异常，而是保留原始名称。
 *
 * @param {import("express").Request} request Express 请求对象。
 * @returns {string} 可用于录音归属和页面展示的用户名称。
 */
export function requestClientNameAndDecode(request) {
  const wecomIdentity = requestWecomIdentity(request);
  if (wecomIdentity?.name) return String(wecomIdentity.name).trim().slice(0, 80);

  const accountPayload = requestAccountPayload(request);
  if (accountPayload?.username) return String(accountPayload.username).trim().slice(0, 80);

  const raw = String(request.get("x-wecom-user-name") || requestClientName(request) || "").trim();
  if (!raw) return "未设置姓名";
  try {
    return (decodeURIComponent(raw) || "未设置姓名").slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

export function requestTrustedWecomOwner(request) {
  const identity = requestWecomIdentity(request);
  if (!identity) return null;
  const ownerClientId = wecomOwnerClientId(identity);
  const ownerName = String(identity.name || "").trim().slice(0, 80);
  const userId = String(identity.appUserId || "").trim();
  return ownerClientId && ownerName && userId ? { userId, ownerClientId, ownerName } : null;
}

export function canManageRecording(recording, clientId, clientName) {
  if (!recording) return false;
  return Boolean(recording.ownerClientId && recording.ownerClientId === clientId);
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
  const isOwner = recording.ownerClientId === clientId;

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
    fileStatus: recording.fileStatus || (recording.storagePath ? "ready" : "pending"),
    transcriptStatus:
      recording.transcriptStatus ||
      ((segments || []).length > 0
        ? "ready"
        : recording.status === "failed"
          ? "failed"
          : recording.status === "transcribing" || recording.status === "processing"
            ? "transcribing"
            : "waiting"),
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

// 拿到录音文件的绝对路径
export function resolveRecordingAudioPathBetter(recording, projectRoot) {
  const storagePath = String(recording?.storageKey || "").trim();
  if (!storagePath) return "";

  if (!path.isAbsolute(storagePath) && !projectRoot) {
    return "";
  }

  const resolvedPath = path.isAbsolute(storagePath)
    ? storagePath
    : path.resolve(projectRoot, storagePath);

  try {
    return statSync(resolvedPath).isFile() ? resolvedPath : "";
  } catch {
    return "";
  }
}
