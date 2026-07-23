import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import multer from "multer";
import PDFDocument from "pdfkit";
import logger from "./utils/log.js";
import { requestAccountPayload, signAccountToken, normalizeAccountUsername, accountClientId, passwordHash, verifyPassword } from "./utils/auth.mjs";
import { canReadRecording, parseJsonObject, splitEnvList, envFlag, firstNonEmptyValue, asArray, boundedNumber, normalizeTtsText, detectTtsAudioFormat, userSafeErrorMessage, userSafeTranscriptionError } from "./utils/common.mjs";
import {
  answerRecordingsQuestion,
  answerRecordingQuestion,
  expandTranscriptSegments,
  generateDailyMeetingBrief,
  generateRecordingTag,
  generateMeetingOutline,
  getTranscriptionDiagnostics,
  getTranscriptionMode,
  isRecordingApiTranscriptionEnabled,
  isFallbackTranscript,
  translateTranscriptToChinese,
  transcribeRecording,
  transcribeVoiceInputRecording,
} from "./transcription.mjs";
import { attachmentDir, audioDir, loadDb, tempDir, transcriptDir, ttsDir, updateDb } from "./db.mjs";
import { convertAudioFileToMp3, fileInfo, mergeAudioFilesToMp3, probeAudioDurationMs, writeTranscriptTextFile } from "./media.mjs";
import {init} from "./init.mjs";
import recordingsRouter, { configure as configureRecordingsRouter } from "./router/recordings.js";
import recordingUploadSessionsRouter, { configure as configureRecordingUploadSessionsRouter } from "./router/recordingUploadSessions.js";
import tencentMeetingRouter, { configure as configureTencentMeetingRouter } from "./router/tencentMeeting.js";
import ttsRouter, { configure as configureTtsRouter } from "./router/tts.js";
import wecomRouter from "./router/wecom.js";
import healthRouter, { configure as configureHealthRouter } from "./router/health.js";
import meetingBriefsRouter, { configure as configureMeetingBriefsRouter } from "./router/meetingBriefs.js";
import qaMessagesRouter, { configure as configureQaMessagesRouter } from "./router/qaMessages.js";
import askRouter, { configure as configureAskRouter } from "./router/ask.js";
import voiceInputRouter, { configure as configureVoiceInputRouter } from "./router/voiceInput.js";
import profileRouter, { configure as configureProfileRouter } from "./router/profile.js";
import transcriptionRouter, { configure as configureTranscriptionRouter } from "./router/transcription.js";
import authRouter, { configure as configureAuthRouter } from "./router/auth.js";
import foldersRouter, { configure as configureFoldersRouter } from "./router/folders.js";
import algoRouter from "./router/algo.js";
import { requestClientIdBetter, resolveRecordingAudioPath, resolveRecordingAudioPathBetter } from "./utils/recordings.js";
import { publishRecordingEvent } from "./utils/recordingEvents.mjs";
import {
  expandTencentMeetingKeyCandidates,
  loadTencentMeetingStsToken,
  requestTencentMeetingStsTokenIfNeeded,
  tencentMeetingApiConfig,
  tencentMeetingApiRequest,
  tencentMeetingEventTimeMs,
  tencentMeetingTimestampMs,
  tencentMeetingDurationValueMs,
  tencentMeetingDurationMsFromFile,
  tencentMeetingDisplayTime,
  tencentMeetingPlaceholderName,
  tencentMeetingPlaceholderTag,
  tencentMeetingImportTag,
  tencentMeetingRecordFileId,
  isTencentMeetingRecording,
  tencentMeetingMeetingRecordId,
  tencentMeetingSourceKindFromEvent,
  tencentMeetingRecordFiles,
  tencentMeetingRecordsFromPayload,
  firstTencentMeetingMediaUrl,
  tencentMeetingDownloadUrlFromFile,
  tencentMeetingSummaryFilesFromPayload,
  tencentMeetingSummaryDownloadUrlsFromPayload,
  isTencentMeetingTranscriptUnavailableError,
  tencentMeetingTranscriptErrorKind,
  dominantTencentMeetingTranscriptFailure,
  isTencentMeetingTranscriptFinalWindowExpired,
  tencentMeetingTranscriptFinalStatus,
  tencentMeetingTranscriptSpeakerName,
  tencentMeetingTranscriptSegmentsFromPayload,
  tencentMeetingTranscriptSegmentsFromText,
  tencentMeetingNameFromDetail,
  tencentMeetingOwnerNameFromDetail,
  tencentMeetingCreatorUseridFromDetail,
  tencentMeetingOperateTimeFromRecord,
  tencentMeetingInfoFromRecordFile,
  tencentMeetingSyncInfoFromRecording,
  tencentMeetingPendingBatchSize,
  tencentMeetingDiscoveryWindow,
  tencentMeetingSummaryFallbackEnabled,
  tencentMeetingAudioSyncEnabled,
  tencentMeetingCallbackUrl,
  tencentMeetingStsOperatorId,
  tencentMeetingImportOwnerClientId,
  tencentMeetingImportOwnerName,
  tencentMeetingSourceKey,
  tencentMeetingApiConfigured,
  isTencentMeetingTranscriptSyncEvent,
  tencentMeetingTranscriptRetryIntervalMs,
  tencentMeetingTranscriptSyncMaxAttempts,
  TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER,
  tencentMeetingQuery,
  tencentMeetingSearchWindow,
  tencentMeetingCandidateOperatorParams,
  tencentMeetingCandidateUserIds,
  tencentMeetingCandidateDownloadIdentityParams,
  tencentMeetingCandidateTranscriptOperatorParams,
  tencentMeetingWebhookConfig,
  tencentMeetingWebhookStatus,
} from "./utils/tencentMeeting.mjs";
// import prisma from './plugins/prisma.js';
import {removeFileIfExists} from './utils/file.js'
import {getWecomUserByUserId} from './utils/wecom.js'
import {projectRoot} from './config.js'
import {TENCENT_MEETING_SOURCE_PREFIX} from './constant.js'
import { recordingFromPrisma, transcriptSegmentFromPrisma } from "./repositories/recordings.mjs";
import { listTencentMeetingWebhookPayloadHistory } from "./repositories/tencentMeetingWebhookEvents.mjs";
import {connectRedis} from './plugins/redis.js'
import { startTencentMeetingStsTokenCron } from "./cron/tencentMeeting.js";
const prisma = await import('./plugins/prisma.cjs').then(m => m.default || m);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const projectRoot = path.resolve(__dirname, "..");
console.log("-----projectRoot-----", projectRoot)
const distDir = path.join(projectRoot, "dist");
const qaJobs = new Map();
const qaMessageCache = new Map();
const dailyBriefJobs = new Map();
const ttsInFlight = new Map();
const transcriptionJobs = new Set();
const meetingOutlineJobs = new Map();
const cancelledRecordingJobs = new Set();
const recordingJobVersions = new Map();
let transcriptionJobChain = Promise.resolve();
const DAILY_BRIEF_TIMEZONE = "Asia/Shanghai";
const DAILY_BRIEF_TITLE = "今日会议简报";
const dailyBriefScheduleState = { lastDate: "" };
const ACCOUNT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 45;
const MIN_VALID_RECORDING_DURATION_MS = 1000;

function recordingJobVersion(recordingId) {
  return recordingJobVersions.get(String(recordingId || "").trim()) || 0;
}

function isRecordingJobCancelled(recordingId, jobVersion) {
  const id = String(recordingId || "").trim();
  return cancelledRecordingJobs.has(id) || (jobVersion !== undefined && recordingJobVersion(id) !== jobVersion);
}

function cancelRecordingJobs(recordingId) {
  const id = String(recordingId || "").trim();
  if (!id) return { transcription: false, meetingOutline: false, tencentMeetingImport: false, tencentMeetingTranscript: false };
  const state = {
    transcription: transcriptionJobs.has(id),
    meetingOutline: meetingOutlineJobs.has(id),
    tencentMeetingImport: tencentMeetingImportJobs.has(id),
    tencentMeetingTranscript: tencentMeetingTranscriptJobs.has(id),
  };
  recordingJobVersions.set(id, recordingJobVersion(id) + 1);
  cancelledRecordingJobs.add(id);
  transcriptionJobs.delete(id);
  meetingOutlineJobs.delete(id);
  tencentMeetingImportJobs.delete(id);
  tencentMeetingTranscriptJobs.delete(id);
  return state;
}

function releaseRecordingJobCancellation(recordingId) {
  cancelledRecordingJobs.delete(String(recordingId || "").trim());
}

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const raw = await readFile(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

await connectRedis()
await init();
console.log("process.env.PORT:", process.env.PORT);
// await loadEnvFile(path.join(projectRoot, ".env"));

const port = Number(process.env.PORT);
const host = process.env.HOST || "0.0.0.0";
// const host = '192.168.1.156'
const httpsPort = Number(process.env.HTTPS_PORT || 0);

const app = express();
app.info = "peter";

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return { passwordSalt: salt, passwordHash: passwordHash(password, salt) };
}

const DELETE_ALL_ACCOUNT_USERNAME = normalizeAccountUsername(process.env.DELETE_ALL_ACCOUNT_USERNAME || "zhangqi");
const DELETE_ALL_ACCOUNT_PASSWORD = String(process.env.DELETE_ALL_ACCOUNT_PASSWORD || "1234598");

// 是否可删除所有录音的特殊管理员账号
function isDeleteAllAccountUsername(value = "") {
  // return Boolean(DELETE_ALL_ACCOUNT_USERNAME) && normalizeAccountUsername(value) === DELETE_ALL_ACCOUNT_USERNAME;
  return false;
}

function deleteAllAccountProfile(account = null) {
  const profile = account?.profile && typeof account.profile === "object" ? account.profile : {};
  return {
    ...profile,
    name: profile.name || DELETE_ALL_ACCOUNT_USERNAME,
    username: DELETE_ALL_ACCOUNT_USERNAME,
    role: "delete-all",
    canDeleteAllRecordings: true,
  };
}

function ensureDeleteAllAccount(db) {
  if (!DELETE_ALL_ACCOUNT_USERNAME || !DELETE_ALL_ACCOUNT_PASSWORD) return null;
  db.accounts = Array.isArray(db.accounts) ? db.accounts : [];
  const now = new Date().toISOString();
  const found = db.accounts.find((item) => isDeleteAllAccountUsername(item.username));
  if (found) {
    if (!verifyPassword(DELETE_ALL_ACCOUNT_PASSWORD, found)) {
      Object.assign(found, createPasswordRecord(DELETE_ALL_ACCOUNT_PASSWORD));
    }
    found.username = DELETE_ALL_ACCOUNT_USERNAME;
    found.profile = deleteAllAccountProfile(found);
    found.updatedAt = now;
    return found;
  }

  const created = {
    id: `admin-${crypto.createHash("sha1").update(DELETE_ALL_ACCOUNT_USERNAME).digest("hex").slice(0, 12)}`,
    username: DELETE_ALL_ACCOUNT_USERNAME,
    ...createPasswordRecord(DELETE_ALL_ACCOUNT_PASSWORD),
    profile: deleteAllAccountProfile(),
    createdAt: now,
    updatedAt: now,
  };
  db.accounts.push(created);
  return created;
}

function publicAccount(account) {
  const profile = account?.profile && typeof account.profile === "object" ? account.profile : {};
  const username = account?.username || profile.username || "";
  const canDeleteAllRecordings = isDeleteAllAccountUsername(username) || Boolean(profile.canDeleteAllRecordings);
  return {
    id: account?.id || "",
    username,
    canDeleteAllRecordings,
    clientId: accountClientId(account?.id || ""),
    profile: {
      ...profile,
      name: username || profile.name || "",
      username,
      accountId: account?.id || "",
      clientId: accountClientId(account?.id || ""),
      accountLoggedIn: Boolean(account?.id),
      canDeleteAllRecordings,
    },
  };
}

function clientProfileForRequest(db, request) {
  const accountPayload = requestAccountPayload(request);
  const account = accountPayload?.accountId ? (db.accounts || []).find((item) => item.id === accountPayload.accountId) : null;
  const clientId = account ? accountClientId(account.id) : requestClientIdBetter(request);
  const clientProfiles =
    db.clientProfiles && typeof db.clientProfiles === "object" && !Array.isArray(db.clientProfiles)
      ? db.clientProfiles
      : {};
  const {
    name,
    avatarUrl,
    wecomName,
    wecomUserName,
    wecomNickname,
    wecomNickName,
    wecomUserId,
    phone,
    ...sharedDefaults
  } = db.profile || {};
  const ownProfile = account ? account.profile || {} : clientProfiles[clientId] || {};
  return {
    ...sharedDefaults,
    ...ownProfile,
    name: account?.username || String(ownProfile.name || "").trim() || "未设置姓名",
    avatarUrl: ownProfile.avatarUrl || "",
    phone: ownProfile.phone || "",
    clientId,
    accountId: account?.id || "",
    username: account?.username || ownProfile.username || "",
    accountLoggedIn: Boolean(account),
    clientProfileSaved: Boolean(account || clientProfiles[clientId]),
  };
}

function profilePatchForClient(body = {}) {
  const allowedFields = [
    "name",
    "avatarUrl",
    "company",
    "department",
    "phone",
    "language",
    "recordsTitle",
    "wecomName",
    "wecomUserName",
    "wecomNickname",
    "wecomNickName",
    "wecomUserId",
    "wecomConfigured",
  ];
  return allowedFields.reduce((patch, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field];
    return patch;
  }, {});
}

function accountAuthResponse(account) {
  const expiresAt = Date.now() + ACCOUNT_TOKEN_TTL_MS;
  const token = signAccountToken({
    accountId: account.id,
    username: account.username,
    expiresAt,
  });
  return {
    token,
    expiresAt,
    account: publicAccount(account),
    profile: publicAccount(account).profile,
  };
}

function mergeLocalClientDataIntoAccount(db, sourceClientId, account, profilePatch = {}) {
  const targetClientId = accountClientId(account.id);
  const sourceProfile =
    db.clientProfiles && typeof db.clientProfiles === "object" && !Array.isArray(db.clientProfiles)
      ? db.clientProfiles[sourceClientId] || {}
      : {};
  const accountProfile = {
    ...(account.profile || {}),
    ...sourceProfile,
    ...profilePatch,
    name: account.username,
    username: account.username,
    accountId: account.id,
    clientId: targetClientId,
    accountLoggedIn: true,
    updatedAt: new Date().toISOString(),
  };
  account.profile = accountProfile;
  account.updatedAt = new Date().toISOString();

  if (!db.clientProfiles || typeof db.clientProfiles !== "object" || Array.isArray(db.clientProfiles)) db.clientProfiles = {};
  db.clientProfiles[targetClientId] = accountProfile;
  delete db.clientProfiles[sourceClientId];

  for (const recording of db.recordings || []) {
    if (recording.ownerClientId === sourceClientId || recording.ownerClientId === targetClientId) {
      recording.ownerClientId = targetClientId;
      recording.ownerName = account.username;
      recording.shared = false;
      recording.updatedAt = new Date().toISOString();
    }
  }

  for (const message of db.qaMessages || []) {
    if (message.clientId === sourceClientId || message.clientId === targetClientId) {
      message.clientId = targetClientId;
      message.updatedAt = new Date().toISOString();
    }
  }

  return account;
}

function qwenTtsConfig() {
  const apiKey = String(process.env.QWEN_TTS_API_KEY || process.env.DASHSCOPE_API_KEY || "").trim();
  const workspaceId = String(process.env.QWEN_TTS_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE_ID || "").trim();
  const endpoint = String(process.env.QWEN_TTS_ENDPOINT || "").trim();
  const region = String(process.env.QWEN_TTS_REGION || "cn-beijing").trim();
  return {
    apiKey,
    workspaceId,
    endpoint,
    region,
    model: String(process.env.QWEN_TTS_MODEL || "qwen-tts").trim(),
    voice: String(process.env.QWEN_TTS_VOICE || "Cherry").trim(),
  };
}

function qwenTtsEndpoint(config = qwenTtsConfig()) {
  if (config.endpoint) return config.endpoint.replace(/\/$/, "");
  return "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
}

function ttsDiagnostics() {
  const config = qwenTtsConfig();
  return {
    provider: "qwen-tts",
    model: config.model,
    configured: Boolean(config.apiKey),
    workspaceConfigured: Boolean(config.workspaceId || config.endpoint),
  };
}

function extractQwenTtsAudioUrl(payload) {
  const candidates = [
    payload?.output?.audio?.url,
    payload?.output?.audio_url,
    payload?.output?.url,
    payload?.audio?.url,
    payload?.url,
  ];
  return String(candidates.find(Boolean) || "").trim();
}

function ttsAudioUrl(id, ext) {
  return `/api/tts/${id}/audio.${ext || "mp3"}`;
}

async function findCachedTtsAudio(cacheKey) {
  for (const ext of ["wav", "mp3", "ogg", "flac"]) {
    const filePath = path.join(ttsDir, `${cacheKey}.${ext}`);
    if (!existsSync(filePath)) continue;

    const buffer = await readFile(filePath);
    const format = detectTtsAudioFormat(buffer, ext);
    if (format.ext !== ext) {
      const correctedPath = path.join(ttsDir, `${cacheKey}.${format.ext}`);
      if (!existsSync(correctedPath)) {
        await writeFile(correctedPath, buffer);
      }
      await rm(filePath, { force: true });
      return { filePath: correctedPath, ...format };
    }

    return { filePath, ...format };
  }
  return null;
}

async function generateQwenTtsAudio(text, options = {}) {
  const normalizedText = normalizeTtsText(text);
  if (!normalizedText) throw new Error("朗读文字不能为空");
  if (Array.from(normalizedText).length > 512) throw new Error("朗读内容过长，请稍后重试或分段朗读。");

  const config = qwenTtsConfig();
  if (!config.apiKey) throw new Error("QWEN-TTS 未配置，请在 .env 设置 DASHSCOPE_API_KEY 或 QWEN_TTS_API_KEY");

  const voice = String(options.voice || config.voice || "Cherry").trim();
  const model = String(options.model || config.model || "qwen-tts").trim();
  const cacheKey = crypto
    .createHash("sha1")
    .update(JSON.stringify({ provider: "qwen-tts", model, voice, text: normalizedText }))
    .digest("hex");
  const cachedAudio = await findCachedTtsAudio(cacheKey);

  if (cachedAudio) {
    return {
      id: cacheKey,
      url: ttsAudioUrl(cacheKey, cachedAudio.ext),
      cached: true,
      contentType: cachedAudio.contentType,
      textLength: normalizedText.length,
    };
  }

  const pending = ttsInFlight.get(cacheKey);
  if (pending) return pending;

  const job = (async () => {
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable",
    };

    const response = await fetch(qwenTtsEndpoint(config), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: {
          text: normalizedText,
          voice,
        },
      }),
      signal: AbortSignal.timeout(Math.max(5000, Number(process.env.QWEN_TTS_TIMEOUT_MS || 90000))),
    });

    const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
    if (!response.ok) {
      const message = payload?.message || payload?.error?.message || payload?.code || "QWEN-TTS 生成失败";
      throw new Error(String(message));
    }

    const audioUrl = extractQwenTtsAudioUrl(payload);
    if (!audioUrl) throw new Error("QWEN-TTS 未返回音频地址");

    const audioResponse = await fetch(audioUrl, {
      signal: AbortSignal.timeout(Math.max(5000, Number(process.env.QWEN_TTS_DOWNLOAD_TIMEOUT_MS || 30000))),
    });
    if (!audioResponse.ok) throw new Error("QWEN-TTS 音频下载失败");
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioFormat = detectTtsAudioFormat(audioBuffer);
    await writeFile(path.join(ttsDir, `${cacheKey}.${audioFormat.ext}`), audioBuffer);
    return {
      id: cacheKey,
      url: ttsAudioUrl(cacheKey, audioFormat.ext),
      cached: false,
      contentType: audioFormat.contentType,
      textLength: normalizedText.length,
    };
  })().finally(() => ttsInFlight.delete(cacheKey));

  ttsInFlight.set(cacheKey, job);
  return job;
}

const audioDownloadTokenSecret =
  process.env.AUDIO_DOWNLOAD_TOKEN_SECRET ||
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(`${projectRoot}:audio-download`).digest("hex");

