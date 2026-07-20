import {Toast} from "antd-mobile";
import {displayDateFromDateKey} from './date.js'
import { getWecomAuthToken } from "../stores/useWecomAuthStore.js";
import {
  AUTH_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  RECORDING_RECOVERY_DB,
  RECORDING_RECOVERY_STORE,
  RECORDING_RECOVERY_VERSION,
  RECORDING_SESSION_QUEUE_STORAGE_KEY,
  RECORDING_SESSION_STORAGE_KEY,
} from "../constant.js";

export {
  AUTH_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  RECORDING_RECOVERY_DB,
  RECORDING_RECOVERY_STORE,
  RECORDING_RECOVERY_VERSION,
  RECORDING_SESSION_QUEUE_STORAGE_KEY,
  RECORDING_SESSION_STORAGE_KEY,
} from "../constant.js";

export const cardColors = ["coral", "indigo", "violet", "teal", "clay", "ink"];

export function showToast(content, duration = 2000) {
  if (!content) return;
  Toast.show({
    content,
    position: "bottom",
    duration
  });
}

export function mergeRequestHeaders(headers = {}, body = null) {
  const next = new Headers(headers);
  if (!(body instanceof FormData)) {
    next.set("Content-Type", "application/json");
  }
  next.set("X-Client-Id", getClientId());
  const auth = getStoredAuth();
  if (auth?.token) next.set("Authorization", `Bearer ${auth.token}`);
  const wecomAuthToken = getWecomAuthToken();
  if (wecomAuthToken) next.set("X-WeCom-Auth-Token", wecomAuthToken);
  const wecomName = getDetectedWecomName();
  if (wecomName) next.set("X-Wecom-User-Name", encodeURIComponent(wecomName));
  return next;
}

export function appendUrlParam(url, key, value) {
  try {
    if (!value) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  } catch (err) {
    console.log("call appendUrlParam failed: ", err.message)
    return ''
  }
}

export function mediaRequestUrl(url, version = "") {
  const auth = getStoredAuth();
  return appendUrlParam(appendUrlParam(appendUrlParam(url, "clientId", getClientId()), "authToken", auth?.token || ""), "v", version);
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: mergeRequestHeaders(options.headers, options.body),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (path.startsWith("/api") && typeof payload === "string" && /<!doctype html|<html|cannot\s+(get|post)/i.test(payload)) {
    throw new Error("接口服务未连接或版本未更新，请刷新页面并确认后端服务已重启。");
  }

  if (!response.ok) {
    throw new Error(typeof payload === "string" ? payload : payload.error || "请求失败");
  }

  return payload;
}

