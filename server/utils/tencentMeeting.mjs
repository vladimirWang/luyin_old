import crypto from "node:crypto";
import logger from "./log.js";
import { normalizeTencentMeetingEncryptedData, tencentMeetingDecryptData } from "./tencentMeetingCrypto.mjs";
import { firstEnv, parseJsonObject, splitEnvList, firstNonEmptyValue, asArray, boundedNumber } from "./common.mjs";
import { decodedTencentMeetingAesKeyLength } from "./algo.js";
import { resolveRecordingAudioPath } from "./recordings.js";
import { projectRoot } from "../config.js";
import {TENCENT_MEETING_SOURCE_PREFIX} from '../constant.js'
import { getTMToken, requestTMToken, setTMToken } from "./token.js";

export async function requestTencentMeetingStsTokenIfNeeded() {
  return requestTMToken();
}

export async function loadTencentMeetingStsToken() {
  const token = await getTMToken({ minimumValidityMs: 3 * 60 * 1000 });
  return token?.value || "";
}

export async function saveTencentMeetingStsToken(tokenInfo = {}) {
  await setTMToken(tokenInfo);
  return true;
}

export function tencentMeetingApiConfig() {
  const secretId = firstEnv("TENCENT_MEETING_SECRET_ID", "WEMEET_SECRET_ID");
  const secretKey = firstEnv("TENCENT_MEETING_SECRET_KEY", "WEMEET_SECRET_KEY");
  const appId = firstEnv("TENCENT_MEETING_ENTERPRISE_ID", "WEMEET_ENTERPRISE_ID", "TENCENT_MEETING_APP_ID", "WEMEET_APP_ID");
  const sdkId = firstEnv("TENCENT_MEETING_SDK_ID", "TENCENT_MEETING_APPLICATION_ID", "WEMEET_SDK_ID", "WEMEET_APPLICATION_ID");
  return {
    baseUrl: "https://api.meeting.qq.com",
    secretId,
    secretKey,
    appId,
    sdkId,
  };
}