function createAudioDownloadToken(recordingId, ttlMs = 30 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${recordingId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", audioDownloadTokenSecret).update(payload).digest("base64url");
  return `${expiresAt}.${signature}`;
}

function configuredPublicBaseUrl() {
  const candidates = [
    process.env.TENCENT_ASR_PUBLIC_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.APP_PUBLIC_URL,
    process.env.APP_BASE_URL,
  ];
  const value = candidates.map((item) => String(item || "").trim()).find(Boolean);
  return value ? value.replace(/\/+$/, "") : "";
}

function createAsrAudioUrl(recording) {
  const baseUrl = configuredPublicBaseUrl();
  if (!baseUrl || !recording?.id) return "";
  const token = createAudioDownloadToken(recording.id, 6 * 60 * 60 * 1000);
  return `${baseUrl}/api/recordings/${encodeURIComponent(recording.id)}/audio.mp3?token=${encodeURIComponent(token)}`;
}

function hasValidAudioDownloadToken(token, recordingId) {
  const raw = String(token || "").trim();
  if (!raw || !recordingId) return false;
  const [expiresAtText, signature = ""] = raw.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const payload = `${recordingId}.${expiresAtText}`;
  const expected = crypto.createHmac("sha256", audioDownloadTokenSecret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function canManageRecording(recording, clientId) {
  const ownerClientId = String(recording.ownerClientId || "").trim();
  const viewerClientId = String(clientId || "").trim();
  return !ownerClientId || ownerClientId === viewerClientId;
}

function canDeleteRecording(recording, clientId) {
  return canManageRecording(recording, clientId) || canReadRecording(recording, clientId);
}

const uploadSessionRoot = path.join(tempDir, "recording-upload-sessions");
await mkdir(uploadSessionRoot, { recursive: true });

const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
});

const tencentMeetingImportJobs = new Set();
const tencentMeetingTranscriptJobs = new Set();
const tencentMeetingCreatorNameCache = new Map();
const TENCENT_MEETING_SSE_MOCK_DELAY_MS = 4_000;

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function publishRecordingSnapshot(recordingId, type = "recording.updated") {
  const row = await prisma.recording.findFirst({
    where: { id: recordingId, deletedAt: null },
  });
  if (!row) return null;
  const recording = recordingFromPrisma(row);
  publishRecordingEvent(type, recording);
  return recording;
}

async function updateRecordingRealtimeState(recordingId, data = {}) {
  const updated = await prisma.recording.updateMany({
    where: { id: recordingId, deletedAt: null },
    data: {
      ...data,
      updatedAt: data.updatedAt || new Date(),
    },
  });
  if (updated.count) await publishRecordingSnapshot(recordingId);
  return updated;
}
let tencentMeetingCloudDiscoveryJob = null;

function logTencentMeetingTranscriptTrace(stage, details = {}) {
  const metadata = { stage, ...details };
  logger.info(`tencent_meeting.transcript.${stage}`, {
    message: Object.entries(details)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
    ...metadata,
  });
  console.info(`[Tencent Meeting][Transcript] ${stage}`, metadata);
}

function emitTencentMeetingTranscriptDiagnosticEnd(details = {}) {
  logger.info("tencent_meeting.transcript.diagnostic_end", {
    message: TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER,
    ...details,
  });
  console.info(TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER, details);
}

const LOCAL_TRANSCRIPTION_SWEEP_INTERVAL_MS = 30 * 1000;
const LOCAL_TRANSCRIPTION_SWEEP_LIMIT = 8;
const configuredMeetingOutlineStaleMs = Number(process.env.MEETING_OUTLINE_STALE_MS);
const configuredMeetingOutlineSweepIntervalMs = Number(process.env.MEETING_OUTLINE_SWEEP_INTERVAL_MS);
const configuredMeetingOutlineSweepLimit = Number(process.env.MEETING_OUTLINE_SWEEP_LIMIT);
const MEETING_OUTLINE_STALE_MS = Number.isFinite(configuredMeetingOutlineStaleMs)
  ? Math.max(60_000, configuredMeetingOutlineStaleMs)
  : 20 * 60 * 1000;
const MEETING_OUTLINE_SWEEP_INTERVAL_MS = Number.isFinite(configuredMeetingOutlineSweepIntervalMs)
  ? Math.max(30_000, configuredMeetingOutlineSweepIntervalMs)
  : 60 * 1000;
const MEETING_OUTLINE_SWEEP_LIMIT = Number.isFinite(configuredMeetingOutlineSweepLimit)
  ? Math.max(1, Math.round(configuredMeetingOutlineSweepLimit))
  : 4;
let pendingLocalTranscriptionSweepAt = 0;

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.globalConfi = {"wecomConfig": 123}

// 加全局请求日志
app.use((request, response, next) => {
  const startedAt = Date.now();
  console.log("进入全局请求日志: ", request.method, request.originalUrl || request.url);
  response.on("finish", () => {
    logger.info("http_request", {message: `${request.method} ${request.originalUrl || request.url} ${response.statusCode} ${Date.now() - startedAt}ms`, method: request.method, path: request.originalUrl || request.url, status: response.statusCode, durationMs: Date.now() - startedAt, ip: request.ip, userAgent: request.get("user-agent") || "", contentLength: response.get("content-length") || ""});
  });
  next();
});

app.get("/api/prisma-connected", async (req, res) => {
  
  let dbConnected = false;
  let dbError = null;
  try {
    await prisma.$connect();
    res.json({ ping: `pong ${Date.now()}`, connected: true, error: null });
  } catch (error) {
    res.json({ ping: `pong ${Date.now()}`, connected: false, error: error.message });
  }

});

app.get("/api/ping", async (req, res) => {
  await prisma.$connect();
  let dbConnected = false;
  let dbError = null;
  try {
    const mariadb = await import("mysql2/promise");
    logger.debug('/api/ping step 0')
    const conn = await mariadb.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "123456",
      database: process.env.MYSQL_DATABASE || "wecom_recorder",
    });
    logger.debug('/api/ping step 1')
    const [rows] = await conn.execute('SELECT 1');
    logger.debug('/api/ping step 2')
    dbConnected = true;
    await conn.end();
    logger.debug('/api/ping step 3')
  } catch (error) {
    dbError = error.message;
  }
  res.json({ ping: `pong ${Date.now()}`, dbConnected, dbError })
});

configureRecordingsRouter(projectRoot, {
  queueTranscriptionJob,
  hasValidAudioDownloadToken,
  createAudioDownloadToken,
  queueTencentMeetingImportSync,
  queueTencentMeetingTranscriptSync,
  isLocalApiTranscriptionRecording,
  schedulePendingLocalTranscriptionSweep,
  findReusableQaMessage,
  publicQaMessage,
  persistQaAttachments,
  cacheQaMessage,
  persistQaMessageSnapshot,
  scheduleQaJob,
  verifiedStoredRecording,
  canManageRecording,
  canDeleteRecording,
  findRecording,
  findSegments,
  publicRecording,
  resolveRecordingAudioPath,
  generateAndStoreMeetingOutline,
  renderMeetingOutlinePdf,
  cancelRecordingJobs,
  releaseRecordingJobCancellation,
});
app.use("/api/recordings", recordingsRouter);

configureRecordingUploadSessionsRouter(projectRoot, {
  queueTranscriptionJob,
  verifiedStoredRecording,
  publicRecording,
});
app.use("/api/recording-upload-sessions", recordingUploadSessionsRouter);

configureTencentMeetingRouter({
  queueTencentMeetingCloudDiscovery,
  queueTencentMeetingPendingImports,
  importTencentMeetingCloudRecordingsFromApi,
  importTencentMeetingAudioCompletedPayload,
  importTencentMeetingRecordingCompletedPayload,
  importTencentMeetingTranscriptReadyPayload,
});
app.use("/api/tencentMeeting", tencentMeetingRouter);
app.use("/api/tencent-meeting", tencentMeetingRouter);
app.use("/tencent-meeting", tencentMeetingRouter);

configureTtsRouter({
  generateQwenTtsAudio,
  findCachedTtsAudio,
});
app.use("/api/tts", ttsRouter);

app.use("/api/wecom", wecomRouter);

configureHealthRouter({
  getTranscriptionDiagnostics,
  ttsDiagnostics,
});
app.use("/api/health", healthRouter);

configureMeetingBriefsRouter({
  dailyBriefDateParts,
  loadDb,
  recordingsForBriefDate,
  findDailyBrief,
  emptyDailyBrief,
  updateDb,
  upsertDailyBriefInDb,
  publicDailyBrief,
  isOrphanDailyBriefGenerating,
  queueDailyBriefGeneration,
  shouldGenerateDailyBrief,
  dailyBriefDateKeysForRecordings,
  dailyBriefOwnerKey,
  dailyBriefPartsFromDateKey,
  dailyBriefPlaceholder,
  normalizeDailyBriefDateParam,
  renderDailyBriefPdf,
  safeDownloadName,
});
app.use("/api/meeting-briefs", meetingBriefsRouter);

configureQaMessagesRouter({
  loadDb,
  canReadQaMessage,
  qaMessageCache,
  schedulePendingQaMessages,
  publicQaMessage,
  cachedQaMessage,
  scheduleQaJob,
  findQaMessage,
  updateDb,
  renderQaMessagePdf,
  safeDownloadName,
  existsSync,
});
app.use("/api/qa-messages", qaMessagesRouter);

configureAskRouter({
  loadDb,
  findReusableQaMessage,
  publicQaMessage,
  scheduleQaJob,
  crypto,
  persistQaAttachments,
  cacheQaMessage,
  persistQaMessageSnapshot,
});
app.use("/api/ask", askRouter);

configureVoiceInputRouter({
  upload,
  crypto,
  tempDir,
  convertAudioFileToMp3,
  fileInfo,
  getTranscriptionMode,
  expandTranscriptSegments,
  transcribeVoiceInputRecording,
});
app.use("/api/voice-input", voiceInputRouter);

configureProfileRouter({
  loadDb,
  clientProfileForRequest,
  requestAccountPayload,
  updateDb,
  profilePatchForClient,
});
app.use("/api/profile", profileRouter);

configureTranscriptionRouter({
  getTranscriptionDiagnostics,
});
app.use("/api/transcription", transcriptionRouter);

configureAuthRouter({
  loadDb,
  requestAccountPayload,
  publicAccount,
  profilePatchForClient,
  updateDb,
  ensureDeleteAllAccount,
  mergeLocalClientDataIntoAccount,
  crypto,
  createPasswordRecord,
  logger,
  accountAuthResponse,
});
app.use("/api/auth", authRouter);

configureFoldersRouter({
  loadDb,
  canReadFolder,
  publicFolder,
  updateDb,
  crypto,
});
app.use("/api/folders", foldersRouter);
app.use("/api/algo", algoRouter);

function isLocalApiTranscriptionRecording(recording = {}) {
  const LOCAL_API_TRANSCRIPTION_SOURCES = new Set(["wecom-h5", "wecom-h5-long-session", "wecom-h5-resumed"]);
  const result = LOCAL_API_TRANSCRIPTION_SOURCES.has(String(recording.source).trim());
  return result
}

function extractTencentMeetingRecordingEvents(payload) {
  if (!payload || typeof payload !== "object") return [];
  const event = String(payload.event || "").trim();
  const containers = [
    payload,
    ...asArray(payload.payload),
    ...asArray(payload.Payload),
    ...asArray(payload.data),
    ...asArray(payload.Data),
  ];
  const entries = [];
  const seen = new Set();

  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const meetingInfo = container.meeting_info || container.meetingInfo || payload.meeting_info || payload.meetingInfo || {};
    const creator = meetingInfo.creator || container.creator || payload.creator || {};
    const operator = container.operator || payload.operator || {};
    const nestedFiles = [
      ...asArray(container.recording_files),
      ...asArray(container.recordingFiles),
      ...asArray(container.record_files),
      ...asArray(container.records),
      ...asArray(container.record_file),
      ...asArray(container.recordFile),
      ...asArray(container.meeting_record),
      ...asArray(container.meetingRecord),
    ];
    const files = nestedFiles.length
      ? nestedFiles
      : tencentMeetingRecordFileId(container)
        ? [container]
        : [];
    const operateTime =
      container.operate_time ||
      container.operateTime ||
      payload.operate_time ||
      payload.operateTime ||
      payload.timestamp ||
      Date.now();
    for (const file of files) {
      const recordFileId = tencentMeetingRecordFileId(file);
      if (!recordFileId || seen.has(recordFileId)) continue;
      seen.add(recordFileId);
      const fileOwner = file?.owner || file?.file_owner || file?.fileOwner || file?.user || file?.creator || {};
      const durationMs = tencentMeetingDurationMsFromFile(file, meetingInfo, container);
      entries.push({
        event,
        recordFileId,
        meetingRecordId: tencentMeetingMeetingRecordId(container, file),
        sourceKind: tencentMeetingSourceKindFromEvent(event, container, file),
        operateTime,
        subject:
          firstNonEmptyValue([
            file?.subject,
            file?.meeting_subject,
            file?.meetingSubject,
            file?.record_file_name,
            file?.recordFileName,
            file?.file_name,
            file?.name,
            container.subject,
            container.meeting_subject,
            container.meetingSubject,
            meetingInfo.subject,
            meetingInfo.meeting_subject,
            meetingInfo.meetingSubject,
          ]) || "",
        ownerName:
          firstNonEmptyValue([
            file?.owner_name,
            file?.ownerName,
            file?.user_name,
            file?.userName,
            file?.display_name,
            file?.displayName,
            file?.nick_name,
            file?.nickName,
            file?.nickname,
            fileOwner.user_name,
            fileOwner.userName,
            fileOwner.display_name,
            fileOwner.displayName,
            fileOwner.nick_name,
            fileOwner.nickName,
            fileOwner.nickname,
            fileOwner.username,
            fileOwner.name,
            creator.user_name,
            creator.userName,
            creator.display_name,
            creator.displayName,
            creator.nick_name,
            creator.nickName,
            creator.nickname,
            creator.username,
            creator.name,
            operator.user_name,
            operator.userName,
            operator.display_name,
            operator.displayName,
            operator.nick_name,
            operator.nickName,
            operator.nickname,
            operator.username,
            operator.name,
          ]) || "",
        creatorUserid:
          firstNonEmptyValue([
            file?.userid,
            file?.user_id,
            file?.userId,
            fileOwner.userid,
            fileOwner.user_id,
            fileOwner.userId,
            creator.userid,
            creator.user_id,
            creator.UserID,
            creator.userId,
            operator.userid,
            operator.user_id,
            operator.UserID,
            operator.userId,
          ]) || "",
        durationMs,
        meetingId: meetingInfo.meeting_id || meetingInfo.meetingId || container.meeting_id || container.meetingId || "",
        meetingCode: meetingInfo.meeting_code || meetingInfo.meetingCode || container.meeting_code || container.meetingCode || "",
        downloadUrl: tencentMeetingDownloadUrlFromFile(file),
        payload,
      });
    }
  }

  return entries;
}

function extractTencentMeetingStartedOwnerContext(payload) {
  if (!payload || typeof payload !== "object") return null;
  const event = String(payload.event || "").trim();
  if (event !== "recording.started") return null;

  const containers = asArray(payload.payload);
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const meetingInfo = container.meeting_info || {};
    const creator = meetingInfo.creator || {};
    const operator = container.operator || {};
    const ownerName = firstNonEmptyValue([
      operator.user_name,
      creator.user_name,
    ]);
    const creatorUserid = firstNonEmptyValue([
      operator.userid,
      creator.userid,
    ]);
    if (!ownerName && !creatorUserid) continue;

    const operateTime =
      container.operate_time ||
      Date.now();
    return {
      ownerName: ownerName || "",
      creatorUserid: creatorUserid || "",
      subject:
        firstNonEmptyValue([
          container.subject,
          container.meeting_subject,
          meetingInfo.subject,
          meetingInfo.meeting_subject,
        ]) || "",
      meetingId: meetingInfo.meeting_id || container.meeting_id || "",
      meetingCode: meetingInfo.meeting_code || container.meeting_code || "",
      operateTime,
      timeMs: tencentMeetingEventTimeMs(operateTime),
    };
  }
  return null;
}

function buildTencentMeetingRecorderOwnerContexts(webhookPayloads = []) {
  const startedContexts = [];
  const contextsByRecordFileId = new Map();
  const configuredMaxGapMs = Number(process.env.TENCENT_MEETING_RECORDER_OWNER_CONTEXT_MAX_AGE_MS || 36 * 60 * 60 * 1000);
  const maxGapMs = Number.isFinite(configuredMaxGapMs) ? Math.max(60 * 1000, configuredMaxGapMs) : 36 * 60 * 60 * 1000;

  for (const payload of webhookPayloads) {
    const startedContext = extractTencentMeetingStartedOwnerContext(payload);
    if (startedContext) {
      const duplicate = startedContexts.some(
        (context) =>
          context.timeMs === startedContext.timeMs &&
          context.meetingId === startedContext.meetingId &&
          context.creatorUserid === startedContext.creatorUserid,
      );
      if (!duplicate) startedContexts.push(startedContext);
      continue;
    }

    const event = String(payload?.event || "").trim();
    if (event !== "recording.audio-completed") continue;
    const completedFiles = extractTencentMeetingRecordingEvents(payload);
    if (!completedFiles.length) continue;
    const completedAt = Math.min(...completedFiles.map((info) => tencentMeetingEventTimeMs(info.operateTime)));
    let candidateIndex = -1;
    for (let index = startedContexts.length - 1; index >= 0; index -= 1) {
      const gapMs = completedAt - startedContexts[index].timeMs;
      if (gapMs >= 0 && gapMs <= maxGapMs) {
        candidateIndex = index;
        break;
      }
    }
    if (candidateIndex < 0) continue;
    const context = startedContexts[candidateIndex];
    for (const info of completedFiles) {
      contextsByRecordFileId.set(info.recordFileId, context);
    }
  }

  return contextsByRecordFileId;
}

async function loadTencentMeetingWebhookPayloadHistory() {
  try {
    return await listTencentMeetingWebhookPayloadHistory({ limit: 2000 });
  } catch (error) {
    console.warn("[Tencent Meeting] recorder owner context history skipped:", error instanceof Error ? error.message : error);
    return [];
  }
}

async function loadTencentMeetingRecorderOwnerContexts() {
  const payloads = await loadTencentMeetingWebhookPayloadHistory();
  return buildTencentMeetingRecorderOwnerContexts(payloads);
}

async function enrichTencentMeetingRecorderOwnerContexts(events = []) {
  if (!events.length) return events;
  const contexts = await loadTencentMeetingRecorderOwnerContexts();
  return events.map((info) => {
    const context = contexts.get(String(info.recordFileId || ""));
    if (!context) return info;
    return {
      ...info,
      ownerName: info.ownerName || context.ownerName || "",
      creatorUserid: info.creatorUserid || context.creatorUserid || "",
      subject: info.subject || context.subject || "",
      meetingId: info.meetingId || context.meetingId || "",
      meetingCode: info.meetingCode || context.meetingCode || "",
    };
  });
}

function cleanTencentMeetingSummaryText(text = "") {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^WEBVTT/i.test(line) && !/^\d+$/.test(line))
    .join("\n")
    .trim();
}

function parseTencentMeetingTimecode(value = "") {
  const text = String(value || "").replace(/[\[\]]/g, "").trim();
  const match = text.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const millis = Number(String(match[4] || "0").padEnd(3, "0").slice(0, 3));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

async function fetchTencentMeetingSummaryText(downloadUrl) {
  const url = String(downloadUrl || "").trim();
  if (!url) return "";
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Math.max(5000, Number(process.env.TENCENT_MEETING_SUMMARY_DOWNLOAD_TIMEOUT_MS || 30000))),
  });
  if (!response.ok) throw new Error(`Tencent Meeting summary download failed: ${response.status}`);
  return response.text();
}