export const QA_TECHNICAL_FALLBACK = "回答内容包含模型中间格式，已自动隐藏。请点击重新生成。";
export const QA_THINKING_STEPS = ["读取选中录音的逐字稿", "抽取与问题最相关的候选语义段", "核对时间点与原文证据", "组织结论、原因和依据"];
export const MOJIBAKE_REPLACEMENTS = [
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
export const MOJIBAKE_PATTERN =
  /\u7481\u677f\u7d8d|\u675e\ue100\u5553\u68f0\u52ee\ue74d|\u93c0\u60f0\u6363|\u8930\u66e2|\u6d7c\u6c33|\u7490\u71bb|\u59dd\uff45\u6e6a|\u6fb6\u8fab\u89e6|\u93c2\u56e7\u74e7|\u93c3\u5815\u66b1|\u95ca\u62bd|\u9352\u55d5\u97e9|\u934f\u62bd\u68f4|\u6fb6\u5d85\u57d7|\u6434\u66e2\u5134|\u7035\u8270\u57c5|\u93b4\u6220|\u93bb\u6130\u68f6|\u93c8\u6944|\u9350\u546d|\u7ef1\u3220\u7d29|\u59af\u2033\u7037|\u9422\u71b8\u579a|\u9358\u71b7\u6d1c|\u934f\u62bd\u656d|\u6e1a\u6fc7\u5d41|\u93c1\u7fe0\u7d8b|\u9352\u3086\u67c7|\u934a\u60e7\u609c|\u7ecb\u5b2a\u5bb3|\u93cd\u7a3f\u7e3e|\u9352\u55d9\u5063|\u7f01\u64b9|\u95c2\ue1be\u74df|\u9286|\u951b|\u951f|\ufffd/;
export const TECHNICAL_ANSWER_PATTERN =
  /DSML|tool_calls|search_transcript_segments|<\s*\|\s*DSML|<\/\s*\|\s*DSML|overall_judgement|final_conclusion|"evidences"\s*:|"analysis"\s*:|"confidence"\s*:|cleanText\(|\{cleanText|point\.(?:conclusion|reason|basis)|Bad control character|JSON parse failed|Cannot POST|<!DOCTYPE html|<html\b|parameter name=|invoke name=|function\s+\w+\s*\(|const\s+\w+\s*=|=>\s*\{|```/i;

export function isEnglishLanguage(language) {
  return /^en/i.test(String(language || ""));
}

export function uiText(language, zh, en) {
  return isEnglishLanguage(language) ? en : zh;
}

export function formatDuration(ms = 0, precise = false) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  if (!precise) return `${minutes}:${seconds}`;
  const hundredths = String(Math.floor((safeMs % 1000) / 10)).padStart(2, "0");
  return `${minutes}:${seconds},${hundredths}`;
}

export function formatShortDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTimecode(ms) {
  return formatDuration(ms);
}

export function formatClockTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatCardDateParts(iso) {
  if (!iso) return { month: "", day: "", weekday: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { month: "", day: "", weekday: "" };
  return {
    month: `${String(date.getMonth() + 1).padStart(2, "0")}月`,
    day: String(date.getDate()).padStart(2, "0"),
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date),
  };
}

export function isToday(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function safeFileName(name) {
  return String(name || "recording").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "recording";
}

export function safeFileNameWithExtension(name, extension) {
  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  const safe = safeFileName(name);
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedSuffix}$`, "i").test(safe) ? safe : `${safe}${suffix}`;
}

export function recordTitleSize(name) {
  const length = Array.from(String(name || "")).length;
  if (length >= 34) return "12px";
  if (length >= 28) return "13px";
  if (length >= 22) return "14px";
  if (length >= 16) return "15px";
  if (length >= 10) return "17px";
  return "clamp(20px, 5vw, 23px)";
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function openDownloadUrl(url, fileName = "") {
  const link = document.createElement("a");
  link.href = url;
  if (fileName) link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function isImageFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name);
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob(resolve, type, quality);
      return;
    }

    fetch(canvas.toDataURL(type, quality))
      .then((response) => response.blob())
      .then(resolve)
      .catch(() => resolve(null));
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

export function getSupportedMimeType() {
  if (!window.MediaRecorder) return "";
  const types = ["audio/mp4", "audio/aac", "audio/mpeg", "audio/webm;codecs=opus", "audio/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function audioExtensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  return "webm";
}

export function canRequestMicrophone() {
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  return window.isSecureContext || localHosts.includes(window.location.hostname);
}

export function microphoneErrorMessage(error) {
  const name = error?.name || "";

  if (!canRequestMicrophone()) {
    return "手机端录音必须通过 HTTPS 打开。请部署到 HTTPS 域名后，再从企业微信应用入口访问。";
  }

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "麦克风权限被拒绝。请在手机系统设置和企业微信权限里允许麦克风，然后重新打开页面。";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到可用麦克风，请确认手机麦克风正常并允许企业微信访问。";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风正在被其他应用占用，请关闭其他录音或通话应用后再试。";
  }

  if (name === "SecurityError") {
    return "浏览器安全策略阻止录音，请使用 HTTPS 地址并从企业微信应用内打开。";
  }

  return "无法获取麦克风权限，请允许访问麦克风后再试。";
}

export function recordingUploadErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/服务器正在处理数据|稍后重试|重试|retry|busy|processing/i.test(message)) {
    return "录音已提交，服务器正在后台处理转写，请稍后刷新记录。";
  }
  if (/Failed to fetch|NetworkError|Network request failed/i.test(message)) {
    return "上传失败，请检查手机网络和服务器是否正常运行。";
  }
  if (/413|too large|Payload Too Large/i.test(message)) {
    return "录音文件过大，请检查服务器上传大小限制。";
  }
  if (/ffmpeg|转码|MP3|audio/i.test(message)) {
    return "上传失败，服务器音频转码没有完成，请检查 ffmpeg 配置。";
  }
  return "上传失败，请检查服务器后重新录音。";
}

export function pointLabelForIndex(index) {
  return `观点 ${index + 1}`;
}

export function stripQaInternalIndexMarkers(value) {
  return String(value ?? "")
    .replace(/\s*[\uFF08(]\s*(?:candidate\s*)?(?:index|indices|indexes|索引|候选索引)\s*[:：]?\s*[\d,\s、，和and-]+[\uFF09)]/gi, "")
    .replace(/\b(?:candidate\s*)?(?:index|indices|indexes)\s*[:：]?\s*[\d,\s、，和and-]+/gi, "")
    .replace(/\b(?:index|indices|indexes)\s*[\d,\s、，和and-]+\b/gi, "")
    .replace(/\b(?:index|indices|indexes)\d+\b/gi, "")
    .replace(/(?:候选\s*)?索引\s*[:：]?\s*[\d,\s、，和and-]+/g, "")
    .replace(/\s+([，。；、：])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function repairKnownMojibake(value) {
  return MOJIBAKE_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));
}

export function looksLikeMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ""));
}