export async function tencentMeetingApiHeaders(method, uri, bodyText = "", options = {}) {
  const config = tencentMeetingApiConfig();
  if (!config.secretId || !config.secretKey || !config.appId) {
    throw new Error("Tencent Meeting API is not configured.");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = String(crypto.randomInt(100000, 2147483647));
  const headerString = `X-TC-Key=${config.secretId}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`;
  const stringToSign = [String(method || "GET").toUpperCase(), headerString, uri, bodyText].join("\n");
  const hexDigest = crypto.createHmac("sha256", config.secretKey).update(stringToSign).digest("hex");
  const signature = Buffer.from(hexDigest, "utf8").toString("base64");
  const headers = {
    "Content-Type": "application/json",
    "X-TC-Key": config.secretId,
    "X-TC-Timestamp": timestamp,
    "X-TC-Nonce": nonce,
    "X-TC-Signature": signature,
    "X-TC-Registered": "1",
    AppId: config.appId,
  };
  const sendSdkId = firstEnv("TENCENT_MEETING_SEND_SDK_ID", "WEMEET_SEND_SDK_ID");
  if (config.sdkId && sendSdkId !== "false") headers.SdkId = config.sdkId;
  if (!options.skipStsToken) {
    const stsToken = await loadTencentMeetingStsToken();
    if (stsToken) headers["STS-Token"] = stsToken;
  }
  return headers;
}

export async function tencentMeetingApiRequest(method, uri, body = null, options = {}) {
  const config = tencentMeetingApiConfig();
  const bodyText = body ? JSON.stringify(body) : "";
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${uri}`, {
    method,
    headers: await tencentMeetingApiHeaders(method, uri, bodyText, options),
    body: bodyText || undefined,
    signal: AbortSignal.timeout(Math.max(5000, Number(process.env.TENCENT_MEETING_API_TIMEOUT_MS || 30000))),
  });
  const text = await response.text();
  const payload = parseJsonObject(text) || { raw: text };
  const apiError = payload?.error_info || payload?.errorInfo || payload?.error;
  const apiErrorCode = apiError?.new_error_code || apiError?.error_code || apiError?.code || payload?.code;
  if (!response.ok || apiErrorCode) {
    const message = apiError?.message || apiError?.msg || payload?.message || text || response.statusText;
    throw new Error(`Tencent Meeting API ${method} ${uri} failed: ${response.status} ${apiErrorCode || ""} ${String(message).slice(0, 160)}`.trim());
  }
  return payload;
}

export function expandTencentMeetingKeyCandidates(keys) {
  const output = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key) || decodedTencentMeetingAesKeyLength(key) !== 32) return;
    seen.add(key);
    output.push(key);
  };

  for (const original of keys) {
    const key = String(original || "").trim();
    add(key);
    let variants = [""];
    for (const char of key) {
      const alternatives = ["I", "l", "L"].includes(char) ? ["I", "l", "L"] : [char];
      const next = [];
      for (const variant of variants) {
        for (const alternative of alternatives) {
          next.push(`${variant}${alternative}`);
        }
      }
      variants = [...new Set(next)].slice(0, 512);
    }
    variants.forEach(add);
  }

  return output.slice(0, 512);
}

export function findTencentMeetingContainerDuplicate(db, info = {}) {
  const meetingRecordId = String(info.meetingRecordId || info.meeting_record_id || "").trim();
  const recordFileId = String(info.recordFileId || info.record_file_id || "").trim();
  if (!meetingRecordId || !recordFileId || meetingRecordId === recordFileId) return null;

  return (db.recordings || []).find((recording) => {
    if (recording.source !== `tencent-meeting:${meetingRecordId}`) return false;
    if (recording.deletedAt) return false;
    if (recording.tencentMeetingMeetingId && info.meetingId && recording.tencentMeetingMeetingId !== info.meetingId) return false;
    if (recording.tencentMeetingMeetingCode && info.meetingCode && recording.tencentMeetingMeetingCode !== info.meetingCode) return false;

    const hasSegments = (db.transcriptSegments || []).some((segment) => segment.recordingId === recording.id);
    return !hasSegments && !resolveRecordingAudioPath(recording, projectRoot);
  });
}

// 说明：对外部输入或模型输出做规整与安全清理。
function safeEqualText(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

// 说明：处理腾讯会议集成中的 tencentMeetingSignature 逻辑。
function tencentMeetingSignature(token, timestamp, nonce, data) {
  return [token, timestamp, nonce, data]
    .map((value) => String(value || ""))
    .sort()
    .join("");
}

// 说明：处理腾讯会议集成中的 tencentMeetingCallbackSignature 逻辑。
function tencentMeetingCallbackSignature(token, timestamp, nonce, data) {
  return crypto.createHash("sha1").update(tencentMeetingSignature(token, timestamp, nonce, data)).digest("hex");
}

// 说明：校验腾讯会议 webhook 签名并解密密文，只接受可信回调。
export function tencentMeetingVerifiedPlaintext(request, encryptedData) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext encryptedData ", {message: encryptedData})
  const config = tencentMeetingWebhookConfig();
  if (!config.tokens.length || !config.encodingAesKeys.length) {
    const error = new Error("Tencent Meeting webhook is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const timestamp = String(request.get("timestamp") || request.get("Timestamp") || "").trim();
  const nonce = String(request.get("nonce") || request.get("Nonce") || "").trim();
  const signature = String(request.get("signature") || request.get("Signature") || "").trim();
  const data = normalizeTencentMeetingEncryptedData(encryptedData);
  if (!timestamp || !nonce || !signature || !data) {
    logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "timestamp || nonce || signature || data 其中之一不存在"})
    const error = new Error("Tencent Meeting callback is missing signature headers or data.");
    error.statusCode = 400;
    throw error;
  }

  const verified = config.tokens.some((token) => {
    const expected = tencentMeetingCallbackSignature(token, timestamp, nonce, data);
    return safeEqualText(signature, expected);
  });
  if (!verified) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "webhook签名验证未通过， signature和本地token算出的签名未对上"})
    const error = new Error("Tencent Meeting callback signature verification failed.");
    error.statusCode = 401;
    throw error;
  }

  const decryptErrors = [];
  for (const encodingAesKey of config.encodingAesKeys) {
    try {
      return tencentMeetingDecryptData(data, encodingAesKey);
    } catch (error) {
  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: error.message})
      decryptErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  logger.info("[CALL] tencentMeetingVerifiedPlaintext ", {message: "AES 解密失败"})
  const error = new Error(`Tencent Meeting callback AES decrypt failed for ${config.encodingAesKeys.length} candidate key(s).`);
  error.statusCode = 400;
  error.cause = decryptErrors[0] || "";
  throw error;
}

// 说明：处理账号、客户端身份或资料相关逻辑。
export function isTencentMeetingStsTokenFresh(token) {
  const isFresh = Boolean(token?.value && token.expiresAt && token.expiresAt > Date.now() + 1000 * 60 * 3);
  // Token freshness is checked before every Tencent Meeting API request. Avoid
  // logging here because a pending-import sweep can call it many times and the
  // serialized token fragment may expose credentials in server logs.
  // logger.info("[CALL] isTencentMeetingStsTokenFresh", { message: `isFresh: ${isFresh}` });
  return isFresh
}

// 说明：处理腾讯会议集成中的 tencentMeetingWebhookConfig 逻辑。
export function tencentMeetingWebhookConfig() {
  const tokens = [
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_TOKEN),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_TOKEN),
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_TOKENS),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_TOKENS),
  ].filter((token, index, list) => list.indexOf(token) === index);
  const encodingAesKeys = expandTencentMeetingKeyCandidates([
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEY),
    ...splitEnvList(process.env.WEMEET_ENCODING_AES_KEY),
    ...splitEnvList(process.env.TENCENT_MEETING_WEBHOOK_ENCODING_AES_KEYS),
    ...splitEnvList(process.env.WEMEET_WEBHOOK_ENCODING_AES_KEYS),
  ]);

  return {
    token: tokens[0] || "",
    tokens,
    encodingAesKey: encodingAesKeys[0] || "",
    encodingAesKeys,
  };
}

export function tencentMeetingEventTimeMs(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return Date.now();
  return number > 10_000_000_000 ? number : number * 1000;
}

export function tencentMeetingTimestampMs(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 10_000_000_000 ? number : number * 1000;
}

export function tencentMeetingDurationValueMs(value, unit = "") {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (/ms|millisecond/i.test(unit) || number > 1000 * 60 * 60 * 24) return Math.round(number);
  return Math.round(number * 1000);
}

export function tencentMeetingDurationMsFromFile(file = {}, meetingInfo = {}, container = {}) {
  const durationMs = firstNonEmptyValue([
    file.duration_ms,
    file.durationMs,
    file.record_duration_ms,
    file.recordDurationMs,
    file.record_file_duration_ms,
    file.file_duration_ms,
    file.audio_duration_ms,
    container.duration_ms,
    container.durationMs,
  ]);
  const parsedDurationMs = tencentMeetingDurationValueMs(durationMs, "ms");
  if (parsedDurationMs > 0) return parsedDurationMs;

  const durationSeconds = firstNonEmptyValue([
    file.duration,
    file.record_duration,
    file.recordDuration,
    file.record_file_duration,
    file.file_duration,
    file.audio_duration,
    meetingInfo.duration,
    container.duration,
  ]);
  const parsedDurationSeconds = tencentMeetingDurationValueMs(durationSeconds, "seconds");
  if (parsedDurationSeconds > 0) return parsedDurationSeconds;

  const startMs = tencentMeetingTimestampMs(
    firstNonEmptyValue([
      file.start_time,
      file.startTime,
      file.record_start_time,
      file.recordStartTime,
      meetingInfo.start_time,
      meetingInfo.startTime,
    ]),
  );
  const endMs = tencentMeetingTimestampMs(
    firstNonEmptyValue([
      file.end_time,
      file.endTime,
      file.record_end_time,
      file.recordEndTime,
      meetingInfo.end_time,
      meetingInfo.endTime,
    ]),
  );
  if (startMs > 0 && endMs > startMs) return endMs - startMs;

  return 0;
}

export function tencentMeetingDisplayTime(value) {
  const date = new Date(tencentMeetingEventTimeMs(value));
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function tencentMeetingPlaceholderName(info) {
  const title = String(info?.subject || info?.name || "").trim();
  if (title) return title.slice(0, 80);
  return `${info?.sourceKind === "cloud" ? "腾讯会议云录制" : "腾讯会议录音"} ${tencentMeetingDisplayTime(info?.operateTime)}`;
}

export function tencentMeetingPlaceholderTag(status = "等待同步") {
  return `腾讯会议录音笔 / ${compactTencentMeetingStatus(status)}`;
}

export function tencentMeetingImportTag(info = {}, status = "等待同步") {
  const kind = info.sourceKind === "cloud" ? "云录制" : "录音笔";
  return `腾讯会议${kind} / ${compactTencentMeetingStatus(status)}`;
}

function compactTencentMeetingStatus(status = "") {
  return String(status || "等待同步")
    .replace(/等待腾讯会议文字/g, "等待腾讯文字")
    .replace(/等待腾讯转写/g, "等待转写")
    .replace(/已同步转写/g, "已同步")
    .replace(/已同步音频/g, "已同步")
    .replace(/等待下载权限/g, "待同步")
    .replace(/腾讯会议无文字|腾讯无可用文字/g, "腾讯无文字")
    .trim();
}

export function tencentMeetingRecordFileId(file = {}) {
  return String(
    firstNonEmptyValue([
      file.record_file_id,
      file.recordFileId,
      file.record_id,
      file.recordId,
      file.file_id,
      file.fileId,
      file.id,
    ]),
  ).trim();
}

export function isTencentMeetingRecording(recording = {}) {
  return String(recording.source || "").startsWith(TENCENT_MEETING_SOURCE_PREFIX);
}

export function tencentMeetingMeetingRecordId(record = {}, file = {}, fallback = "") {
  return String(
    firstNonEmptyValue([
      file.meeting_record_id,
      file.meetingRecordId,
      record.meeting_record_id,
      record.meetingRecordId,
      record.record_id,
      record.recordId,
      record.id,
      fallback,
    ]),
  ).trim();
}

export function tencentMeetingSourceKindFromEvent(event = "", container = {}, file = {}, fallback = "") {
  const text = `${event} ${container.source_kind || container.sourceKind || ""} ${file.source_kind || file.sourceKind || ""} ${
    file.file_type || file.fileType || file.type || ""
  }`;
  if (/audio-completed|audio_completed|recorder|recording_pen|recording-pen|录音笔/i.test(text)) return "recorder";
  if (/cloud|record-completed|record_completed|recording\.completed|recording\.record-completed/i.test(text)) return "cloud";
  return fallback || "recorder";
}

export function tencentMeetingRecordFiles(record = {}) {
  return [
    ...asArray(record.record_file),
    ...asArray(record.recordFile),
    ...asArray(record.record_files),
    ...asArray(record.recording_files),
    ...asArray(record.files),
    ...asArray(record.record_file_list),
    ...asArray(record.meeting_record),
    ...asArray(record.meetingRecord),
    ...asArray(record.meeting_records),
    ...asArray(record.meetingRecords),
  ];
}

export function tencentMeetingRecordsFromPayload(payload = {}) {
  return [
    ...asArray(payload.record_meeting),
    ...asArray(payload.record_meetings),
    ...asArray(payload.meeting_record),
    ...asArray(payload.meeting_record_list),
    ...asArray(payload.meeting_records),
    ...asArray(payload.records),
    ...asArray(payload.record_list),
    ...asArray(payload.list),
    ...asArray(payload.data?.record_meeting),
    ...asArray(payload.data?.record_meetings),
    ...asArray(payload.data?.meeting_record),
    ...asArray(payload.data?.meeting_record_list),
    ...asArray(payload.data?.records),
    ...asArray(payload.data?.record_list),
    ...asArray(payload.data?.list),
  ];
}

export function firstTencentMeetingMediaUrl(value, seen = new Set()) {
  if (!value) return "";
  if (typeof value === "string") {
    const text = value.trim();
    return /^https?:\/\//i.test(text) ? text : "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const fieldsByPriority = [
    [
      "audio_download_url",
      "audioDownloadUrl",
      "audio_download_address",
      "audioDownloadAddress",
      "audio_address",
      "audioAddress",
      "audio_url",
      "audioUrl",
      "download_audio_url",
      "downloadAudioUrl",
    ],
    [
      "download_address",
      "downloadAddress",
      "download_url",
      "downloadUrl",
      "file_download_url",
      "fileDownloadUrl",
      "file_download_address",
      "fileDownloadAddress",
    ],
    [
      "media_url",
      "mediaUrl",
      "media_address",
      "mediaAddress",
      "recording_url",
      "recordingUrl",
      "recording_address",
      "recordingAddress",
      "video_download_url",
      "videoDownloadUrl",
      "video_url",
      "videoUrl",
      "play_url",
      "playUrl",
      "file_url",
      "fileUrl",
      "url",
    ],
  ];

  for (const fields of fieldsByPriority) {
    for (const field of fields) {
      const url = firstTencentMeetingMediaUrl(value[field], seen);
      if (url) return url;
    }
  }

  const containers = [
    "download_address_info",
    "downloadAddressInfo",
    "download_info",
    "downloadInfo",
    "audio",
    "video",
    "media",
    "file",
    "record_file",
    "recordFile",
  ];
  for (const field of containers) {
    const url = firstTencentMeetingMediaUrl(value[field], seen);
    if (url) return url;
  }

  const arrays = [
    "download_addresses",
    "downloadAddresses",
    "addresses",
    "urls",
    "files",
    "record_files",
    "recordFiles",
    "recording_files",
    "recordingFiles",
    "media_files",
    "mediaFiles",
  ];
  for (const field of arrays) {
    for (const item of asArray(value[field])) {
      const url = firstTencentMeetingMediaUrl(item, seen);
      if (url) return url;
    }
  }

  return "";
}

export function tencentMeetingDownloadUrlFromFile(file = {}) {
  return firstTencentMeetingMediaUrl(file);
}

export function tencentMeetingSummaryFilesFromPayload(payload = {}) {
  const nested = payload.data || {};
  return [
    ...asArray(payload.meeting_summary),
    ...asArray(payload.meetingSummary),
    ...asArray(payload.summary_files),
    ...asArray(payload.summaryFiles),
    ...asArray(payload.transcript_files),
    ...asArray(payload.transcriptFiles),
    ...asArray(payload.ai_meeting_transcripts),
    ...asArray(payload.aiMeetingTranscripts),
    ...asArray(nested.meeting_summary),
    ...asArray(nested.meetingSummary),
    ...asArray(nested.summary_files),
    ...asArray(nested.summaryFiles),
    ...asArray(nested.transcript_files),
    ...asArray(nested.transcriptFiles),
    ...asArray(nested.ai_meeting_transcripts),
    ...asArray(nested.aiMeetingTranscripts),
  ];
}

export function tencentMeetingSummaryDownloadUrlsFromPayload(payload = {}) {
  const urls = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (text && !urls.includes(text)) urls.push(text);
  };
  for (const file of tencentMeetingSummaryFilesFromPayload(payload)) {
    const fileType = String(file.file_type || file.fileType || file.type || "").toLowerCase();
    const url =
      file.download_address ||
      file.downloadAddress ||
      file.download_url ||
      file.downloadUrl ||
      file.url ||
      "";
    if (!fileType || fileType === "txt" || fileType === "text") add(url);
  }
  return urls;
}

export function tencentMeetingTranscriptParagraphsFromPayload(payload = {}) {
  return [
    ...asArray(payload.minutes?.paragraphs),
    ...asArray(payload.minutes?.paragraph_list),
    ...asArray(payload.data?.minutes?.paragraphs),
    ...asArray(payload.data?.minutes?.paragraph_list),
    ...asArray(payload.paragraphs),
    ...asArray(payload.paragraph_list),
    ...asArray(payload.data?.paragraphs),
    ...asArray(payload.data?.paragraph_list),
  ];
}

export function tencentMeetingTranscriptPidsFromPayload(payload = {}) {
  const pidFromValue = (value) => {
    if (!value || typeof value !== "object") return String(value || "").trim();
    return String(
      firstNonEmptyValue([
        value.pid,
        value.paragraph_id,
        value.paragraphId,
        value.id,
        value.start_pid,
        value.startPid,
      ]),
    ).trim();
  };
  const values = [
    ...asArray(payload.pids),
    ...asArray(payload.pid_list),
    ...asArray(payload.paragraph_ids),
    ...asArray(payload.data?.pids),
    ...asArray(payload.data?.pid_list),
    ...asArray(payload.data?.paragraph_ids),
    ...tencentMeetingTranscriptParagraphsFromPayload(payload).map((paragraph) => paragraph.pid || paragraph.paragraph_id || paragraph.id),
  ];
  return [...new Set(values.map(pidFromValue).filter(Boolean))];
}

export function tencentMeetingTranscriptDetailConcurrency() {
  return boundedNumber(process.env.TENCENT_MEETING_TRANSCRIPT_DETAIL_CONCURRENCY, 8, 1, 16);
}

export function tencentMeetingTranscriptRetryIntervalMs(recording = {}) {
  if (process.env.TENCENT_MEETING_TRANSCRIPT_RETRY_INTERVAL_MS) {
    return boundedNumber(process.env.TENCENT_MEETING_TRANSCRIPT_RETRY_INTERVAL_MS, 60 * 1000, 30 * 1000, 60 * 60 * 1000);
  }
  const createdMs = Date.parse(recording.createdAt || recording.updatedAt || "");
  const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : 0;
  if (ageMs > 0 && ageMs < 30 * 60 * 1000) return 60 * 1000;
  if (ageMs > 0 && ageMs < 3 * 60 * 60 * 1000) return 2 * 60 * 1000;
  return 5 * 60 * 1000;
}

export function isTencentMeetingTranscriptUnavailableError(error) {
  const normalizedMessage = String(error instanceof Error ? error.message : error || "");
  if (/30001|30003|content.*generating|transcript.*generat/i.test(normalizedMessage)) return true;
  const message = normalizedMessage;
  return /108030001|108000403|纪要不存在|会议纪要|转写.*不存在|暂无.*转写|暂无.*纪要|transcript.*not/i.test(message);
}

export function tencentMeetingTranscriptErrorKind(error) {
  const normalizedMessage = String(error instanceof Error ? error.message : error || "");
  if (/\b403\b|permission|forbidden/i.test(normalizedMessage)) return "permission";
  if (/30002|transcript.*empty|no.*transcript.*content/i.test(normalizedMessage)) return "empty";
  if (/4049|record.*not.*exist/i.test(normalizedMessage)) return "missing";
  const message = normalizedMessage;
  if (/1009009042|暂无权限|无权限|permission|forbidden/i.test(message)) return "permission";
  if (/108030002|纪要无内容|转写无内容|无内容/i.test(message)) return "empty";
  if (/108004051|录制文件已经被删除|108004049|不存在的记录|record.*not.*exist/i.test(message)) return "missing";
  if (isTencentMeetingTranscriptUnavailableError(error)) return "pending";
  return message ? "error" : "pending";
}

export function dominantTencentMeetingTranscriptFailure(kinds = []) {
  const values = kinds.filter(Boolean);
  if (!values.length) return "pending";
  for (const kind of ["pending", "empty", "permission", "missing", "error"]) {
    if (values.includes(kind)) return kind;
  }
  return "pending";
}

export function isTencentMeetingTranscriptFinalWindowExpired(recording = {}) {
  const createdMs = Date.parse(recording.createdAt || recording.updatedAt || "");
  const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : 0;
  return ageMs > Number(process.env.TENCENT_MEETING_TRANSCRIPT_FINALIZE_MS || 24 * 60 * 60 * 1000);
}

export function tencentMeetingTranscriptFinalStatus(failureKind = "pending", recording = {}) {
  if (failureKind === "permission") {
    return {
      final: false,
      statusText: "等待下载权限",
      transcriptSource: "",
      errorMessage: "腾讯会议暂未给当前应用读取这条录制文字的权限，请确认录制文件授权。",
    };
  }
  if (failureKind === "missing") {
    return {
      final: true,
      statusText: "腾讯无文字",
      transcriptSource: "tencent-meeting-unavailable",
      errorMessage: "腾讯会议返回这条录制文件不存在或已删除，无法同步文字。",
    };
  }
  if ((failureKind === "empty" || failureKind === "pending") && isTencentMeetingTranscriptFinalWindowExpired(recording)) {
    return {
      final: true,
      statusText: "腾讯无文字",
      transcriptSource: "tencent-meeting-unavailable",
      errorMessage: "腾讯会议没有为这条录制生成可同步的文字，通常是录制太短、无有效发言或腾讯侧文字未生成。",
    };
  }
  return {
    final: false,
    statusText: "等待腾讯会议文字",
    transcriptSource: "",
    errorMessage: "腾讯会议还没有返回已生成的转写文字，后台会稍后自动同步。",
  };
}

export function tencentMeetingTranscriptNextRetryAt(recording = {}) {
  return new Date(Date.now() + tencentMeetingTranscriptRetryIntervalMs(recording)).toISOString();
}

export function tencentMeetingTranscriptTextFromParagraph(paragraph = {}) {
  const direct = firstNonEmptyValue([
    paragraph.text,
    paragraph.content,
    paragraph.transcript,
    paragraph.sentence,
    paragraph.words_text,
  ]);
  if (direct) return String(direct).trim();

  const sentenceText = asArray(paragraph.sentences)
    .map((sentence) => {
      const words = asArray(sentence.words)
        .map((word) => String(word?.text || word?.word || "").trim())
        .filter(Boolean)
        .join("");
      return words || String(sentence.text || sentence.content || "").trim();
    })
    .filter(Boolean)
    .join("");

  return sentenceText || "";
}

export function tencentMeetingTranscriptSpeakerName(paragraph = {}, fallback = "") {
  const speakerId = String(paragraph.speaker_id || paragraph.speakerId || "").trim();
  const speakerName = String(paragraph.speaker_name || paragraph.speakerName || paragraph.speaker || "").trim();
  if (speakerName) return speakerName.slice(0, 100);
  if (speakerId) return `参会人${speakerId.slice(0, 8)}`;
  return fallback || "未知发言人";
}

function tencentMeetingTranscriptSpeakerKey(value = "") {
  const identity = String(value || "").trim();
  if (!identity || identity === "未知发言人") return "speaker-1";
  return `speaker-${crypto.createHash("sha1").update(identity).digest("hex").slice(0, 12)}`;
}

function tencentMeetingTranscriptResult(segments = [], rawText = "") {
  const speakerMap = {};
  for (const segment of segments) {
    if (segment.speakerKey && segment.speakerName) speakerMap[segment.speakerKey] = segment.speakerName;
  }
  const transcriptText =
    String(rawText || "").trim() ||
    segments
      .map((segment) => `${segment.speakerName ? `【${segment.speakerName}】` : ""}${segment.text || ""}`)
      .join("\n")
      .trim();
  return {
    segments,
    rawText: transcriptText,
    correctedText: transcriptText,
    speakerMap,
  };
}

function tencentMeetingTranscriptOffsetMs(value) {
  if (value === undefined || value === null || value === "") return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number.NaN;
}

export function tencentMeetingTranscriptSegmentsFromPayload(payload = {}, durationMs = 0) {
  const paragraphs = tencentMeetingTranscriptParagraphsFromPayload(payload);
  const segments = [];
  for (const paragraph of paragraphs) {
    const text = tencentMeetingTranscriptTextFromParagraph(paragraph);
    if (!text) continue;

    const speakerName = tencentMeetingTranscriptSpeakerName(paragraph);
    const speakerIdentity = paragraph.speaker_id || paragraph.speakerId || speakerName;
    const startTimeMs = tencentMeetingTranscriptOffsetMs(paragraph.start_time ?? paragraph.startTime ?? paragraph.begin_time);
    const endTimeMs = tencentMeetingTranscriptOffsetMs(paragraph.end_time ?? paragraph.endTime ?? paragraph.finish_time);

    const duration = Number.isFinite(endTimeMs) && Number.isFinite(startTimeMs) ? endTimeMs - startTimeMs : 0;
    const actualStartTimeMs = Number.isFinite(startTimeMs) ? startTimeMs : (segments.length ? segments[segments.length - 1].endMs : 0);
    const actualEndTimeMs = Number.isFinite(endTimeMs) ? endTimeMs : actualStartTimeMs + Math.max(duration, 100);

    segments.push({
      startMs: Math.max(0, actualStartTimeMs),
      endMs: Math.max(0, actualEndTimeMs),
      speakerKey: tencentMeetingTranscriptSpeakerKey(speakerIdentity),
      speakerName,
      text,
    });
  }

  if (durationMs > 0) {
    for (const segment of segments) {
      segment.startMs = Math.min(segment.startMs, durationMs);
      segment.endMs = Math.min(segment.endMs, durationMs);
    }
  }

  return tencentMeetingTranscriptResult(segments);
}

export function tencentMeetingTranscriptSegmentsFromText(text = "", durationMs = 0) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const segments = [];
  let currentSpeaker = "";
  let currentText = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const speakerMatch = trimmed.match(/^【([^】]+)】\s*/);
    if (speakerMatch) {
      if (currentText) {
        segments.push({
          startMs: 0,
          endMs: 0,
          speakerKey: tencentMeetingTranscriptSpeakerKey(currentSpeaker),
          speakerName: currentSpeaker || "未知发言人",
          text: currentText.trim(),
        });
        currentText = "";
      }
      currentSpeaker = speakerMatch[1].slice(0, 100);
      currentText = trimmed.slice(speakerMatch[0].length).trim();
      continue;
    }

    if (currentText) {
      currentText += "\n";
    }
    currentText += trimmed;
  }

  if (currentText) {
    segments.push({
      startMs: 0,
      endMs: 0,
      speakerKey: tencentMeetingTranscriptSpeakerKey(currentSpeaker),
      speakerName: currentSpeaker || "未知发言人",
      text: currentText.trim(),
    });
  }

  if (durationMs > 0 && segments.length > 0) {
    const totalTextLength = segments.reduce((sum, seg) => sum + seg.text.length, 0);
    if (totalTextLength > 0) {
      let accumulatedTimeMs = 0;
      for (const segment of segments) {
        segment.startMs = accumulatedTimeMs;
        segment.endMs = accumulatedTimeMs + Math.round((segment.text.length / totalTextLength) * durationMs);
        accumulatedTimeMs = segment.endMs;
      }
      segments[segments.length - 1].endMs = durationMs;
    }
  }

  return tencentMeetingTranscriptResult(segments, text);
}

export function tencentMeetingNameFromDetail(record = {}, file = {}, fallback = "") {
  return String(
    firstNonEmptyValue([
      record.subject,
      record.meeting_subject,
      record.meetingSubject,
      record.topic,
      file.subject,
      file.meeting_subject,
      file.meetingSubject,
      file.record_file_name,
      file.recordFileName,
      file.file_name,
      file.name,
      fallback ||
        "",
    ]),
  ).trim();
}

export function tencentMeetingOwnerNameFromDetail(record = {}, file = {}, fallback = "") {
  const owner = file.owner || file.file_owner || file.fileOwner || record.owner || record.file_owner || {};
  const creator = record.creator || record.meeting_info?.creator || record.meetingInfo?.creator || {};
  return String(
    firstNonEmptyValue([
      file.owner_name,
      file.ownerName,
      file.user_name,
      file.userName,
      file.display_name,
      file.displayName,
      file.nick_name,
      file.nickName,
      file.nickname,
      owner.user_name,
      owner.userName,
      owner.display_name,
      owner.displayName,
      owner.nick_name,
      owner.nickName,
      owner.nickname,
      owner.username,
      owner.name,
      record.owner_name,
      record.ownerName,
      record.user_name,
      record.userName,
      record.display_name,
      record.displayName,
      record.nick_name,
      record.nickName,
      record.nickname,
      creator.user_name,
      creator.userName,
      creator.display_name,
      creator.displayName,
      creator.nick_name,
      creator.nickName,
      creator.nickname,
      creator.username,
      creator.name,
      fallback,
    ]),
  ).trim();
}

export function tencentMeetingCreatorUseridFromDetail(record = {}, file = {}, fallback = "") {
  const owner = file.owner || file.file_owner || file.fileOwner || record.owner || record.file_owner || {};
  const creator = record.creator || record.meeting_info?.creator || record.meetingInfo?.creator || {};
  return String(
    firstNonEmptyValue([
      file.userid,
      file.user_id,
      file.userId,
      owner.userid,
      owner.user_id,
      owner.userId,
      record.userid,
      record.user_id,
      record.userId,
      creator.userid,
      creator.user_id,
      creator.UserID,
      creator.userId,
      fallback,
    ]),
  ).trim();
}

export function tencentMeetingOperateTimeFromRecord(record = {}, file = {}, fallback = "") {
  return firstNonEmptyValue([
    file.operate_time,
    file.operateTime,
    file.create_time,
    file.createTime,
    file.end_time,
    file.endTime,
    file.start_time,
    file.startTime,
    record.operate_time,
    record.operateTime,
    record.end_time,
    record.endTime,
    record.start_time,
    record.startTime,
    fallback,
    Date.now(),
  ]);
}

export function tencentMeetingInfoFromRecordFile(record = {}, file = {}, fallback = {}, sourceKind = "cloud") {
  const meetingInfo = record.meeting_info || record.meetingInfo || record;
  const recordFileId = tencentMeetingRecordFileId(file) || String(fallback.recordFileId || "").trim();
  const meetingRecordId = tencentMeetingMeetingRecordId(record, file, fallback.meetingRecordId || fallback.meeting_record_id || "");
  const detectedSourceKind = tencentMeetingSourceKindFromEvent(fallback.event || record.event || "", record, file, sourceKind);
  return {
    event: fallback.event || "recording.discovery",
    sourceKind: detectedSourceKind,
    recordFileId,
    meetingRecordId,
    operateTime: tencentMeetingOperateTimeFromRecord(record, file, fallback.operateTime),
    subject: tencentMeetingNameFromDetail(record, file, fallback.subject),
    ownerName: tencentMeetingOwnerNameFromDetail(record, file, fallback.ownerName),
    creatorUserid: tencentMeetingCreatorUseridFromDetail(record, file, fallback.creatorUserid),
    durationMs: tencentMeetingDurationMsFromFile(file, meetingInfo, record) || Number(fallback.durationMs || 0),
    meetingId: meetingInfo.meeting_id || meetingInfo.meetingId || record.meeting_id || record.meetingId || fallback.meetingId || "",
    meetingCode: meetingInfo.meeting_code || meetingInfo.meetingCode || record.meeting_code || record.meetingCode || fallback.meetingCode || "",
    downloadUrl: tencentMeetingDownloadUrlFromFile(file) || fallback.downloadUrl || "",
    record,
    file,
  };
}

export function tencentMeetingSyncInfoFromRecording(recording = {}) {
  return {
    recordFileId: String(recording.source || "").slice(TENCENT_MEETING_SOURCE_PREFIX.length+1),
    meetingRecordId: recording.tencentMeetingMeetingRecordId || "",
    sourceKind:
      recording.tencentMeetingSourceKind ||
      (/云录制|cloud|recording\.completed/i.test(`${recording.tag || ""} ${recording.userAgent || ""}`) ? "cloud" : "recorder"),
    operateTime: recording.createdAt || Date.now(),
    subject: recording.name,
    ownerName: recording.ownerName || "",
    durationMs: recording.durationMs || 0,
    creatorUserid: recording.tencentMeetingCreatorUserid || "",
    meetingId: recording.tencentMeetingMeetingId || "",
    meetingCode: recording.tencentMeetingMeetingCode || "",
  };
}

export function tencentMeetingRecordingTimeMs(recording = {}) {
  const candidates = [recording.updatedAt, recording.createdAt, recording.sharedAt, recording.transcribedAt];
  for (const value of candidates) {
    const time = Date.parse(value || "");
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

export function tencentMeetingPendingBatchSize(envName, fallback) {
  return Math.min(50, Math.max(1, Number(process.env[envName] || fallback)));
}

export function tencentMeetingDiscoveryWindow() {
  const lookbackDays = Math.min(31, 7);
  const endMs = Date.now() + 1000 * 60 * 60 * 6;
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;
  return {
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(endMs / 1000),
  };
}

export function tencentMeetingSummaryFallbackEnabled(info = {}) {
  // TODO 多余环境变量 configured始终为空字符串
  // const configured = firstEnv("TENCENT_MEETING_SUMMARY_FALLBACK_ENABLED", "WEMEET_SUMMARY_FALLBACK_ENABLED");
  // const configured = ""
  // if (configured !== "") return envFlag(configured, false);
  return false;
}

export function tencentMeetingAudioSyncEnabled() {
  const explicit = process.env.TENCENT_MEETING_AUDIO_SYNC_ENABLED;
  if (explicit) return /^(1|true|yes|on)$/i.test(explicit);
  return tencentMeetingApiConfigured();
}

export function tencentMeetingCallbackUrl() {
  const candidates = [
    process.env.TENCENT_ASR_PUBLIC_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.APP_PUBLIC_URL,
    process.env.APP_BASE_URL,
  ];
  const baseUrl = candidates.map((item) => String(item || "").trim()).find(Boolean);
  return baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/tencentMeeting/webhook` : "";
}

export function tencentMeetingStsOperatorId() {
  return firstEnv("TENCENT_MEETING_STS_OPERATOR_ID", "WEMEET_STS_OPERATOR_ID", "TENCENT_MEETING_OPERATOR_ID", "WEMEET_OPERATOR_ID");
}

export function tencentMeetingImportOwnerClientId() {
  return "tencent-meeting";
}

export function tencentMeetingImportOwnerName() {
  return "腾讯会议录音笔";
}

export function tencentMeetingSourceKey(recordFileId) {
  return `${TENCENT_MEETING_SOURCE_PREFIX}:${String(recordFileId || "").trim()}`;
}

export function tencentMeetingApiConfigured() {
  const config = tencentMeetingApiConfig();
  return Boolean(config.secretId && config.secretKey && config.appId);
}

export function isTencentMeetingTranscriptReadyEvent(payload = {}) {
  return String(payload?.event || "").trim() === "smart.transcripts";
}

export function isTencentMeetingRecorderTranscriptEvent(payload = {}) {
  return String(payload?.event || "").trim() === "recording.audio-completed";
}

export function isTencentMeetingTranscriptSyncEvent(payload = {}) {
  return isTencentMeetingTranscriptReadyEvent(payload) || isTencentMeetingRecorderTranscriptEvent(payload);
}

export function tencentMeetingTranscriptSyncMaxAttempts(info = {}) {
  if (!isTencentMeetingRecorderTranscriptEvent(info)) return 1;
  return boundedNumber(process.env.TENCENT_MEETING_RECORDER_TRANSCRIPT_MAX_ATTEMPTS, 6, 1, 24);
}

export const TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_START_MARKER =
  "===== TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_START =====";

export const TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER =
  "===== TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END =====";

export const TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_START_MARKER =
  "===== TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_START =====";

export const TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_STEP_MARKER =
  "===== TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_STEP =====";

export const TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_END_MARKER =
  "===== TENCENT_MEETING_RECORDER_CALLBACK_DIAGNOSTIC_END =====";

export function tencentMeetingWebhookEventAction(payload = {}) {
  switch (String(payload?.event || "").trim()) {
    case "common.sts-token":
      return "sts-token";
    case "recording.started":
      return "recording-started";
    case "recording.completed":
      return "recording-completed";
    case "recording.audio-completed":
      return "audio-completed";
    case "smart.transcripts":
      return "transcript-ready";
    default:
      return "ignored";
  }
}

export function tencentMeetingQuery(pathname, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function tencentMeetingSearchWindow(info = {}) {
  const operateMs = tencentMeetingEventTimeMs(info.operateTime);
  const startMs = operateMs - 1000 * 60 * 60 * 24 * 8;
  const endMs = Math.max(Date.now() + 1000 * 60 * 60 * 24, operateMs + 1000 * 60 * 60 * 24 * 2);
  return {
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(endMs / 1000),
  };
}

export function tencentMeetingCandidateOperatorParams() {
  const operatorId = firstEnv("TENCENT_MEETING_OPERATOR_ID", "WEMEET_OPERATOR_ID");
  if (!operatorId) return [];
  const type = firstEnv("TENCENT_MEETING_OPERATOR_ID_TYPE", "WEMEET_OPERATOR_ID_TYPE") || "3";
  return [{ operator_id: operatorId, operator_id_type: type }];
}

export function tencentMeetingCandidateUserIds() {
  return [
    ...splitEnvList(process.env.TENCENT_MEETING_USERIDS),
    ...splitEnvList(process.env.TENCENT_MEETING_USER_IDS),
    ...splitEnvList(process.env.WEMEET_USERIDS),
    ...splitEnvList(process.env.WEMEET_USER_IDS),
    firstEnv("TENCENT_MEETING_USERID", "WEMEET_USERID"),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

export function tencentMeetingCandidateDownloadIdentityParams(info = {}) {
  const eventUserIds = [
    info.creatorUserid,
    info.creatorUserId,
    info.ownerUserid,
    info.ownerUserId,
    info.userid,
    info.userId,
  ].filter(Boolean);
  const identities = [
    ...eventUserIds.map((userid) => ({ userid })),
    ...tencentMeetingCandidateUserIds().map((userid) => ({ userid })),
    ...tencentMeetingCandidateOperatorParams(),
  ];
  const seen = new Set();
  return identities.filter((identity) => {
    const key = JSON.stringify(identity);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tencentMeetingCandidateTranscriptOperatorParams(info = {}) {
  const eventUserIds = [
    info.creatorUserid,
    info.creatorUserId,
    info.ownerUserid,
    info.ownerUserId,
    info.userid,
    info.userId,
  ].filter(Boolean);
  const identities = [
    ...eventUserIds.map((operatorId) => ({ operator_id: operatorId, operator_id_type: 1 })),
    ...tencentMeetingCandidateUserIds().map((operatorId) => ({ operator_id: operatorId, operator_id_type: 1 })),
    ...tencentMeetingCandidateOperatorParams(),
  ];
  const seen = new Set();
  return identities.filter((identity) => {
    const key = JSON.stringify(identity);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tencentMeetingWebhookStatus() {
  const config = tencentMeetingWebhookConfig();
  const candidates = [
    process.env.TENCENT_ASR_PUBLIC_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.APP_PUBLIC_URL,
    process.env.APP_BASE_URL,
  ];
  const baseUrl = candidates.map((item) => String(item || "").trim()).find(Boolean);
  const configuredBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  return {
    configured: Boolean(config.tokens.length && config.encodingAesKeys.length),
    callbackUrl: tencentMeetingCallbackUrl(),
    apiConfigured: tencentMeetingApiConfigured(),
    cloudDiscovery: {
      enabled: Number(process.env.TENCENT_MEETING_CLOUD_DISCOVERY_INTERVAL_MS || 10 * 60 * 1000) !== 0,
      lookbackDays: Math.min(31, 7),
    },
    needs: {
      publicBaseUrl: !configuredBaseUrl,
      token: !config.tokens.length,
      encodingAesKey: !config.encodingAesKeys.length,
      apiCredentials: !tencentMeetingApiConfigured(),
    },
  };
}


export async function importTencentMeetingStsTokenPayload(payload = {}) {
  // const event = String(payload.event || payload.Event || payload.event_type || "").trim();
  // console.log("call importTencentMeetingStsTokenPayload, event: ", event)
  // console.log("call importTencentMeetingStsTokenPayload, payload: ", payload)
  // if (event !== "common.sts-token") return;
  // const saveTasks = asArray(payload.payload).map(item => {
  //   return saveTencentMeetingStsToken(item?.token_info)
  // })
  // return Promise.all(saveTasks)
  const event = String(payload.event || "").trim();
  if (event !== "common.sts-token") return false;
  let saved = false;
  for (const item of asArray(payload.payload)) {
    if (await saveTencentMeetingStsToken(item?.token_info)) saved = true;
  }
  return saved;
}