async function fetchTencentMeetingSummaryTranscript(info = {}, durationMs = 0, failureKinds = []) {
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  if (!recordFileId || !tencentMeetingApiConfigured()) return null;

  const ids = [
    recordFileId,
    String(info.meetingRecordId || info.meeting_record_id || "").trim(),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  const identityParamsList = tencentMeetingCandidateDownloadIdentityParams(info);
  if (!ids.length || !identityParamsList.length) return null;
  await requestTencentMeetingStsTokenIfNeeded();

  for (const params of identityParamsList) {
    for (const id of ids) {
      try {
        const payload = await tencentMeetingApiRequest("GET", tencentMeetingQuery(`/v1/addresses/${encodeURIComponent(id)}`, params));
        const summaryUrls = tencentMeetingSummaryDownloadUrlsFromPayload(payload);
        for (const summaryUrl of summaryUrls) {
          try {
            const summaryText = await fetchTencentMeetingSummaryText(summaryUrl);
            const result = tencentMeetingTranscriptSegmentsFromText(summaryText, durationMs);
            if (result.segments.length > 0) {
              return {
                ...result,
                provider: "tencent-meeting",
                source: "meeting_summary",
                recordFileId,
                operator: params,
              };
            }
          } catch (error) {
            failureKinds.push(tencentMeetingTranscriptErrorKind(error));
            console.warn("[Tencent Meeting] summary text download skipped:", error instanceof Error ? error.message : error);
          }
        }
      } catch (error) {
        failureKinds.push(tencentMeetingTranscriptErrorKind(error));
        if (!isTencentMeetingTranscriptUnavailableError(error)) {
          console.warn("[Tencent Meeting] summary detail lookup skipped:", error instanceof Error ? error.message : error);
        }
      }
    }
  }

  return null;
}

async function findTencentMeetingDownloadTarget(info) {
  const recordFileId = String(info?.recordFileId || "").trim();
  if (!recordFileId) return null;
  const meetingRecordId = String(info?.meetingRecordId || info?.meeting_record_id || "").trim();
  if (info.downloadUrl) {
    return {
      record: info.record || {},
      file: info.file || {},
      meetingRecordId,
      name: info.subject || info.name || "",
      ownerName: info.ownerName || "",
      creatorUserid: info.creatorUserid || "",
      durationMs: Number(info.durationMs || 0),
      downloadUrl: info.downloadUrl,
    };
  }
  if (!tencentMeetingApiConfigured()) return null;
  const { startTime, endTime } = tencentMeetingSearchWindow(info);
  logger.log("[call] findTencentMeetingDownloadTarget ", {message: `startTime: ${startTime}, endTime: ${endTime}`})
  const identityParams = tencentMeetingCandidateDownloadIdentityParams(info);
  if (!identityParams.length) return null;
  await requestTencentMeetingStsTokenIfNeeded();

  for (const params of identityParams) {
    const addressIds = [...new Set([recordFileId, meetingRecordId].filter(Boolean))];
    const addressUris = addressIds.flatMap((addressId) => [
      tencentMeetingQuery(`/v1/addresses/${encodeURIComponent(addressId)}`, params),
      tencentMeetingQuery("/v1/addresses", { meeting_record_id: addressId, ...params }),
    ]);
    for (const uri of addressUris) {
      try {
        const payload = await tencentMeetingApiRequest("GET", uri);
        const file = payload.record_file || payload.file || payload.data || payload;
        const downloadUrl = tencentMeetingDownloadUrlFromFile(file);
        if (downloadUrl) {
          return {
            record: payload,
            file,
            ...params,
            meetingRecordId: tencentMeetingMeetingRecordId(payload, file, meetingRecordId),
            name: tencentMeetingNameFromDetail(payload, file, info.subject),
            ownerName: tencentMeetingOwnerNameFromDetail(payload, file, info.ownerName),
            creatorUserid: tencentMeetingCreatorUseridFromDetail(payload, file, info.creatorUserid),
            durationMs: tencentMeetingDurationMsFromFile(file, payload.meeting_info || payload.meetingInfo || payload, payload),
            downloadUrl,
          };
        }
      } catch (error) {
        console.warn("[Tencent Meeting] address lookup skipped:", error instanceof Error ? error.message : error);
      }
    }
  }

  for (const operatorParams of tencentMeetingCandidateOperatorParams()) {
    for (let page = 1; page <= 10; page += 1) {
      const uri = tencentMeetingQuery("/v1/corp/records", {
        start_time: startTime,
        end_time: endTime,
        page_size: 20,
        page,
        ...operatorParams,
      });
      try {
        const payload = await tencentMeetingApiRequest("GET", uri);
        for (const record of tencentMeetingRecordsFromPayload(payload)) {
          for (const file of tencentMeetingRecordFiles(record)) {
            const fileId = tencentMeetingRecordFileId(file);
            if (fileId !== recordFileId) continue;
            return {
              record,
              file,
              meetingRecordId: tencentMeetingMeetingRecordId(record, file, meetingRecordId),
              name: tencentMeetingNameFromDetail(record, file, info.subject),
              ownerName: tencentMeetingOwnerNameFromDetail(record, file, info.ownerName),
              creatorUserid: tencentMeetingCreatorUseridFromDetail(record, file, info.creatorUserid),
              durationMs: tencentMeetingDurationMsFromFile(file, record.meeting_info || record.meetingInfo || record, record),
              downloadUrl: tencentMeetingDownloadUrlFromFile(file),
            };
          }
        }
        const hasMore = Boolean(payload.has_remaining || payload.has_more || payload.data?.has_more);
        if (!hasMore) break;
      } catch (error) {
        console.warn("[Tencent Meeting] corp record lookup skipped:", error instanceof Error ? error.message : error);
        break;
      }
    }
  }

  for (const params of identityParams) {
    const listUri = tencentMeetingQuery("/v1/records", {
      start_time: startTime,
      end_time: endTime,
      page_size: 20,
      page: 1,
      ...params,
    });
    try {
      const payload = await tencentMeetingApiRequest("GET", listUri);
      for (const record of tencentMeetingRecordsFromPayload(payload)) {
        for (const file of tencentMeetingRecordFiles(record)) {
          const fileId = tencentMeetingRecordFileId(file);
          if (fileId !== recordFileId) continue;
          return {
            record,
            file,
            ...params,
            meetingRecordId: tencentMeetingMeetingRecordId(record, file, meetingRecordId),
            name: tencentMeetingNameFromDetail(record, file, info.subject),
            ownerName: tencentMeetingOwnerNameFromDetail(record, file, info.ownerName),
            creatorUserid: tencentMeetingCreatorUseridFromDetail(record, file, info.creatorUserid),
            durationMs: tencentMeetingDurationMsFromFile(file, record.meeting_info || record.meetingInfo || record, record),
            downloadUrl: tencentMeetingDownloadUrlFromFile(file),
          };
        }
      }
    } catch (error) {
      console.warn("[Tencent Meeting] user record lookup skipped:", error instanceof Error ? error.message : error);
    }
  }

  return null;
}

// 从腾讯会议 API 获取录音的内置转写内容
async function fetchTencentMeetingBuiltInTranscript(info = {}, durationMs = 0) {
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  if (!recordFileId) {
    logTencentMeetingTranscriptTrace("fetch_skipped", {
      reason: "missing_record_file_id",
      event: info.event || "",
    });
    return null;
  }
  if (!tencentMeetingApiConfigured()) {
    logTencentMeetingTranscriptTrace("fetch_skipped", {
      reason: "api_not_configured",
      recordFileId,
    });
    return null;
  }

  // 获取 STS Token（确保 API 调用权限）
  await requestTencentMeetingStsTokenIfNeeded();
  logger.info("[CALL] fetchTencentMeetingBuiltInTranscript", {message: `获取到 STS Token`});
  const failureKinds = [];

  const operatorParamsList = tencentMeetingCandidateTranscriptOperatorParams(info);
  logger.info("[CALL] fetchTencentMeetingBuiltInTranscript", {message: `operatorParamsList: ${JSON.stringify(operatorParamsList)}`});
  logTencentMeetingTranscriptTrace("fetch_started", {
    recordFileId,
    meetingId: info.meetingId || info.meeting_id || "",
    durationMs: Number(durationMs || 0),
    operatorCandidateCount: operatorParamsList.length,
  });
  for (const [attemptIndex, operatorParams] of operatorParamsList.entries()) {
    // 方式a 标准转写详情接口
    const uri = tencentMeetingQuery("/v1/records/transcripts/details", {
      record_file_id: recordFileId,
      meeting_id: info.meetingId || info.meeting_id || "",
      transcripts_type: Number(process.env.TENCENT_MEETING_TRANSCRIPTS_TYPE || 1),
      ...operatorParams,
    });
    logger.info("[CALL] fetchTencentMeetingBuiltInTranscript", {message: `uri: ${uri}`});
    logTencentMeetingTranscriptTrace("fetch_attempt", {
      recordFileId,
      attempt: attemptIndex + 1,
      attemptCount: operatorParamsList.length,
    });
    try {
      const payload = await tencentMeetingApiRequest("GET", uri);
      const result = tencentMeetingTranscriptSegmentsFromPayload(payload, durationMs);
      logTencentMeetingTranscriptTrace("fetch_response_parsed", {
        recordFileId,
        attempt: attemptIndex + 1,
        responseKeys: Object.keys(payload || {}).join(","),
        segmentCount: result.segments.length,
      });
      if (result.segments.length > 0) {
        return {
          ...result,
          provider: "tencent-meeting",
          recordFileId,
          operator: operatorParams,
        };
      }
    } catch (error) {
      const failureKind = tencentMeetingTranscriptErrorKind(error);
      failureKinds.push(failureKind);
      logTencentMeetingTranscriptTrace("fetch_attempt_failed", {
        recordFileId,
        attempt: attemptIndex + 1,
        failureKind,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!isTencentMeetingTranscriptUnavailableError(error)) {
        console.warn("[Tencent Meeting] built-in transcript lookup skipped:", error instanceof Error ? error.message : error);
      }
    }

  }

  const recorderSummaryFallback = String(info.event || "").trim() === "recording.audio-completed";
  if (recorderSummaryFallback || tencentMeetingSummaryFallbackEnabled(info)) {
    logTencentMeetingTranscriptTrace("summary_fallback_started", {
      recordFileId,
      event: info.event || "",
      recorderSummaryFallback,
    });
    const summaryResult = await fetchTencentMeetingSummaryTranscript(info, durationMs, failureKinds);
    logTencentMeetingTranscriptTrace("summary_fallback_completed", {
      recordFileId,
      event: info.event || "",
      segmentCount: summaryResult?.segments?.length || 0,
    });
    if (summaryResult?.segments?.length > 0) return summaryResult;
  }
  logger.info("[CALL] fetchTencentMeetingBuiltInTranscript", {message: `未获取到转写内容`});
  const failureKind = dominantTencentMeetingTranscriptFailure(failureKinds);
  logTencentMeetingTranscriptTrace("fetch_exhausted", {
    recordFileId,
    failureKind,
    attemptCount: operatorParamsList.length,
  });
  return {
    segments: [],
    unavailable: true,
    failureKind,
    recordFileId,
  };
}

async function storeTencentMeetingBuiltInTranscript(recordingId, transcriptResult, jobVersion) {
  const recordFileId = String(transcriptResult?.recordFileId || "").trim();
  if (!transcriptResult?.segments?.length) {
    logTencentMeetingTranscriptTrace("store_skipped", {
      recordingId,
      recordFileId,
      reason: "no_segments",
    });
    return false;
  }
  if (isRecordingJobCancelled(recordingId, jobVersion)) {
    logTencentMeetingTranscriptTrace("store_skipped", {
      recordingId,
      recordFileId,
      reason: "job_cancelled",
    });
    return false;
  }
  const recordingRow = await prisma.recording.findFirst({
    where: { id: recordingId, deletedAt: null },
  });
  if (!recordingRow) {
    logTencentMeetingTranscriptTrace("store_skipped", {
      recordingId,
      recordFileId,
      reason: "recording_not_found",
    });
    return false;
  }
  const recording = recordingFromPrisma(recordingRow);

  const segments = expandTranscriptSegments(transcriptResult.segments, recording.durationMs || 0);
  if (!segments.length) {
    logTencentMeetingTranscriptTrace("store_skipped", {
      recordingId,
      recordFileId,
      reason: "segments_empty_after_normalization",
    });
    return false;
  }
  logTencentMeetingTranscriptTrace("store_started", {
    recordingId,
    recordFileId,
    inputSegmentCount: transcriptResult.segments.length,
    normalizedSegmentCount: segments.length,
  });

  const { transcriptPath, transcriptRawPath, transcriptCorrectedPath, transcriptionMetaPath } = await transcriptStoragePaths(recordingId, recording);
  await writeTranscriptTextFile(recording, segments, transcriptPath);
  const rawText = transcriptResult.rawText || segments.map((segment) => segment.rawText || segment.text || "").join("\n");
  const correctedText = transcriptResult.correctedText || segments.map((segment) => segment.correctedText || segment.text || "").join("\n");
  if (rawText.trim()) await writeFile(transcriptRawPath, `${rawText.trim()}\n`, "utf8");
  if (correctedText.trim()) await writeFile(transcriptCorrectedPath, `${correctedText.trim()}\n`, "utf8");
  await writeFile(
    transcriptionMetaPath,
    `${JSON.stringify(
      {
        provider: "tencent-meeting",
        source: transcriptResult.source || "transcript_api",
        recordFileId: transcriptResult.recordFileId || "",
        importedAt: new Date().toISOString(),
        segmentCount: segments.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (isRecordingJobCancelled(recordingId, jobVersion)) {
    await Promise.all([
      transcriptPath,
      transcriptRawPath,
      transcriptCorrectedPath,
      transcriptionMetaPath,
    ].map((filePath) => removeFileIfExists(filePath)));
    return false;
  }

  const now = new Date();
  const recordingData = {
    status: "ready",
    transcriptStatus: "ready",
    updatedAt: now,
    errorMessage: "",
    transcribedAt: now,
    transcriptProvider: "tencent-meeting",
    transcriptSource: "tencent-meeting",
    transcriptPath,
    transcriptRawPath: rawText.trim() ? transcriptRawPath : "",
    transcriptCorrectedPath: correctedText.trim() ? transcriptCorrectedPath : "",
    transcriptionMetaPath,
    speakerMapJson: JSON.stringify({ ...(recording.speakerMap || {}), ...(transcriptResult.speakerMap || {}) }),
    meetingOutlineStatus: "generating",
    meetingOutlineError: "",
  };
  if (String(recording.source || "").startsWith(TENCENT_MEETING_SOURCE_PREFIX) && String(recording.tag || "").startsWith("腾讯会议")) {
    recordingData.tag = tencentMeetingImportTag(tencentMeetingSyncInfoFromRecording(recording), "已同步转写");
  }

  let persistenceStats = { deletedSegmentCount: 0, createdSegmentCount: 0, updatedRecordingCount: 0 };
  await updateRecordingRealtimeState(recordingId, {
    transcriptStatus: "persisting",
  });
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.transcriptSegment.deleteMany({ where: { recordingId } });
    const created = await tx.transcriptSegment.createMany({
      data: segments.map((segment) => ({
        id: String(segment.id || crypto.randomUUID()),
        recordingId,
        startMs: BigInt(Math.max(0, Math.round(Number(segment.startMs || 0)))),
        endMs: BigInt(Math.max(0, Math.round(Number(segment.endMs || 0)))),
        text: segment.text || "",
        confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
        speakerLabel: segment.speakerKey || segment.speakerLabel || "speaker-1",
        createdAt: now,
      })),
    });
    const updated = await tx.recording.updateMany({
      where: { id: recordingId, deletedAt: null },
      data: recordingData,
    });
    if (!updated.count) throw new Error("Recording was deleted while Tencent Meeting transcript sync was running.");
    persistenceStats = {
      deletedSegmentCount: deleted.count,
      createdSegmentCount: created.count,
      updatedRecordingCount: updated.count,
    };
  });
  logTencentMeetingTranscriptTrace("store_committed", {
    recordingId,
    recordFileId,
    ...persistenceStats,
  });
  await publishRecordingSnapshot(recordingId);

  if (isRecordingJobCancelled(recordingId, jobVersion)) return false;

  markDailyBriefDirtyForRecording(recordingId).catch((error) =>
    console.warn("[Tencent Meeting] daily brief dirty mark failed:", error instanceof Error ? error.message : error),
  );
  generateAndStoreMeetingOutline(recordingId, segments, { updateTag: true }).catch((error) =>
    console.warn("[Tencent Meeting] outline generation after transcript sync failed:", error instanceof Error ? error.message : error),
  );
  return true;
}

async function syncTencentMeetingBuiltInTranscript(recordingId, info = {}, jobVersion = recordingJobVersion(recordingId)) {
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  logger.info("[CALL] syncTencentMeetingBuiltInTranscript", {
    message: `recordingId: ${recordingId}, recordFileId: ${recordFileId}, event: ${info.event || ""}, sourceKind: ${info.sourceKind || ""}`,
  });
  logTencentMeetingTranscriptTrace("sync_started", {
    recordingId,
    recordFileId,
    event: info.event || "",
    jobVersion,
  });
  if (isRecordingJobCancelled(recordingId, jobVersion)) {
    logTencentMeetingTranscriptTrace("sync_skipped", {
      recordingId,
      recordFileId,
      reason: "job_cancelled",
    });
    return false;
  }
  if (!isTencentMeetingTranscriptSyncEvent({ event: info.event })) {
    logger.info("[Tencent Meeting] transcript sync skipped", { message: "event does not support transcript synchronization" });
    logTencentMeetingTranscriptTrace("sync_skipped", {
      recordingId,
      recordFileId,
      reason: "event_does_not_support_transcript_sync",
      event: info.event || "",
    });
    return false;
  }
  const recordingRow = await prisma.recording.findFirst({
    where: { id: recordingId, deletedAt: null },
  });
  if (!recordingRow) {
    logTencentMeetingTranscriptTrace("sync_skipped", {
      recordingId,
      recordFileId,
      reason: "recording_not_found",
    });
    return false;
  }
  const recording = recordingFromPrisma(recordingRow);
  await updateRecordingRealtimeState(recordingId, {
    transcriptStatus: "fetching",
  });
  const existingSegmentCount = await prisma.transcriptSegment.count({ where: { recordingId } });
  logger.info("[CALL] syncTencentMeetingBuiltInTranscript", {message: `transcriptSource: ${recording.transcriptSource}, existingSegments.length: ${existingSegmentCount}`});
  logTencentMeetingTranscriptTrace("recording_loaded", {
    recordingId,
    recordFileId,
    source: recording.source || "",
    transcriptSource: recording.transcriptSource || "",
    existingSegmentCount,
  });
  if (existingSegmentCount > 0 && recording.transcriptSource === "tencent-meeting") {
    await updateRecordingRealtimeState(recordingId, {
      transcriptStatus: "ready",
    });
    logger.info("[CALL] syncTencentMeetingBuiltInTranscript", {message: `已有撰写片段，且转写来源是腾讯会议，无需同步转写`});
    logTencentMeetingTranscriptTrace("sync_completed", {
      recordingId,
      recordFileId,
      result: "already_synchronized",
      existingSegmentCount,
    });
    return true;
  }
  logger.info("[CALL] syncTencentMeetingBuiltInTranscript", {message: `开始同步转写`});
  const transcriptResult = await fetchTencentMeetingBuiltInTranscript(info, recording.durationMs || info.durationMs || 0);
  if (isRecordingJobCancelled(recordingId, jobVersion)) {
    logTencentMeetingTranscriptTrace("sync_skipped", {
      recordingId,
      recordFileId,
      reason: "job_cancelled_after_fetch",
    });
    return false;
  }
  logTencentMeetingTranscriptTrace("fetch_completed", {
    recordingId,
    recordFileId,
    segmentCount: transcriptResult?.segments?.length || 0,
    unavailable: Boolean(transcriptResult?.unavailable),
    failureKind: transcriptResult?.failureKind || "",
  });
  if (!transcriptResult?.segments?.length) {
    const failureKind = transcriptResult?.failureKind || "pending";
    const finalStatus = tencentMeetingTranscriptFinalStatus(failureKind, recording);
    if (String(recording.source || "").startsWith(TENCENT_MEETING_SOURCE_PREFIX)) {
      const updated = await updateRecordingRealtimeState(recordingId, {
          status: recording.status === "transcribing" || recording.status === "processing" ? "uploaded" : recording.status,
          transcriptStatus: finalStatus.final ? "unavailable" : "waiting",
          tag: tencentMeetingImportTag({ ...info, sourceKind: recording.tencentMeetingSourceKind }, finalStatus.statusText),
          errorMessage: finalStatus.errorMessage,
          transcriptProvider: "tencent-meeting",
          transcriptSource: finalStatus.final ? finalStatus.transcriptSource : "",
          ...(!finalStatus.final
            ? {
                transcriptPath: "",
                transcriptRawPath: "",
                transcriptCorrectedPath: "",
                transcriptionMetaPath: "",
              }
            : {}),
      });
      logTencentMeetingTranscriptTrace("no_segments_status_persisted", {
        recordingId,
        recordFileId,
        failureKind,
        final: finalStatus.final,
        updatedRecordingCount: updated.count,
      });
    }
    return false;
  }
  const stored = await storeTencentMeetingBuiltInTranscript(recordingId, transcriptResult, jobVersion);
  logTencentMeetingTranscriptTrace("sync_completed", {
    recordingId,
    recordFileId,
    result: stored ? "stored" : "not_stored",
    segmentCount: transcriptResult.segments.length,
  });
  return stored;
}

async function downloadTencentMeetingFile(url, targetPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Math.max(30000, Number(process.env.TENCENT_MEETING_DOWNLOAD_TIMEOUT_MS || 20 * 60 * 1000))),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Tencent Meeting recording download failed: ${response.status}`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
  return {
    ...(await fileInfo(targetPath)),
    contentType: response.headers.get("content-type") || "",
    finalUrl: response.url || url,
  };
}

function tencentMeetingRecordingAudioUrl(recordingId) {
  return `/audio/${recordingId}.mp3`;
}

function isTencentMeetingStreamingMedia(url = "", downloadInfo = {}) {
  const text = String(url || downloadInfo.finalUrl || "").trim();
  const contentType = String(downloadInfo.contentType || "").toLowerCase();
  return /\.m3u8(?:[?#]|$)/i.test(text) || /mpegurl|vnd\.apple\.mpegurl|x-mpegurl/i.test(contentType);
}

async function inspectTencentMeetingDownloadedFile(targetPath, downloadInfo = {}) {
  const contentType = String(downloadInfo.contentType || "").toLowerCase();
  if (/mpegurl|vnd\.apple\.mpegurl|x-mpegurl/i.test(contentType)) return { useRemoteInput: true };

  const size = Number(downloadInfo.size || 0);
  if (size <= 0) throw new Error("Tencent Meeting recording download is empty");
  if (size > 1024 * 1024) return { useRemoteInput: false };

  const text = (await readFile(targetPath)).toString("utf8").trimStart();
  if (/^#EXTM3U/i.test(text)) return { useRemoteInput: true };
  if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text)) {
    throw new Error("Tencent Meeting recording download returned an HTML page instead of media");
  }
  if (/^(?:\{|\[)/.test(text) && /error|errcode|message|code|permission|forbid/i.test(text.slice(0, 2000))) {
    throw new Error("Tencent Meeting recording download returned an API error instead of media");
  }
  return { useRemoteInput: false };
}

async function syncTencentMeetingRecordingAudio(recordingId, info = {}, jobVersion = recordingJobVersion(recordingId)) {
  if (isRecordingJobCancelled(recordingId, jobVersion)) return false;
  const recordingBeforeSync = await prisma.recording.findFirst({
    where: { id: recordingId, deletedAt: null },
  });
  if (!recordingBeforeSync) return false;
  if (resolveRecordingAudioPathBetter(recordingBeforeSync, projectRoot)) {
    if (recordingBeforeSync.fileStatus !== "ready") {
      await updateRecordingRealtimeState(recordingId, { fileStatus: "ready" });
    }
    return true;
  }

  await updateRecordingRealtimeState(recordingId, { fileStatus: "downloading" });

  console.info(`[CALL] syncTencentMeetingRecordingAudio: recordingId: ${recordingId}`);
  const target = await findTencentMeetingDownloadTarget(info);
  console.info(`[CALL] syncTencentMeetingRecordingAudio`);
  if (!target?.downloadUrl) {
    const needsIdentity = !tencentMeetingCandidateDownloadIdentityParams(info).length;
    const hasStsToken = Boolean(await loadTencentMeetingStsToken());
    const canRequestStsToken = Boolean(tencentMeetingStsOperatorId());
    const waitsForTencentTranscript = info.sourceKind === "recorder" || /audio-completed|smart\.transcripts/i.test(String(info.event || ""));
    if (isRecordingJobCancelled(recordingId, jobVersion)) return false;
    const data = {
      updatedAt: new Date(),
      fileStatus: "waiting",
      tencentMeetingSourceKind: info.sourceKind || recordingBeforeSync.tencentMeetingSourceKind || "",
      tag: tencentMeetingImportTag(info, "等待下载权限"),
      errorMessage: needsIdentity
        ? "Tencent Meeting recording needs a configured userid or Rooms operator_id before the audio can be downloaded."
        : !hasStsToken && canRequestStsToken
          ? "Tencent Meeting STS-Token has been requested. Waiting for common.sts-token callback before downloading audio."
          : !hasStsToken
            ? "Tencent Meeting recording needs STS-Token. Subscribe common.sts-token and configure an admin userid to generate it."
            : "Tencent Meeting recording download address is not available yet.",
    };
    if (target?.name) data.name = target.name;
    const currentOwnerName = String(recordingBeforeSync.ownerName || "").trim();
    if (
      target?.ownerName &&
      (!currentOwnerName || currentOwnerName === tencentMeetingImportOwnerName())
    ) {
      data.ownerName = target.ownerName;
    }
    if (target?.creatorUserid) data.tencentMeetingCreatorUserid = target.creatorUserid;
    if (target?.meetingRecordId) data.tencentMeetingMeetingRecordId = target.meetingRecordId;
    if (target?.record?.meeting_id || target?.record?.meetingId) {
      data.tencentMeetingMeetingId = target.record.meeting_id || target.record.meetingId;
    }
    if (target?.record?.meeting_code || target?.record?.meetingCode) {
      data.tencentMeetingMeetingCode = target.record.meeting_code || target.record.meetingCode;
    }
    if (target?.durationMs > Number(recordingBeforeSync.durationMs || 0n)) {
      data.durationMs = BigInt(Math.max(0, Math.round(Number(target.durationMs))));
    }
    if (waitsForTencentTranscript && !needsIdentity) {
      data.tag = tencentMeetingImportTag(info, "等待腾讯会议文字");
      data.errorMessage =
        info.sourceKind === "recorder" || String(info.event || "") === "recording.audio-completed"
          ? "腾讯会议录音笔已完成音频处理，正在同步录音笔转写内容；如果文字仍在生成，后台会按计划重试。"
          : "腾讯会议转写内容尚未返回，后台会等待对应事件后继续同步。";
    }
    await updateRecordingRealtimeState(recordingId, data);
    return false;
  }

  const tempPath = path.join(tempDir, `tencent-meeting-${recordingId}-${Date.now()}`);
  const fileName = `${recordingId}.mp3`;
  const storagePath = path.join(audioDir, fileName);
  try {
    const downloadInfo = await downloadTencentMeetingFile(target.downloadUrl, tempPath);
    await updateRecordingRealtimeState(recordingId, { fileStatus: "processing" });
    const inspection = await inspectTencentMeetingDownloadedFile(tempPath, downloadInfo);
    const conversionInput =
      inspection.useRemoteInput || isTencentMeetingStreamingMedia(target.downloadUrl, downloadInfo) ? target.downloadUrl : tempPath;
    await convertAudioFileToMp3(conversionInput, storagePath);
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      await removeFileIfExists(tempPath);
      await removeFileIfExists(storagePath);
      return false;
    }
    await removeFileIfExists(tempPath);
    const { storedFile, durationMs } = await verifiedStoredRecording(storagePath, target.durationMs || info.durationMs || 0);
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      await removeFileIfExists(storagePath);
      return false;
    }
    const segmentCount = await prisma.transcriptSegment.count({ where: { recordingId } });
    const now = new Date();
    const data = {
      name: target.name || recordingBeforeSync.name,
      updatedAt: now,
      durationMs: BigInt(Math.max(0, Math.round(Number(durationMs || 0)))),
      tencentMeetingSourceKind: info.sourceKind || recordingBeforeSync.tencentMeetingSourceKind || "",
      mimeType: "audio/mpeg",
      fileSize: BigInt(Math.max(0, Math.round(Number(storedFile.size || 0)))),
      fileName,
      storageProvider: "local",
      storageKey: storagePath,
      audioUrl: tencentMeetingRecordingAudioUrl(recordingId),
      fileStatus: "ready",
      status: segmentCount > 0 ? "ready" : "uploaded",
      errorMessage: "",
      tag: tencentMeetingImportTag(info, segmentCount > 0 ? "已同步转写" : "等待录音笔转写"),
      shared: true,
      sharedAt: recordingBeforeSync.sharedAt || now,
    };
    const currentOwnerName = String(recordingBeforeSync.ownerName || "").trim();
    if (target.ownerName && (!currentOwnerName || currentOwnerName === tencentMeetingImportOwnerName())) {
      data.ownerName = target.ownerName;
    }
    if (target.creatorUserid) data.tencentMeetingCreatorUserid = target.creatorUserid;
    if (target.meetingRecordId) data.tencentMeetingMeetingRecordId = target.meetingRecordId;
    if (target.record?.meeting_id || target.record?.meetingId) {
      data.tencentMeetingMeetingId = target.record.meeting_id || target.record.meetingId;
    }
    if (target.record?.meeting_code || target.record?.meetingCode) {
      data.tencentMeetingMeetingCode = target.record.meeting_code || target.record.meetingCode;
    }
    const synced = await updateRecordingRealtimeState(recordingId, data);
    if (!synced.count) {
      await removeFileIfExists(storagePath);
      return false;
    }
    return true;
  } catch (error) {
    await removeFileIfExists(tempPath);
    await removeFileIfExists(storagePath);
    if (!isRecordingJobCancelled(recordingId, jobVersion)) {
      await prisma.recording.updateMany({
        where: { id: recordingId, deletedAt: null },
        data: {
          updatedAt: new Date(),
          fileStatus: "failed",
          tag: tencentMeetingImportTag(info, "等待重试"),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      await publishRecordingSnapshot(recordingId);
    }
    throw error;
  }
}

function queueTencentMeetingImportSync(recordingId, info = {}) {
  if (!tencentMeetingAudioSyncEnabled()) return false;
  if (!recordingId || isRecordingJobCancelled(recordingId) || tencentMeetingImportJobs.has(recordingId)) return false;
  const jobVersion = recordingJobVersion(recordingId);
  tencentMeetingImportJobs.add(recordingId);
  setTimeout(() => {
    syncTencentMeetingRecordingAudio(recordingId, info, jobVersion)
      .catch((error) => console.warn("[Tencent Meeting] import sync failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        if (recordingJobVersion(recordingId) === jobVersion) tencentMeetingImportJobs.delete(recordingId);
      });
  }, 50);
  return true;
}

function waitForTencentMeetingTranscriptRetry(delayMs) {
  return sleep(delayMs);
}

async function runTencentMeetingTranscriptSyncAttempts(recordingId, info, jobVersion) {
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  const maxAttempts = tencentMeetingTranscriptSyncMaxAttempts(info);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logTencentMeetingTranscriptTrace("sync_attempt_started", {
      recordingId,
      recordFileId,
      event: info.event || "",
      attempt,
      maxAttempts,
      jobVersion,
    });
    const stored = await syncTencentMeetingBuiltInTranscript(recordingId, info, jobVersion);
    logTencentMeetingTranscriptTrace("sync_attempt_finished", {
      recordingId,
      recordFileId,
      attempt,
      maxAttempts,
      stored,
    });
    if (stored) return { stored: true, outcome: "completed", attempt, maxAttempts };
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      return { stored: false, outcome: "cancelled", attempt, maxAttempts };
    }

    const recording = await prisma.recording.findFirst({
      where: { id: recordingId, deletedAt: null },
      select: {
        createdAt: true,
        updatedAt: true,
        transcriptSource: true,
      },
    });
    if (!recording) return { stored: false, outcome: "recording_missing", attempt, maxAttempts };
    if (recording.transcriptSource === "tencent-meeting-unavailable") {
      return { stored: false, outcome: "unavailable", attempt, maxAttempts };
    }
    if (attempt >= maxAttempts) {
      return { stored: false, outcome: "not_stored", attempt, maxAttempts };
    }

    const retryDelayMs = tencentMeetingTranscriptRetryIntervalMs({
      createdAt: recording.createdAt?.toISOString?.() || recording.createdAt,
      updatedAt: recording.updatedAt?.toISOString?.() || recording.updatedAt,
    });
    logTencentMeetingTranscriptTrace("retry_scheduled", {
      recordingId,
      recordFileId,
      event: info.event || "",
      nextAttempt: attempt + 1,
      maxAttempts,
      retryDelayMs,
    });
    await waitForTencentMeetingTranscriptRetry(retryDelayMs);
  }
  return { stored: false, outcome: "not_stored", attempt: maxAttempts, maxAttempts };
}

function queueTencentMeetingTranscriptSync(recordingId, info = {}) {
  logger.info("call queueTencentMeetingTranscriptSync: ", {message: 'step 0'})
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  if (!recordingId) {
    logTencentMeetingTranscriptTrace("queue_skipped", {
      recordFileId,
      reason: "missing_recording_id",
    });
    emitTencentMeetingTranscriptDiagnosticEnd({
      recordFileId,
      outcome: "queue_skipped_missing_recording_id",
    });
    return false;
  }
  if (isRecordingJobCancelled(recordingId)) {
    logTencentMeetingTranscriptTrace("queue_skipped", {
      recordingId,
      recordFileId,
      reason: "job_cancelled",
    });
    emitTencentMeetingTranscriptDiagnosticEnd({
      recordingId,
      recordFileId,
      outcome: "queue_skipped_job_cancelled",
    });
    return false;
  }
  if (tencentMeetingTranscriptJobs.has(recordingId)) {
    logger.info("call queueTencentMeetingTranscriptSync: ", {message: '已有这个任务'})
    logTencentMeetingTranscriptTrace("queue_skipped", {
      recordingId,
      recordFileId,
      reason: "job_already_queued",
    });
    return false;
  }
  const jobVersion = recordingJobVersion(recordingId);
  tencentMeetingTranscriptJobs.add(recordingId);
  logTencentMeetingTranscriptTrace("queued", {
    recordingId,
    recordFileId,
    event: info.event || "",
    jobVersion,
  });
  setTimeout(() => {
    let outcome = "unknown";
    logTencentMeetingTranscriptTrace("worker_started", {
      recordingId,
      recordFileId,
      jobVersion,
    });
    const statusReady = updateRecordingRealtimeState(recordingId, { transcriptStatus: "queued" }).catch((error) =>
      console.warn("[Tencent Meeting] transcript queued status update failed:", error instanceof Error ? error.message : error),
    );
    statusReady
      .then(() => runTencentMeetingTranscriptSyncAttempts(recordingId, info, jobVersion))
      .then((result) => {
        outcome = result.outcome;
        return result.stored;
      })
      .catch((error) => {
        outcome = "failed";
        logTencentMeetingTranscriptTrace("worker_failed", {
          recordingId,
          recordFileId,
          jobVersion,
          error: error instanceof Error ? error.message : String(error),
        });
        updateRecordingRealtimeState(recordingId, {
          transcriptStatus: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch((statusError) =>
          console.warn(
            "[Tencent Meeting] transcript failed status update failed:",
            statusError instanceof Error ? statusError.message : statusError,
          ),
        );
        console.warn("[Tencent Meeting] transcript sync failed:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        if (recordingJobVersion(recordingId) === jobVersion) tencentMeetingTranscriptJobs.delete(recordingId);
        logTencentMeetingTranscriptTrace("worker_finished", {
          recordingId,
          recordFileId,
          jobVersion,
          stillQueued: tencentMeetingTranscriptJobs.has(recordingId),
        });
        emitTencentMeetingTranscriptDiagnosticEnd({
          recordingId,
          recordFileId,
          jobVersion,
          outcome,
        });
      });
  }, 80);
  return true;
}

async function resolveTencentMeetingOwnerName(info = {}) {
  const currentName = String(info.ownerName || "").trim();
  const fallbackOwnerName = tencentMeetingImportOwnerName();
  if (currentName && currentName !== fallbackOwnerName) return currentName;
  const creatorUserid = String(info.creatorUserid || "").trim();
  if (!creatorUserid) return currentName === fallbackOwnerName ? "" : currentName;
  if (tencentMeetingCreatorNameCache.has(creatorUserid)) {
    return tencentMeetingCreatorNameCache.get(creatorUserid) || "";
  }
  try {
    const user = await getWecomUserByUserId(creatorUserid);
    const name = String(user?.name || "").trim();
    tencentMeetingCreatorNameCache.set(creatorUserid, name);
    return name;
  } catch (error) {
    console.warn("[Tencent Meeting] creator name lookup skipped:", error instanceof Error ? error.message : error);
    return currentName === fallbackOwnerName ? "" : currentName;
  }
}

async function backfillTencentMeetingRecorderOwnersFromWebhookHistory() {
  const contexts = await loadTencentMeetingRecorderOwnerContexts();
  if (!contexts.size) return 0;
  const resolvedContexts = new Map();
  for (const [recordFileId, context] of contexts) {
    resolvedContexts.set(recordFileId, {
      ...context,
      ownerName: (await resolveTencentMeetingOwnerName(context)) || context.ownerName || "",
    });
  }

  const sources = [...resolvedContexts.keys()].map((recordFileId) => tencentMeetingSourceKey(recordFileId));
  const recordings = await prisma.recording.findMany({
    where: { source: { in: sources }, deletedAt: null },
  });
  let updated = 0;
  const fallbackOwnerName = tencentMeetingImportOwnerName();
  await prisma.$transaction(async (tx) => {
    for (const recording of recordings) {
      const recordFileId = String(recording.source || "").slice(`${TENCENT_MEETING_SOURCE_PREFIX}:`.length);
      const context = resolvedContexts.get(recordFileId);
      if (!context) continue;
      const data = {};
      const currentOwnerName = String(recording.ownerName || "").trim();
      if ((!currentOwnerName || currentOwnerName === fallbackOwnerName) && context.ownerName) data.ownerName = context.ownerName;
      if (!recording.tencentMeetingCreatorUserid && context.creatorUserid) data.tencentMeetingCreatorUserid = context.creatorUserid;
      if (!recording.tencentMeetingMeetingId && context.meetingId) data.tencentMeetingMeetingId = context.meetingId;
      if (!recording.tencentMeetingMeetingCode && context.meetingCode) data.tencentMeetingMeetingCode = context.meetingCode;
      if (!Object.keys(data).length) continue;
      await tx.recording.update({ where: { id: recording.id }, data });
      updated += 1;
    }
  });
  return updated;
}

async function upsertTencentMeetingRecordingInfos(recordInfos = [], userAgent = "tencent-meeting-sync") {
  const uniqueInfos = [];
  const seen = new Set();
  for (const info of recordInfos) {
    const recordFileId = String(info?.recordFileId || "").trim();
    if (!recordFileId || seen.has(recordFileId)) continue;
    seen.add(recordFileId);
    uniqueInfos.push({
      ...info,
      recordFileId,
      ownerName: (await resolveTencentMeetingOwnerName(info)) || info.ownerName || "",
    });
  }
  logger.info("[call] upsertTencentMeetingRecordingInfos step 1: ", {message: `uniqueInfos`})
  if (!uniqueInfos.length) return [];

  const now = new Date();
  const results = await prisma.$transaction(async (tx) => {
    const latest = await tx.recording.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
    let nextSeq = Number(latest?.seq || 0);
    const results = [];
    for (const eventInfo of uniqueInfos) {
      logger.info("[call] upsertTencentMeetingRecordingInfos step 2: ", {message: `fileId: ${eventInfo.recordFileId}`})
      const source = tencentMeetingSourceKey(eventInfo.recordFileId);
      const existing = await tx.recording.findFirst({
        where: { source },
        include: { segments: { select: { id: true }, take: 1 } },
      });
      logger.info("[call] upsertTencentMeetingRecordingInfos step 3: ", {message: ``})
      const meetingRecordId = String(eventInfo.meetingRecordId || "").trim();
      logger.info("[call] upsertTencentMeetingRecordingInfos step 4: ", {message: `meetingRecordId && meetingRecordId !== eventInfo.recordFileId: ${JSON.stringify(meetingRecordId && meetingRecordId !== eventInfo.recordFileId)}`})
      if (meetingRecordId && meetingRecordId !== eventInfo.recordFileId) {
        const duplicate = await tx.recording.findFirst({
          where: { source: tencentMeetingSourceKey(meetingRecordId), deletedAt: null },
          include: { segments: { select: { id: true }, take: 1 } },
        });
        const matchesMeeting =
          duplicate &&
          (!duplicate.tencentMeetingMeetingId || !eventInfo.meetingId || duplicate.tencentMeetingMeetingId === eventInfo.meetingId) &&
          (!duplicate.tencentMeetingMeetingCode || !eventInfo.meetingCode || duplicate.tencentMeetingMeetingCode === eventInfo.meetingCode);
        if (matchesMeeting && !duplicate.segments.length && !resolveRecordingAudioPath(recordingFromPrisma(duplicate), projectRoot)) {
          await tx.recording.update({
            where: { id: duplicate.id },
            data: { deletedAt: now, errorMessage: "已由腾讯会议真实录制文件替代。" },
          });
        }
      }
      if (existing) {
        const hasSegments = existing.segments.length > 0;
        const existingOwnerName = String(existing.ownerName || "").trim();
        const incomingOwnerName = String(eventInfo.ownerName || "").trim();
        const ownerName =
          existingOwnerName && existingOwnerName !== tencentMeetingImportOwnerName()
            ? existingOwnerName
            : incomingOwnerName || existingOwnerName || tencentMeetingImportOwnerName();
        const data = {
          shared: true,
          sharedAt: existing.sharedAt || now,
          ownerName,
          audioUrl: tencentMeetingRecordingAudioUrl(existing.id),
          transcriptProvider: existing.transcriptSource === "tencent-meeting" || !hasSegments ? "tencent-meeting" : existing.transcriptProvider,
          fileStatus: existing.fileStatus || (existing.storageKey ? "ready" : "pending"),
          transcriptStatus:
            eventInfo.event === "smart.transcripts"
              ? "queued"
              : hasSegments
                ? "ready"
                : existing.transcriptStatus || "waiting",
        };
        if (eventInfo.subject) data.name = tencentMeetingPlaceholderName(eventInfo);
        const eventDurationMs = Number(eventInfo.durationMs || 0);
        if (eventDurationMs > Number(existing.durationMs || 0n)) data.durationMs = BigInt(Math.round(eventDurationMs));
        if (eventInfo.creatorUserid) data.tencentMeetingCreatorUserid = eventInfo.creatorUserid;
        if (eventInfo.meetingId) data.tencentMeetingMeetingId = eventInfo.meetingId;
        if (eventInfo.meetingCode) data.tencentMeetingMeetingCode = eventInfo.meetingCode;
        if (eventInfo.meetingRecordId) data.tencentMeetingMeetingRecordId = eventInfo.meetingRecordId;
        if (eventInfo.sourceKind) data.tencentMeetingSourceKind = eventInfo.sourceKind;
        if (eventInfo.sourceKind === "cloud" && (!existing.tag || /录音笔|等待同步|已同步/.test(existing.tag))) {
          data.tag = tencentMeetingImportTag(eventInfo, hasSegments ? "已同步转写" : "等待转写");
        }
        await tx.recording.update({ where: { id: existing.id }, data });
        results.push({ recordingId: existing.id, recordFileId: eventInfo.recordFileId, created: false, info: eventInfo });
        continue;
      }

      nextSeq += 1;
      const recordingId = crypto.randomUUID();
      logger.info("[call] upsertTencentMeetingRecordingInfos step 5: ", {message: `recordFileId: ${eventInfo.recordFileId}, id: ${recordingId}`})
      
      await tx.recording.create({
        data: {
          id: recordingId,
          seq: nextSeq,
          name: tencentMeetingPlaceholderName(eventInfo),
          createdAt: new Date(tencentMeetingEventTimeMs(eventInfo.operateTime)),
          updatedAt: now,
          durationMs: BigInt(Math.max(0, Math.round(Number(eventInfo.durationMs || 0)))),
          mimeType: "audio/mpeg",
          fileSize: 0n,
          fileName: "",
          storageProvider: "local",
          storageKey: "",
          transcriptPath: "",
          favorite: false,
          ownerClientId: tencentMeetingImportOwnerClientId(),
          ownerName: eventInfo.ownerName || tencentMeetingImportOwnerName(),
          shared: true,
          sharedAt: now,
          speakerName: "speaker-1",
          speakerMapJson: "{}",
          tag: tencentMeetingImportTag(eventInfo, "等待同步"),
          deletedAt: null,
          transcriptProvider: "tencent-meeting",
          transcriptSource: "",
          transcribedAt: null,
          status: "uploaded",
          fileStatus: "pending",
          transcriptStatus: eventInfo.event === "smart.transcripts" ? "queued" : "waiting",
          source,
          tencentMeetingCreatorUserid: eventInfo.creatorUserid || "",
          tencentMeetingMeetingId: eventInfo.meetingId || "",
          tencentMeetingMeetingCode: eventInfo.meetingCode || "",
          tencentMeetingMeetingRecordId: eventInfo.meetingRecordId || "",
          tencentMeetingSourceKind: eventInfo.sourceKind || "",
          errorMessage: "",
          userAgent,
          audioUrl: tencentMeetingRecordingAudioUrl(recordingId),
        },
      });
      logger.info("[call] upsertTencentMeetingRecordingInfos step 6: ", {message: ``})
      results.push({ recordingId, recordFileId: eventInfo.recordFileId, created: true, info: eventInfo });
    }
    return results;
  });
  for (const result of results) {
    await publishRecordingSnapshot(result.recordingId, result.created ? "recording.created" : "recording.updated");
  }
  return results;
}

async function importTencentMeetingWebhookPayload(
  payload,
  {
    syncAudio = false,
    syncTranscript = false,
    sseMockDelayMs = 0,
    userAgent = "tencent-meeting-webhook",
  } = {},
) {
  logger.debug("触发ststoken获取", {message: 'step2'})
  const event = String(payload?.event || "").trim();
  logTencentMeetingTranscriptTrace("webhook_import_started", {
    event,
    syncTranscript,
    syncAudio,
  });
  const events = await enrichTencentMeetingRecorderOwnerContexts(extractTencentMeetingRecordingEvents(payload));
  logger.debug("触发ststoken获取", {message: `step3 length: ${events.length}`})
  logTencentMeetingTranscriptTrace("webhook_record_files_extracted", {
    event,
    extractedCount: events.length,
    recordFileIds: events.map((item) => item.recordFileId).filter(Boolean).join(","),
  });
  if (!events.length) {
    logTencentMeetingTranscriptTrace("webhook_import_skipped", {
      event,
      reason: "no_record_file_id_extracted",
    });
    if (syncTranscript) {
      emitTencentMeetingTranscriptDiagnosticEnd({
        event,
        outcome: "no_record_file_id_extracted",
      });
    }
    return [];
  }
  const results = await upsertTencentMeetingRecordingInfos(events, userAgent);
  if (results.length) {
    console.info(
      "[Tencent Meeting] webhook imported:",
      results
        .map((result) => `${result.info?.sourceKind || "unknown"}:${result.recordFileId}:${result.created ? "created" : "updated"}`)
        .join(", "),
    );
  }
  logTencentMeetingTranscriptTrace("webhook_recordings_upserted", {
    event,
    resultCount: results.length,
    recordingIds: results.map((result) => result.recordingId).filter(Boolean).join(","),
    createdCount: results.filter((result) => result.created).length,
  });

  const normalizedSseMockDelayMs = Math.max(0, Number(sseMockDelayMs) || 0);
  if (results.length > 0 && normalizedSseMockDelayMs > 0) {
    logger.info("tencent_meeting.sse_mock_delay_started", {
      message: `event=${event}, recordingCount=${results.length}, delayMs=${normalizedSseMockDelayMs}`,
      event,
      recordingCount: results.length,
      delayMs: normalizedSseMockDelayMs,
    });
    await sleep(normalizedSseMockDelayMs);
    logger.info("tencent_meeting.sse_mock_delay_finished", {
      message: `event=${event}, recordingCount=${results.length}, delayMs=${normalizedSseMockDelayMs}`,
      event,
      recordingCount: results.length,
      delayMs: normalizedSseMockDelayMs,
    });
  }

  for (const result of results) {
    if (syncTranscript) {
      const queued = queueTencentMeetingTranscriptSync(result.recordingId, {
        ...result.info,
        event: payload.event,
      });
      logTencentMeetingTranscriptTrace("webhook_queue_result", {
        event,
        recordingId: result.recordingId,
        recordFileId: result.recordFileId,
        queued,
      });
    }
    if (syncAudio) {
      queueTencentMeetingImportSync(result.recordingId, result.info);
    }
  }

  return results;
}

async function importTencentMeetingRecordingCompletedPayload(payload) {
  return importTencentMeetingWebhookPayload(payload, {
    syncAudio: true,
    sseMockDelayMs: TENCENT_MEETING_SSE_MOCK_DELAY_MS,
    userAgent: "tencent-meeting-recording-completed",
  });
}

async function importTencentMeetingAudioCompletedPayload(payload) {
  return importTencentMeetingWebhookPayload(payload, {
    syncAudio: true,
    syncTranscript: true,
    sseMockDelayMs: TENCENT_MEETING_SSE_MOCK_DELAY_MS,
    userAgent: "tencent-meeting-audio-completed",
  });
}

async function importTencentMeetingTranscriptReadyPayload(payload) {
  return importTencentMeetingWebhookPayload(payload, {
    syncTranscript: true,
    userAgent: "tencent-meeting-smart-transcripts",
  });
}

async function replayMissingTencentMeetingRecordingWebhooks() {
  const payloads = (await loadTencentMeetingWebhookPayloadHistory())
    .filter((payload) => extractTencentMeetingRecordingEvents(payload).length > 0)
    .slice(-30);
  if (!payloads.length) return 0;

  const recordFileIds = payloads.flatMap((payload) =>
    extractTencentMeetingRecordingEvents(payload).map((info) => String(info.recordFileId || "")).filter(Boolean),
  );
  const sources = [...new Set(recordFileIds)].map((recordFileId) => tencentMeetingSourceKey(recordFileId));
  const existing = await prisma.recording.findMany({
    where: { source: { in: sources } },
    select: { source: true },
  });
  const existingSources = new Set(existing.map((recording) => String(recording.source || "")));
  let replayed = 0;
  for (const payload of payloads) {
    const infos = extractTencentMeetingRecordingEvents(payload);
    if (infos.every((info) => existingSources.has(tencentMeetingSourceKey(info.recordFileId)))) continue;
    const event = String(payload?.event || "").trim();
    const results =
      event === "recording.audio-completed"
        ? await importTencentMeetingAudioCompletedPayload(payload)
        : event === "recording.completed"
          ? await importTencentMeetingRecordingCompletedPayload(payload)
          : event === "smart.transcripts"
            ? await importTencentMeetingTranscriptReadyPayload(payload)
            : await importTencentMeetingWebhookPayload(payload);
    for (const result of results) existingSources.add(tencentMeetingSourceKey(result.recordFileId));
    replayed += results.filter((result) => result.created).length;
  }
  return replayed;
}

async function fetchTencentMeetingCloudRecordInfos() {
  if (!tencentMeetingApiConfigured()) return [];
  // 申请token
  await requestTencentMeetingStsTokenIfNeeded();
  const { startTime, endTime } = tencentMeetingDiscoveryWindow();
  const infos = [];
  const seen = new Set();
  const collect = (record, file, fallback = {}) => {
    const info = tencentMeetingInfoFromRecordFile(record, file, fallback, "cloud");
    if (!info.recordFileId || seen.has(info.recordFileId)) return;
    seen.add(info.recordFileId);
    infos.push(info);
  };

  for (const operatorParams of tencentMeetingCandidateOperatorParams()) {
    for (let page = 1; page <= 8; page += 1) {
      // 拿到当前企业账户下所有用户的录制记录
      const uri = tencentMeetingQuery("/v1/corp/records", {
        start_time: startTime,
        end_time: endTime,
        page_size: 20,
        page,
        ...operatorParams,
      });
      try {
        const payload = await tencentMeetingApiRequest("GET", uri);
        for (const record of tencentMeetingRecordsFromPayload(payload)) {
          const files = tencentMeetingRecordFiles(record);
          if (files.length) files.forEach((file) => collect(record, file));
          else collect(record, record);
        }
        const hasMore = Boolean(payload.has_remaining || payload.has_more || payload.data?.has_more);
        if (!hasMore) break;
      } catch (error) {
        console.warn("[Tencent Meeting] cloud corp record discovery skipped:", error instanceof Error ? error.message : error);
        break;
      }
    }
  }

  for (const params of tencentMeetingCandidateDownloadIdentityParams({})) {
    for (let page = 1; page <= 8; page += 1) {
      const uri = tencentMeetingQuery("/v1/records", {
        start_time: startTime,
        end_time: endTime,
        page_size: 20,
        page,
        ...params,
      });
      try {
        const payload = await tencentMeetingApiRequest("GET", uri);
        for (const record of tencentMeetingRecordsFromPayload(payload)) {
          const files = tencentMeetingRecordFiles(record);
          if (files.length) files.forEach((file) => collect(record, file, params));
          else collect(record, record, params);
        }
        const hasMore = Boolean(payload.has_remaining || payload.has_more || payload.data?.has_more);
        if (!hasMore) break;
      } catch (error) {
        console.warn("[Tencent Meeting] cloud user record discovery skipped:", error instanceof Error ? error.message : error);
        break;
      }
    }
  }

  return infos;
}

async function importTencentMeetingCloudRecordingsFromApi() {
  const infos = await fetchTencentMeetingCloudRecordInfos();
  const results = await upsertTencentMeetingRecordingInfos(infos, "tencent-meeting-cloud-discovery");
  for (const result of results) {
    queueTencentMeetingImportSync(result.recordingId, result.info);
  }
  return results.length;
}

function queueTencentMeetingCloudDiscovery() {
  if (tencentMeetingCloudDiscoveryJob || !tencentMeetingApiConfigured()) return false;
  tencentMeetingCloudDiscoveryJob = setTimeout(() => {
    importTencentMeetingCloudRecordingsFromApi()
      .catch((error) => console.warn("[Tencent Meeting] cloud record discovery failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        tencentMeetingCloudDiscoveryJob = null;
      });
  }, 100);
  return true;
}

/**
 * 恢复尚未下载音频或尚未同步转写的腾讯会议录音任务。
 */
async function queueTencentMeetingPendingImports() {
  await backfillTencentMeetingRecorderOwnersFromWebhookHistory();
  const pendingAudio = [];
  if (tencentMeetingAudioSyncEnabled()) {
    const recordings = await prisma.recording.findMany({
      where: {
        source: { startsWith: TENCENT_MEETING_SOURCE_PREFIX },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    pendingAudio.push(
      ...recordings
        .filter((recording) => !resolveRecordingAudioPathBetter(recording, projectRoot))
        .slice(0, tencentMeetingPendingBatchSize("TENCENT_MEETING_PENDING_AUDIO_BATCH_SIZE", 6)),
    );
  }

  for (const recording of pendingAudio) {
    queueTencentMeetingImportSync(recording.id, tencentMeetingSyncInfoFromRecording(recording));
  }

  return pendingAudio.length;
}

function safeUploadSessionId(value = "") {
  const id = String(value || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(id)) return "";
  return id;
}

function uploadSessionPath(sessionId) {
  const safeId = safeUploadSessionId(sessionId);
  if (!safeId) return "";
  return path.join(uploadSessionRoot, safeId);
}

async function readUploadSessionMeta(sessionId) {
  const dir = uploadSessionPath(sessionId);
  if (!dir) return null;
  try {
    return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

async function verifiedStoredRecording(storagePath, fallbackDurationMs = 0) {
  const storedFile = await fileInfo(storagePath);
  const actualDurationMs = await probeAudioDurationMs(storagePath);
  const durationMs = actualDurationMs || Number(fallbackDurationMs || 0);
  if (!storedFile.size || durationMs < MIN_VALID_RECORDING_DURATION_MS) {
    await removeFileIfExists(storagePath);
    const error = new Error("录音音频无效或时长过短，本地分片会保留并等待重新上传。");
    error.status = 422;
    throw error;
  }
  return { storedFile, durationMs };
}

function segmentSpeakerKey(segment) {
  const raw =
    segment.speakerKey ??
    segment.speaker_key ??
    segment.speakerLabel ??
    segment.speaker_label ??
    segment.speaker ??
    segment.channel;
  return String(raw || "speaker-1").trim() || "speaker-1";
}

function deriveSpeakers(recording, segments = []) {
  const totals = new Map();

  if (segments.length === 0) {
    totals.set("speaker-1", { key: "speaker-1", totalMs: recording.durationMs || 0, segmentCount: 0 });
  }

  segments.forEach((segment, index) => {
    const key = segmentSpeakerKey(segment, index);
    const current = totals.get(key) || { key, totalMs: 0, segmentCount: 0 };
    current.totalMs += Math.max(0, (segment.endMs || 0) - (segment.startMs || 0));
    current.segmentCount += 1;
    totals.set(key, current);
  });

  const sorted = [...totals.values()].sort((a, b) => b.totalMs - a.totalMs || b.segmentCount - a.segmentCount);
  const speakerMap = recording.speakerMap && typeof recording.speakerMap === "object" ? recording.speakerMap : {};

  return sorted.map((speaker, index) => ({
    key: speaker.key,
    name: speakerMap[speaker.key] || (speaker.key === "speaker-1" ? recording.speakerName : "") || `说话人 ${index + 1}`,
    totalMs: speaker.totalMs,
    segmentCount: speaker.segmentCount,
  }));
}

function publicRecording(recording, segments = [], viewerClientId = "", viewerName = "", options = {}) {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0);
  const transcriptText = expandedSegments.map((segment) => segment.text).join("\n");
  const fallbackTranscript = isFallbackTranscript(expandedSegments);
  const diagnostics = getTranscriptionDiagnostics();
  const speakers = deriveSpeakers(recording, expandedSegments);
  const speakerByKey = new Map(speakers.map((speaker) => [speaker.key, speaker]));
  const primarySpeaker = speakers[0]?.name || recording.speakerName || "说话人 1";
  const storedOwnerName = String(recording.ownerName || "").trim();
  const isOwnRecording = !recording.ownerClientId || recording.ownerClientId === viewerClientId;
  const canDeleteAllRecordings = Boolean(options.canDeleteAllRecordings);
  const isTencentMeetingImport = isTencentMeetingRecording(recording);
  const canUseRecordingApiTranscription = isLocalApiTranscriptionRecording(recording);
  const rawTag = String(recording.tag || "");
  const rawErrorMessage = String(recording.errorMessage || "");
  const isTencentMeetingTextPending =
    isTencentMeetingImport &&
    !expandedSegments.length &&
    (/等待腾讯会议文字|等待腾讯文字|等待腾讯转写|等待转写/.test(rawTag) ||
      /smart\.transcripts|录制转写生成|腾讯会议还没有返回|纪要不存在|纪要无内容/.test(rawErrorMessage));
  const isTencentMeetingNoTranscript =
    isTencentMeetingImport &&
    !isTencentMeetingTextPending &&
    (recording.transcriptSource === "tencent-meeting-unavailable" || rawTag.includes("腾讯无文字") || rawErrorMessage.includes("没有为这条录制生成"));
  const isTencentMeetingPermissionPending =
    isTencentMeetingImport && !expandedSegments.length && (/待授权|等待下载权限/.test(rawTag) || /暂无权限|无权限/.test(rawErrorMessage));
  const isWaitingTencentMeetingDownload =
    isTencentMeetingImport && !expandedSegments.length && !isTencentMeetingTextPending && (isTencentMeetingPermissionPending || !resolveRecordingAudioPath(recording));
  const isWaitingTencentMeetingTranscript =
    isTencentMeetingImport &&
    !expandedSegments.length &&
    !isTencentMeetingNoTranscript &&
    !isWaitingTencentMeetingDownload &&
    String(recording.transcriptProvider || "") === "tencent-meeting";
  const ownerName =
    isOwnRecording && viewerName && viewerName !== "未设置姓名"
      ? viewerName
      : storedOwnerName && storedOwnerName !== "未设置姓名"
        ? storedOwnerName
        : storedOwnerName || "未设置姓名";
  const cleanedTag = cleanQaVisibleText(recording.tag || "", "");
  const displayTag =
    isWaitingTencentMeetingTranscript && cleanedTag.startsWith("腾讯会议") && /等待腾讯|等待转写/.test(cleanedTag)
      ? tencentMeetingImportTag(tencentMeetingSyncInfoFromRecording(recording), "等待腾讯会议文字")
      : isTencentMeetingImport &&
          expandedSegments.length > 0 &&
          cleanedTag.startsWith("腾讯会议") &&
          /等待腾讯|等待转写|已同步音频/.test(cleanedTag)
        ? tencentMeetingImportTag(tencentMeetingSyncInfoFromRecording(recording), "已同步转写")
        : cleanedTag;
  const displayStatus =
    isTencentMeetingImport && expandedSegments.length > 0 && recording.transcriptSource === "tencent-meeting"
      ? "ready"
      : recording.status;
  
  return {
    id: recording.id,
    seq: recording.seq,
    name: recording.name,
    speakerName: primarySpeaker,
    speakerMap: recording.speakerMap || {},
    speakers,
    tag: displayTag,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    deletedAt: recording.deletedAt || null,
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
    size: recording.size,
    transcriptUrl: recording.transcriptPath ? `/api/recordings/${recording.id}/transcript.txt` : "",
    favorite: Boolean(recording.favorite),
    folderId: recording.folderId || null,
    ownerName,
    shared: recording.shared !== false,
    sharedAt: recording.sharedAt || "",
    canManage: canManageRecording(recording, viewerClientId, viewerName),
    canDelete: canDeleteAllRecordings || canDeleteRecording(recording, viewerClientId, viewerName),
    translationText: recording.translationText || "",
    detectedLanguage: recording.detectedLanguage || "",
    status: displayStatus,
    fileStatus: recording.fileStatus || (recording.storagePath ? "ready" : "pending"),
    transcriptStatus:
      recording.transcriptStatus ||
      (expandedSegments.length > 0
        ? "ready"
        : recording.transcriptSource === "tencent-meeting-unavailable"
          ? "unavailable"
          : displayStatus === "failed"
            ? "failed"
            : displayStatus === "transcribing" || displayStatus === "processing"
              ? "transcribing"
              : "waiting"),
    errorMessage: recording.errorMessage ? userSafeErrorMessage(recording.errorMessage, "转写失败，请稍后点击重新转写。") : "",
    transcriptText,
    transcriptProvider: isTencentMeetingImport ? recording.transcriptProvider || "tencent-meeting" : recording.transcriptProvider || diagnostics.mode,
    transcriptSource: fallbackTranscript
      ? "local-fallback"
      : isTencentMeetingImport
        ? isTencentMeetingTextPending
          ? ""
          : recording.transcriptSource || ""
        : recording.transcriptSource || diagnostics.mode,
    transcriptionStartedAt: recording.transcriptionStartedAt || "",
    transcribedAt: recording.transcribedAt || "",
    meetingOutline: recording.meetingOutline || null,
    meetingOutlineStatus: recording.meetingOutlineStatus || "",
    meetingOutlineError: recording.meetingOutlineError
      ? userSafeErrorMessage(recording.meetingOutlineError, "会议提纲暂未稳定生成，请稍后重新生成。")
      : "",
    meetingOutlineStartedAt: recording.meetingOutlineStartedAt || "",
    meetingOutlinedAt: recording.meetingOutlinedAt || "",
    tencentMeeting: {
      imported: isTencentMeetingImport,
      sourceKind: tencentMeetingSyncInfoFromRecording(recording).sourceKind || "",
      waitingDownload: isWaitingTencentMeetingDownload,
      waitingTranscript: isWaitingTencentMeetingTranscript,
    },
    transcriptHealth: {
      mode: diagnostics.mode,
      configured: diagnostics.configured,
      apiEnabled: canUseRecordingApiTranscription && diagnostics.recordingApiEnabled !== false,
      apiSourceAllowed: canUseRecordingApiTranscription,
      isFallback: fallbackTranscript,
      message:
        recording.status === "failed" && recording.errorMessage
          ? userSafeErrorMessage(recording.errorMessage, "转写失败，请稍后点击重新转写。")
          : recording.errorMessage && expandedSegments.length > 0
            ? `最近一次重新转写失败，当前仍显示上次可用转写。`
          : fallbackTranscript && diagnostics.recordingApiEnabled !== false
            ? "当前显示的是模拟转写，请点击重新转写获取真实内容。"
            : diagnostics.message,
    },
    audioUrl: recording.audioUrl,
    // audioUrl: recording.audioUrl,
    transcript: expandedSegments.map((segment, index) => {
      const speakerKey = segmentSpeakerKey(segment, index);
      const speaker = speakerByKey.get(speakerKey) || speakers[0] || { key: "speaker-1", name: primarySpeaker };
      return {
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        speakerKey: speaker.key,
        speakerName: speaker.name,
        confidence: segment.confidence,
      };
    }),
  };
}

function publicFolder(folder, recordings = []) {
  return {
    id: folder.id,
    name: folder.name,
    ownerClientId: folder.ownerClientId || "",
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    count: recordings.filter((recording) => recording.folderId === folder.id && !recording.deletedAt).length,
  };
}

function canReadFolder(folder, clientId) {
  const ownerClientId = String(folder.ownerClientId || "").trim();
  return !ownerClientId || ownerClientId === clientId;
}

function findRecording(db, id) {
  return db.recordings.find((recording) => recording.id === id);
}

function findSegments(db, recordingId) {
  return db.transcriptSegments
    .filter((segment) => segment.recordingId === recordingId)
    .sort((a, b) => a.startMs - b.startMs);
}

function dailyBriefDateParts(date = new Date(), timeZone = DAILY_BRIEF_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    displayDate: `${parts.month}/${parts.day}`,
    timezone: timeZone,
    hour: Number(parts.hour || 0),
  };
}

function dailyBriefPartsFromDateKey(dateKey, timeZone = DAILY_BRIEF_TIMEZONE) {
  const [year = "", month = "", day = ""] = String(dateKey || "").split("-");
  const current = dailyBriefDateParts(new Date(), timeZone);
  return {
    date: year && month && day ? `${year}-${month}-${day}` : current.date,
    displayDate: month && day ? `${month}/${day}` : current.displayDate,
    timezone: timeZone,
    hour: current.hour,
  };
}

function dailyBriefOwnerKey(clientId = "") {
  return String(clientId || "").trim() || "anonymous";
}

function dailyBriefId(dateKey, clientId = "") {
  const ownerKey = dailyBriefOwnerKey(clientId);
  const ownerHash = crypto.createHash("sha1").update(ownerKey).digest("hex").slice(0, 12);
  return `daily-brief-${dateKey}-${ownerHash}`;
}

function validDateFromSource(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOwnRecording(recording, clientId = "") {
  const ownerClientId = String(recording?.ownerClientId || "").trim();
  const viewerClientId = String(clientId || "").trim();
  return !ownerClientId || ownerClientId === viewerClientId;
}

function recordingReferenceDate(recording, clientId = "") {
  const sharedAt = !isOwnRecording(recording, clientId) ? recording?.sharedAt : "";
  return (
    validDateFromSource(sharedAt) ||
    validDateFromSource(recording?.uploadedAt) ||
    validDateFromSource(recording?.createdAt) ||
    validDateFromSource(recording?.updatedAt) ||
    new Date()
  );
}

/**
 * 
 * @param {*} recording 
 * @param {*} timeZone 
 * @param {*} clientId 
 * @returns string // "YYYY-MM-DD"
 */
function recordingDateKey(recording, timeZone = DAILY_BRIEF_TIMEZONE, clientId = "") {
  const referenceDate = recordingReferenceDate(recording, clientId);
  return dailyBriefDateParts(referenceDate, timeZone).date;
}

function recordingBriefSortTime(recording, clientId = "") {
  return recordingReferenceDate(recording, clientId).getTime();
}

async function transcriptStoragePaths(recordingId, recording = {}) {
  const dateKey = recordingDateKey(recording);
  const dateDir = path.join(transcriptDir, dateKey);
  await mkdir(dateDir, { recursive: true });
  return {
    transcriptPath: path.join(dateDir, `${recordingId}.txt`),
    transcriptRawPath: path.join(dateDir, `${recordingId}.raw.txt`),
    transcriptCorrectedPath: path.join(dateDir, `${recordingId}.corrected.txt`),
    transcriptionMetaPath: path.join(dateDir, `${recordingId}.tencent-asr.json`),
  };
}

function recordingsForBriefDate(db, dateKey, clientId = "", clientName = "") {
  return (db.recordings || [])
    .filter((recording) => !recording.deletedAt && recordingDateKey(recording, DAILY_BRIEF_TIMEZONE, clientId) === dateKey)
    .filter((recording) => !clientId || canReadRecording(recording, clientId, clientName))
    .sort(
      (a, b) =>
        recordingBriefSortTime(a, clientId) - recordingBriefSortTime(b, clientId) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    );
}

function dailyBriefDateKeysForRecordings(db, clientId = "", clientName = "") {
  return [
    ...new Set(
      (db.recordings || [])
        .filter((recording) => !recording.deletedAt)
        .filter((recording) => !clientId || canReadRecording(recording, clientId, clientName))
        .map((recording) => recordingDateKey(recording, DAILY_BRIEF_TIMEZONE, clientId))
        .filter(Boolean),
    ),
  ].sort((a, b) => String(b || "").localeCompare(String(a || "")));
}

function dailyBriefRecordingIds(recordings = []) {
  return recordings.map((recording) => recording.id).filter(Boolean).sort();
}

function publicDailyBriefRecordingState(recording, db) {
  const segments = db ? findSegments(db, recording.id) : [];
  const hasMeetingOutline = Boolean(recording.meetingOutline);
  const transcriptReady = segments.length > 0 || Boolean(recording.transcribedAt || recording.transcriptPath);
  const rawOutlineStatus = String(recording.meetingOutlineStatus || "").trim();
  const meetingOutlineStatus = hasMeetingOutline ? "ready" : rawOutlineStatus || (transcriptReady ? "pending" : "waiting_transcript");
  return {
    id: recording.id,
    seq: recording.seq,
    name: recording.name || `录音 ${String(recording.seq || "").padStart(3, "0")}`,
    createdAt: recording.createdAt || "",
    uploadedAt: recording.uploadedAt || "",
    sharedAt: recording.sharedAt || "",
    durationMs: recording.durationMs || 0,
    status: recording.status || "",
    hasMeetingOutline,
    transcriptReady,
    meetingOutlineStatus,
    meetingOutlinedAt: recording.meetingOutlinedAt || "",
    canRefreshDailyBriefItem: hasMeetingOutline && recording.status !== "failed",
  };
}

function publicDailyBriefRecordingStates(recordings = [], db = null) {
  return recordings.map((recording) => publicDailyBriefRecordingState(recording, db));
}

function sameIdSet(left = [], right = []) {
  const a = [...new Set(left.filter(Boolean))].sort();
  const b = [...new Set(right.filter(Boolean))].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function hasBriefRecordingSetChanged(brief, recordings) {
  return !sameIdSet(Array.isArray(brief?.recordingIds) ? brief.recordingIds : [], dailyBriefRecordingIds(recordings));
}

function findDailyBrief(db, dateKey, clientId = "") {
  const ownerKey = dailyBriefOwnerKey(clientId);
  return (db.dailyMeetingBriefs || []).find((brief) => brief.date === dateKey && dailyBriefOwnerKey(brief.clientId) === ownerKey);
}

function upsertDailyBriefInDb(nextDb, brief) {
  nextDb.dailyMeetingBriefs = Array.isArray(nextDb.dailyMeetingBriefs) ? nextDb.dailyMeetingBriefs : [];
  const ownerKey = dailyBriefOwnerKey(brief.clientId);
  const index = nextDb.dailyMeetingBriefs.findIndex((item) => item.date === brief.date && dailyBriefOwnerKey(item.clientId) === ownerKey);
  if (index >= 0) {
    nextDb.dailyMeetingBriefs[index] = { ...nextDb.dailyMeetingBriefs[index], ...brief };
  } else {
    nextDb.dailyMeetingBriefs.push(brief);
  }
}

function emptyDailyBrief(parts, recordings = [], clientId = "") {
  const now = new Date().toISOString();
  return {
    id: dailyBriefId(parts.date, clientId),
    date: parts.date,
    clientId: dailyBriefOwnerKey(clientId),
    displayDate: parts.displayDate,
    timezone: parts.timezone,
    meetingCount: recordings.length,
    recordingIds: dailyBriefRecordingIds(recordings),
    title: DAILY_BRIEF_TITLE,
    summaryMarkdown: "",
    status: recordings.length ? "generating" : "empty",
    generatedAt: "",
    updatedAt: now,
    dirty: recordings.length > 0,
  };
}

function dailyBriefPlaceholder(parts, recordings = [], clientId = "") {
  const placeholder = emptyDailyBrief(parts, recordings, clientId);
  if (recordings.length > 0) {
    placeholder.status = "idle";
    placeholder.dirty = true;
  }
  return placeholder;
}

function publicDailyBrief(brief, parts = dailyBriefDateParts(), recordings = [], clientId = "", db = null) {
  const fallback = brief || emptyDailyBrief(parts, recordings, clientId);
  const currentRecordingIds = dailyBriefRecordingIds(recordings);
  const storedRecordingIds = Array.isArray(fallback.recordingIds) ? fallback.recordingIds : [];
  const useCurrentRecordingSet = recordings.length > 0 && !sameIdSet(storedRecordingIds, currentRecordingIds);
  const recordingIds = useCurrentRecordingSet ? currentRecordingIds : storedRecordingIds.length ? storedRecordingIds : currentRecordingIds;
  const meetingCount = useCurrentRecordingSet ? recordings.length : Number(fallback.meetingCount ?? recordings.length ?? 0);
  const status = useCurrentRecordingSet && fallback.status === "empty" ? "idle" : fallback.status || (recordings.length ? "generating" : "empty");
  return {
    id: fallback.id || dailyBriefId(parts.date, fallback.clientId || clientId),
    date: fallback.date || parts.date,
    clientId: fallback.clientId || dailyBriefOwnerKey(clientId),
    displayDate: fallback.displayDate || parts.displayDate,
    timezone: fallback.timezone || parts.timezone,
    meetingCount,
    recordingIds,
    title: fallback.title || DAILY_BRIEF_TITLE,
    summaryMarkdown: cleanQaVisibleText(fallback.summaryMarkdown || "", ""),
    status,
    generatedAt: fallback.generatedAt || "",
    updatedAt: fallback.updatedAt || "",
    dirty: Boolean(fallback.dirty || useCurrentRecordingSet),
    recordingStates: publicDailyBriefRecordingStates(recordings, db),
  };
}

function normalizeDailyBriefDateParam(value = "") {
  const dateKey = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : "";
}

function shouldGenerateDailyBrief(parts, brief, recordings) {
  if (!recordings.length) return false;
  if (brief?.status === "generating") return false;
  if (!brief || hasBriefRecordingSetChanged(brief, recordings)) return true;
  if (parts.hour < 19 && !brief?.dirty) return false;
  return brief.status !== "ready" || brief.dirty;
}

function hasActiveDailyBriefJob(dateKey, clientId = "") {
  return dailyBriefJobs.has(dailyBriefJobKey(dateKey, clientId));
}

function isOrphanDailyBriefGenerating(brief, dateKey, clientId = "") {
  return brief?.status === "generating" && !hasActiveDailyBriefJob(dateKey, clientId);
}

async function markDailyBriefDirtyForRecording(recordingId) {
  const parts = dailyBriefDateParts();
  if (parts.hour < 19) return;

  await updateDb((nextDb) => {
    const recording = findRecording(nextDb, recordingId);
    if (!recording || recordingDateKey(recording, DAILY_BRIEF_TIMEZONE, recording.ownerClientId || "") !== parts.date) return;

    const ownerClientId = recording.ownerClientId || "";
    const recordings = recordingsForBriefDate(nextDb, parts.date, ownerClientId);
    const current = findDailyBrief(nextDb, parts.date, ownerClientId) || emptyDailyBrief(parts, recordings, ownerClientId);
    upsertDailyBriefInDb(nextDb, {
      ...current,
      clientId: dailyBriefOwnerKey(ownerClientId),
      meetingCount: recordings.length,
      recordingIds: dailyBriefRecordingIds(recordings),
      status: current.status === "ready" ? "ready" : current.status || "generating",
      dirty: true,
      updatedAt: new Date().toISOString(),
    });
  });
}

function dailyBriefJobKey(dateKey, clientId = "") {
  return `${dateKey}:${dailyBriefOwnerKey(clientId)}`;
}

async function markDailyBriefGenerating(dateKey, clientId = "", clientName = "") {
  const parts = dailyBriefPartsFromDateKey(dateKey);
  const updatedAt = new Date().toISOString();
  let queued = null;
  await updateDb((nextDb) => {
    const recordings = recordingsForBriefDate(nextDb, dateKey, clientId, clientName);
    const current = findDailyBrief(nextDb, dateKey, clientId) || emptyDailyBrief(parts, recordings, clientId);
    queued = {
      ...current,
      id: dailyBriefId(parts.date, clientId),
      date: parts.date,
      clientId: dailyBriefOwnerKey(clientId),
      displayDate: parts.displayDate,
      timezone: parts.timezone,
      meetingCount: recordings.length,
      recordingIds: dailyBriefRecordingIds(recordings),
      title: current.title || DAILY_BRIEF_TITLE,
      status: recordings.length ? "generating" : "empty",
      dirty: recordings.length > 0,
      updatedAt,
    };
    upsertDailyBriefInDb(nextDb, queued);
  });
  return queued || emptyDailyBrief(parts, [], clientId);
}

async function queueDailyBriefGeneration(dateKey, clientId = "", clientName = "") {
  const jobKey = dailyBriefJobKey(dateKey, clientId);
  if (dailyBriefJobs.has(jobKey)) {
    const db = await loadDb();
    const parts = dailyBriefPartsFromDateKey(dateKey);
    const recordings = recordingsForBriefDate(db, dateKey, clientId, clientName);
    return findDailyBrief(db, dateKey, clientId) || emptyDailyBrief(parts, recordings, clientId);
  }
  const queued = await markDailyBriefGenerating(dateKey, clientId, clientName);
  if (queued.status === "generating") {
    generateAndStoreDailyBrief(dateKey, clientId, clientName).catch((error) =>
      console.warn("[Daily brief] background generation failed:", error instanceof Error ? error.message : error),
    );
  }
  return queued;
}

async function generateAndStoreDailyBrief(dateKey = dailyBriefDateParts().date, clientId = "", clientName = "") {
  const jobKey = dailyBriefJobKey(dateKey, clientId);
  if (dailyBriefJobs.has(jobKey)) return dailyBriefJobs.get(jobKey);

  const job = (async () => {
    const parts = dailyBriefPartsFromDateKey(dateKey);
    const startedAt = new Date().toISOString();
    let recordings = [];

    await updateDb((nextDb) => {
      recordings = recordingsForBriefDate(nextDb, dateKey, clientId, clientName);
      const current = findDailyBrief(nextDb, dateKey, clientId) || emptyDailyBrief(parts, recordings, clientId);
      upsertDailyBriefInDb(nextDb, {
        ...current,
        clientId: dailyBriefOwnerKey(clientId),
        meetingCount: recordings.length,
        recordingIds: dailyBriefRecordingIds(recordings),
        status: recordings.length ? "generating" : "empty",
        dirty: recordings.length > 0,
        updatedAt: startedAt,
      });
    });

    if (!recordings.length) {
      const empty = emptyDailyBrief(parts, recordings, clientId);
      await updateDb((nextDb) => upsertDailyBriefInDb(nextDb, empty));
      return empty;
    }

    const db = await loadDb();
    const freshRecordings = recordingsForBriefDate(db, dateKey, clientId, clientName);
    const items = freshRecordings.map((recording) => ({ recording, segments: findSegments(db, recording.id) }));

    try {
      const result = await generateDailyMeetingBrief(items, {
        date: parts.date,
        displayDate: parts.displayDate,
        timezone: parts.timezone,
      });
      const ready = {
        id: dailyBriefId(parts.date, clientId),
        date: parts.date,
        clientId: dailyBriefOwnerKey(clientId),
        displayDate: parts.displayDate,
        timezone: parts.timezone,
        meetingCount: freshRecordings.length,
        recordingIds: dailyBriefRecordingIds(freshRecordings),
        title: DAILY_BRIEF_TITLE,
        summaryMarkdown: result.summaryMarkdown || "",
        status: "ready",
        generatedAt: result.generatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dirty: false,
      };
      await updateDb((nextDb) => upsertDailyBriefInDb(nextDb, ready));
      return ready;
    } catch (error) {
      console.warn("[Daily brief] generation failed:", error instanceof Error ? error.message : error);
      const failed = {
        id: dailyBriefId(parts.date, clientId),
        date: parts.date,
        clientId: dailyBriefOwnerKey(clientId),
        displayDate: parts.displayDate,
        timezone: parts.timezone,
        meetingCount: freshRecordings.length,
        recordingIds: dailyBriefRecordingIds(freshRecordings),
        title: DAILY_BRIEF_TITLE,
        summaryMarkdown: "",
        status: "failed",
        generatedAt: "",
        updatedAt: new Date().toISOString(),
        dirty: true,
      };
      await updateDb((nextDb) => upsertDailyBriefInDb(nextDb, failed));
      return failed;
    }
  })().finally(() => dailyBriefJobs.delete(jobKey));

  dailyBriefJobs.set(jobKey, job);
  return job;
}

function scheduleDailyBriefGeneration() {
  const run = () => {
    const parts = dailyBriefDateParts();
    if (parts.hour < 19 || dailyBriefScheduleState.lastDate === parts.date) return;

    dailyBriefScheduleState.lastDate = parts.date;
    generateAndStoreDailyBrief(parts.date).catch((error) =>
      console.warn("[Daily brief] scheduled generation failed:", error instanceof Error ? error.message : error),
    );
  };

  run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref?.();
}

function qaMessageRecordingIds(message) {
  return Array.isArray(message.recordingIds) ? message.recordingIds : message.recordingId ? [message.recordingId] : [];
}

function cloneQaMessage(message) {
  return JSON.parse(JSON.stringify(message || {}));
}

function cacheQaMessage(message) {
  if (!message?.id) return message;
  const cached = cloneQaMessage(message);
  qaMessageCache.set(cached.id, cached);
  return cached;
}

function cachedQaMessage(id) {
  return qaMessageCache.get(String(id || "")) || null;
}

function persistQaMessageSnapshot(message, { removeReadyCache = true } = {}) {
  if (!message?.id) return Promise.resolve(null);
  const snapshot = cloneQaMessage(message);
  return updateDb((db) => {
    db.qaMessages = Array.isArray(db.qaMessages) ? db.qaMessages : [];
    const existing = findQaMessage(db, snapshot.id);
    if (existing) {
      Object.assign(existing, snapshot);
      return existing;
    }
    db.qaMessages.push(snapshot);
    return snapshot;
  })
    .then((stored) => {
      const current = cachedQaMessage(snapshot.id);
      if (removeReadyCache && current && !current.pending && current.status !== "pending") {
        qaMessageCache.delete(snapshot.id);
      }
      return stored;
    })
    .catch((error) => {
      console.warn("[QA] persist snapshot failed:", error instanceof Error ? error.message : error);
      return null;
    });
}

function sameRecordingScope(left = [], right = []) {
  const a = [...new Set(left.filter(Boolean))].sort();
  const b = [...new Set(right.filter(Boolean))].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function normalizeQaReuseQuestion(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function qaMessageHasAttachments(message = {}) {
  return Array.isArray(message.attachments) && message.attachments.some((item) => !item?.deletedAt);
}

function qaAnswerLooksReusable(message = {}) {
  if (message.pending || message.status === "pending") return true;
  const answer = String(message.answer || "").trim();
  if (!answer) return false;
  return !/大模型暂未|待重新分析|需要重新生成结构化分析|提问失败|问答服务暂时不可用/.test(answer);
}

function findReusableQaMessage(db, { clientId, recordingIds, question }) {
  const normalizedQuestion = normalizeQaReuseQuestion(question);
  if (!normalizedQuestion) return null;
  return [...(db.qaMessages || [])]
    .filter((message) => {
      if (message.deletedAt || message.clientId !== clientId || qaMessageHasAttachments(message)) return false;
      if (normalizeQaReuseQuestion(message.question) !== normalizedQuestion) return false;
      if (!sameRecordingScope(qaMessageRecordingIds(message), recordingIds)) return false;
      return qaAnswerLooksReusable(message);
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0] || null;
}

function publicQaAttachments(message) {
  return (Array.isArray(message.attachments) ? message.attachments : []).map((item) => {
    const attachment = { ...item };
    delete attachment.storagePath;
    if (attachment.fileId && !attachment.url) {
      attachment.url = `/api/qa-messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.fileId)}`;
    }
    return attachment;
  });
}

function publicQaMessage(message, recordingMap = new Map()) {
  const ids = qaMessageRecordingIds(message);
  const names = ids.map((id) => recordingMap.get(id)?.name).filter(Boolean);
  const fallbackNames = Array.isArray(message.recordingNames) ? message.recordingNames.filter(Boolean) : [];
  const structuredAnswer = sanitizeStructuredQaAnswer(message.structuredAnswer || parseStructuredQaAnswer(message.answer));
  const answer =
    structuredAnswer
      ? structuredQaAnswerToText(structuredAnswer) || QA_TECHNICAL_FALLBACK
      : cleanQaVisibleText(message.answer, message.pending || message.status === "pending" ? "" : QA_TECHNICAL_FALLBACK);
  return {
    ...message,
    answer,
    structuredAnswer,
    citations: sanitizeQaCitations(message.citations),
    reasoningContent: "",
    thinking: qaVisibleThinkingSteps(message),
    attachments: publicQaAttachments(message),
    pending: Boolean(message.pending || message.status === "pending"),
    status: message.pending || message.status === "pending" ? "pending" : message.status || "ready",
    favorite: Boolean(message.favorite),
    deletedAt: message.deletedAt || null,
    recordingIds: ids,
    recordingNames: names.length ? names : fallbackNames,
  };
}

function findQaMessage(db, id) {
  return (db.qaMessages || []).find((message) => message.id === id);
}

function canReadQaMessage(message, clientId) {
  return Boolean(message.clientId) && message.clientId === clientId;
}

function compactSearchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function searchBigrams(value = "") {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, "");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

function compactSearchToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, "");
}

function unorderedCharacterMatchScore(source, needle, weight = 1) {
  const compactSource = compactSearchToken(source);
  const compactNeedle = compactSearchToken(needle);
  if (!compactSource || !compactNeedle) return 0;
  if (compactNeedle.length === 1 && /\p{Script=Han}/u.test(compactNeedle) && compactSource.includes(compactNeedle)) {
    return 28 * weight;
  }

  if (compactNeedle.length >= 2 && compactNeedle.length <= 8) {
    const chars = [...new Set([...compactNeedle])];
    if (chars.length >= 2 && chars.every((char) => compactSource.includes(char))) {
      return 24 * weight;
    }
  }

  return 0;
}

function fieldSearchScore(text, query, weight = 1) {
  const source = compactSearchText(text);
  const needle = compactSearchText(query);
  if (!source || !needle) return 0;
  if (source === needle) return 100 * weight;
  if (source.startsWith(needle)) return 75 * weight;
  if (needle.length >= 2 && source.includes(needle)) return 55 * weight;
  const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length > 0 && tokens.every((token) => source.includes(token))) return 35 * weight;
  return unorderedCharacterMatchScore(source, needle, weight);
}

function transcriptSearchScore(text, query) {
  const source = compactSearchText(text);
  const needle = compactSearchText(query);
  if (!source || !needle) return 0;
  if (needle.length >= 3 && source.includes(needle)) return 42;

  const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length > 0) {
    const matched = tokens.filter((token) => source.includes(token)).length;
    return matched === tokens.length ? 34 : matched / tokens.length >= 0.75 ? 22 : 0;
  }

  const grams = searchBigrams(needle);
  if (grams.length < 2) return 0;
  const matched = grams.filter((gram) => source.includes(gram)).length;
  const ratio = matched / grams.length;
  return ratio >= 0.68 ? 30 * ratio : 0;
}

function recordingSearchScore(recording, query) {
  const transcriptText = recording.transcript.map((segment) => segment.text).join(" ");
  const translationText = recording.translationText || "";
  const seq = String(recording.seq).padStart(3, "0");
  return Math.max(
    fieldSearchScore(recording.name, query, 1.6),
    fieldSearchScore(seq, query, 1.5),
    fieldSearchScore(recording.tag, query, 1.25),
    fieldSearchScore(recording.ownerName, query, 1),
    fieldSearchScore(recording.speakerName, query, 0.8),
    fieldSearchScore(recording.speakers.map((speaker) => speaker.name).join(" "), query, 0.8),
    transcriptSearchScore(transcriptText, query),
    transcriptSearchScore(translationText, query),
  );
}

const QA_TECHNICAL_FALLBACK = "回答内容包含模型中间格式，已自动隐藏。请重新生成。";
const QA_THINKING_STEPS = ["读取选中录音的逐字稿", "抽取与问题最相关的候选语义段", "核对时间点与原文证据", "组织结论、原因和依据"];
const MOJIBAKE_REPLACEMENTS = [
  [/\u7481\u677f\u7d8d/g, "记录"],
  [/\u675e\ue100\u5553\u68f0\u52ee\ue74d/g, "转写预览"],
  [/\u93c0\u60f0\u6363/g, "收起"],
  [/\u7487\u4f79\u5d41/g, "证据"],
  [/\u8930\u66e2\u7176/g, "录音"],
  [/\u675e\ue102\u721c/g, "转码"],
  [/\u95c2\ue1be\u74df/g, "问答"],
  [/\u93c2\u56e7\u74e7/g, "文字"],
  [/\u9352\u55d5\u97e9/g, "分享"],
  [/\u6fb6\u8fab\u89e6/g, "失败"],
];
const MOJIBAKE_PATTERN =
  /\u7481\u677f\u7d8d|\u675e\ue100\u5553\u68f0\u52ee\ue74d|\u93c0\u60f0\u6363|\u8930\u66e2|\u6d7c\u6c33|\u7490\u71bb|\u59dd\uff45\u6e6a|\u6fb6\u8fab\u89e6|\u93c2\u56e7\u74e7|\u93c3\u5815\u66b1|\u95ca\u62bd|\u9352\u55d5\u97e9|\u934f\u62bd\u68f4|\u6fb6\u5d85\u57d7|\u6434\u66e2\u5134|\u7035\u8270\u57c5|\u93b4\u6220|\u93bb\u6130\u68f6|\u93c8\u6944|\u9350\u546d|\u7ef1\u3220\u7d29|\u59af\u2033\u7037|\u9422\u71b8\u579a|\u9358\u71b7\u6d1c|\u934f\u62bd\u656d|\u6e1a\u6fc7\u5d41|\u93c1\u7fe0\u7d8b|\u9352\u3086\u67c7|\u934a\u60e7\u609c|\u7ecb\u5b2a\u5bb3|\u93cd\u7a3f\u7e3e|\u9352\u55d9\u5063|\u7f01\u64b9|\u95c2\ue1be\u74df|\u9286|\u951b|\u951f|\ufffd/;
const TECHNICAL_ANSWER_PATTERN =
  /DSML|tool_calls|search_transcript_segments|<\s*\|\s*DSML|<\/\s*\|\s*DSML|overall_judgement|final_conclusion|"evidences"\s*:|"analysis"\s*:|"confidence"\s*:|cleanText\(|\{cleanText|point\.(?:conclusion|reason|basis)|Bad control character|JSON parse failed|Cannot POST|<!DOCTYPE html|<html\b|parameter name=|invoke name=|function\s+\w+\s*\(|const\s+\w+\s*=|=>\s*\{|```/i;

function repairKnownMojibake(value) {
  return MOJIBAKE_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));
}

function stripAnswerMarkup(value) {
  return repairKnownMojibake(value)
    .replace(/\*\*/g, "")
    .replace(/```(?:json|markdown|javascript|js|html|xml)?/gi, "")
    .replace(/```/g, "")
    .replace(/[<]\/?\s*(?:DSML|tool_calls|invoke|parameter)[^>]*>/gi, "")
    .replace(/【录音[^】]+】/g, "")
    .replace(/\[[^\]]*(?:录音|\u8930\u66e2\u7176)[^\]]*\]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ""));
}

function looksLikeTechnicalAnswerLeak(value) {
  const text = String(value || "");
  return looksLikeMojibake(text) || TECHNICAL_ANSWER_PATTERN.test(text);
}

function cleanQaVisibleText(value, fallback = "") {
  const clean = stripQaInternalIndexMarkers(stripAnswerMarkup(value));
  if (!clean) return fallback;
  return looksLikeTechnicalAnswerLeak(clean) ? fallback : clean;
}

function parseStructuredQaAnswer(answer) {
  if (answer && typeof answer === "object") return answer;
  const raw = String(answer || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  for (const candidate of candidates) {
    const variants = [
      candidate,
      candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " "),
      candidate.replace(/,\s*([}\]])/g, "$1"),
      candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ").replace(/,\s*([}\]])/g, "$1"),
    ];
    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant);
        if (parsed && typeof parsed === "object" && (parsed.overall_judgement || parsed.final_conclusion || Array.isArray(parsed.analysis))) {
          return parsed;
        }
      } catch {
        // Try the next cleanup variant.
      }
    }
  }
  return null;
}

function stripQaInternalIndexMarkers(value = "") {
  return String(value ?? "")
    .replace(/\s*[\uFF08(]\s*(?:candidate\s*)?(?:index|indices|indexes)\s*[:\uFF1A]?\s*[\d,\s\u3001\uFF0C\u548Cand-]+[\uFF09)]/gi, "")
    .replace(/\s*[\uFF08(]\s*(?:候选)?索引\s*[:：]?\s*[\d,\s、，和-]+[\uFF09)]/g, "")
    .replace(/\b(?:candidate\s*)?(?:index|indices|indexes)\s*[:\uFF1A]?\s*[\d,\s\u3001\uFF0C\u548Cand-]+/gi, "")
    .replace(/\b(?:index|indices|indexes)\d+\b/gi, "")
    .replace(/(?:候选)?索引\s*[:：]?\s*[\d,\s、，和-]+/g, "")
    .replace(/\s+([，。；、：])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function structuredQaAnswerToText(structured) {
  if (!structured || typeof structured !== "object") return "";
  const cleanText = (value) => cleanQaVisibleText(value);
  const lines = [];
  if (structured.overall_judgement) {
    lines.push("整体判断", cleanText(structured.overall_judgement), "");
  }
  if (structured.judgement_level) {
    lines.push("判断等级 / 倾向程度", cleanText(structured.judgement_level), "");
  }
  const coreBasis = Array.isArray(structured.core_basis) ? structured.core_basis.filter(Boolean) : [];
  if (coreBasis.length > 0) {
    lines.push("核心依据", ...coreBasis.map((item, index) => `${index + 1}. ${cleanText(item)}`), "");
  }
  const analysis = Array.isArray(structured.analysis) ? structured.analysis : [];
  if (analysis.length > 0) {
    lines.push("分点分析");
    analysis.forEach((point, index) => {
      lines.push(`${index + 1}. ${cleanText(point?.title || `判断点 ${index + 1}`)}`);
      if (point?.conclusion) lines.push(`结论：${cleanText(point.conclusion)}`);
      if (point?.reason) lines.push(`原因：${cleanText(point.reason)}`);
      if (point?.basis) lines.push(`关键依据：${cleanText(point.basis)}`);
      lines.push("");
    });
  }
  if (structured.final_conclusion) {
    lines.push("最终结论", cleanText(structured.final_conclusion));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeStructuredQaAnswer(structured) {
  if (!structured || typeof structured !== "object") return null;
  const cleanText = (value, fallback = "", maxLength = 1200) => cleanQaVisibleText(value, fallback).slice(0, maxLength);
  const coreBasis = Array.isArray(structured.core_basis)
    ? structured.core_basis.map((item) => cleanText(item, "", 220)).filter(Boolean).slice(0, 6)
    : [];
  const analysis = Array.isArray(structured.analysis)
    ? structured.analysis
        .map((point, index) => ({
          title: cleanText(point?.title, `判断点 ${index + 1}`, 80),
          conclusion: cleanText(point?.conclusion, "原文证据不足", 360),
          reason: cleanText(point?.reason, "原文证据不足，无法进一步判断。", 520),
          basis: cleanText(point?.basis, "原文证据不足", 520),
          evidence_ids: Array.isArray(point?.evidence_ids) ? point.evidence_ids.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 3) : [],
        }))
        .filter((point) => point.title || point.conclusion || point.reason || point.basis)
    : [];
  const evidences = Array.isArray(structured.evidences)
    ? structured.evidences
        .map((evidence, index) => ({
          ...evidence,
          id: cleanText(evidence?.id, `e${index + 1}`, 30).replace(/\s+/g, "-"),
          analysis_title: cleanText(evidence?.analysis_title || evidence?.analysisTitle, "", 80),
          evidence_title: cleanText(evidence?.evidence_title || evidence?.evidenceTitle, `证据 ${index + 1}`, 80),
          quote: cleanText(evidence?.quote, "", 220),
          evidence_role: cleanText(evidence?.evidence_role || evidence?.evidenceRole, "", 180),
        }))
        .filter((evidence) => evidence.evidence_title || evidence.quote || evidence.evidence_role)
    : [];
  const normalized = {
    overall_judgement: cleanText(structured.overall_judgement || structured.overallJudgement, "", 700),
    judgement_level: cleanText(structured.judgement_level || structured.judgementLevel || structured.level, "", 160),
    core_basis: coreBasis,
    analysis,
    evidences,
    final_conclusion: cleanText(structured.final_conclusion || structured.finalConclusion, "", 500),
  };
  const hasVisibleText = [
    normalized.overall_judgement,
    normalized.judgement_level,
    normalized.final_conclusion,
    ...normalized.core_basis,
    ...normalized.analysis.flatMap((point) => [point.title, point.conclusion, point.reason, point.basis]),
    ...normalized.evidences.flatMap((evidence) => [evidence.evidence_title, evidence.quote, evidence.evidence_role]),
  ].some(Boolean);
  return hasVisibleText ? normalized : null;
}

function sanitizeQaCitations(citations = []) {
  return (Array.isArray(citations) ? citations : []).map((citation) => ({
    ...citation,
    recordingName: cleanQaVisibleText(citation?.recordingName, ""),
    text: cleanQaVisibleText(citation?.text, ""),
    analysisTitle: cleanQaVisibleText(citation?.analysisTitle, ""),
    evidenceTitle: cleanQaVisibleText(citation?.evidenceTitle, ""),
    evidenceRole: cleanQaVisibleText(citation?.evidenceRole, ""),
  }));
}

function qaVisibleThinkingSteps(message = {}) {
  const steps = Array.isArray(message.thinking) ? message.thinking : [];
  const safeSteps = steps
    .map((step) => cleanQaVisibleText(step))
    .filter(Boolean)
    .filter((step) => !looksLikeTechnicalAnswerLeak(step))
    .slice(0, 8);
  return safeSteps.length > 0 ? safeSteps : QA_THINKING_STEPS;
}

function answerBlocksForPdf(answer) {
  const structured = parseStructuredQaAnswer(answer);
  if (structured) {
    const text = structuredQaAnswerToText(structured);
    return text
      .split(/\n{2,}/)
      .map((item) => stripQaInternalIndexMarkers(stripAnswerMarkup(item)))
      .filter(Boolean);
  }

  const clean = stripQaInternalIndexMarkers(stripAnswerMarkup(answer));
  if (!clean) return [];
  if (looksLikeTechnicalAnswerLeak(clean)) {
    return ["回答内容包含模型中间格式，已自动隐藏。请在问答页重新生成该回答后再分享。"];
  }

  const numbered = clean.match(/(?:^|\n)(?:\d+[.、]\s*)[\s\S]*?(?=\n\d+[.、]\s*|$)/g);
  if (numbered && numbered.length > 1) {
    const prefix = clean.slice(0, clean.indexOf(numbered[0])).trim();
    return [prefix, ...numbered.map((item) => item.trim())].filter(Boolean);
  }

  return clean
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPdfTime(ms = 0) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatPdfDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeDownloadName(name) {
  return String(name || "问答记录").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "问答记录";
}

function safeAttachmentName(name = "attachment") {
  const clean = String(name || "attachment").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return clean.slice(0, 120) || "attachment";
}

function extensionFromMime(mimeType = "", fallbackName = "") {
  const ext = path.extname(fallbackName || "").toLowerCase();
  if (ext && ext.length <= 12) return ext;
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "application/json": ".json",
  };
  return map[String(mimeType || "").toLowerCase()] || ".bin";
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  return { mimeType, buffer };
}

async function persistQaAttachment(messageId, item, fallbackKind = "file") {
  const fileId = crypto.randomUUID();
  const kind = String(item?.kind || fallbackKind || "file").slice(0, 24);
  const name = safeAttachmentName(item?.name || (kind === "image" ? "图片" : "附件"));
  const text = String(item?.text || "").slice(0, 6000);
  const externalUrl = String(item?.url || "").slice(0, 500);
  const dataUrl = String(item?.dataUrl || "");
  const parsed = parseDataUrl(dataUrl);
  const mimeType = String(item?.type || parsed?.mimeType || "").slice(0, 100);
  const attachment = {
    id: fileId,
    fileId,
    kind,
    name,
    type: mimeType,
    text,
    url: externalUrl,
  };

  if (parsed?.buffer?.length) {
    if (parsed.buffer.length > 8 * 1024 * 1024) {
      throw new Error(`${name} 文件过大，无法保存到问答记录`);
    }
    const folder = path.join(attachmentDir, messageId);
    await mkdir(folder, { recursive: true });
    const fileName = `${fileId}${extensionFromMime(mimeType || parsed.mimeType, name)}`;
    const storagePath = path.join(folder, fileName);
    await writeFile(storagePath, parsed.buffer);
    attachment.type = mimeType || parsed.mimeType;
    attachment.storagePath = storagePath;
    attachment.url = `/api/qa-messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(fileId)}`;
  }

  return attachment;
}

async function persistQaAttachments(messageId, images = [], attachments = []) {
  const imageItems = (Array.isArray(images) ? images : []).slice(0, 3).map((item) => ({
    kind: "image",
    name: String(item?.name || "图片").slice(0, 120),
    type: String(item?.type || "image/jpeg").slice(0, 100),
    dataUrl: item?.dataUrl,
  }));
  const attachmentItems = (Array.isArray(attachments) ? attachments : []).slice(0, 6);
  const saved = [];
  for (const item of [...imageItems, ...attachmentItems]) {
    saved.push(await persistQaAttachment(messageId, item, item?.kind || "file"));
  }
  return saved;
}

function scheduleQaJob(messageId) {
  if (!messageId || qaJobs.has(messageId)) return;
  const job = runQaJob(messageId).finally(() => qaJobs.delete(messageId));
  qaJobs.set(messageId, job);
}

function schedulePendingQaMessages(messages = []) {
  messages.forEach((message) => {
    if (message?.pending || message?.status === "pending") scheduleQaJob(message.id);
  });
}

async function runQaJob(messageId) {
  let jobMessage = null;
  try {
    const db = await loadDb();
    const message = findQaMessage(db, messageId) || cachedQaMessage(messageId);
    if (!message || message.deletedAt || (!message.pending && message.status !== "pending")) return;
    jobMessage = message;

    const ids = qaMessageRecordingIds(message);
    const targetRecordings = ids.length
      ? db.recordings.filter((recording) => ids.includes(recording.id) && !recording.deletedAt && canReadRecording(recording, message.clientId, ""))
      : db.recordings.filter((recording) => !recording.deletedAt && canReadRecording(recording, message.clientId, ""));
    const items = targetRecordings
      .map((recording) => ({
        recording,
        segments: expandTranscriptSegments(findSegments(db, recording.id), recording.durationMs || 0),
      }))
      .filter((item) => item.segments.length > 0);
    const history = (db.qaMessages || [])
      .filter((item) => item.id !== message.id && !item.deletedAt && item.clientId === message.clientId && !item.pending && item.status !== "pending")
      .filter((item) => sameRecordingScope(qaMessageRecordingIds(item), ids))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .slice(-6);

    const answer = await answerRecordingsQuestion(items, message.question, {
      attachments: message.attachments || [],
      history,
    });

    const ready = {
      ...message,
      answer: answer.answer || "",
      structuredAnswer: answer.structuredAnswer || null,
      jumpToMs: answer.jumpToMs || 0,
      citations: answer.citations || [],
      provider: answer.provider || message.provider || "",
      model: answer.model || message.model || "",
      reasoningContent: answer.reasoningContent || "",
      thinking: Array.isArray(answer.thinking) ? answer.thinking : [],
      pending: false,
      status: "ready",
      updatedAt: new Date().toISOString(),
    };
    cacheQaMessage(ready);
    persistQaMessageSnapshot(ready);
  } catch (error) {
    console.warn("[QA] job failed:", error instanceof Error ? error.message : error);
    const failed = {
      ...(cachedQaMessage(messageId) || jobMessage || { id: messageId, clientId: "", question: "" }),
      answer: "提问失败：问答服务暂时不可用，请稍后重试。",
      structuredAnswer: null,
      citations: [],
      provider: "",
      model: "",
      reasoningContent: "",
      thinking: [],
      pending: false,
      status: "failed",
      updatedAt: new Date().toISOString(),
    };
    cacheQaMessage(failed);
    persistQaMessageSnapshot(failed);
  }
}

function resolvePdfFontPath() {
  const candidates = [
    [process.env.PDF_FONT_PATH, process.env.PDF_FONT_FAMILY || ""],
    ["C:\\Windows\\Fonts\\NotoSansSC-VF.ttf", ""],
    ["C:\\Windows\\Fonts\\simhei.ttf", ""],
    ["C:\\Windows\\Fonts\\msyh.ttc", ""],
    ["/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular"],
    ["/usr/share/fonts/google-noto-cjk/NotoSerifCJK-Regular.ttc", "NotoSerifCJKsc-Regular"],
    ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular"],
    ["/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular"],
    ["/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", ""],
  ].filter(Boolean);
  const found = candidates.find(([candidate]) => candidate && existsSync(candidate));
  return found ? { path: found[0], family: found[1] || "" } : null;
}

function resolvePdfBoldFontPath() {
  const candidates = [
    [process.env.PDF_BOLD_FONT_PATH, process.env.PDF_BOLD_FONT_FAMILY || ""],
    ["C:\\Windows\\Fonts\\Dengb.ttf", ""],
    ["C:\\Windows\\Fonts\\simhei.ttf", ""],
    ["C:\\Windows\\Fonts\\simsunb.ttf", ""],
    ["C:\\Windows\\Fonts\\msyhbd.ttc", ""],
    ["/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold"],
    ["/usr/share/fonts/google-noto-cjk/NotoSansCJK-Medium.ttc", "NotoSansCJKsc-Medium"],
    ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold"],
    ["/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold"],
  ].filter(Boolean);
  const found = candidates.find(([candidate]) => candidate && existsSync(candidate));
  return found ? { path: found[0], family: found[1] || "" } : resolvePdfFontPath();
}

function applyPdfFont(doc, font) {
  if (!font?.path) return doc;
  if (font.family) return doc.font(font.path, font.family);
  return doc.font(font.path);
}

function renderQaMessagePdf(message, recordingMap = new Map()) {
  return new Promise((resolve, reject) => {
    const publicMessage = publicQaMessage(message, recordingMap);
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      info: {
        Title: publicMessage.question || "录音问答",
        Author: "企业微信录音 H5",
        Subject: "录音问答分享",
      },
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regularFontPath = resolvePdfFontPath();
    const boldFontPath = resolvePdfBoldFontPath();
    const setFont = (bold = true) => {
      if (bold && boldFontPath) applyPdfFont(doc, boldFontPath);
      else if (regularFontPath) applyPdfFont(doc, regularFontPath);
      return doc;
    };
    setFont(true);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const addSectionTitle = (title) => {
      doc.moveDown(0.9);
      setFont(true).fillColor("#000000").fontSize(15).text(title, { width: pageWidth });
      doc.moveDown(0.35);
    };

    const addParagraph = (text, options = {}) => {
      setFont(options.bold !== false);
      doc.fillColor(options.color || "#000000").fontSize(options.size || 11).text(String(text || ""), {
        width: pageWidth,
        lineGap: options.lineGap ?? 4,
        align: "left",
      });
    };

    setFont(true).fillColor("#000000").fontSize(22).text("录音问答记录", { width: pageWidth });
    doc.moveDown(0.3);
    addParagraph(`生成时间：${formatPdfDate(new Date())}`, { color: "#000000", size: 10 });
    if (publicMessage.recordingNames.length > 0) {
      addParagraph(`相关录音：${publicMessage.recordingNames.join("、")}`, { color: "#000000", size: 10 });
    }
    addParagraph(`提问时间：${formatPdfDate(publicMessage.createdAt)}`, { color: "#000000", size: 10 });

    addSectionTitle("问题");
    const questionX = doc.x;
    const questionY = doc.y;
    doc.save().roundedRect(questionX, questionY, pageWidth, 54, 12).fill("#f4f6fb").restore();
    setFont(true).fillColor("#000000").fontSize(13).text(publicMessage.question || "未命名问题", questionX + 12, questionY + 12, {
      width: pageWidth - 24,
      lineGap: 4,
    });
    doc.y = Math.max(doc.y, questionY + 62);

    addSectionTitle("回答");
    const blocks = answerBlocksForPdf(publicMessage.answer);
    if (blocks.length === 0) {
      addParagraph("暂无回答内容。");
    } else {
      blocks.forEach((block, index) => {
        setFont(true).fillColor("#000000").fontSize(12).text(`观点 ${index + 1}`, { width: pageWidth });
        doc.moveDown(0.2);
        addParagraph(block);
        const citation = Array.isArray(publicMessage.citations) ? publicMessage.citations[index] : null;
        if (citation) {
          const time = `${formatPdfTime(citation.startMs)}${citation.endMs ? `-${formatPdfTime(citation.endMs)}` : ""}`;
          addParagraph(`出处：${time}  ${citation.text || ""}`, { color: "#000000", size: 10, lineGap: 3 });
        }
        doc.moveDown(0.55);
      });
    }

    const citations = Array.isArray(publicMessage.citations) ? publicMessage.citations : [];
    if (citations.length > 0) {
      addSectionTitle("录音索引");
      citations.slice(0, 12).forEach((citation, index) => {
        const time = `${formatPdfTime(citation.startMs)}${citation.endMs ? `-${formatPdfTime(citation.endMs)}` : ""}`;
        addParagraph(`${index + 1}. ${time}  ${citation.recordingName || ""}`, { color: "#000000", size: 10 });
        if (citation.text) addParagraph(citation.text, { color: "#000000", size: 10, lineGap: 3 });
        doc.moveDown(0.35);
      });
    }

    doc.end();
  });
}

function renderDailyBriefPdf(brief) {
  return new Promise((resolve, reject) => {
    const publicBrief = publicDailyBrief(brief, dailyBriefPartsFromDateKey(brief?.date), []);
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      info: {
        Title: publicBrief.title || "今日会议简报",
        Author: "企业微信录音 H5",
        Subject: "今日会议简报",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regularFontPath = resolvePdfFontPath();
    const boldFontPath = resolvePdfBoldFontPath();
    const setFont = (bold = true) => {
      if (bold && boldFontPath) applyPdfFont(doc, boldFontPath);
      else if (regularFontPath) applyPdfFont(doc, regularFontPath);
      return doc;
    };
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const addParagraph = (text, options = {}) => {
      setFont(options.bold !== false)
        .fillColor(options.color || "#000000")
        .fontSize(options.size || 11)
        .text(String(text || ""), { width: pageWidth, lineGap: options.lineGap ?? 4 });
    };

    setFont(true).fillColor("#000000").fontSize(22).text(publicBrief.title || "今日会议简报", { width: pageWidth });
    doc.moveDown(0.25);
    addParagraph(`日期：${publicBrief.displayDate || publicBrief.date || ""}`, { color: "#000000", size: 10 });
    addParagraph(`会议数量：${publicBrief.meetingCount || 0}`, { color: "#000000", size: 10 });
    doc.moveDown(0.8);

    const lines = String(publicBrief.summaryMarkdown || "暂无简报内容。")
      .replace(/\r/g, "")
      .split("\n");
    lines.forEach((line) => {
      const text = cleanQaVisibleText(line, "").replace(/^#{1,6}\s*/, "").trim();
      if (!text) {
        doc.moveDown(0.35);
        return;
      }
      const heading = /^(今日会议简报|[一二三四五六七八九十]+、|\d+\.)/.test(text);
      addParagraph(text.replace(/^[-*]\s*/, "• "), {
        bold: heading,
        size: heading ? 13 : 11,
        lineGap: heading ? 5 : 4,
      });
      if (heading) doc.moveDown(0.15);
    });

    doc.end();
  });
}

function outlineGroupItems(outline = {}) {
  const groups = [
    ["会议提纲", outline.sections],
    ["主要内容", outline.mainPoints],
    ["关键点", outline.keyPoints],
    ["决议", outline.decisions],
    ["待办项", outline.actionItems],
    ["风险与问题", outline.risks],
  ];

  return groups
    .map(([title, items]) => ({
      title,
      items: Array.isArray(items) ? items.filter(Boolean) : [],
    }))
    .filter((group) => group.items.length > 0);
}

function renderMeetingOutlinePdf(recording, outline = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      info: {
        Title: `${recording?.name || "录音"} - 会议提纲`,
        Author: "企业微信录音 H5",
        Subject: "会议提纲分享",
      },
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regularFontPath = resolvePdfFontPath();
    const boldFontPath = resolvePdfBoldFontPath();
    const setFont = (bold = true) => {
      if (bold && boldFontPath) applyPdfFont(doc, boldFontPath);
      else if (regularFontPath) applyPdfFont(doc, regularFontPath);
      return doc;
    };
    setFont();

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const addParagraph = (text, options = {}) => {
      const value = String(text || "").trim();
      if (!value) return;
      setFont(options.bold !== false);
      doc.fillColor(options.color || "#000000").fontSize(options.size || 13).text(value, {
        width: pageWidth,
        lineGap: options.lineGap ?? 5,
        align: "left",
      });
      doc.moveDown(options.after ?? 0.35);
    };
    const addSectionTitle = (title) => {
      doc.moveDown(0.5);
      setFont(true).fillColor("#000000").fontSize(17).text(String(title || ""), { width: pageWidth });
      doc.moveDown(0.3);
    };
    const addBullet = (text) => addParagraph(`• ${text}`, { color: "#000000", size: 13, after: 0.25 });

    setFont(true).fillColor("#000000").fontSize(28).text("会议提纲", { width: pageWidth });
    doc.moveDown(0.3);
    addParagraph(`录音：${recording?.name || "未命名录音"}`, { color: "#000000", size: 12, after: 0.08 });
    addParagraph(`生成时间：${formatPdfDate(new Date())}`, { color: "#000000", size: 12, after: 0.08 });
    if (recording?.createdAt) addParagraph(`录音时间：${formatPdfDate(recording.createdAt)}`, { color: "#000000", size: 12, after: 0.4 });

    if (!outline) {
      addParagraph("暂无会议提纲内容。");
      doc.end();
      return;
    }

    if (outline.reportMarkdown) {
      String(outline.reportMarkdown)
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^#{1,2}\s*会议报告生成提纲/.test(line))
        .filter((line) => !/^>\s*如会议中包含更多议题/.test(line))
        .filter((line) => !/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?$/.test(line))
        .forEach((line) => {
          if (/^#{1,4}\s+/.test(line)) {
            addSectionTitle(line.replace(/^#{1,4}\s+/, ""));
            return;
          }
          if (/^[-*]\s+/.test(line)) {
            addBullet(line.replace(/^[-*]\s+/, ""));
            return;
          }
          addParagraph(line.replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, "  "));
        });
    } else {
      addSectionTitle(outline.title || "会议概览");
      addParagraph(outline.summary || "AI 已完成会议内容整理。");
      for (const group of outlineGroupItems(outline)) {
        addSectionTitle(group.title);
        group.items.forEach((item, index) => {
          const title = item.title || `${group.title} ${index + 1}`;
          const summary = item.summary || item.evidence || "";
          const suffix = [item.owner ? `负责人：${item.owner}` : "", item.due ? `截止：${item.due}` : ""]
            .filter(Boolean)
            .join("  ");
          addBullet(`${title}${summary ? `：${summary}` : ""}${suffix ? `（${suffix}）` : ""}`);
        });
      }
    }

    doc.end();
  });
}

function outlineKeywordText(outline) {
  if (!outline) return "";
  const raw = Array.isArray(outline.keywords) ? outline.keywords.join(" / ") : String(outline.keywords || "");
  return compactCardTagText(raw);
}

function compactCardText(value = "", maxLength = 18) {
  const cleaned = String(value || "")
    .replace(/[`*_>#"“”‘’]/g, "")
    .replace(/^\s*(会议主题|主题|标题|录音名称|会议名称)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? chars.slice(0, maxLength).join("") : cleaned;
}

function compactCardTagText(value = "") {
  const parts = String(value || "")
    .replace(/[，、,;；|]+/g, " / ")
    .replace(/\s*\/\s*/g, " / ")
    .split("/")
    .map((item) => compactCardText(item.trim(), 8))
    .filter(Boolean)
    .filter((item) => !/^(腾讯会议|腾讯转写|会议录音|录音|转写|已同步|待授权|等待同步)$/i.test(item));
  return [...new Set(parts)].slice(0, 2).join(" / ");
}

function isDefaultRecordingName(name = "") {
  const value = String(name || "").trim();
  return (
    !value ||
    /^录音\s*\d{1,4}$/i.test(value) ||
    /^新录音$/i.test(value) ||
    /^中断自动保存\b/.test(value) ||
    /^腾讯会议录音\s+\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(value) ||
    /^腾讯会议云录制\s+\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(value) ||
    /^\d{8}录音文件$/.test(value) ||
    /^.+的快速会议$/.test(value)
  );
}

function outlineTitleText(outline, recording) {
  const raw = outline?.title || outline?.meetingTitle || outline?.subject || "";
  const title = compactCardText(raw, 18);
  if (!title || /^(会议纪要|会议提纲|录音转写|未明确|快速会议|腾讯会议录音)$/i.test(title)) return "";
  if (title === compactCardText(recording?.ownerName || "", 18)) return "";
  return title;
}

async function setMeetingOutlineState(recordingId, patch, jobVersion) {
  if (isRecordingJobCancelled(recordingId, jobVersion)) return;
  await prisma.recording.updateMany({
    where: { id: recordingId, deletedAt: null },
    data: { ...patch, updatedAt: new Date() },
  });
}

// 用于根据录音转写内容生成并保存会议大纲/会议提纲
async function generateAndStoreMeetingOutline(recordingId, segments = [], options = {}) {
  const id = String(recordingId || "").trim();
  if (!id || isRecordingJobCancelled(id)) return null;
  const activeJob = meetingOutlineJobs.get(id);
  if (activeJob) return activeJob;

  const jobVersion = recordingJobVersion(id);
  const job = runMeetingOutlineJob(id, segments, options, jobVersion);
  meetingOutlineJobs.set(id, job);
  try {
    return await job;
  } finally {
    if (meetingOutlineJobs.get(id) === job) meetingOutlineJobs.delete(id);
  }
}

async function runMeetingOutlineJob(recordingId, segments = [], options = {}, jobVersion = recordingJobVersion(recordingId)) {
  if (isRecordingJobCancelled(recordingId, jobVersion)) return null;
  const row = await prisma.recording.findFirst({
    where: { id: recordingId, deletedAt: null },
    include: { segments: { orderBy: { startMs: "asc" } } },
  });
  const recording = row ? recordingFromPrisma(row) : null;
  if (!recording) return null;

  const transcriptSegments = segments.length ? segments : row.segments.map(transcriptSegmentFromPrisma);
  const expandedSegments = expandTranscriptSegments(transcriptSegments, recording.durationMs || 0);
  if (!expandedSegments.length) {
    await setMeetingOutlineState(recordingId, {
      meetingOutlineStatus: "failed",
      meetingOutlineError: "当前还没有可用于生成会议提纲的转写内容。",
      meetingOutlineStartedAt: null,
    }, jobVersion);
    return null;
  }

  await setMeetingOutlineState(recordingId, {
    meetingOutlineStatus: "generating",
    meetingOutlineError: "",
    meetingOutlineStartedAt: new Date(),
  }, jobVersion);

  try {
    const outline = await generateMeetingOutline(recording, expandedSegments);
    if (isRecordingJobCancelled(recordingId, jobVersion)) return null;
    const outlineKeywords = outlineKeywordText(outline);
    const outlineTitle = outlineTitleText(outline, recording);
    const generatedAt = new Date(outline?.generatedAt || Date.now());
    const outlineStatus = outline ? "ready" : "failed";
    const data = {
      meetingOutlineJson: outline ? JSON.stringify(outline) : null,
      meetingOutlineStatus: outlineStatus,
      meetingOutlineError: outlineStatus === "failed" ? "Meeting outline generation failed." : "",
      meetingOutlineStartedAt: null,
      meetingOutlinedAt: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt,
      updatedAt: new Date(),
    };
    if (options.updateTag !== false && outlineKeywords) data.tag = outlineKeywords;
    if (options.updateName !== false && outlineTitle && isDefaultRecordingName(recording.name)) {
      data.name = outlineTitle;
    }
    await prisma.recording.updateMany({
      where: { id: recordingId, deletedAt: null },
      data,
    });
    return outline;
  } catch (error) {
    if (isRecordingJobCancelled(recordingId, jobVersion)) return null;
    console.warn("[Meeting outline] store failed:", error instanceof Error ? error.message : error);
    await setMeetingOutlineState(recordingId, {
      meetingOutlineStatus: "failed",
      meetingOutlineError: userSafeErrorMessage(error, "会议提纲暂未稳定生成，请稍后重新生成。"),
      meetingOutlineStartedAt: null,
    }, jobVersion);
    return null;
  }
}

async function runTranscriptionJob(recordingId, jobVersion = recordingJobVersion(recordingId)) {
  logger.info("[call] transcription.job step 0", {message: ""});
  if (isRecordingJobCancelled(recordingId, jobVersion)) {
    logger.info("[call] transcription.job step 1", {message: ""});
    return
  }
  const recordingRow = await prisma.recording.findFirst({
    where: {
      id: recordingId,
      deletedAt: null,
    },
  })
  logger.info("[call] transcription.job step 2", {message: ""});
  const recording = recordingRow ? recordingFromPrisma(recordingRow) : null;
  logger.info("[call] transcription.job step 3", {message: `recordingId: ${recordingId}, source: ${recording?.source || "unknown"}`});
  if (!recording) {
    logger.info("[call] transcription.job step 4", {message: "不存在recording,中断任务"});
    return
  }
  if (!isLocalApiTranscriptionRecording(recording)) {
    logger.info("[call] transcription.job step 5", {message: ""});
    if (isTencentMeetingRecording(recording)) {
      logger.info("[call] transcription.job step 6", {message: ""});
      logger.info("[Transcription] Tencent Meeting transcript waits for smart.transcripts", { message: recording.id });
    } else {
      logger.info("[call] transcription.job step 7", {message: ""});
      console.warn("[Transcription] skipped API job for unsupported source:", recording.source || "unknown");
    }
    return;
  }
  if (!isRecordingApiTranscriptionEnabled()) {
    logger.info("[call] transcription.job step 8", {message: ""});
    return;
  }

  try {
    logger.info("[call] transcription.job step 9", {message: ""});
    const segments = await transcribeRecording({
      ...recording,
      asrAudioUrl: createAsrAudioUrl(recording),
    });
    logger.info("[call] transcription.job step 10", {message: ""});
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      logger.info("[call] transcription.job step 11", {message: ""});
      return;
    }
    const translation = await translateTranscriptToChinese(recording, segments);
    logger.info("[call] transcription.job step 12", {message: ""});
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      logger.info("[call] transcription.job step 13", {message: ""});
      return;
    }
    const autoTag = "";
    const { transcriptPath, transcriptRawPath, transcriptCorrectedPath, transcriptionMetaPath } = await transcriptStoragePaths(recordingId, recording);
    await writeTranscriptTextFile(recording, segments, transcriptPath);
    logger.info("[call] transcription.job step 14", {message: ""});
    if (segments.rawText) await writeFile(transcriptRawPath, `${segments.rawText.trim()}\n`, "utf8");
    if (segments.correctedText) await writeFile(transcriptCorrectedPath, `${segments.correctedText.trim()}\n`, "utf8");
    if (segments.transcriptionMeta) {
      await writeFile(transcriptionMetaPath, `${JSON.stringify(segments.transcriptionMeta, null, 2)}\n`, "utf8");
    }
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      await Promise.all([
        transcriptPath,
        transcriptRawPath,
        transcriptCorrectedPath,
        transcriptionMetaPath,
      ].map((filePath) => removeFileIfExists(filePath)));
      return;
    }

    const newRecording = {
      status: "ready",
      transcribedAt: new Date(),
      transcriptProvider: getTranscriptionMode(),
      transcriptSource: isFallbackTranscript(segments) ? "local-fallback" : getTranscriptionMode(),
      transcriptionStartedAt: null,
      transcriptPath: transcriptPath,
      transcriptRawPath: segments.rawText ? transcriptRawPath : "",
      transcriptCorrectedPath: segments.correctedText ? transcriptCorrectedPath : "",
      transcriptionMetaPath: segments.transcriptionMeta ? transcriptionMetaPath : "",
      detectedLanguage: translation.detectedLanguage || "",
      translationText: translation.translationText || "",
      meetingOutlineStatus: "generating",
      meetingOutlineError: "",
      meetingOutlineJson: null,
      meetingOutlineStartedAt: new Date(),
      meetingOutlinedAt: null,
      // if (!target.tag && autoTag) target.tag = autoTag;
    }
    if (autoTag) {
      newRecording.tag = autoTag
    }
    await prisma.$transaction(async (tx) => {
      await tx.transcriptSegment.deleteMany({ where: { recordingId } });
      if (segments.length) {
        await tx.transcriptSegment.createMany({
          data: segments.map((segment) => ({
            id: String(segment.id || crypto.randomUUID()),
            recordingId,
            startMs: BigInt(Math.max(0, Math.round(Number(segment.startMs || 0)))),
            endMs: BigInt(Math.max(0, Math.round(Number(segment.endMs || 0)))),
            text: segment.text || "",
            confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
            speakerLabel: segment.speakerKey || segment.speakerLabel || "speaker-1",
            createdAt: new Date(),
          })),
        });
      }
      const updated = await tx.recording.updateMany({
        where: { id: recordingId, deletedAt: null },
        data: newRecording,
      });
      if (!updated.count) throw new Error("Recording was deleted while transcription was running.");
    });
    if (isRecordingJobCancelled(recordingId, jobVersion)) return;
    await generateAndStoreMeetingOutline(recordingId, segments, { updateTag: true });
    await markDailyBriefDirtyForRecording(recordingId);
    logger.info("transcription.job.success", {message: `recordingId: ${recordingId}, segmentCount: ${segments.length}, transcriptSource: ${recording?.source || "unknown"}`, recordingId, segmentCount: segments.length, transcriptSource: recording?.source || "unknown"});
  } catch (error) {
    logger.error("transcription.job.failed step 0", {message: `recordingId: ${recordingId}, error: ${error instanceof Error ? error.message : error}`});
    if (isRecordingJobCancelled(recordingId, jobVersion)) {
      logger.error("transcription.job.failed step 1", {message: `recordingId: ${recordingId}, error: ${error instanceof Error ? error.message : error}`});
      return;
    }
    const existingSegmentCount = await prisma.transcriptSegment.count({ where: { recordingId } });
    logger.error("transcription.job.failed step 2", {message: `recordingId: ${recordingId}, error: ${error instanceof Error ? error.message : error}`});

    await prisma.recording.updateMany({
      where: { id: recordingId, deletedAt: null },
      data: {
        status: existingSegmentCount > 0 ? "ready" : "failed",
        errorMessage: userSafeTranscriptionError(error),
        transcriptionStartedAt: null,
      },
    });
    logger.error("transcription.job.failed step 3", {message: `recordingId: ${recordingId}, error: ${error instanceof Error ? error.message : error}`});
  }
}

async function queueTranscriptionJob(recordingId, recordingForSource = null) {
  logger.debug(`call queueTranscriptionJob step 0: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
  const id = String(recordingId || "").trim();
  if (!id || isRecordingJobCancelled(id)) {
    logger.debug(`call queueTranscriptionJob step 1: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
    return false;
  }

  // 如果传入了 recordingForSource ，但该录音的来源 不支持本地 API 转写 ，则直接返回 false ， 不加入转写队列
  if (recordingForSource && !isLocalApiTranscriptionRecording(recordingForSource)) {
    logger.debug(`call queueTranscriptionJob step 2: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
    return false;
  }
  if (!isRecordingApiTranscriptionEnabled()) {
    logger.debug(`call queueTranscriptionJob step 3: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
    return false;
  }
  if (transcriptionJobs.has(id)) {
    logger.debug(`call queueTranscriptionJob step 4: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
    return false;
  }
  const jobVersion = recordingJobVersion(id);

  transcriptionJobs.add(id);
  let claimed;
  try {
    claimed = await prisma.recording.updateMany({
      where: { id, deletedAt: null },
      data: {
        status: "transcribing",
        transcriptionStartedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: "",
        transcriptProvider: getTranscriptionMode(),
      },
    });
  } catch (error) {
    transcriptionJobs.delete(id);
    throw error;
  }
  if (!claimed.count) {
    transcriptionJobs.delete(id);
    logger.debug(`call queueTranscriptionJob step 5: recordingId: ${recordingId}, recordingForSource: ${recordingForSource}`)
    return false;
  }

  transcriptionJobChain = transcriptionJobChain
    .catch(() => {})
    .then(() => runTranscriptionJob(id, jobVersion))
    .catch((error) => {
      logger.warn("[Transcription] call queueTranscriptionJob failed:", {message: error instanceof Error ? error.message : error});
    })
    .finally(() => {
      if (recordingJobVersion(id) === jobVersion) transcriptionJobs.delete(id);
    });
  logger.info("[Transcription] call queueTranscriptionJob success:");

  return true;
}

async function queuePendingLocalTranscriptionJobs(reason = "sweep") {
  if (!isRecordingApiTranscriptionEnabled()) return 0;
  const rows = await prisma.recording.findMany({
    where: {
      deletedAt: null,
      source: { in: ["wecom-h5", "wecom-h5-long-session", "wecom-h5-resumed"] },
      status: { in: ["uploaded", "uploading", "queued", "pending", "processing", "transcribing"] },
    },
    orderBy: { updatedAt: "asc" },
  });
  const candidates = rows
    .map(recordingFromPrisma)
    .filter((recording) => !transcriptionJobs.has(recording.id) && Boolean(resolveRecordingAudioPath(recording, projectRoot)))
    .slice(0, LOCAL_TRANSCRIPTION_SWEEP_LIMIT);

  let queued = 0;
  for (const recording of candidates) {
    if (await queueTranscriptionJob(recording.id, recording)) queued += 1;
  }
  if (queued) logger.info("transcription.recovered", {message: `reason: ${reason}, queued: ${queued}`, reason, queued});
  return queued;
}

async function queuePendingMeetingOutlineJobs(reason = "sweep", options = {}) {
  const staleBefore = new Date(Date.now() - MEETING_OUTLINE_STALE_MS);
  const rows = await prisma.recording.findMany({
    where: {
      deletedAt: null,
      meetingOutlineStatus: "generating",
      meetingOutlineJson: null,
      segments: { some: {} },
      ...(options.force
        ? {}
        : { OR: [{ meetingOutlineStartedAt: null }, { meetingOutlineStartedAt: { lte: staleBefore } }] }),
    },
    orderBy: { meetingOutlineStartedAt: "asc" },
    take: MEETING_OUTLINE_SWEEP_LIMIT,
    select: { id: true },
  });
  const jobs = rows
    .filter(({ id }) => !meetingOutlineJobs.has(id))
    .map(({ id }) => generateAndStoreMeetingOutline(id, [], { updateTag: true }));
  if (jobs.length) logger.info("meeting-outline.recovered", { message: `reason: ${reason}, queued: ${jobs.length}`, reason, queued: jobs.length });
  await Promise.allSettled(jobs);
  return jobs.length;
}

function schedulePendingLocalTranscriptionSweep(reason = "sweep", options = {}) {
  const nowMs = Date.now();
  if (!options.force && nowMs - pendingLocalTranscriptionSweepAt < LOCAL_TRANSCRIPTION_SWEEP_INTERVAL_MS) return;
  pendingLocalTranscriptionSweepAt = nowMs;
  queuePendingLocalTranscriptionJobs(reason).catch((error) => {
    console.warn("[Transcription] pending local upload sweep failed:", error instanceof Error ? error.message : error);
  });
}
/**
 *  1. 转写文件迁移
    遍历所有录音记录
    检查是否有转写文本段（segments）但 转写文件不存在或路径为空
    如果检测到这种情况，重新生成并保存转写 TXT 文件
    更新录音记录的 transcriptPath 指向新的转写文件位置
    2. 音频格式标准化
    检查录音文件是否为 MP3 格式（mimeType !== "audio/mpeg" 且后缀不是 .mp3）
    如果不是，自动转换原音频文件为 MP3 格式
    将新的 MP3 路径、文件名、大小等信息更新到录音记录
 * @returns 
 */
async function migrateExistingArtifacts() {
  const db = await loadDb();
  const updates = [];

  for (const recording of db.recordings) {
    const segments = findSegments(db, recording.id);
    const patch = {};

    if (segments.length > 0 && (!recording.transcriptPath || !existsSync(recording.transcriptPath))) {
      const { transcriptPath } = await transcriptStoragePaths(recording.id, recording);
      await writeTranscriptTextFile(recording, segments, transcriptPath);
      patch.transcriptPath = transcriptPath;
    }

    const currentExt = path.extname(recording.storagePath || recording.fileName || "").toLowerCase();
    const needsMp3 = recording.storagePath && existsSync(recording.storagePath) && recording.mimeType !== "audio/mpeg" && currentExt !== ".mp3";

    if (needsMp3) {
      const targetPath = path.join(audioDir, `${recording.id}.mp3`);
      if (!existsSync(targetPath)) {
        await convertAudioFileToMp3(recording.storagePath, targetPath);
      }
      const storedFile = await fileInfo(targetPath);
      patch.storagePath = targetPath;
      patch.fileName = `${recording.id}.mp3`;
      patch.mimeType = "audio/mpeg";
      patch.size = storedFile.size;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: recording.id, patch });
    }
  }

  if (updates.length === 0) return;

  await updateDb((nextDb) => {
    for (const update of updates) {
      const recording = findRecording(nextDb, update.id);
      if (!recording) continue;
      Object.assign(recording, update.patch, { updatedAt: new Date().toISOString() });
    }
  });
}

app.get("/", (req, res) => {
  res.send('ok')
})

// const publicDir = path.resolve(import.meta.dirname, "../public");
// if (existsSync(publicDir)) {
//   app.use(express.static(publicDir));
// }

// if (existsSync(distDir)) {
//   app.use(express.static(distDir));
//   app.use((request, response, next) => {
//     if (request.path.startsWith("/api")) {
//       next();
//       return;
//     }
//     response.sendFile(path.join(distDir, "index.html"));
//   });
// }

// const storagePath = path.resolve(__dirname, 'storage')
// logger.info("storage path: ", {message: storagePath})
// app.use("/static", express.static(storagePath));

app.use((error, request, response, _next) => {
  logger.error("server.unhandled_error", {message: `method: ${request?.method}, path: ${request?.path}, originalUrl: ${request?.originalUrl}, error: ${error.message}`});
  if (response.headersSent) return;
  const isPayloadTooLarge =
    error?.type === "entity.too.large" ||
    error?.status === 413 ||
    /request entity too large|payload too large|entity.too.large/i.test(String(error?.message || ""));
  const status = isPayloadTooLarge ? 413 : Number(error?.status || error?.statusCode || 500);
  response.status(status >= 400 && status < 600 ? status : 500).json({
    error: isPayloadTooLarge ? "上传内容过大，请压缩后重新上传。" : userSafeErrorMessage(error, "服务器正在处理数据，请稍后重试。"),
  });
});

app.listen(port, host, () => {
  logger.info("server.started", {host, port, httpsPort, nodeEnv: process.env.NODE_ENV || "development"});
  console.log(`Recorder API listening on http://${host}:${port}`);
});

// if (httpsPort > 0 && process.env.HTTPS_KEY_PATH && process.env.HTTPS_CERT_PATH) {
//   try {
//     const [key, cert] = await Promise.all([readFile(process.env.HTTPS_KEY_PATH), readFile(process.env.HTTPS_CERT_PATH)]);
//     https.createServer({ key, cert }, app).listen(httpsPort, host, () => {
//       console.log(`Recorder HTTPS listening on https://${host}:${httpsPort}`);
//     });
//   } catch (error) {
//     console.error("HTTPS server failed to start", error);
//   }
// }

scheduleDailyBriefGeneration();
startTencentMeetingStsTokenCron();

replayMissingTencentMeetingRecordingWebhooks()
  .then(async (replayed) => {
    if (replayed > 0) console.info(`[Tencent Meeting] replayed missing recorder webhooks: ${replayed}`);
    const updated = await backfillTencentMeetingRecorderOwnersFromWebhookHistory();
    if (updated > 0) console.info(`[Tencent Meeting] backfilled recorder owner names: ${updated}`);
  })
  .catch((error) => {
    console.warn("[Tencent Meeting] recorder webhook recovery failed:", error instanceof Error ? error.message : error);
  });

// 暂时停用存量转写文件处理
// migrateExistingArtifacts().catch((error) => {
//   console.error("Artifact migration failed", error);
// });

// Do not scan every historical pending Tencent Meeting import on startup.
// New imports are synchronized by their webhook events, and a fresh STS-token
// webhook explicitly retries pending imports when recovery is actually useful.
// setTimeout(() => {
//   queueTencentMeetingPendingImports().catch((error) => {
//     console.error("Tencent Meeting pending import scan failed", error);
//   });
// }, 5000).unref?.();

// queueTencentMeetingCloudDiscovery();
setTimeout(() => {
  schedulePendingLocalTranscriptionSweep("startup", { force: true });
  queuePendingMeetingOutlineJobs("startup", { force: true }).catch((error) => {
    console.warn("[Meeting outline] startup recovery failed:", error instanceof Error ? error.message : error);
  });
}, 2000).unref?.();

setInterval(() => {
  schedulePendingLocalTranscriptionSweep("interval");
}, LOCAL_TRANSCRIPTION_SWEEP_INTERVAL_MS).unref?.();

setInterval(() => {
  queuePendingMeetingOutlineJobs("interval").catch((error) => {
    console.warn("[Meeting outline] pending job sweep failed:", error instanceof Error ? error.message : error);
  });
}, MEETING_OUTLINE_SWEEP_INTERVAL_MS).unref?.();

// Periodic full-table retries generate a Tencent API request burst even when no
// relevant event has occurred. Keep recovery event-driven instead.
// const tencentMeetingPendingImportIntervalMs = Number(process.env.TENCENT_MEETING_PENDING_IMPORT_INTERVAL_MS || 5 * 60 * 1000);
// if (tencentMeetingPendingImportIntervalMs > 0) {
//   setInterval(() => {
//     queueTencentMeetingPendingImports().catch((error) => {
//       console.warn("Tencent Meeting pending import scan failed:", error instanceof Error ? error.message : error);
//     });
//   }, Math.max(60 * 1000, tencentMeetingPendingImportIntervalMs)).unref();
// }

// const tencentMeetingCloudDiscoveryIntervalMs = Number(process.env.TENCENT_MEETING_CLOUD_DISCOVERY_INTERVAL_MS || 10 * 60 * 1000);
// if (tencentMeetingCloudDiscoveryIntervalMs > 0) {
//   setInterval(() => {
//     queueTencentMeetingCloudDiscovery();
//   }, Math.max(2 * 60 * 1000, tencentMeetingCloudDiscoveryIntervalMs)).unref();
// }