export function looksLikeTechnicalAnswerLeak(value) {
  const text = String(value || "");
  return looksLikeMojibake(text) || TECHNICAL_ANSWER_PATTERN.test(text);
}

export function cleanQaVisibleText(value, fallback = "") {
  const clean = stripQaInternalIndexMarkers(
    repairKnownMojibake(value)
      .replace(/\*\*/g, "")
      .replace(/```(?:json|markdown|javascript|js|html|xml)?/gi, "")
      .replace(/```/g, "")
      .replace(/[<]\/?\s*(?:DSML|tool_calls|invoke|parameter)[^>]*>/gi, "")
      .replace(/【录音[^】]+】/g, "")
      .replace(/\[[^\]]*(?:录音|\u8930\u66e2\u7176)[^\]]*\]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  if (!clean) return fallback;
  return looksLikeTechnicalAnswerLeak(clean) ? fallback : clean;
}

export function parseStructuredAnswer(answer) {
  if (!answer) return null;
  if (typeof answer === "object") return answer;
  const raw = String(answer || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));

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
        if (parsed && typeof parsed === "object" && (parsed.overall_judgement || parsed.final_conclusion || Array.isArray(parsed.analysis))) return parsed;
      } catch {
      }
    }
  }
  return null;
}

export function structuredAnswerFromItem(item) {
  return parseStructuredAnswer(item?.structuredAnswer) || parseStructuredAnswer(item?.answer);
}

export function structuredAnswerToPlainText(structured) {
  if (!structured || typeof structured !== "object") return "";
  const cleanText = (value) => cleanQaVisibleText(value);
  const lines = [];
  if (structured.overall_judgement) {
    lines.push("[整体判断]", cleanText(structured.overall_judgement), "");
  }
  if (structured.judgement_level) {
    lines.push("[判断等级 / 倾向程度]", cleanText(structured.judgement_level), "");
  }
  if (Array.isArray(structured.core_basis) && structured.core_basis.length > 0) {
    lines.push("[核心依据]", ...structured.core_basis.filter(Boolean).map((item, index) => `${index + 1}. ${cleanText(item)}`), "");
  }
  if (Array.isArray(structured.analysis) && structured.analysis.length > 0) {
    lines.push("[分点分析]");
    structured.analysis.forEach((point, index) => {
      lines.push(`${index + 1}. ${cleanText(point?.title || pointLabelForIndex(index))}`);
      if (point?.conclusion) lines.push(`结论：${cleanText(point.conclusion)}`);
      if (point?.reason) lines.push(`原因：${cleanText(point.reason)}`);
      if (point?.basis) lines.push(`关键依据：${cleanText(point.basis)}`);
      lines.push("");
    });
  }
  if (Array.isArray(structured.evidences) && structured.evidences.length > 0) {
    lines.push("[原文证据索引]");
    structured.evidences.forEach((evidence, index) => {
      lines.push(`${index + 1}. ${cleanText(evidence?.evidence_title || evidence?.analysis_title || `证据 ${index + 1}`)}`);
      lines.push(`时间：${evidence?.start_time || ""}${evidence?.end_time ? ` - ${evidence.end_time}` : ""}`);
      if (evidence?.quote) lines.push(`原文：${cleanText(evidence.quote)}`);
      if (evidence?.evidence_role) lines.push(`作用：${cleanText(evidence.evidence_role)}`);
      lines.push("");
    });
  }
  if (structured.final_conclusion) {
    lines.push("[最终结论]", cleanText(structured.final_conclusion));
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return looksLikeTechnicalAnswerLeak(text) ? "" : text;
}

export function cleanAnswerForDisplay(answer) {
  const structured = parseStructuredAnswer(answer);
  if (structured) return structuredAnswerToPlainText(structured) || QA_TECHNICAL_FALLBACK;
  return cleanQaVisibleText(answer, QA_TECHNICAL_FALLBACK);
}

export function answerBlocksForDisplay(answer) {
  const clean = cleanAnswerForDisplay(answer);
  if (!clean) return [];

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

export function thinkingStepsForMessage(item) {
  const thinking = item?.thinking || item?.reasoning || item?.reasoningContent || "";
  const cleanSteps = (steps) => {
    const safeSteps = steps
      .map((step) => cleanQaVisibleText(step))
      .filter(Boolean)
      .filter((step) => !looksLikeTechnicalAnswerLeak(step))
      .slice(0, 8);
    return safeSteps.length > 0 ? safeSteps : QA_THINKING_STEPS;
  };
  if (Array.isArray(thinking)) return cleanSteps(thinking.filter(Boolean).map(String));
  if (thinking && typeof thinking === "object") {
    const steps = thinking.steps || thinking.messages || thinking.summary;
    if (Array.isArray(steps)) return cleanSteps(steps.filter(Boolean).map((step) => (typeof step === "string" ? step : step.text || step.title || JSON.stringify(step))));
    if (thinking.text || thinking.summary) return cleanSteps([String(thinking.text || thinking.summary)]);
  }
  if (typeof thinking === "string" && thinking.trim()) {
    return cleanSteps(
      thinking
      .split(/\n+/)
      .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  return QA_THINKING_STEPS;
}

export function meetingReportBlocks(markdown = "") {
  const lines = String(markdown || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .filter((line) => !/^#{1,2}\s*会议报告生成提纲/.test(line))
    .filter((line) => !looksLikeMojibake(line))
    .map((line, index) => {
      if (/^#{1,4}\s+/.test(line)) {
        return { id: `heading-${index}`, type: "heading", text: line.replace(/^#{1,4}\s+/, "") };
      }
      if (/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?$/.test(line)) {
        return null;
      }
      if (/^\|.*\|$/.test(line)) {
        return { id: `table-${index}`, type: "table", text: line };
      }
      if (/^[-*]\s+/.test(line)) {
        return { id: `bullet-${index}`, type: "bullet", text: line.replace(/^[-*]\s+/, "") };
      }
      return { id: `text-${index}`, type: "text", text: line };
    })
    .filter(Boolean);
}

export function isTencentMeetingWaitingDownload(recording) {
  if (recording?.tencentMeeting?.waitingDownload) return true;
  const tag = String(recording?.tag || "");
  const message = String(recording?.errorMessage || "");
  if (
    tag.includes("等待腾讯会议文字") ||
    tag.includes("等待腾讯文字") ||
    tag.includes("等待腾讯转写") ||
    tag.includes("等待转写") ||
    message.includes("smart.transcripts") ||
    message.includes("录制转写生成")
  ) {
    return false;
  }
  return tag.includes("等待下载权限") || tag.includes("待授权") || message.includes("STS-Token") || message.includes("暂无权限");
}

export function isTencentMeetingRecorderPen(recording = {}) {
  if (!recording?.tencentMeeting?.imported) return false;
  const sourceKind = String(recording?.tencentMeeting?.sourceKind || recording?.tencentMeetingSourceKind || "").toLowerCase();
  if (sourceKind === "recorder") return true;
  const sourceText = `${recording?.name || ""} ${recording?.tag || ""}`;
  return sourceText.includes("录音笔");
}

export function isTencentMeetingNoTranscript(recording) {
  const tag = String(recording?.tag || "");
  const message = String(recording?.errorMessage || "");
  if (
    tag.includes("等待腾讯会议文字") ||
    tag.includes("等待腾讯文字") ||
    tag.includes("等待腾讯转写") ||
    tag.includes("等待转写") ||
    message.includes("smart.transcripts") ||
    message.includes("录制转写生成")
  ) {
    return false;
  }
  return (
    recording?.transcriptSource === "tencent-meeting-unavailable" ||
    tag.includes("腾讯无文字") ||
    message.includes("没有为这条录制生成") ||
    message.includes("录制文件不存在") ||
    message.includes("已删除")
  );
}

export function isTencentMeetingWaitingTranscript(recording) {
  if (isTencentMeetingNoTranscript(recording)) return false;
  if (recording?.tencentMeeting?.waitingTranscript) return true;
  const tag = String(recording?.tag || "");
  const message = String(recording?.errorMessage || "");
  if (
    Boolean(recording?.tencentMeeting?.imported) &&
    !recording?.transcript?.length &&
    (recording?.transcriptProvider === "tencent-meeting" || tag.includes("腾讯转写")) &&
    (tag.includes("等待腾讯会议文字") ||
      tag.includes("等待腾讯文字") ||
      tag.includes("等待腾讯转写") ||
      tag.includes("等待转写") ||
      message.includes("smart.transcripts") ||
      message.includes("录制转写生成"))
  ) {
    return true;
  }
  return Boolean(recording?.tencentMeeting?.imported) &&
    !recording?.transcript?.length &&
    (recording?.transcriptProvider === "tencent-meeting" || tag.includes("腾讯转写")) &&
    (tag.includes("等待腾讯会议文字") ||
      tag.includes("等待腾讯文字") ||
      tag.includes("等待腾讯转写") ||
      tag.includes("等待转写") ||
      message.includes("腾讯会议还没有返回"));
}

export function recordingStatusLabel(recording, isTrashView = false) {
  if (isTrashView) return "回收站";
  if (isTencentMeetingNoTranscript(recording)) return "腾讯无文字";
  if (isTencentMeetingWaitingDownload(recording)) return "待同步";
  if (isTencentMeetingWaitingTranscript(recording)) return "待腾讯转写";
  if (recording?.status === "failed") return "转写失败";
  if (recording?.transcriptHealth?.isFallback || recording?.status === "pending_retry") return "待重转";
  if (recording?.status === "ready") return "已转写";
  return "处理中";
}

export function recordingDetailStatusLabel(recording) {
  if (isTencentMeetingNoTranscript(recording)) return "腾讯无文字";
  if (isTencentMeetingWaitingDownload(recording)) return "等待同步";
  if (isTencentMeetingWaitingTranscript(recording)) return "等待腾讯文字";
  if (recording?.status === "ready") return "转写完成";
  if (recording?.status === "failed") return "转写失败";
  return "服务处理中";
}

export function recordingDurationLabel(recording) {
  if (isTencentMeetingWaitingDownload(recording) && !recording?.durationMs) return "待同步";
  return formatDuration(recording?.durationMs || 0);
}

export function recordDateToneClass(recording, isTrashView = false) {
  if (isTrashView) return "date-ready";
  if (
    recording?.status === "failed" ||
    recording?.status === "pending_retry" ||
    recording?.transcriptHealth?.isFallback ||
    isTencentMeetingNoTranscript(recording)
  ) {
    return "date-failed";
  }
  if (
    recording?.status === "uploading" ||
    recording?.status === "uploaded" ||
    recording?.status === "queued" ||
    recording?.status === "pending" ||
    recording?.status === "processing" ||
    recording?.status === "transcribing" ||
    isTencentMeetingWaitingDownload(recording) ||
    isTencentMeetingWaitingTranscript(recording)
  ) {
    return "date-processing";
  }
  return "date-ready";
}

export function recordVisualClass(recording = {}) {
  const sourceClass = isTencentMeetingRecorderPen(recording) ? " visual-tencent-recorder" : "";
  const text = `${recording.name || ""} ${recording.tag || ""} ${recording.transcriptText || ""}`.toLowerCase();
  if (recording.status === "failed" || recording.transcriptHealth?.isFallback) return `visual-voice${sourceClass}`;
  if (recording.status && recording.status !== "ready") return `visual-listening${sourceClass}`;
  if (/ppt|文档|文本|材料|汇报|方案|报告|brief|pdf|txt/.test(text)) return `visual-keyboard${sourceClass}`;
  if (/ai|模型|数据|知识库|系统|技术|平台|云|算法|接口/.test(text)) return `visual-listening${sourceClass}`;
  if (/会议|讨论|沟通|物业|项目|需求|目标|结论|待办/.test(text)) return `visual-dots${sourceClass}`;
  return recording.shared !== false ? `visual-voice${sourceClass}` : `visual-dots${sourceClass}`;
}

export function recordSourceMeta(recording = {}) {
  const sourceKind = String(recording?.tencentMeeting?.sourceKind || recording?.tencentMeetingSourceKind || "").toLowerCase();
  if (recording?.tencentMeeting?.imported && sourceKind === "recorder") {
    return { className: "source-recorder", label: "录音笔" };
  }
  if (recording?.tencentMeeting?.imported) {
    return { className: "source-meeting", label: "腾讯会议" };
  }
  return { className: "source-upload", label: "上传文件" };
}

export function transcriptTextForRecording(recording) {
  return (
    recording?.transcriptText ||
    (recording?.transcript || [])
      .map((line) => `[${formatTimecode(line.startMs)}] ${line.speakerName || recording.speakerName || ""} ${line.text}`)
      .join("\n")
  );
}

export function transcriptPlainTextForRecording(recording) {
  const header = [
    recording?.name || "录音转写",
    `时间：${formatDate(recording?.createdAt)}`,
    `时长：${formatDuration(recording?.durationMs || 0)}`,
    "",
  ];
  const lines = (recording?.transcript || []).length
    ? recording.transcript.map((line) => `[${formatTimecode(line.startMs)}] ${line.speakerName || recording.speakerName || "说话人"}：${line.text || ""}`)
    : [transcriptTextForRecording(recording) || "暂无转写内容"];
  return `${header.concat(lines).join("\n")}\n`;
}

export function transcriptTextFileForRecording(recording) {
  return new File([transcriptPlainTextForRecording(recording)], `${safeFileName(recording?.name)}.txt`, {
    type: "text/plain;charset=utf-8",
  });
}

export function recordingListSignature(recordings = []) {
  return recordings
    .map((recording) =>
      [
        recording.id,
        recording.updatedAt,
        recording.status,
        recording.name,
        recording.durationMs || 0,
        recording.tag || "",
        recording.favorite ? 1 : 0,
        recording.shared === false ? 0 : 1,
        recording.ownerName || "",
        recording.canManage === false ? 0 : 1,
        recording.folderId || "",
        recording.deletedAt || "",
        recording.transcript?.length || 0,
        recording.transcriptText?.length || 0,
        recording.errorMessage || "",
        recording.meetingOutlineStatus || "",
        recording.meetingOutlinedAt || "",
        recording.meetingOutlineError || "",
      ].join(":"),
    )
    .join("|");
}

export function isFreshUploadLikeRecording(recording) {
  if (!recording?.id || recording.deletedAt) return false;
  if (!recording.transcriptHealth?.apiSourceAllowed) return false;
  const status = String(recording.status || "");
  if (!["uploaded", "uploading", "queued", "pending", "processing", "transcribing"].includes(status)) return false;
  const timestamp = Date.parse(recording.updatedAt || recording.createdAt || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < 90 * 1000;
}

export function mergeFreshUploadRecordings(nextRecordings = [], currentRecordings = [], removedIds = new Set()) {
  const nextIds = new Set(nextRecordings.map((recording) => recording.id));
  const carry = currentRecordings.filter(
    (recording) => !nextIds.has(recording.id) && !removedIds.has(recording.id) && isFreshUploadLikeRecording(recording),
  );
  if (!carry.length) return nextRecordings;
  return [...nextRecordings, ...carry].sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
}

export function speakersForRecording(recording) {
  if (recording?.speakers?.length) return recording.speakers;
  return [
    {
      key: "speaker-1",
      name: recording?.speakerName || "说话人 1",
      totalMs: recording?.durationMs || 0,
      segmentCount: recording?.transcript?.length || 0,
    },
  ];
}

export function speakerDraftsForRecording(recording) {
  const speakerMap = recording?.speakerMap || {};
  return Object.fromEntries(speakersForRecording(recording).map((speaker) => [speaker.key, speakerMap[speaker.key] || speaker.name]));
}

export function readStoredJson(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

export function getStoredAuth() {
  try {
    const auth = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "{}");
    if (!auth?.token || Number(auth.expiresAt || 0) < Date.now()) {
      if (auth?.token) window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

export function saveStoredAuth(auth) {
  if (!auth?.token) return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getDetectedWecomName() {
  const profile = getLocalProfile();
  return String(profile.wecomName || profile.wecomUserName || profile.wecomNickname || profile.wecomNickName || "").trim();
}

export function getAccountDisplayName(profile = getLocalProfile()) {
  const auth = getStoredAuth();
  return String(auth?.account?.username || auth?.profile?.username || profile.username || "").trim();
}

export function getClientName() {
  const profile = getLocalProfile();
  return getAccountDisplayName(profile) || getDetectedWecomName() || String(profile.name || "").trim() || "未设置姓名";
}

export function profileStorageKey(clientId = getClientId()) {
  return `${PROFILE_STORAGE_KEY}:${clientId || "local"}`;
}

export function getClientId() {
  const auth = getStoredAuth();
  if (auth?.account?.clientId) return auth.account.clientId;
  if (auth?.profile?.clientId) return auth.profile.clientId;
  const key = "wecomRecorderClientId";
  let clientId = window.localStorage.getItem(key);
  if (!clientId) {
    clientId = `client-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    window.localStorage.setItem(key, clientId);
  }
  return clientId;
}

export function getLocalProfile() {
  const clientId = getClientId();
  const key = profileStorageKey(clientId);
  const profile = readStoredJson(key);
  if (Object.keys(profile).length > 0) return profile;

  const legacyProfile = readStoredJson(PROFILE_STORAGE_KEY);
  if (Object.keys(legacyProfile).length > 0) {
    const migrated = { ...legacyProfile, clientId };
    try {
      window.localStorage.setItem(key, JSON.stringify(migrated));
    } catch (error) {
      console.warn("Profile migration skipped:", error);
    }
    return migrated;
  }

  return {};
}

export function saveLocalProfile(profile) {
  const clientId = getClientId();
  const next = { ...(profile || {}), clientId, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(profileStorageKey(clientId), JSON.stringify(next));
  } catch (error) {
    console.warn("Profile storage is full:", error);
  }
}

export function sharedProfileDefaults(profile = {}) {
  const {
    name,
    avatarUrl,
    wecomName,
    wecomUserName,
    wecomNickname,
    wecomNickName,
    wecomUserId,
    phone,
    ...rest
  } = profile || {};
  return rest;
}

export function openRecordingRecoveryDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = window.indexedDB.open(RECORDING_RECOVERY_DB, RECORDING_RECOVERY_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDING_RECOVERY_STORE)) {
        const store = db.createObjectStore(RECORDING_RECOVERY_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export function normalizeRecordingSessionManifest(manifest) {
  if (!manifest?.id) return null;
  const segments = Array.isArray(manifest.segments)
    ? manifest.segments
        .filter((segment) => segment?.id)
        .map((segment) => ({
          id: segment.id,
          sessionId: segment.sessionId || manifest.id,
          index: Math.max(0, Number(segment.index || 0)),
          durationMs: Math.max(0, Number(segment.durationMs || 0)),
          size: Math.max(0, Number(segment.size || 0)),
          mimeType: segment.mimeType || "audio/webm",
          createdAt: segment.createdAt || manifest.updatedAt || manifest.createdAt || new Date().toISOString(),
        }))
        .sort((a, b) => a.index - b.index)
    : [];
  return {
    id: manifest.id,
    startedAt: manifest.startedAt || manifest.createdAt || new Date().toISOString(),
    createdAt: manifest.createdAt || manifest.startedAt || new Date().toISOString(),
    updatedAt: manifest.updatedAt || new Date().toISOString(),
    clientId: manifest.clientId || getClientId(),
    clientName: manifest.clientName || getClientName(),
    status: manifest.status || "recording",
    name: manifest.name || "",
    segments,
  };
}

export function readRecordingRecoveryQueue() {
  try {
    const raw = window.localStorage.getItem(RECORDING_SESSION_QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const queue = Array.isArray(parsed) ? parsed : [];
    const deduped = new Map();
    for (const manifest of queue) {
      const normalized = normalizeRecordingSessionManifest(manifest);
      if (!normalized?.id) continue;
      const previous = deduped.get(normalized.id);
      if (!previous || String(normalized.updatedAt || "").localeCompare(String(previous.updatedAt || "")) >= 0) {
        deduped.set(normalized.id, normalized);
      }
    }
    return [...deduped.values()].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  } catch {
    return [];
  }
}

export function readRecordingSessionManifest() {
  try {
    const raw = window.localStorage.getItem(RECORDING_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const manifest = JSON.parse(raw);
    if (!manifest?.id) return null;
    const queued = readRecordingRecoveryQueue().find((item) => item.id === manifest.id);
    return queued ? { ...manifest, ...queued, segments: queued.segments || manifest.segments || [] } : manifest;
  } catch {
    return null;
  }
}

export function writeRecordingRecoveryQueue(queue) {
  const normalized = [];
  const seen = new Set();
  for (const manifest of Array.isArray(queue) ? queue : []) {
    const item = normalizeRecordingSessionManifest(manifest);
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push(item);
  }
  window.localStorage.setItem(RECORDING_SESSION_QUEUE_STORAGE_KEY, JSON.stringify(normalized));
}

export function upsertRecordingRecoveryManifest(manifest) {
  const normalized = normalizeRecordingSessionManifest(manifest);
  if (!normalized?.id) return null;
  const queue = readRecordingRecoveryQueue().filter((item) => item.id !== normalized.id);
  queue.push(normalized);
  writeRecordingRecoveryQueue(queue);
  return normalized;
}

export function removeRecordingRecoveryManifest(sessionId) {
  if (!sessionId) return;
  writeRecordingRecoveryQueue(readRecordingRecoveryQueue().filter((manifest) => manifest.id !== sessionId));
}

export function readRecoverableRecordingManifests() {
  const queue = readRecordingRecoveryQueue();
  const active = (() => {
    try {
      const raw = window.localStorage.getItem(RECORDING_SESSION_STORAGE_KEY);
      return raw ? normalizeRecordingSessionManifest(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  })();
  const byId = new Map(queue.map((manifest) => [manifest.id, manifest]));
  if (active?.id && !byId.has(active.id)) byId.set(active.id, active);

  return [...byId.values()]
    .filter((manifest) => (manifest.segments || []).length > 0)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export function writeRecordingSessionManifest(manifest, options = {}) {
  if (!manifest?.id) return;
  const normalized = upsertRecordingRecoveryManifest(manifest);
  if (normalized && options.setActive !== false) {
    window.localStorage.setItem(RECORDING_SESSION_STORAGE_KEY, JSON.stringify(normalized));
  }
}

export function clearRecordingSessionManifest(sessionId = "") {
  if (!sessionId) {
    window.localStorage.removeItem(RECORDING_SESSION_STORAGE_KEY);
    return;
  }
  try {
    const raw = window.localStorage.getItem(RECORDING_SESSION_STORAGE_KEY);
    const active = raw ? JSON.parse(raw) : null;
    if (!active?.id || active.id === sessionId) window.localStorage.removeItem(RECORDING_SESSION_STORAGE_KEY);
  } catch {
    window.localStorage.removeItem(RECORDING_SESSION_STORAGE_KEY);
  }
}

export function dailyBriefMeetingCount(brief, fallback = 0) {
  const value = Number(brief?.meetingCount);
  return Number.isFinite(value) ? value : fallback;
}

export function fetchWithClient(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: mergeRequestHeaders(options.headers),
  });
}

export function dailyBriefDisplayDate(brief) {
  return brief?.displayDate || displayDateFromDateKey(brief?.date);
}
