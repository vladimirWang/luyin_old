import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FastForward,
  FileAudio,
  FileUp,
  FolderPlus,
  Heart,
  Home,
  ImagePlus,
  Keyboard,
  Link,
  ListMusic,
  LoaderCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Send,
  Settings,
  Share2,
  Star,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  X,
} from "lucide-react";

const cardColors = ["coral", "indigo", "violet", "teal", "clay", "ink"];
const RECORDING_DATA_SLICE_MS = 60 * 1000;
const RECORDING_AUTOSAVE_CHUNK_MS = 5 * 60 * 1000;
const RECORDING_ROLLOVER_MS = 10 * 60 * 1000;
const RECORDING_WATCHDOG_MS = 5 * 1000;
const LONG_RECORDING_DIRECT_UPLOAD_LIMIT = 80;
const LONG_RECORDING_UPLOAD_BATCH_SIZE = 48;
const RECORDING_RECOVERY_DB = "wecomRecorderRecordingRecovery";
const RECORDING_RECOVERY_STORE = "segments";
const RECORDING_RECOVERY_VERSION = 1;
const RECORDING_SESSION_STORAGE_KEY = "wecomRecorderActiveRecordingSession";
const RECORDING_SESSION_QUEUE_STORAGE_KEY = "wecomRecorderRecordingRecoveryQueue";
const QA_ACTIVE_MESSAGE_KEY = "wecomRecorderActiveQaMessage";
const DAILY_BRIEF_ACTIVE_KEY = "wecomRecorderActiveDailyBrief";
const AUTH_STORAGE_KEY = "wecomRecorderAccountAuth";
const AVATAR_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const AVATAR_TARGET_BYTES = 360 * 1024;
const AVATAR_HARD_LIMIT_BYTES = 720 * 1024;
const AVATAR_MAX_DIMENSION = 512;

function formatDuration(ms = 0, precise = false) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  if (!precise) return `${minutes}:${seconds}`;
  const hundredths = String(Math.floor((safeMs % 1000) / 10)).padStart(2, "0");
  return `${minutes}:${seconds},${hundredths}`;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatTimecode(ms) {
  return formatDuration(ms);
}

function formatShortDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatClockTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function isToday(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isEnglishLanguage(language) {
  return /^en/i.test(String(language || ""));
}

function uiText(language, zh, en) {
  return isEnglishLanguage(language) ? en : zh;
}

function safeFileName(name) {
  return String(name || "recording").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "recording";
}

function safeFileNameWithExtension(name, extension) {
  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  const safe = safeFileName(name);
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedSuffix}$`, "i").test(safe) ? safe : `${safe}${suffix}`;
}

function recordTitleSize(name) {
  const length = Array.from(String(name || "")).length;
  if (length >= 34) return "14px";
  if (length >= 28) return "15px";
  if (length >= 22) return "16px";
  if (length >= 16) return "17px";
  if (length >= 10) return "20px";
  return "clamp(21px, 5.8vw, 25px)";
}

function recordVisualClass(recording = {}) {
  const text = `${recording.name || ""} ${recording.tag || ""} ${recording.transcriptText || ""}`.toLowerCase();
  if (recording.status === "failed" || recording.transcriptHealth?.isFallback) return "visual-voice";
  if (recording.status && recording.status !== "ready") return "visual-listening";
  if (/ppt|文档|文本|材料|汇报|方案|报告|brief|pdf|txt/.test(text)) return "visual-keyboard";
  if (/ai|模型|数据|知识库|系统|技术|平台|云|算法|接口/.test(text)) return "visual-listening";
  if (/会议|讨论|沟通|物业|项目|需求|目标|结论|待办/.test(text)) return "visual-dots";
  return recording.shared !== false ? "visual-voice" : "visual-dots";
}

function recordVisualIcon(visualClass = "") {
  return <img className="record-visual-logo" src="/assets/record-dot-logo.png" alt="" draggable="false" />;
}

function transcriptTextForRecording(recording) {
  return (
    recording?.transcriptText ||
    (recording?.transcript || [])
      .map((line) => `[${formatTimecode(line.startMs)}] ${line.speakerName || recording.speakerName || ""} ${line.text}`)
      .join("\n")
  );
}

function transcriptPlainTextForRecording(recording) {
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

function transcriptTextFileForRecording(recording) {
  return new File([transcriptPlainTextForRecording(recording)], `${safeFileName(recording?.name)}.txt`, {
    type: "text/plain;charset=utf-8",
  });
}

function recordingListSignature(recordings = []) {
  return recordings
    .map((recording) =>
      [
        recording.id,
        recording.updatedAt,
        recording.status,
        recording.name,
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

function isUploadableMediaFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    /\.(mp3|m4a|wav|webm|aac|mp4|mov|m4v)$/i.test(name)
  );
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function openDownloadUrl(url, fileName = "") {
  const link = document.createElement("a");
  link.href = url;
  if (fileName) link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isImageFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name);
}

function canvasToBlob(canvas, type, quality) {
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      const bitmap = await window.createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      try {
        const bitmap = await window.createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close?.(),
        };
      } catch {
        // Fall back to an HTMLImageElement below.
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片无法读取"));
      img.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function compressAvatarImage(file) {
  if (!isImageFile(file)) throw new Error("请选择图片文件");
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new Error("图片太大，请重新上传。");

  const image = await loadImageSource(file);
  try {
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (!width || !height) throw new Error("图片无法读取，请重新上传。");

    const cropSize = Math.min(width, height);
    const sourceX = Math.max(0, Math.floor((width - cropSize) / 2));
    const sourceY = Math.max(0, Math.floor((height - cropSize) / 2));
    const outputSizes = [...new Set([Math.min(AVATAR_MAX_DIMENSION, cropSize), 384, 320, 256].filter((size) => size > 0 && size <= cropSize))];
    const qualities = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4];
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前浏览器无法压缩图片，请重新上传更小的图片。");

    let bestBlob = null;
    for (const size of outputSizes) {
      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(image.source, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (!blob) continue;
        if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
        if (blob.size <= AVATAR_TARGET_BYTES) return blobToDataUrl(blob);
      }
    }

    if (bestBlob && bestBlob.size <= AVATAR_HARD_LIMIT_BYTES) return blobToDataUrl(bestBlob);
    throw new Error("图片太大，请重新上传。");
  } finally {
    image.close?.();
  }
}

const QA_TECHNICAL_FALLBACK = "回答内容包含模型中间格式，已自动隐藏。请点击重新生成。";
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

function stripQaInternalIndexMarkers(value) {
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

function looksLikeMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ""));
}

function looksLikeTechnicalAnswerLeak(value) {
  const text = String(value || "");
  return looksLikeMojibake(text) || TECHNICAL_ANSWER_PATTERN.test(text);
}

function cleanQaVisibleText(value, fallback = "") {
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

function cleanAnswerForDisplay(answer) {
  const structured = parseStructuredAnswer(answer);
  if (structured) return structuredAnswerToPlainText(structured) || QA_TECHNICAL_FALLBACK;
  return cleanQaVisibleText(answer, QA_TECHNICAL_FALLBACK);
}

function answerBlocksForDisplay(answer) {
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

function parseStructuredAnswer(answer) {
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
        // Try the next cleanup variant.
      }
    }
  }
  return null;
}

function structuredAnswerFromItem(item) {
  return parseStructuredAnswer(item?.structuredAnswer) || parseStructuredAnswer(item?.answer);
}

function pointLabelForIndex(index) {
  return `观点 ${index + 1}`;
}

function structuredAnswerToPlainText(structured) {
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

function thinkingStepsForMessage(item) {
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
function meetingReportBlocks(markdown = "") {
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

function speakersForRecording(recording) {
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

function speakerDraftsForRecording(recording) {
  const speakerMap = recording?.speakerMap || {};
  return Object.fromEntries(speakersForRecording(recording).map((speaker) => [speaker.key, speakerMap[speaker.key] || speaker.name]));
}

function getSupportedMimeType() {
  if (!window.MediaRecorder) return "";
  const types = ["audio/mp4", "audio/aac", "audio/mpeg", "audio/webm;codecs=opus", "audio/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function audioExtensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  return "webm";
}

function canRequestMicrophone() {
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  return window.isSecureContext || localHosts.includes(window.location.hostname);
}

function microphoneErrorMessage(error) {
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

function recordingUploadErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
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

async function requestMicrophoneStream() {
  const attempts = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    { audio: true },
  ];

  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function openRecordingRecoveryDb() {
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

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

async function putRecordingRecoverySegment(row) {
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).put(row);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write aborted"));
    });
  } finally {
    db.close();
  }
}

async function getRecordingRecoverySegment(id) {
  if (!id) return null;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readonly");
    return (await idbRequest(transaction.objectStore(RECORDING_RECOVERY_STORE).get(id))) || null;
  } finally {
    db.close();
  }
}

async function deleteRecordingRecoverySegment(id) {
  if (!id) return;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).delete(id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB delete failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB delete aborted"));
    });
  } finally {
    db.close();
  }
}

function readRecordingSessionManifest() {
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

function normalizeRecordingSessionManifest(manifest) {
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

function readRecordingRecoveryQueue() {
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

function writeRecordingRecoveryQueue(queue) {
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

function upsertRecordingRecoveryManifest(manifest) {
  const normalized = normalizeRecordingSessionManifest(manifest);
  if (!normalized?.id) return null;
  const queue = readRecordingRecoveryQueue().filter((item) => item.id !== normalized.id);
  queue.push(normalized);
  writeRecordingRecoveryQueue(queue);
  return normalized;
}

function removeRecordingRecoveryManifest(sessionId) {
  if (!sessionId) return;
  writeRecordingRecoveryQueue(readRecordingRecoveryQueue().filter((manifest) => manifest.id !== sessionId));
}

function readRecoverableRecordingManifests() {
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

function writeRecordingSessionManifest(manifest, options = {}) {
  if (!manifest?.id) return;
  const normalized = upsertRecordingRecoveryManifest(manifest);
  if (normalized && options.setActive !== false) {
    window.localStorage.setItem(RECORDING_SESSION_STORAGE_KEY, JSON.stringify(normalized));
  }
}

function clearRecordingSessionManifest(sessionId = "") {
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

async function clearRecordingRecoverySession(sessionId) {
  const targetSessionId = sessionId || "";
  const manifests = targetSessionId ? readRecoverableRecordingManifests().filter((item) => item.id === targetSessionId) : readRecoverableRecordingManifests();
  const segmentIds = manifests
    .flatMap((manifest) => manifest.segments || [])
    .filter((segment) => !targetSessionId || segment.sessionId === targetSessionId)
    .map((segment) => segment.id)
    .filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  if (targetSessionId) removeRecordingRecoveryManifest(targetSessionId);
  else writeRecordingRecoveryQueue([]);
  clearRecordingSessionManifest(targetSessionId);
}

async function clearRecordingRecoveryManifest(manifest) {
  const segmentIds = (manifest?.segments || []).map((segment) => segment.id).filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  removeRecordingRecoveryManifest(manifest?.id);
  clearRecordingSessionManifest(manifest?.id);
}

async function requestPersistentRecordingStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Long recording still works without persistent storage; this only reduces mobile cleanup risk.
  }
}

function getClientId() {
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

const PROFILE_STORAGE_KEY = "wecomRecorderProfile";

function getStoredAuth() {
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

function saveStoredAuth(auth) {
  if (!auth?.token) return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function profileStorageKey(clientId = getClientId()) {
  return `${PROFILE_STORAGE_KEY}:${clientId || "local"}`;
}

function readStoredJson(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function getLocalProfile() {
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

function saveLocalProfile(profile) {
  const clientId = getClientId();
  const next = { ...(profile || {}), clientId, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(profileStorageKey(clientId), JSON.stringify(next));
  } catch (error) {
    console.warn("Profile storage is full:", error);
  }
}

function sharedProfileDefaults(profile = {}) {
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

function getDetectedWecomName() {
  const profile = getLocalProfile();
  return String(profile.wecomName || profile.wecomUserName || profile.wecomNickname || profile.wecomNickName || "").trim();
}

function getAccountDisplayName(profile = getLocalProfile()) {
  const auth = getStoredAuth();
  return String(auth?.account?.username || auth?.profile?.username || profile.username || "").trim();
}

function getClientName() {
  const profile = getLocalProfile();
  return getAccountDisplayName(profile) || getDetectedWecomName() || String(profile.name || "").trim() || "未设置姓名";
}

function getWecomUserId() {
  const profile = getLocalProfile();
  return String(profile.wecomUserId || "").trim();
}

function mergeRequestHeaders(headers = {}) {
  const next = new Headers(headers);
  const clientName = getClientName();
  const wecomName = getDetectedWecomName();
  const auth = getStoredAuth();
  next.set("X-Client-Id", getClientId());
  next.set("X-Client-Name", encodeURIComponent(clientName));
  if (auth?.token) next.set("X-Auth-Token", auth.token);
  const wecomUserId = getWecomUserId();
  if (wecomUserId) next.set("X-Wecom-User-Id", encodeURIComponent(wecomUserId));
  if (wecomName) next.set("X-Wecom-User-Name", encodeURIComponent(wecomName));
  return next;
}

function appendUrlParam(url, key, value) {
  if (!value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function mediaRequestUrl(url, version = "") {
  const auth = getStoredAuth();
  return appendUrlParam(appendUrlParam(appendUrlParam(url, "clientId", getClientId()), "authToken", auth?.token || ""), "v", version);
}

function fetchWithClient(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: mergeRequestHeaders(options.headers),
  });
}

function isWecomWebView() {
  return /wxwork|wecom|micromessenger/i.test(navigator.userAgent);
}

function readWecomNameHintFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return [
    params.get("wecomName"),
    params.get("wwName"),
    params.get("userName"),
    params.get("user_name"),
    params.get("realName"),
    params.get("realname"),
    params.get("memberName"),
    params.get("wxworkName"),
    params.get("nickname"),
    params.get("name"),
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: mergeRequestHeaders(options.headers),
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

function getAudioFileDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement(String(file?.type || "").startsWith("video/") ? "video" : "audio");
    const objectUrl = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    }, 2500);

    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      URL.revokeObjectURL(objectUrl);
      resolve(durationMs);
    };
    audio.onerror = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
  });
}

function IconButton({ label, children, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`} type="button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

function WaveCanvas({ active, level }) {
  const canvasRef = useRef(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frame = 0;
    let rafId = 0;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * ratio;
      const height = canvas.clientHeight * ratio;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);
      context.lineWidth = 2 * ratio;
      context.lineCap = "round";

      const centerY = height * 0.5;
      const baseAmplitude = activeRef.current ? 0.16 + levelRef.current * 0.58 : 0.16;
      const lineCount = 44;

      for (let i = 0; i < lineCount; i += 1) {
        const progress = i / (lineCount - 1);
        const red = Math.round(235 - progress * 92);
        const green = Math.round(86 + progress * 42);
        const blue = Math.round(90 + progress * 150);
        const phase = frame * (activeRef.current ? 0.04 : 0.012) + i * 0.12;
        const amplitude = height * baseAmplitude * (0.84 + Math.sin(frame * 0.02 + i * 0.18) * 0.15);
        const offset = (i - lineCount / 2) * height * 0.005;

        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, 0.88)`;
        context.beginPath();

        for (let x = -width * 0.08; x <= width * 1.08; x += width / 130) {
          const nx = x / width;
          const envelope =
            Math.sin(Math.PI * Math.min(1, Math.max(0, nx))) *
            (0.62 + 0.38 * Math.sin(nx * Math.PI * 2 + frame * 0.008));
          const wave =
            Math.sin(nx * Math.PI * 2.25 + phase) * envelope +
            Math.sin(nx * Math.PI * 4.1 - phase * 0.45) * 0.16;
          const y = centerY + wave * amplitude + offset;

          if (x === -width * 0.08) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.stroke();
      }

      context.strokeStyle = "rgba(61, 126, 226, 0.85)";
      context.lineWidth = 2 * ratio;
      const markerX = width * 0.5;
      context.beginPath();
      context.moveTo(markerX, height * 0.2);
      context.lineTo(markerX, height * 0.78);
      context.stroke();

      context.fillStyle = "rgba(61, 126, 226, 0.95)";
      context.beginPath();
      context.moveTo(markerX - 9 * ratio, height * 0.19);
      context.lineTo(markerX + 9 * ratio, height * 0.19);
      context.lineTo(markerX, height * 0.25);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(markerX - 9 * ratio, height * 0.8);
      context.lineTo(markerX + 9 * ratio, height * 0.8);
      context.lineTo(markerX, height * 0.74);
      context.closePath();
      context.fill();

      frame += 1;
      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <canvas ref={canvasRef} className="wave-canvas" aria-label="录音波形" />;
}

function RecorderView({ elapsedMs, isRecording, level, recordingError, onToggleRecording }) {
  const ringLevel = isRecording ? Math.max(0.04, Math.min(1, level)) : 0;

  return (
    <section className="screen recorder-screen" aria-label="录音">
      <div className="wave-stage">
        <WaveCanvas active={isRecording} level={level} />
      </div>

      <div className="record-time">{formatDuration(elapsedMs, true)}</div>
      <div className="record-message-stack">
        {recordingError ? <div className="inline-alert">{recordingError}</div> : null}
      </div>

      <div className={isRecording ? "mic-zone recording" : "mic-zone"} style={{ "--level": ringLevel }}>
        <span className="pulse-ring ring-one" />
        <span className="pulse-ring ring-two" />
        <span className="pulse-ring ring-three" />
        <button className="record-button" type="button" onClick={onToggleRecording} aria-label={isRecording ? "停止录音" : "开始录音"}>
          {isRecording ? <span className="end-label">结束</span> : <Mic className="mic-logo" size={56} strokeWidth={2.1} />}
        </button>
      </div>
    </section>
  );
}

function RecordCard({
  recording,
  folders,
  isTrashView,
  isExpanded,
  isDeleting = false,
  onToggleExpand,
  onAsk,
  onRename,
  onUpdateMeta,
  onMove,
  onToggleFavorite,
  onRetranscribe,
  onDelete,
  onRestore,
  onPermanentDelete,
}) {
  const [draftName, setDraftName] = useState(recording.name);
  const [draftTag, setDraftTag] = useState(recording.tag || "");
  const color = cardColors[(recording.seq - 1) % cardColors.length];
  const visualClass = recordVisualClass(recording);
  const canRetranscribe =
    !isTrashView &&
    recording.canManage !== false &&
    (recording.status === "failed" || recording.transcriptHealth?.isFallback);
  const ownerLabel = recording.ownerName && recording.ownerName !== "未设置姓名" ? recording.ownerName : getClientName();

  useEffect(() => {
    setDraftName(recording.name);
    setDraftTag(recording.tag || "");
  }, [recording.name, recording.tag]);

  function commitName() {
    const next = draftName.trim();
    if (next && next !== recording.name) onRename(next);
    else setDraftName(recording.name);
  }

  function commitMeta() {
    const tag = draftTag.trim();
    if (tag !== (recording.tag || "")) {
      onUpdateMeta({ tag });
    }
    setDraftTag(tag);
  }

  return (
    <article
      className={`record-card ${color} ${visualClass}${isTrashView ? " in-trash" : ""}${isExpanded ? " expanded" : ""}${isDeleting ? " is-deleting" : ""}${isToday(recording.createdAt) ? " is-today" : ""}`}
      onClick={isDeleting ? undefined : onToggleExpand}
      style={{ "--record-title-size": recordTitleSize(draftName) }}
      aria-busy={isDeleting}
    >
      <div className="record-card-top">
        <span className="record-number">{formatShortDate(recording.createdAt)}</span>
        <span className={`status-dot ${recording.status}`}>
          {isTrashView
            ? "回收站"
            : recording.status === "failed"
              ? "转写失败"
              : recording.transcriptHealth?.isFallback
                ? "待重转"
                : recording.status === "ready"
                  ? "已转写"
                  : "处理中"}
        </span>
      </div>

      <div className="record-visual" aria-hidden="true">
        <span>{recordVisualIcon(visualClass)}</span>
      </div>

      <textarea
        className="record-title-input"
        aria-label="录音名称"
        rows={3}
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitName}
        disabled={isDeleting}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onClick={(event) => event.stopPropagation()}
      />

      <div className="record-meta">
        <span>{formatClockTime(recording.createdAt)}</span>
        <span>{formatDuration(recording.durationMs)}</span>
      </div>

      <div className="card-mark-row" onClick={(event) => event.stopPropagation()}>
        <textarea
          aria-label="录音标记"
          rows={1}
          value={draftTag}
          onChange={(event) => setDraftTag(event.target.value)}
          onBlur={commitMeta}
          disabled={isDeleting}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="标记"
        />
      </div>

      <div className="record-card-details" onClick={(event) => event.stopPropagation()}>
        <select
          className="folder-select"
          aria-label="录音文件夹"
          value={recording.folderId || ""}
          onChange={(event) => onMove(event.target.value || null)}
          disabled={isTrashView || isDeleting}
        >
          <option value="">未分类</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>

        <div className="record-owner-badge" title={ownerLabel}>
          <UserRound size={12} />
          <span>{ownerLabel}</span>
        </div>
      </div>

      {!isTrashView && recording.canManage !== false ? (
        <label className="record-share-toggle" onClick={(event) => event.stopPropagation()}>
          <span>{recording.shared !== false ? "共享录音" : "仅自己"}</span>
          <input
            type="checkbox"
            checked={recording.shared !== false}
            onChange={(event) => onUpdateMeta({ shared: event.target.checked })}
            disabled={isDeleting}
          />
          <i aria-hidden="true" />
        </label>
      ) : null}

      <div className={`card-actions${canRetranscribe ? " has-retranscribe" : ""}`} onClick={(event) => event.stopPropagation()}>
        {isTrashView ? (
          <>
            <IconButton label="恢复录音" onClick={onRestore} disabled={isDeleting}>
              <RefreshCw size={18} />
            </IconButton>
            <IconButton label={isDeleting ? "删除中" : "彻底删除"} onClick={isDeleting ? undefined : onPermanentDelete} disabled={isDeleting}>
              {isDeleting ? <LoaderCircle className="spin-icon" size={18} /> : <Trash2 size={18} />}
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label={recording.favorite ? "取消收藏" : "收藏"} onClick={onToggleFavorite} disabled={isDeleting}>
              <Heart size={18} fill={recording.favorite ? "currentColor" : "none"} />
            </IconButton>
            {canRetranscribe ? (
              <IconButton label="重新转写" onClick={onRetranscribe} disabled={isDeleting}>
                <RefreshCw size={18} />
              </IconButton>
            ) : null}
            <button className="qa-card-button" type="button" onClick={onAsk} disabled={isDeleting}>
              问答
            </button>
            <IconButton label={isDeleting ? "删除中" : "删除"} onClick={isDeleting ? undefined : onDelete} disabled={isDeleting}>
              {isDeleting ? <LoaderCircle className="spin-icon" size={18} /> : <Trash2 size={18} />}
            </IconButton>
          </>
        )}
      </div>
      {isDeleting ? (
        <div className="record-card-busy" aria-live="polite">
          <LoaderCircle className="spin-icon" size={18} />
          <span>删除中</span>
        </div>
      ) : null}

    </article>
  );
}

function UploadingRecordCard({ item }) {
  return (
    <article className="record-card upload-card is-uploading" aria-label={`${item.name}正在上传`}>
      <div className="record-card-top">
        <span className="record-number">{formatShortDate(item.createdAt)}</span>
        <span className="status-dot uploaded">上传中</span>
      </div>
      <div className="upload-card-title">{item.name || "新录音"}</div>
      <div className="record-meta">
        <span>{formatClockTime(item.createdAt)}</span>
        <span>{formatDuration(item.durationMs)}</span>
      </div>
      <div className="upload-card-progress">
        <LoaderCircle className="spin-icon" size={20} />
        <span>{item.message || "正在上传服务器，请不要重复选择"}</span>
      </div>
    </article>
  );
}

function RecordPreviewOverlay({ recording, onClose, onAsk, onShare, onRetranscribe }) {
  const audioRef = useRef(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareBusyMode, setShareBusyMode] = useState("");
  const [openSection, setOpenSection] = useState("");
  const [meetingOutline, setMeetingOutline] = useState(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCurrent, setPreviewCurrent] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(recording?.durationMs ? recording.durationMs / 1000 : 0);

  useEffect(() => {
    setOpenSection("");
    setPreviewPlaying(false);
    setPreviewCurrent(0);
    setPreviewDuration(recording?.durationMs ? recording.durationMs / 1000 : 0);
  }, [recording?.id, recording?.durationMs]);

  useEffect(() => {
    setMeetingOutline(recording?.meetingOutline || null);
    setOutlineError(recording?.meetingOutlineError || "");
    setOutlineLoading(recording?.meetingOutlineStatus === "generating");
  }, [
    recording?.id,
    recording?.meetingOutline,
    recording?.meetingOutlineStatus,
    recording?.meetingOutlineError,
  ]);

  const transcriptLines = recording?.transcript || [];
  const isTranscribing = ["uploading", "processing", "transcribing"].includes(recording?.status);
  const canRetranscribe =
    recording?.canManage !== false &&
    typeof onRetranscribe === "function" &&
    (recording?.status === "failed" ||
      recording?.transcriptHealth?.isFallback ||
      (transcriptLines.length === 0 && !isTranscribing));
  const outlineCount = meetingOutline
    ? (meetingOutline.sections?.length || 0) +
      (meetingOutline.mainPoints?.length || 0) +
      (meetingOutline.keyPoints?.length || 0) +
      (meetingOutline.decisions?.length || 0) +
      (meetingOutline.actionItems?.length || 0) +
      (meetingOutline.risks?.length || 0)
    : 0;

  function seekTo(ms) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, ms / 1000);
    audio.play().catch(() => {});
  }

  function togglePreviewPlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function handlePreviewSeek(event) {
    const audio = audioRef.current;
    const next = Number(event.target.value || 0);
    setPreviewCurrent(next);
    if (audio) audio.currentTime = next;
  }

  async function loadMeetingOutline(forceRefresh = false) {
    if (!recording || outlineLoading || transcriptLines.length === 0) return;
    if (!forceRefresh && meetingOutline) return;
    setOutlineLoading(true);
    setOutlineError("");
    try {
      const payload = await api(`/api/recordings/${encodeURIComponent(recording.id)}/meeting-outline`, {
        method: forceRefresh ? "POST" : "GET",
      });
      if (payload.status === "generating" && !payload.outline) {
        setOutlineLoading(true);
        return;
      }
      setMeetingOutline(payload.outline || null);
      setOutlineLoading(false);
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : "会议提纲生成失败");
      setOutlineLoading(false);
    }
  }

  useEffect(() => {
    if (recording?.status === "ready" && transcriptLines.length > 0) {
      setOpenSection("outline");
    }
  }, [recording?.id, recording?.status, transcriptLines.length]);

  useEffect(() => {
    if (!recording?.id || recording.meetingOutlineStatus !== "generating") return undefined;
    setOutlineLoading(true);
    const interval = window.setInterval(async () => {
      try {
        const payload = await api(`/api/recordings/${encodeURIComponent(recording.id)}`);
        const nextRecording = payload.recording;
        if (!nextRecording) return;
        if (nextRecording.meetingOutline) setMeetingOutline(nextRecording.meetingOutline);
        setOutlineError(nextRecording.meetingOutlineError || "");
        setOutlineLoading(nextRecording.meetingOutlineStatus === "generating");
      } catch {
        // The list-level poll will try again.
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [recording?.id, recording?.meetingOutlineStatus]);

  if (!recording) return null;

  function toggleSection(section) {
    const next = openSection === section ? "" : section;
    setOpenSection(next);
    if (next === "outline" && !meetingOutline && recording?.meetingOutlineStatus !== "generating") {
      loadMeetingOutline();
    }
  }

  function renderMeetingGroup(title, items = [], emptyText = "") {
    if (!items.length) return emptyText ? <p className="record-preview-empty">{emptyText}</p> : null;
    return (
      <div className="meeting-outline-group">
        <h3>{title}</h3>
        {items.map((item, index) => (
          <button
            className="meeting-outline-item"
            key={`${title}-${item.title}-${index}`}
            type="button"
            onClick={() => seekTo(item.startMs || 0)}
          >
            <span>{formatTimecode(item.startMs || 0)}</span>
            <strong>{item.title}</strong>
            <p>
              {item.summary}
              {item.owner ? ` 负责人：${item.owner}` : ""}
              {item.due ? ` 截止：${item.due}` : ""}
            </p>
            {item.evidence ? <small>{item.evidence}</small> : null}
          </button>
        ))}
      </div>
    );
  }

  async function handleShare(mode, event) {
    event.preventDefault();
    event.stopPropagation();
    if (shareBusyMode) return;
    setShareBusyMode(mode);
    try {
      await onShare(mode);
    } finally {
      setShareBusyMode("");
    }
  }

  function handleRetranscribe(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!canRetranscribe) return;
    onRetranscribe();
  }

  return (
    <div className="record-preview-layer" role="dialog" aria-modal="true" aria-label={`${recording.name}转写预览`} onClick={onClose}>
      <section className="record-preview-panel" onClick={(event) => event.stopPropagation()}>
        <header className="record-preview-head">
          <div>
            <span>录音 {String(recording.seq).padStart(3, "0")}</span>
            <h2>{recording.name}</h2>
          </div>
          <button type="button" onClick={onClose}>
            收起
          </button>
        </header>

        <div className="record-preview-body" aria-label="录音内容预览">
          <section className={`preview-section${openSection === "outline" ? " open" : ""}`}>
            <button
              className="preview-section-toggle"
              type="button"
              onClick={() => toggleSection("outline")}
            >
              <span>
                <strong>会议提纲</strong>
                <em>
                  {outlineLoading
                    ? "AI 正在整理"
                    : meetingOutline
                      ? `${outlineCount || 1} 项办公纪要`
                      : transcriptLines.length > 0
                        ? "转写完成后自动生成"
                        : "等待转写后生成"}
                </em>
              </span>
              {openSection === "outline" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {openSection === "outline" ? (
              <div className="meeting-outline-list">
                <div className="meeting-outline-actions">
                  <button type="button" onClick={() => loadMeetingOutline(true)} disabled={outlineLoading || transcriptLines.length === 0}>
                    <RefreshCw size={15} />
                    重新生成会议提纲
                  </button>
                </div>
                {outlineLoading ? (
                  <p className="record-preview-empty">AI 正在分析完整转写，生成会议提纲、主要内容、关键点和待办项。</p>
                ) : outlineError ? (
                  <p className="record-preview-empty">{outlineError}</p>
                ) : meetingOutline ? (
                  <>
                    {meetingOutline.reportMarkdown ? (
                      <article className="meeting-report">
                        {meetingReportBlocks(meetingOutline.reportMarkdown).map((block) => {
                          if (block.type === "heading") return <h3 key={block.id}>{block.text}</h3>;
                          if (block.type === "bullet") return <p className="meeting-report-bullet" key={block.id}>{block.text}</p>;
                          if (block.type === "table") return <p className="meeting-report-table" key={block.id}>{block.text}</p>;
                          return <p key={block.id}>{block.text}</p>;
                        })}
                      </article>
                    ) : (
                      <>
                        <div className="meeting-summary-card">
                          <strong>{meetingOutline.title || "会议纪要"}</strong>
                          <p>{meetingOutline.summary || "AI 已完成会议内容整理。"}</p>
                          <em>{meetingOutline.provider === "local-fallback" ? "本地提纲" : "AI 分析：" + (meetingOutline.model || meetingOutline.provider || "")}</em>
                        </div>
                        {renderMeetingGroup("会议提纲", meetingOutline.sections)}
                        {renderMeetingGroup("主要内容", meetingOutline.mainPoints)}
                        {renderMeetingGroup("关键点", meetingOutline.keyPoints)}
                        {renderMeetingGroup("决议", meetingOutline.decisions)}
                        {renderMeetingGroup("待办项", meetingOutline.actionItems)}
                        {renderMeetingGroup("风险与问题", meetingOutline.risks)}
                      </>
                    )}
                  </>
                ) : (
                  <p className="record-preview-empty">这条录音还没有可用于生成会议提纲的转写内容。</p>
                )}
              </div>
            ) : null}
          </section>

          <section className={`preview-section${openSection === "transcript" ? " open" : ""}`}>
            <button
              className="preview-section-toggle"
              type="button"
              onClick={() => setOpenSection((current) => (current === "transcript" ? "" : "transcript"))}
            >
              <span>
                <strong>逐字转写</strong>
                <em>{transcriptLines.length > 0 ? `${transcriptLines.length} 段文字` : "暂无文字"}</em>
              </span>
              {openSection === "transcript" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {openSection === "transcript" ? (
              <div className="record-preview-transcript" aria-label="详细文字转写">
                {transcriptLines.length > 0 ? (
                  transcriptLines.map((line) => (
                    <button className="record-preview-line" key={line.id} type="button" onClick={() => seekTo(line.startMs)}>
                      <span>{formatTimecode(line.startMs)}</span>
                      <strong>
                        <em>{line.speakerName || recording.speakerName || "说话人"}</em>
                        {line.text}
                      </strong>
                    </button>
                  ))
                ) : (
                  <div className="record-preview-empty-state">
                    <p className="record-preview-empty">这条录音还没有可用的文字转写。</p>
                    {canRetranscribe ? (
                      <button className="record-preview-retry" type="button" onClick={handleRetranscribe}>
                        <RefreshCw size={15} />
                        重新转写
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {recording.translationText ? (
            <section className={`preview-section${openSection === "translation" ? " open" : ""}`}>
              <button
                className="preview-section-toggle"
                type="button"
                onClick={() => setOpenSection((current) => (current === "translation" ? "" : "translation"))}
              >
                <span>
                  <strong>中文翻译</strong>
                  <em>英文录音自动翻译</em>
                </span>
                {openSection === "translation" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {openSection === "translation" ? (
                <div className="record-preview-translation">{recording.translationText}</div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="record-preview-player">
          <audio
            ref={audioRef}
            className="hidden-audio"
            preload="metadata"
            src={mediaRequestUrl(recording.audioUrl, recording.updatedAt || recording.createdAt)}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              setPreviewDuration(Number.isFinite(duration) ? duration : recording.durationMs / 1000 || 0);
            }}
            onTimeUpdate={(event) => setPreviewCurrent(event.currentTarget.currentTime || 0)}
            onPlay={() => setPreviewPlaying(true)}
            onPause={() => setPreviewPlaying(false)}
            onEnded={() => setPreviewPlaying(false)}
          />
          <div className="preview-audio-bar" aria-label="录音播放器">
            <button type="button" onClick={togglePreviewPlay} aria-label={previewPlaying ? "暂停播放" : "播放录音"}>
              {previewPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <span>{formatDuration(previewCurrent * 1000)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, previewDuration)}
              step="0.1"
              value={Math.min(previewCurrent, Math.max(1, previewDuration))}
              onChange={handlePreviewSeek}
              aria-label="播放进度"
            />
            <span>{formatDuration((previewDuration || recording.durationMs / 1000 || 0) * 1000)}</span>
            <Volume2 size={16} />
          </div>
          <div className="record-preview-actions">
            <button className="record-share-main" type="button" onClick={() => setShareMenuOpen((current) => !current)}>
              <Share2 size={15} />
              分享
            </button>
            <button type="button" onClick={onAsk}>
              问答
            </button>
          </div>
          {shareMenuOpen ? (
            <div className="record-share-options" aria-label="分享内容选择" onClick={(event) => event.stopPropagation()}>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("outline", event)}>
                {shareBusyMode === "outline" ? "准备中" : "会议提纲 PDF"}
              </button>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("text", event)}>
                {shareBusyMode === "text" ? "准备中" : "文字 TXT"}
              </button>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("audio", event)}>
                {shareBusyMode === "audio" ? "准备中" : "录音 MP3"}
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function RecordsView({
  recordings,
  folders,
  folderStats,
  recordsTitle,
  selectedFolderId,
  query,
  setQuery,
  loading,
  deletingRecordIds = [],
  uploadBusy,
  onOpenSettings,
  onStartRecording,
  onUploadFile,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onSelectFolder,
  onOpenDetail,
  onRename,
  onUpdateMeta,
  onMove,
  onToggleFavorite,
  onRetranscribe,
  onShare,
  onDelete,
  onRestore,
  onPermanentDelete,
  onRefresh,
  onUpdateRecordsTitle,
  language,
}) {
  const searchInputRef = useRef(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recordsTitle || "我的录音");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [expandedRecordingId, setExpandedRecordingId] = useState("");
  const [cardScale, setCardScale] = useState(1);
  const pinchRef = useRef({ distance: 0, scale: 1 });

  useEffect(() => {
    setTitleDraft(recordsTitle || "我的录音");
  }, [recordsTitle]);

  async function submitFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || creatingBusy) return;

    setCreatingBusy(true);
    try {
      await onCreateFolder(name);
      setFolderName("");
      setCreatingFolder(false);
    } finally {
      setCreatingBusy(false);
    }
  }

  function commitTitle() {
    const next = titleDraft.trim() || "我的录音";
    setTitleDraft(next);
    if (next !== (recordsTitle || "我的录音")) onUpdateRecordsTitle(next);
  }

  async function commitFolderRename(folder) {
    const nextName = folderDraft.trim() || folder.label;
    setFolderDraft(nextName);
    if (nextName !== folder.label) await onRenameFolder(folder.id, nextName);
    setEditingFolderId("");
  }

  async function removeFolder(folder) {
    const confirmed = window.confirm(`删除文件夹「${folder.label}」？里面的录音会回到未分类。`);
    if (!confirmed) return;
    await onDeleteFolder(folder.id);
    if (selectedFolderId === folder.id) onSelectFolder("all");
  }

  const folderItems = [
    { id: "all", label: "全部", count: folderStats.totalCount },
    { id: "favorites", label: "收藏夹", count: folderStats.favoriteCount, icon: <Star size={14} /> },
    { id: "uncategorized", label: "未分类", count: folderStats.uncategorizedCount },
    { id: "trash", label: "回收站", count: folderStats.trashCount, icon: <Trash2 size={14} /> },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.count, editable: true })),
  ];
  const collapsedFolderItems = (() => {
    const visible = [folderItems[0]].filter(Boolean);
    const selectedFolder = folderItems.find((folder) => folder.id === selectedFolderId);
    if (selectedFolder && !visible.some((folder) => folder.id === selectedFolder.id)) visible.push(selectedFolder);
    for (const folder of folderItems) {
      if (visible.length >= 3) break;
      if (!visible.some((item) => item.id === folder.id)) visible.push(folder);
    }
    return visible;
  })();
  const canExpandFolders = folderItems.length > collapsedFolderItems.length || folderItems.length > 3;
  const visibleFolderItems = foldersExpanded && canExpandFolders ? folderItems : collapsedFolderItems;
  const previewRecording = recordings.find((item) => item.id === expandedRecordingId && !item.deletedAt) || null;
  const recordColumns = cardScale < 0.62 ? 4 : cardScale < 0.86 ? 3 : 2;
  const compactCards = recordColumns >= 3;
  const denseCards = recordColumns >= 4;

  function touchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    const [first, second] = touches;
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  }

  function handleRecordsTouchStart(event) {
    if (event.touches.length !== 2) return;
    pinchRef.current = { distance: touchDistance(event.touches), scale: cardScale };
  }

  function handleRecordsTouchMove(event) {
    if (event.touches.length !== 2 || !pinchRef.current.distance) return;
    event.preventDefault();
    const ratio = touchDistance(event.touches) / pinchRef.current.distance;
    const nextScale = Math.min(1.06, Math.max(0.5, pinchRef.current.scale * ratio));
    setCardScale(nextScale);
  }

  function handleRecordsTouchEnd(event) {
    if (event.touches.length < 2) pinchRef.current = { distance: 0, scale: cardScale };
  }

  useEffect(() => {
    if (!canExpandFolders && foldersExpanded) setFoldersExpanded(false);
  }, [canExpandFolders, foldersExpanded]);

  return (
    <section className="screen records-screen" aria-label={uiText(language, "我的录音", "My records")}>
      <header className="records-header">
        <div>
          <p className="eyebrow">My Records</p>
          <input
            className="records-title-input"
            aria-label="记录页标题"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div className="header-tools">
          <IconButton label={uiText(language, "搜索", "Search")} onClick={() => searchInputRef.current?.focus()}>
            <Search size={24} />
          </IconButton>
          <IconButton label={uiText(language, "刷新", "Refresh")} onClick={onRefresh}>
            <RefreshCw size={23} />
          </IconButton>
          <IconButton label={uiText(language, "设置", "Settings")} onClick={onOpenSettings}>
            <Settings size={24} />
          </IconButton>
        </div>
      </header>

      <label className="search-bar">
        <Search size={19} />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={uiText(language, "搜索录音编号、名称", "Search number or name")}
        />
      </label>

      <div className="record-actions-row">
        <button type="button" onClick={onUploadFile}>
          {uploadBusy ? <LoaderCircle className="spin-icon" size={18} /> : <Upload size={18} />}
          {uploadBusy ? uiText(language, "上传中", "Uploading") : uiText(language, "上传录音", "Upload")}
        </button>
        <button type="button" onClick={() => setCreatingFolder((current) => !current)}>
          <FolderPlus size={18} />
          {uiText(language, "新建文件夹", "New folder")}
        </button>
      </div>

      {creatingFolder ? (
        <form className="folder-create-form" onSubmit={submitFolder}>
          <input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="输入文件夹名称"
          />
          <button type="submit" disabled={creatingBusy || !folderName.trim()}>
            {creatingBusy ? "创建中" : "创建"}
          </button>
          <IconButton
            label="取消新建文件夹"
            onClick={() => {
              setFolderName("");
              setCreatingFolder(false);
            }}
          >
            <X size={18} />
          </IconButton>
        </form>
      ) : null}

      <div className="folder-area">
        <div className={foldersExpanded && canExpandFolders ? "folder-strip expanded" : "folder-strip collapsed"} aria-label="录音文件夹">
          {visibleFolderItems.map((folder) => {
            const editing = editingFolderId === folder.id;
            return (
              <div className={["folder-chip", selectedFolderId === folder.id ? "active" : ""].filter(Boolean).join(" ")} key={folder.id}>
                {editing ? (
                  <input
                    autoFocus
                    value={folderDraft}
                    onChange={(event) => setFolderDraft(event.target.value)}
                    onBlur={() => commitFolderRename(folder)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setEditingFolderId("");
                        setFolderDraft("");
                      }
                    }}
                    aria-label={folder.label + "文件夹名称"}
                  />
                ) : (
                  <button className="folder-main-button" type="button" onClick={() => onSelectFolder(folder.id)}>
                    {folder.icon}
                    <span className="folder-label">{folder.label}</span>
                    <span className="folder-count">{folder.count}</span>
                  </button>
                )}
                {folder.editable ? (
                  <span className="folder-chip-tools">
                    <button
                      type="button"
                      aria-label={"重命名 " + folder.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (editing) commitFolderRename(folder);
                        else {
                          setEditingFolderId(folder.id);
                          setFolderDraft(folder.label);
                        }
                      }}
                    >
                      {editing ? <Check size={12} /> : <Pencil size={12} />}
                    </button>
                    <button className="folder-delete-button" type="button" aria-label={"删除 " + folder.label} onClick={() => removeFolder(folder)}>
                      <Trash2 size={12} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {canExpandFolders ? (
          <button
            className="folder-expand-button"
            type="button"
            aria-label={foldersExpanded ? "收起文件夹筛选" : "展开文件夹筛选"}
            title={foldersExpanded ? "收起" : "展开"}
            onClick={() => setFoldersExpanded((current) => !current)}
          >
            {foldersExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        ) : null}
      </div>

      <div
        className="records-content"
        onTouchStart={handleRecordsTouchStart}
        onTouchMove={handleRecordsTouchMove}
        onTouchEnd={handleRecordsTouchEnd}
        onTouchCancel={handleRecordsTouchEnd}
      >
        {loading ? (
          <div className="loading-state">
            <LoaderCircle size={28} />
            正在读取服务器录音
          </div>
        ) : recordings.length > 0 ? (
          <div
            className={["record-grid", compactCards ? "compact" : "", denseCards ? "dense" : ""].filter(Boolean).join(" ")}
            style={{
              "--card-scale": cardScale,
              "--record-columns": recordColumns,
              "--record-title-size": String(Math.max(16, Math.round(25 * cardScale))) + "px",
            }}
          >
            {recordings.map((recording) =>
              recording.status === "uploading" ? (
                <UploadingRecordCard key={recording.id} item={recording} />
              ) : (
                <RecordCard
                  key={recording.id}
                  recording={recording}
                  folders={folders}
                  isTrashView={selectedFolderId === "trash"}
                  isExpanded={expandedRecordingId === recording.id}
                  isDeleting={deletingRecordIds.includes(recording.id)}
                  onToggleExpand={() => setExpandedRecordingId((current) => (current === recording.id ? "" : recording.id))}
                  onAsk={() => onOpenDetail(recording.id)}
                  onRename={(name) => onRename(recording.id, name)}
                  onUpdateMeta={(patch) => onUpdateMeta(recording.id, patch)}
                  onMove={(folderId) => onMove(recording.id, folderId)}
                  onToggleFavorite={() => onToggleFavorite(recording)}
                  onRetranscribe={() => onRetranscribe(recording)}
                  onShare={() => onShare(recording)}
                  onDelete={() => onDelete(recording)}
                  onRestore={() => onRestore(recording)}
                  onPermanentDelete={() => onPermanentDelete(recording)}
                />
              ),
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <Mic size={40} />
            </div>
            <h2>{query ? "没有匹配的录音" : "还没有录音"}</h2>
            <p>{query ? "换一个关键词试试。" : "点击下方录音按钮，完成后会上传服务器并生成卡片。"}</p>
            <button className="primary-pill" type="button" onClick={onStartRecording}>
              <Mic size={18} />
              录音
            </button>
          </div>
        )}
      </div>

      {previewRecording && selectedFolderId !== "trash" ? (
        <RecordPreviewOverlay
          recording={previewRecording}
          onClose={() => setExpandedRecordingId("")}
          onAsk={() => {
            setExpandedRecordingId("");
            onOpenDetail(previewRecording.id);
          }}
          onShare={(mode) => onShare(previewRecording, mode)}
          onRetranscribe={() => onRetranscribe(previewRecording)}
        />
      ) : null}
    </section>
  );
}

function todayDisplayDateFallback() {
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0") + "/" + String(now.getDate()).padStart(2, "0");
}

function todayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateKeyFromDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}-${String(safeDate.getDate()).padStart(2, "0")}`;
}

function dateKeyFromRecording(recording) {
  return dateKeyFromDate(recording?.createdAt || recording?.uploadedAt || recording?.updatedAt || Date.now());
}

function displayDateFromDateKey(dateKey) {
  const [, month = "", day = ""] = String(dateKey || "").split("-");
  return month && day ? `${month}/${day}` : todayDisplayDateFallback();
}

function dailyBriefDisplayDate(brief) {
  return brief?.displayDate || displayDateFromDateKey(brief?.date);
}

function dailyBriefMeetingCount(brief, fallback = 0) {
  const value = Number(brief?.meetingCount);
  return Number.isFinite(value) ? value : fallback;
}

function dailyBriefFallbackContent(brief, meetingCount) {
  const displayDate = dailyBriefDisplayDate(brief);
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  if (brief?.status === "generating" || brief?.dirty) {
    return [
      `今日会议简报｜${displayDate}｜正在生成`,
      "",
      "正在生成今日会议简报",
      "系统正在汇总今天上传的录音和会议提纲，生成完成后会自动显示在这里。",
    ].join("\n");
  }
  if (!meetingCount) {
    return [
      `今日会议简报｜${displayDate}｜共 0 场会议`,
      "",
      "一、今日总体结论",
      "今天还没有可总结的录音。",
      "",
      "二、会议列表",
      "暂无会议。",
      "",
      "三、今日重点待办",
      "暂无明确内容。",
    ].join("\n");
  }
  return [
    `今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
    "",
    "一、今日总体结论",
    "今日会议简报正在生成中，生成完成后会自动展示。",
    "",
    "二、会议列表",
    "暂无可展示的会议详情。",
    "",
    "三、今日重点待办",
    "暂无明确内容。",
  ].join("\n");
}

function DailyMeetingBriefCard({ brief, loading, meetingCount, onOpen }) {
  const displayDate = dailyBriefDisplayDate(brief);
  const countText = meetingCount > 0 ? `${meetingCount}场会议` : "暂无会议";
  const hint = meetingCount > 0 ? "点击查看今日核心内容" : "今天还没有可总结的录音";
  return (
    <div className="daily-brief-wrapper">
      <button className="daily-brief-card" type="button" onClick={onOpen} disabled={loading && !brief}>
        <span className="daily-brief-title">今日会议简报</span>
        <span className="daily-brief-subtitle">
          {displayDate} ｜ {countText}
        </span>
        <span className="daily-brief-hint">{loading ? "正在读取今日简报" : hint}</span>
      </button>
    </div>
  );
}

function normalizeDailyBriefTitle(value = "") {
  return cleanQaVisibleText(value, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isDailyBriefRecordingHeading(text = "") {
  return /^\d+[.、]\s*/.test(cleanQaVisibleText(text, ""));
}

function isDailyBriefSectionHeading(text = "") {
  const value = cleanQaVisibleText(text, "");
  return /^(今日会议简报|[一二三四五六七八九十]+、|\d+[.、]\s*)/.test(value);
}

function matchDailyBriefRecordingState(text = "", recordingStates = []) {
  if (!isDailyBriefRecordingHeading(text)) return null;
  const title = normalizeDailyBriefTitle(text);
  if (!title) return null;
  return recordingStates.find((state) => {
    const name = normalizeDailyBriefTitle(state?.name || state?.title || "");
    return name && (title.includes(name) || name.includes(title));
  }) || null;
}

function dailyBriefOutlineWaitingText(state) {
  if (!state || state.hasMeetingOutline || state.meetingOutlineStatus === "ready") return "";
  if (!state.transcriptReady || ["uploaded", "uploading", "processing", "transcribing"].includes(state.status)) {
    return "这条录音还在转写，今日简报先保留位置。转写和会议提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "generating") {
    return "这条录音的会议提纲正在生成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "failed") {
    return "这条录音的会议提纲暂未生成成功，今日简报先保留位置。请先重新转写或生成提纲后再更新。";
  }
  return "这条录音的会议提纲还没有生成完成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
}

function canRefreshDailyBriefRecording(state) {
  return Boolean(state?.canRefreshDailyBriefItem || state?.hasMeetingOutline || state?.meetingOutlineStatus === "ready");
}

function renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading }) {
  if (onSpeakLine) {
    return (
      <button
        className={`${className} daily-brief-line-button ${active ? "active" : ""}`.trim()}
        key={`daily-brief-line-${index}`}
        type="button"
        onClick={(event) => onSpeakLine({ event, text: visibleText, index, itemId, label: heading ? "朗读标题" : "朗读段落" })}
      >
        {visibleText}
      </button>
    );
  }
  return (
    <p className={className} key={`daily-brief-line-${index}`}>
      {visibleText || text}
    </p>
  );
}

function renderDailyBriefLines(markdown = "", options = {}) {
  const {
    speechIdPrefix = "daily-brief-line",
    ttsState,
    onSpeakLine,
    recordingStates = [],
    refreshingRecordingIds,
    briefDate,
    onRefreshRecording,
  } = options;
  const lines = String(markdown || "").split(/\r?\n/);
  let waitingRecordingState = null;

  return lines.flatMap((line, index) => {
    const text = cleanQaVisibleText(line, "");
    const recordingState = matchDailyBriefRecordingState(text, recordingStates);
    const waitingText = dailyBriefOutlineWaitingText(recordingState);

    if (!text) return waitingRecordingState ? [] : [<div className="daily-brief-gap" key={`daily-brief-gap-${index}`} />];
    if (isDailyBriefSectionHeading(text)) waitingRecordingState = waitingText ? recordingState : null;
    else if (waitingRecordingState) return [];

    const heading = isDailyBriefSectionHeading(text);
    const bullet = /^[-*]\s*/.test(text);
    const visibleText = text.replace(/^[-*]\s*/, bullet ? "• " : "");
    const className = heading ? "daily-brief-line heading" : bullet ? "daily-brief-line bullet" : "daily-brief-line";
    const itemId = `${speechIdPrefix}-line-${index}`;
    const active = ttsState?.itemId === itemId && (ttsState.playing || ttsState.loading);
    const lineElement = renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading });

    if (!recordingState) return [lineElement];

    const refreshing = Boolean(refreshingRecordingIds?.has?.(recordingState.id));
    const canRefresh = canRefreshDailyBriefRecording(recordingState) && typeof onRefreshRecording === "function";
    return [
      <div className="daily-brief-recording-heading-row" key={`daily-brief-recording-heading-${index}`}>
        <div className="daily-brief-recording-heading-text">{lineElement}</div>
        {canRefresh ? (
          <button
            className="daily-brief-recording-refresh"
            type="button"
            disabled={refreshing}
            onClick={(event) => onRefreshRecording(recordingState, briefDate, event)}
          >
            {refreshing ? <LoaderCircle className="spin-icon" size={13} /> : <RefreshCw size={13} />}
            <span>{refreshing ? "更新中" : "重新生成此条"}</span>
          </button>
        ) : null}
      </div>,
      waitingText ? (
        <div className="daily-brief-outline-waiting" key={`daily-brief-outline-waiting-${index}`}>
          {waitingText}
        </div>
      ) : null,
    ].filter(Boolean);
  });
}

function DailyMeetingBriefMessage({ message, ttsState, onSpeakLine, onShare, onRefreshRecording, refreshingRecordingIds }) {
  const content = cleanQaVisibleText(message.content || message.answer || "", "") || dailyBriefFallbackContent(null, 0);
  const canShare = message.briefDate && message.status !== "generating";
  const speechIdPrefix = `daily-brief-${message.briefDate || message.id || "message"}`;
  return (
    <article className="daily-brief-message">
      <div className="daily-brief-message-kicker">今日会议简报</div>
      <div className="daily-brief-message-body">
        {renderDailyBriefLines(content, {
          speechIdPrefix,
          ttsState,
          recordingStates: message.recordingStates || [],
          refreshingRecordingIds,
          briefDate: message.briefDate,
          onRefreshRecording,
          onSpeakLine: (line) => onSpeakLine?.(message, line),
        })}
      </div>
      {canShare ? (
        <div className="daily-brief-actions">
          <button type="button" onClick={(event) => onShare?.(message, event)}>
            <Share2 size={13} />
            <span>分享 PDF</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

function dailyBriefListContent(brief, meetingCount = 0, loading = false) {
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  const displayDate = dailyBriefDisplayDate(brief);
  if (loading || brief?.status === "generating") {
    return [
      `今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
      "",
      "正在生成",
      "系统正在汇总当天录音的会议提纲，完成后会自动展示在这张卡片里。",
    ].join("\n");
  }
  if (!meetingCount) {
    return [`会议简报｜${displayDate}`, "", "当天暂无可总结的录音。"].join("\n");
  }
  return [
    `会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
    "",
    "展开后会生成并展示当天录音的核心内容。",
    "你可以朗读内容，也可以在生成完成后分享 PDF。",
  ].join("\n");
}

function dailyBriefHasSummary(brief) {
  return Boolean(cleanQaVisibleText(brief?.summaryMarkdown || "", ""));
}

function DailyBriefListView({
  briefs,
  expandedDates,
  generatingDates,
  ttsState,
  refreshingRecordingIds,
  onToggle,
  onGenerate,
  onSpeak,
  onSpeakLine,
  onShare,
  onRefreshRecording,
}) {
  if (!briefs.length) {
    return (
      <div className="daily-brief-list-empty">
        <strong>还没有会议简报</strong>
        <span>上传录音后，会按日期生成每天一张简报卡。</span>
      </div>
    );
  }

  return (
    <div className="daily-brief-list" aria-label="会议简报列表">
      {briefs.map((brief) => {
        const date = brief.date || "";
        const expanded = expandedDates.has(date);
        const meetingCount = dailyBriefMeetingCount(brief, 0);
        const generating = generatingDates.has(date) || brief.status === "generating";
        const hasSummary = dailyBriefHasSummary(brief);
        const content = dailyBriefListContent(brief, meetingCount, generating);
        const speechId = `daily-brief-${date}`;
        const speaking = ttsState.itemId === speechId && ttsState.playing;
        const speechLoading = ttsState.itemId === speechId && ttsState.loading;

        return (
          <article className={expanded ? "daily-brief-list-card expanded" : "daily-brief-list-card"} key={date || brief.id}>
            <div className="daily-brief-list-header">
              <button className="daily-brief-list-toggle" type="button" onClick={() => onToggle(brief)}>
                <span className="daily-brief-list-date">{dailyBriefDisplayDate(brief)}</span>
                <span className="daily-brief-list-main">
                  <strong>{brief.title || "会议简报"}</strong>
                  <em>{meetingCount ? `${meetingCount} 场会议` : "暂无录音"}</em>
                </span>
                <span className={generating ? "daily-brief-list-status generating" : "daily-brief-list-status"}>
                  {generating ? "生成中" : hasSummary ? "已生成" : "待生成"}
                </span>
                <span className="daily-brief-list-chevron" aria-hidden="true">
                  {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
              </button>
            </div>

            {expanded ? (
              <div className="daily-brief-list-content">
                <div className="daily-brief-list-body">
                  {renderDailyBriefLines(content, {
                    speechIdPrefix: speechId,
                    ttsState,
                    recordingStates: brief.recordingStates || [],
                    refreshingRecordingIds,
                    briefDate: date,
                    onRefreshRecording,
                    onSpeakLine: (line) => onSpeakLine?.(brief, line),
                  })}
                </div>
                <div className="daily-brief-list-actions">
                  {meetingCount > 0 ? (
                    <button type="button" onClick={(event) => onGenerate(brief, event)} disabled={generating}>
                      {generating ? <LoaderCircle className="spin-icon" size={14} /> : <RefreshCw size={14} />}
                      <span>{hasSummary ? "重新生成" : "生成简报"}</span>
                    </button>
                  ) : null}
                  <button type="button" onClick={(event) => onSpeak(brief, event)} disabled={!content.trim()}>
                    {speechLoading ? <LoaderCircle className="spin-icon" size={14} /> : speaking ? <Pause size={14} /> : <Play size={14} />}
                    <span>{speaking ? "停止朗读" : "朗读内容"}</span>
                  </button>
                  <button type="button" onClick={(event) => onShare(brief, event)} disabled={!hasSummary || generating}>
                    <Share2 size={14} />
                    <span>分享 PDF</span>
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function DetailView(props) {
  return <ChatDetailView {...props} />;
}

function ChatDetailView({ recording, recordings = [], onBack, onToast, language, onSelectRecording }) {
  const audioRef = useRef(null);
  const audioSourceRef = useRef("");
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const audioQuestionInputRef = useRef(null);
  const fileQuestionInputRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voicePointerRef = useRef(null);
  const chatThreadRef = useRef(null);
  const chatEndRef = useRef(null);
  const [availableRecordings, setAvailableRecordings] = useState(() => recordings.filter((item) => !item.deletedAt));
  const [scopeIds, setScopeIds] = useState(recording?.id ? [recording.id] : []);
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);
  const [dailyBrief, setDailyBrief] = useState(null);
  const [dailyBriefHistory, setDailyBriefHistory] = useState([]);
  const [dailyBriefLoading, setDailyBriefLoading] = useState(false);
  const [dailyBriefExpanded, setDailyBriefExpanded] = useState(Boolean(recording?.id));
  const [expandedDailyBriefDates, setExpandedDailyBriefDates] = useState(() => new Set());
  const [dailyBriefGeneratingDates, setDailyBriefGeneratingDates] = useState(() => new Set());
  const [dailyBriefRefreshingRecordingIds, setDailyBriefRefreshingRecordingIds] = useState(() => new Set());
  const [qaHistory, setQaHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState("history");
  const [images, setImages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [composerMode, setComposerMode] = useState("text");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [activeCitationKey, setActiveCitationKey] = useState("");
  const activeCitationRef = useRef({ key: "", startMs: 0, endMs: 0 });
  const [citationPlayback, setCitationPlayback] = useState({ key: "", currentMs: 0, durationMs: 0 });
  const [expandedCitationGroups, setExpandedCitationGroups] = useState({});
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const qaPollingRef = useRef(new Map());
  const dailyBriefPollingRef = useRef(new Map());
  const qaConversationViewRef = useRef(Boolean(recording?.id));
  const activeScopeIdsRef = useRef([]);
  const ttsAudioRef = useRef(null);
  const ttsQueueRef = useRef({ itemId: "", segments: [], index: 0 });
  const [ttsState, setTtsState] = useState({ key: "", itemId: "", index: -1, loading: false, playing: false });
  const lockedRecordingId = recording?.id || "";
  const activeScopeIds = lockedRecordingId ? [lockedRecordingId] : scopeIds;
  const scopeKey = activeScopeIds.join("|");
  activeScopeIdsRef.current = activeScopeIds;

  function readActiveQaMessageRef() {
    try {
      const raw = window.localStorage?.getItem(QA_ACTIVE_MESSAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.id ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveActiveQaMessageRef(message) {
    if (!message?.id) return;
    try {
      window.localStorage?.setItem(
        QA_ACTIVE_MESSAGE_KEY,
        JSON.stringify({
          id: message.id,
          recordingIds: messageRecordingIds(message),
          createdAt: message.createdAt || new Date().toISOString(),
          pending: Boolean(message.pending),
        }),
      );
    } catch {}
  }

  function clearActiveQaMessageRef(id) {
    try {
      const current = readActiveQaMessageRef();
      if (!id || current?.id === id) window.localStorage?.removeItem(QA_ACTIVE_MESSAGE_KEY);
    } catch {}
  }

  function enterQaConversationView() {
    qaConversationViewRef.current = true;
  }

  function enterDailyBriefView() {
    qaConversationViewRef.current = false;
    clearActiveQaMessageRef();
  }

  function isDailyBriefViewActive() {
    return !qaConversationViewRef.current;
  }

  function readActiveDailyBriefRef() {
    try {
      const raw = window.localStorage?.getItem(DAILY_BRIEF_ACTIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.date ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveActiveDailyBriefRef(brief) {
    if (!brief?.date) return;
    try {
      window.localStorage?.setItem(
        DAILY_BRIEF_ACTIVE_KEY,
        JSON.stringify({
          date: brief.date,
          updatedAt: brief.updatedAt || new Date().toISOString(),
          status: brief.status || "",
        }),
      );
    } catch {}
  }

  function clearActiveDailyBriefRef(date) {
    try {
      const current = readActiveDailyBriefRef();
      if (!date || current?.date === date) window.localStorage?.removeItem(DAILY_BRIEF_ACTIVE_KEY);
    } catch {}
  }

  function stopTtsQueue() {
    const audio = ttsAudioRef.current;
    ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setCitationPlayback((current) => ({ ...current, durationMs: Math.round((audio.duration || 0) * 1000) }));
    };
    const handleTimeUpdate = () => {
      const currentMs = Math.round((audio.currentTime || 0) * 1000);
      setCitationPlayback((current) => ({ ...current, currentMs }));
      const active = activeCitationRef.current;
      if (active.key && active.endMs && currentMs >= active.endMs) {
        audio.pause();
        setActiveCitationKey("");
        activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
      }
    };
    const handleEnded = () => {
      setActiveCitationKey("");
      activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
    };
    const handlePause = () => {
      if (!activeCitationRef.current.key) setActiveCitationKey("");
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
      audioSourceRef.current = "";
    };
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    ttsAudioRef.current = audio;

    const handlePlay = () => setTtsState((current) => ({ ...current, playing: true, loading: false }));
    const handlePause = () => setTtsState((current) => ({ ...current, playing: false, loading: false }));
    const handleEnded = () => {
      const queue = ttsQueueRef.current;
      if (queue.itemId && queue.segments.length > queue.index + 1) {
        playTtsSegment(queue.itemId, queue.segments, queue.index + 1, true);
        return;
      }
      ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
      setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeAttribute("src");
      audio.load();
      ttsAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    stopTtsQueue();
  }, [recording?.id, scopeKey]);

  useEffect(() => {
    setAvailableRecordings(recordings.filter((item) => !item.deletedAt));
  }, [recordings]);

  useEffect(() => {
    if (lockedRecordingId) {
      enterQaConversationView();
      const nextScope = [lockedRecordingId];
      setScopeIds(nextScope);
      setDailyBriefExpanded(true);
      setAnswers((current) => {
        const history = historyForRecordings(nextScope);
        const known = [...current, ...history, ...qaHistory];
        const visible = current.filter((item) => shouldKeepQaMessageForScope(item, nextScope, known));
        return mergeQaMessages(history, visible).slice(-20);
      });
      const activeRef = readActiveQaMessageRef();
      if (activeRef?.id && !isSameRecordingScope(normalizeRecordingIds(activeRef.recordingIds || []), nextScope)) {
        clearActiveQaMessageRef(activeRef.id);
      }
    } else {
      enterDailyBriefView();
      setDailyBriefExpanded(false);
    }
  }, [lockedRecordingId]);

  useEffect(() => {
    let ignored = false;
    setListLoading(true);
    api("/api/recordings?folderId=all&q=")
      .then((payload) => {
        if (!ignored) {
          setAvailableRecordings((payload.recordings || []).filter((item) => !item.deletedAt));
          setListError("");
        }
      })
      .catch(() => {
        if (!ignored) setListError("录音列表暂时无法刷新");
      })
      .finally(() => {
        if (!ignored) setListLoading(false);
      });

    return () => {
      ignored = true;
      if (voiceRecorderRef.current?.state === "recording") voiceRecorderRef.current.stop();
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      qaPollingRef.current.forEach((timer) => window.clearTimeout(timer));
      qaPollingRef.current.clear();
      dailyBriefPollingRef.current.forEach((timer) => window.clearTimeout(timer));
      dailyBriefPollingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let ignored = false;
    api("/api/qa-messages?limit=60")
      .then((payload) => {
        if (!ignored) {
          const messages = payload.messages || [];
          setQaHistory(messages);
          restoreActiveQaConversation(messages);
        }
      })
      .catch(() => {});
    return () => {
      ignored = true;
    };
  }, []);

  useEffect(() => {
    if (recording?.id) return undefined;
    let ignored = false;
    setDailyBriefLoading(true);
    fetchDailyBriefHistory().catch(() => {});
    api("/api/meeting-briefs/today")
      .then((payload) => {
        if (!ignored) {
          mergeDailyBriefState(payload);
          if (payload?.status === "generating") {
            saveActiveDailyBriefRef(payload);
            pollDailyBrief(payload.date);
          } else if (payload?.summaryMarkdown) {
            clearActiveDailyBriefRef(payload.date);
          } else if (readActiveDailyBriefRef()?.date === payload?.date) {
            pollDailyBrief(payload.date);
          }
        }
      })
      .catch(() => {
        if (!ignored) setDailyBrief(null);
      })
      .finally(() => {
        if (!ignored) setDailyBriefLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [recording?.id, availableRecordings.length]);

  const activeRecordings = useMemo(() => {
    return [...availableRecordings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [availableRecordings]);
  const todayBriefRecordings = useMemo(() => activeRecordings.filter((item) => isToday(item.createdAt)), [activeRecordings]);
  const dailyBriefList = useMemo(() => {
    const byDate = new Map();
    const putBrief = (brief) => {
      if (!brief?.date) return;
      byDate.set(brief.date, { ...(byDate.get(brief.date) || {}), ...brief });
    };

    dailyBriefHistory.forEach(putBrief);
    putBrief(dailyBrief);

    const recordingsByDate = new Map();
    activeRecordings.forEach((item) => {
      const date = dateKeyFromRecording(item);
      recordingsByDate.set(date, [...(recordingsByDate.get(date) || []), item]);
    });

    recordingsByDate.forEach((items, date) => {
      const existing = byDate.get(date) || {};
      byDate.set(date, {
        id: existing.id || `daily-brief-${date}`,
        date,
        displayDate: existing.displayDate || displayDateFromDateKey(date),
        title: existing.title || "会议简报",
        meetingCount: Number.isFinite(Number(existing.meetingCount)) ? Number(existing.meetingCount) : items.length,
        recordingIds: Array.isArray(existing.recordingIds) && existing.recordingIds.length ? existing.recordingIds : items.map((item) => item.id).filter(Boolean),
        summaryMarkdown: existing.summaryMarkdown || "",
        status: existing.status || (items.length ? "idle" : "empty"),
        generatedAt: existing.generatedAt || "",
        updatedAt: existing.updatedAt || items[0]?.createdAt || date,
        dirty: Boolean(existing.dirty || (!existing.summaryMarkdown && items.length > 0)),
      });
    });

    return [...byDate.values()]
      .filter((brief) => brief?.date && (brief.status !== "empty" || dailyBriefMeetingCount(brief, 0) > 0))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [activeRecordings, dailyBrief, dailyBriefHistory]);
  const sortMessagesAscending = (messages = []) =>
    [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const scopeRecording = activeScopeIds.length === 1 ? activeRecordings.find((item) => item.id === activeScopeIds[0]) || null : null;
  const scopedRecordingsForPicker = activeRecordings;
  const visibleRecordings = scopeExpanded ? scopedRecordingsForPicker : scopedRecordingsForPicker.slice(0, 3);
  const scopeLabel = activeScopeIds.length === 0 ? uiText(language, "全部录音", "All recordings") : scopeRecording ? scopeRecording.name : uiText(language, "已选择录音", "Selected recording");
  const selectedScopeRecordings = activeScopeIds.map((id) => activeRecordings.find((item) => item.id === id)).filter(Boolean);
  const scopeSummaryMeta =
    activeScopeIds.length === 0
      ? `${activeRecordings.length} 条录音`
      : selectedScopeRecordings[0]
        ? `${formatShortDate(selectedScopeRecordings[0].createdAt)} · ${formatDuration(selectedScopeRecordings[0].durationMs)}`
        : "";
  const composerRows = Math.min(4, Math.max(1, question.split("\n").length, Math.ceil(question.length / 22)));
  const latestAnswer = answers[answers.length - 1];
  const latestAnswerKey = latestAnswer
    ? `${latestAnswer.id}-${latestAnswer.pending ? "pending" : "ready"}-${String(latestAnswer.answer || "").length}`
    : "";
  const shouldShowDailyBriefCard = !recording?.id && scopeIds.length === 0 && answers.length === 0 && !dailyBriefExpanded;
  const shouldShowDailyBriefList = !recording?.id && scopeIds.length === 0 && answers.length === 0 && dailyBriefExpanded;
  const chatThreadClassName = shouldShowDailyBriefCard ? "chat-thread has-daily-brief" : shouldShowDailyBriefList ? "chat-thread daily-brief-list-thread" : "chat-thread";
  const visibleHistoryMessages = useMemo(() => {
    const alive = qaHistory.filter((item) => !item.deletedAt);
    const base = historyMode === "favorites" ? alive.filter((item) => item.favorite) : alive;
    const scoped = activeScopeIds.length > 0 ? base.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, activeScopeIds, alive), activeScopeIds)) : base;
    return sortMessagesAscending(scoped);
  }, [answers, historyMode, qaHistory, scopeKey]);
  const visibleDailyBriefHistory = useMemo(() => {
    if (historyMode !== "history" || activeScopeIds.length > 0) return [];
    return [...dailyBriefHistory]
      .filter((item) => item?.date && item.status !== "empty")
      .sort((a, b) => {
        const left = new Date(a.updatedAt || a.generatedAt || a.date || 0).getTime();
        const right = new Date(b.updatedAt || b.generatedAt || b.date || 0).getTime();
        return right - left;
      });
  }, [dailyBriefHistory, historyMode, scopeKey]);
  const visibleHistoryCount = visibleHistoryMessages.length + visibleDailyBriefHistory.length;

  useEffect(() => {
    if (!lockedRecordingId) return;
    const nextScope = [lockedRecordingId];
    setAnswers((current) => {
      const history = historyForRecordings(nextScope);
      const known = [...current, ...history, ...qaHistory];
      const visible = current.filter((item) => shouldKeepQaMessageForScope(item, nextScope, known));
      return mergeQaMessages(history, visible).slice(-20);
    });
  }, [lockedRecordingId, qaHistory]);

  useEffect(() => {
    if (!latestAnswerKey) return;
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) {
        thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
        return;
      }
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }, [latestAnswerKey]);

  useEffect(() => {
    answers.filter((item) => item.pending).forEach((item) => pollQaMessage(item.id, 0, messageScopeFromKnown(item, activeScopeIdsRef.current, answers)));
  }, [answers]);

  function normalizeRecordingIds(ids = []) {
    return [...new Set((ids || []).filter(Boolean))].sort();
  }

  function messageRecordingIds(message) {
    return normalizeRecordingIds(Array.isArray(message.recordingIds) ? message.recordingIds : message.recordingId ? [message.recordingId] : []);
  }

  function messageScopeFromKnown(message, fallbackIds = [], knownMessages = []) {
    const direct = messageRecordingIds(message);
    if (direct.length > 0) return direct;

    const activeRef = readActiveQaMessageRef();
    if (activeRef?.id === message?.id) {
      const activeScope = normalizeRecordingIds(activeRef.recordingIds || []);
      if (activeScope.length > 0) return activeScope;
    }

    const known = [...knownMessages, ...answers, ...qaHistory].find((item) => item?.id === message?.id && messageRecordingIds(item).length > 0);
    if (known) return messageRecordingIds(known);
    return normalizeRecordingIds(fallbackIds);
  }

  function withQaMessageScope(message, fallbackIds = [], knownMessages = []) {
    if (!message?.id) return message;
    const scope = messageScopeFromKnown(message, fallbackIds, knownMessages);
    return scope.length > 0 ? { ...message, recordingIds: scope } : message;
  }

  function isSameRecordingScope(left = [], right = []) {
    const normalizedLeft = normalizeRecordingIds(left);
    const normalizedRight = normalizeRecordingIds(right);
    return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
  }

  function mergeQaMessages(...groups) {
    const merged = new Map();
    groups.flat().forEach((message) => {
      if (!message?.id || message.deletedAt) return;
      const previous = merged.get(message.id);
      const scope = messageRecordingIds(message).length > 0 ? messageRecordingIds(message) : messageRecordingIds(previous || {});
      const next = { ...(previous || {}), ...message };
      merged.set(message.id, scope.length > 0 ? { ...next, recordingIds: scope } : next);
    });
    return sortMessagesAscending([...merged.values()]);
  }

  function shouldKeepQaMessageForScope(message, scopeIdsForView, knownMessages = []) {
    if (!message?.id || message.deletedAt) return false;
    const targetScope = normalizeRecordingIds(scopeIdsForView);
    if (isSameRecordingScope(messageScopeFromKnown(message, targetScope, knownMessages), targetScope)) return true;

    const activeRef = readActiveQaMessageRef();
    if (activeRef?.id !== message.id) return false;
    const activeScope = normalizeRecordingIds(activeRef.recordingIds || []);
    return activeScope.length === 0 || isSameRecordingScope(activeScope, targetScope);
  }

  function restoreActiveQaConversation(messages = []) {
    const alive = sortMessagesAscending(messages.filter((item) => !item.deletedAt));
    const pendingMessages = alive.filter((item) => item.pending);
    pendingMessages.forEach((item) => pollQaMessage(item.id, 0, messageScopeFromKnown(item, [], alive)));
    if (!qaConversationViewRef.current) return;
    if (answers.length > 0) return;

    const activeRef = readActiveQaMessageRef();
    const refAgeMs = activeRef?.createdAt ? Date.now() - new Date(activeRef.createdAt).getTime() : 0;
    const refFresh = activeRef?.id && (!refAgeMs || refAgeMs < 24 * 60 * 60 * 1000);
    const currentScope = normalizeRecordingIds(activeScopeIdsRef.current);
    const scopeLocked = Boolean(lockedRecordingId);
    const belongsToCurrentScope = (item) => isSameRecordingScope(messageScopeFromKnown(item, scopeLocked ? currentScope : [], alive), currentScope);
    const fromActiveRef = refFresh ? alive.find((item) => item.id === activeRef.id && belongsToCurrentScope(item)) : null;
    const fromCurrentScope = [...pendingMessages].reverse().find((item) => belongsToCurrentScope(item));
    const candidate = fromActiveRef || fromCurrentScope || (scopeLocked ? null : pendingMessages[pendingMessages.length - 1]);
    if (!candidate) return;

    const candidateScope = messageScopeFromKnown(candidate, scopeLocked ? currentScope : [], alive);
    setScopeIds(scopeLocked ? currentScope : candidateScope);
    const scopedHistory = alive.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, candidateScope, alive), candidateScope));
    const restored = scopedHistory.some((item) => item.id === candidate.id) ? scopedHistory : [candidate];
    setAnswers(sortMessagesAscending(restored).slice(-20));
    setDailyBriefExpanded(true);
    if (candidate.pending) pollQaMessage(candidate.id, 0, candidateScope);
  }

  function historyForRecordings(ids) {
    const selected = normalizeRecordingIds(ids);
    return sortMessagesAscending(qaHistory.filter((message) => !message.deletedAt && isSameRecordingScope(messageScopeFromKnown(message, [], qaHistory), selected)));
  }

  function latestLinkedScopeForRecording(id) {
    const message = qaHistory.find((item) => {
      if (item.deletedAt) return false;
      const ids = messageScopeFromKnown(item, [], qaHistory);
      return ids.length > 1 && ids.includes(id);
    });
    return message ? messageScopeFromKnown(message, [], qaHistory) : null;
  }

  function hasHistoryForRecording(id) {
    return qaHistory.some((message) => !message.deletedAt && isSameRecordingScope(messageScopeFromKnown(message, [], qaHistory), [id]));
  }

  function toggleScope(id) {
    enterQaConversationView();
    const next = [id];
    const history = historyForRecordings(next).slice(-20);
    const latest = history[history.length - 1];
    setScopeIds(next);
    setAnswers(history);
    setDailyBriefExpanded(true);
    setScopeExpanded(false);
    if (latest) saveActiveQaMessageRef(latest);
    else clearActiveQaMessageRef();
    history.filter((item) => item.pending).forEach((item) => pollQaMessage(item.id, 0, next));
    if (lockedRecordingId && id !== lockedRecordingId) onSelectRecording?.(id);
    window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function resetToAllRecordings() {
    onSelectRecording?.("");
    enterDailyBriefView();
    stopTtsQueue();
    setScopeIds([]);
    setAnswers([]);
    setQuestion("");
    setImages([]);
    setAttachments([]);
    setAttachmentsOpen(false);
    setDailyBriefExpanded(false);
    setScopeExpanded(false);
    setHistoryOpen(false);
    setActiveCitationKey("");
    setExpandedCitationGroups({});
  }

  function switchHistoryMode(mode, event) {
    event.stopPropagation();
    setHistoryMode(mode);
    setHistoryOpen(true);
  }

  function openAttachmentPreview(item, type = "file") {
    setAttachmentPreview({ ...item, previewType: type });
  }

  function authenticatedResourceUrl(url = "") {
    if (!url || /^data:/i.test(url)) return url;
    let parsed;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      return url;
    }
    if (parsed.origin !== window.location.origin) return url;
    if (!parsed.searchParams.get("clientId")) parsed.searchParams.set("clientId", getClientId());
    const auth = getStoredAuth();
    if (auth?.token && !parsed.searchParams.get("authToken")) parsed.searchParams.set("authToken", auth.token);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function attachmentPreviewUrl(item = {}) {
    return item.dataUrl || authenticatedResourceUrl(item.url || "");
  }

  function closeAttachmentPreview() {
    setAttachmentPreview(null);
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function readDataUrlFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function attachmentPreviewType(item = {}) {
    const kind = String(item.kind || item.previewType || "").toLowerCase();
    const type = String(item.type || "").toLowerCase();
    if (kind === "image" || type.startsWith("image/") || item.dataUrl?.startsWith("data:image/")) return "image";
    if (kind === "audio" || type.startsWith("audio/") || item.dataUrl?.startsWith("data:audio/")) return "audio";
    if (kind === "location") return "location";
    return "file";
  }

  function attachmentsForMessage(currentImages = [], currentAttachments = []) {
    return [
      ...currentImages.map((item) => ({ ...item, kind: "image", previewType: "image" })),
      ...currentAttachments.map((item) => ({ ...item, previewType: attachmentPreviewType(item) })),
    ];
  }

  async function addImageFiles(fileList, sourceLabel = "图片") {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const nextImages = [];
    for (const file of files.slice(0, Math.max(0, 3 - images.length))) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 3 * 1024 * 1024) {
        onToast?.("图片太大，单张请控制在 3MB 内");
        continue;
      }
      const dataUrl = await readImageFile(file);
      nextImages.push({ id: `${file.name}-${Date.now()}`, name: file.name, type: file.type, dataUrl });
    }

    if (nextImages.length > 0) {
      setImages((current) => [...current, ...nextImages].slice(0, 3));
      setAttachmentsOpen(false);
      onToast?.(`${sourceLabel}已加入`);
    }
  }

  async function addImages(event) {
    await addImageFiles(event.target.files, "图片");
    event.target.value = "";
  }

  async function addCameraImage(event) {
    await addImageFiles(event.target.files, "拍照图片");
    event.target.value = "";
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function addQuestionFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onToast?.("文件太大，当前先支持 2MB 内的文字类文件");
      return;
    }

    const textLike =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|log)$/i.test(file.name);
    let text = "";
    if (textLike) {
      text = (await readTextFile(file)).slice(0, 6000);
    }
    const dataUrl = textLike ? "" : await readDataUrlFile(file);
    setAttachments((current) => [
      ...current,
      {
        id: `${file.name}-${Date.now()}`,
        kind: "file",
        name: file.name,
        type: file.type,
        text,
        dataUrl,
      },
    ].slice(0, 6));
    setAttachmentsOpen(false);
    onToast?.(text ? "文件内容已加入提问上下文" : "文件已加入，非文字文件暂作为附件标记");
  }

  async function addQuestionAudio(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      onToast?.("请选择音频文件");
      return;
    }

    try {
      setVoiceBusy(true);
      const durationMs = await getAudioFileDuration(file);
      const dataUrl = file.size <= 8 * 1024 * 1024 ? await readDataUrlFile(file) : "";
      await uploadVoiceQuestion(file, durationMs);
      setAttachments((current) => [
        ...current,
        { id: `${file.name}-${Date.now()}`, kind: "audio", name: file.name, type: file.type, dataUrl, text: "音频已转成文字并放入输入框" },
      ].slice(0, 6));
      setAttachmentsOpen(false);
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "音频转文字失败");
    } finally {
      setVoiceBusy(false);
    }
  }

  function addLocationAttachment() {
    if (!navigator.geolocation) {
      onToast?.("当前环境不支持获取地址");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const url = `https://maps.google.com/?q=${lat},${lng}`;
        const text = `当前位置：${lat}, ${lng} ${url}`;
        setAttachments((current) => [
          ...current,
          { id: `location-${Date.now()}`, kind: "location", name: "当前位置", text, url },
        ].slice(0, 6));
        setQuestion((current) => `${current}${current ? "\n" : ""}${text}`.trim());
        setAttachmentsOpen(false);
        onToast?.("地址已加入");
      },
      () => onToast?.("无法获取地址，请在手机和企业微信里允许位置权限"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function uploadVoiceQuestion(blob, durationMs) {
    const formData = new FormData();
    const ext = audioExtensionFromMimeType(blob.type);
    formData.append("audio", blob, `question-${Date.now()}.${ext}`);
    formData.append("durationMs", String(durationMs));
    const payload = await api("/api/voice-input", {
      method: "POST",
      body: formData,
    });
    const text = String(payload.text || "").trim();
    if (text) setQuestion((current) => `${current} ${text}`.trim());
    else onToast?.("没有识别到语音内容");
  }

  async function startVoiceInput(event) {
    event?.preventDefault?.();
    if (listening || voiceBusy) return;
    if (event?.pointerId !== undefined) voicePointerRef.current = event.pointerId;

    if (!canRequestMicrophone()) {
      onToast?.("手机端语音输入需要通过 HTTPS 打开");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onToast?.("当前环境不支持网页录音，请更新企业微信后再试");
      return;
    }

    try {
      const stream = await requestMicrophoneStream();
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceChunksRef.current = [];
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const durationMs = Math.max(600, Date.now() - voiceStartedAtRef.current);
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setListening(false);
        setVoiceBusy(true);
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        try {
          await uploadVoiceQuestion(blob, durationMs);
          setComposerMode("text");
        } catch (error) {
          onToast?.(error instanceof Error ? error.message : "语音转文字失败");
        } finally {
          setVoiceBusy(false);
        }
      };

      recorder.start(250);
      setListening(true);
    } catch (error) {
      setListening(false);
      onToast?.(microphoneErrorMessage(error));
    }
  }

  function stopVoiceInput(event) {
    event?.preventDefault?.();
    if (event?.pointerId !== undefined && voicePointerRef.current !== null && event.pointerId !== voicePointerRef.current) return;
    voicePointerRef.current = null;
    const recorder = voiceRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  function attachmentQuestionText(currentImages = images, currentAttachments = attachments) {
    const names = [
      ...currentImages.map((item) => `图片：${item.name}`),
      ...currentAttachments.map((item) => `${item.kind === "audio" ? "录音" : item.kind === "location" ? "地址" : "文件"}：${item.name}`),
    ];
    return names.length > 0 ? `请结合选中的录音内容，分析我上传的附件：${names.join("、")}` : "";
  }

  async function askRecordings(event) {
    event.preventDefault();
    const trimmed = question.trim();
    const outgoingImages = images;
    const outgoingAttachments = attachments;
    const outgoingQuestion = trimmed || attachmentQuestionText(outgoingImages, outgoingAttachments);
    if (!outgoingQuestion) return;
    enterQaConversationView();
    setDailyBriefExpanded(true);
    const optimisticAttachments = attachmentsForMessage(outgoingImages, outgoingAttachments);
    const targetScopeIds = normalizeRecordingIds(activeScopeIds);

    const optimisticId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage = {
      id: optimisticId,
      question: outgoingQuestion,
      answer: "",
      citations: [],
      recordingIds: targetScopeIds,
      recordingNames: targetScopeIds
        .map((id) => activeRecordings.find((item) => item.id === id)?.name)
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      attachments: optimisticAttachments,
      pending: true,
    };
    saveActiveQaMessageRef(optimisticMessage);
    setAnswers((current) =>
      sortMessagesAscending([...current.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, targetScopeIds, current), targetScopeIds)), optimisticMessage]).slice(-20),
    );
    setQuestion("");
    setImages([]);
    setAttachments([]);
    setAttachmentsOpen(false);
    try {
      const payload = await api("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: outgoingQuestion,
          recordingIds: targetScopeIds,
          images: outgoingImages.map((item) => ({ name: item.name, type: item.type, dataUrl: item.dataUrl })),
          attachments: outgoingAttachments.map((item) => ({
            kind: item.kind,
            name: item.name,
            type: item.type,
            text: item.text,
            url: item.url,
            dataUrl: item.dataUrl,
          })),
        }),
      });
      if (!payload.message?.id) throw new Error("问答创建失败");
      const fallbackScope = lockedRecordingId ? [lockedRecordingId] : targetScopeIds;
      const scopedMessage = withQaMessageScope(payload.message, fallbackScope, [optimisticMessage]);
      saveActiveQaMessageRef(scopedMessage);
      const messageScope = messageScopeFromKnown(scopedMessage, fallbackScope, [optimisticMessage]);
      const nextScope = lockedRecordingId ? [lockedRecordingId] : messageScope;
      setScopeIds(nextScope);
      setAnswers((current) => {
        const known = [...historyForRecordings(nextScope), ...current, scopedMessage];
        const scopedCurrent = current.filter(
          (item) =>
            item.id !== optimisticId &&
            item.id !== scopedMessage.id &&
            isSameRecordingScope(messageScopeFromKnown(item, nextScope, known), nextScope),
        );
        const scopedHistory = historyForRecordings(nextScope).filter((item) => item.id !== optimisticId && item.id !== scopedMessage.id);
        return mergeQaMessages(scopedHistory, scopedCurrent, [scopedMessage]).slice(-20);
      });
      setQaHistory((current) => [scopedMessage, ...current.filter((item) => item.id !== scopedMessage.id)].slice(0, 60));
      if (scopedMessage.pending) pollQaMessage(scopedMessage.id, 0, nextScope);
    } catch (error) {
      setAnswers((current) => current.filter((item) => item.id !== optimisticId));
      onToast?.(error instanceof Error ? error.message : "提问失败");
    }
  }

  function citationDisplayLabel(index) {
    return pointLabelForIndex(index);
  }

  function citationKey(citation, index = 0) {
    return `${citation.recordingId || "recording"}-${citation.evidenceId || citation.segmentId || index}-${citation.startMs || 0}`;
  }

  function citationTimeLabel(citation) {
    const start = formatTimecode(citation.startMs || 0);
    const end = citation.endMs ? `-${formatTimecode(citation.endMs)}` : "";
    return `${start}${end}`;
  }

  function sortCitationsByTimeline(citations = []) {
    return [...citations].sort(
      (a, b) =>
        (a.recordingSeq || 0) - (b.recordingSeq || 0) ||
        String(a.recordingName || "").localeCompare(String(b.recordingName || ""), "zh-CN") ||
        (a.startMs || 0) - (b.startMs || 0),
    );
  }

  function citationRecordingDurationMs(citation) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    return Math.max(target?.durationMs || 0, citation.endMs || 0, (citation.startMs || 0) + 120000, 1000);
  }

  function citationStartMs(citation) {
    return Math.max(0, citation.startMs || 0);
  }

  function citationEndMs(citation) {
    const start = citationStartMs(citation);
    const recordingDuration = citationRecordingDurationMs(citation);
    const requestedEnd = Math.max(start + 1000, citation.endMs || start + 60000);
    return Math.min(recordingDuration, start + 120000, requestedEnd);
  }

  function citationSegmentDurationMs(citation) {
    return Math.max(1000, citationEndMs(citation) - citationStartMs(citation));
  }

  function citationProgressOffsetMs(citation, key) {
    if (activeCitationKey === key && citationPlayback.key === key) {
      return Math.min(Math.max(0, citationPlayback.currentMs - citationStartMs(citation)), citationSegmentDurationMs(citation));
    }
    return 0;
  }

  function textSignalSet(text = "") {
    const compact = String(text || "")
      .replace(/[^\p{Script=Han}a-z0-9]/giu, "")
      .toLowerCase();
    return new Set([...compact].filter(Boolean));
  }

  function scoreCitationForBlock(block, citation) {
    const blockSignals = textSignalSet(block);
    const citationSignals = textSignalSet(citation?.text || "");
    if (blockSignals.size === 0 || citationSignals.size === 0) return 0;

    let overlap = 0;
    citationSignals.forEach((char) => {
      if (blockSignals.has(char)) overlap += 1;
    });
    return overlap / Math.max(8, Math.min(blockSignals.size, citationSignals.size));
  }

  function citationsForBlock(block, blockIndex, allBlocks, citations) {
    if (!citations.length) return [];
    const scored = citations
      .map((citation, index) => ({
        citation,
        index,
        score: scoreCitationForBlock(block, citation),
      }))
      .sort((a, b) => b.score - a.score || (a.citation.startMs || 0) - (b.citation.startMs || 0));

    const matched = scored.filter((item) => item.score >= 0.12);
    if (matched.length > 0) return dedupeCitations(matched.map((item) => ({ ...item.citation, _citationIndex: item.index })));

    const chunkSize = Math.max(1, Math.ceil(citations.length / Math.max(1, allBlocks.length)));
    return dedupeCitations(
      citations.slice(blockIndex * chunkSize, blockIndex * chunkSize + chunkSize).map((citation, index) => ({
        ...citation,
        _citationIndex: blockIndex * chunkSize + index,
      })),
    );
  }

  function compactCitationText(value = "") {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[^\p{Script=Han}a-z0-9]/giu, "")
      .toLowerCase()
      .slice(0, 80);
  }

  function dedupeCitations(citations = []) {
    const kept = [];
    for (const citation of sortCitationsByTimeline(citations)) {
      const start = citationStartMs(citation);
      const end = citationEndMs(citation);
      const textKey = compactCitationText(citation.text);
      const duplicate = kept.some((item) => {
        const sameRecording = (item.recordingId || "") === (citation.recordingId || "");
        if (!sameRecording) return false;
        const itemStart = citationStartMs(item);
        const itemEnd = citationEndMs(item);
        const overlaps = start <= itemEnd && end >= itemStart;
        const close = Math.abs(start - itemStart) < 45000;
        const sameText = textKey && compactCitationText(item.text) === textKey;
        return overlaps || close || sameText;
      });
      if (!duplicate) kept.push(citation);
      if (kept.length >= 8) break;
    }
    return kept;
  }

  function toggleCitationGroup(key) {
    setExpandedCitationGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  function playCitation(citation, key, nextMs = citation.startMs || 0) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    const audio = audioRef.current;
    if (!target || !audio) return;
    stopTtsQueue();

    if (activeCitationKey === key) {
      if (audio.paused) audio.play().catch(() => setActiveCitationKey(""));
      else {
        audio.pause();
        setActiveCitationKey("");
        activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
      }
      return;
    }

    seekCitation(citation, key, nextMs);
  }

  function seekCitation(citation, key, nextMs) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    const audio = audioRef.current;
    if (!target || !audio) return;

    const startMs = citationStartMs(citation);
    const endMs = citationEndMs(citation);
    const targetMs = Math.min(endMs, Math.max(startMs, nextMs));
    setActiveCitationKey(key);
    activeCitationRef.current = { key, startMs, endMs };
    setCitationPlayback({ key, currentMs: targetMs, durationMs: citationSegmentDurationMs(citation) });
    const nextSrc = new URL(mediaRequestUrl(target.audioUrl, target.updatedAt || target.createdAt || ""), window.location.href).href;
    const jump = () => {
      audio.currentTime = Math.max(0, targetMs / 1000);
      audio.play().catch(() => setActiveCitationKey(""));
    };
    if (audioSourceRef.current !== nextSrc) {
      audio.src = nextSrc;
      audioSourceRef.current = nextSrc;
      audio.addEventListener("loadedmetadata", jump, { once: true });
      audio.load();
    } else {
      jump();
    }
  }

  function openHistoryItem(item) {
    enterQaConversationView();
    const ids = lockedRecordingId ? [lockedRecordingId] : messageScopeFromKnown(item, [], qaHistory);
    const scopedItem = withQaMessageScope(item, ids, qaHistory);
    if (lockedRecordingId && !isSameRecordingScope(messageScopeFromKnown(scopedItem, ids, qaHistory), ids)) return;
    saveActiveQaMessageRef(scopedItem);
    setScopeIds(ids);
    setAnswers(sortMessagesAscending([scopedItem]));
    setDailyBriefExpanded(true);
    if (scopedItem.pending) pollQaMessage(scopedItem.id, 0, ids);
    setHistoryOpen(false);
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function updateHistoryMessage(message) {
    setQaHistory((current) => current.map((item) => (item.id === message.id ? withQaMessageScope({ ...item, ...message }, messageRecordingIds(item), current) : item)));
    setAnswers((current) => current.map((item) => (item.id === message.id ? withQaMessageScope({ ...item, ...message }, messageRecordingIds(item), current) : item)));
  }

  function upsertQaMessage(message, fallbackScopeIds = activeScopeIdsRef.current) {
    if (!message?.id) return;
    const fallbackScope = normalizeRecordingIds(fallbackScopeIds);
    const seededMessage = withQaMessageScope(message, fallbackScope, [...answers, ...qaHistory]);
    if (readActiveQaMessageRef()?.id === seededMessage.id) saveActiveQaMessageRef(seededMessage);
    setQaHistory((current) => {
      const storedScope = messageScopeFromKnown(seededMessage, fallbackScope, [...current, ...answers]);
      const scopedMessage = withQaMessageScope(seededMessage, storedScope, current);
      return [scopedMessage, ...current.filter((item) => item.id !== scopedMessage.id)].slice(0, 60);
    });
    setAnswers((current) => {
      if (!qaConversationViewRef.current) return current;
      const currentScope = normalizeRecordingIds(activeScopeIdsRef.current);
      const scopedMessage = withQaMessageScope(seededMessage, currentScope, current);
      const messageScope = messageScopeFromKnown(scopedMessage, currentScope, current);
      const known = [...current, scopedMessage, ...qaHistory];
      const scopedCurrent = current.filter((item) => shouldKeepQaMessageForScope(item, currentScope, known) && item.id !== scopedMessage.id);
      if (!isSameRecordingScope(messageScope, currentScope)) return mergeQaMessages(scopedCurrent).slice(-20);
      return mergeQaMessages(scopedCurrent, [scopedMessage]).slice(-20);
    });
  }

  function pollQaMessage(id, attempt = 0, fallbackScopeIds = activeScopeIdsRef.current) {
    if (!id || qaPollingRef.current.has(id)) return;
    const pollScopeIds = normalizeRecordingIds(fallbackScopeIds);
    const timer = window.setTimeout(async () => {
      qaPollingRef.current.delete(id);
      try {
        const payload = await api(`/api/qa-messages/${encodeURIComponent(id)}`);
        if (payload.message) {
          upsertQaMessage(payload.message, pollScopeIds);
          if (payload.message.pending && attempt < 180) pollQaMessage(id, attempt + 1, pollScopeIds);
        }
      } catch {
        if (attempt < 30) pollQaMessage(id, attempt + 1, pollScopeIds);
      }
    }, attempt === 0 ? 900 : 1800);
    qaPollingRef.current.set(id, timer);
  }

  function openCurrentScopeConversation() {
    enterQaConversationView();
    const history = historyForRecordings(activeScopeIdsRef.current).slice(-20);
    const latest = history[history.length - 1];
    setAnswers(history);
    setDailyBriefExpanded(true);
    if (latest) saveActiveQaMessageRef(latest);
    else clearActiveQaMessageRef();
    history.filter((item) => item.pending).forEach((item) => pollQaMessage(item.id, 0, activeScopeIdsRef.current));
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function dailyBriefMessageFromBrief(brief = dailyBrief, options = {}) {
    const meetingCount = dailyBriefMeetingCount(brief, todayBriefRecordings.length);
    const loadingBrief = options.loading
      ? {
          ...(brief || {}),
          summaryMarkdown: "",
          status: "generating",
          dirty: true,
        }
      : brief;
    const content = dailyBriefFallbackContent(loadingBrief, meetingCount);
    const recordingIds = Array.isArray(brief?.recordingIds)
      ? brief.recordingIds
      : todayBriefRecordings.map((item) => item.id).filter(Boolean);
    const recordingStates = Array.isArray(brief?.recordingStates) ? brief.recordingStates : [];
    const message = {
      id: `daily-brief-${brief?.date || Date.now()}`,
      type: "daily-brief",
      briefDate: brief?.date || "",
      status: options.loading ? "generating" : brief?.status || "",
      role: "assistant",
      question: "今日会议简报",
      answer: content,
      content,
      citations: [],
      recordingIds,
      recordingStates,
      recordingNames: recordingStates.length ? recordingStates.map((item) => item.name).filter(Boolean) : todayBriefRecordings.map((item) => item.name).filter(Boolean),
      createdAt: brief?.updatedAt || brief?.generatedAt || new Date().toISOString(),
    };
    return message;
  }

  function mergeDailyBriefState(brief) {
    if (!brief?.date) return;
    if (brief.date === todayDateKey()) {
      setDailyBrief((current) => ({ ...(current || {}), ...brief }));
    }
    setDailyBriefHistory((current) =>
      [brief, ...current.filter((item) => item?.date !== brief.date)].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    );
  }

  async function fetchDailyBriefHistory() {
    const payload = await api("/api/meeting-briefs?limit=30");
    const briefs = payload.briefs || [];
    setDailyBriefHistory(briefs);
    return briefs;
  }

  function showDailyBriefMessage(brief = dailyBrief, options = {}) {
    enterDailyBriefView();
    const message = dailyBriefMessageFromBrief(brief, options);
    setAnswers([message]);
    setDailyBriefExpanded(true);
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function updateDailyBriefAnswerMessage(brief = dailyBrief, options = {}) {
    if (!brief?.date) return;
    const nextMessage = dailyBriefMessageFromBrief(brief, options);
    setAnswers((current) =>
      current.map((item) =>
        item.type === "daily-brief" && (item.briefDate || "") === brief.date
          ? { ...nextMessage, id: item.id || nextMessage.id }
          : item,
      ),
    );
  }

  function openDailyBriefCard() {
    enterDailyBriefView();
    onSelectRecording?.("");
    setScopeIds([]);
    setAnswers([]);
    setDailyBriefExpanded(true);
    setHistoryOpen(false);
    setScopeExpanded(false);
    fetchDailyBriefHistory().catch(() => {});
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openDailyBriefHistoryItem(brief) {
    enterDailyBriefView();
    mergeDailyBriefState(brief);
    setScopeIds([]);
    setAnswers([]);
    setDailyBriefExpanded(true);
    setExpandedDailyBriefDates((current) => new Set([...current, brief.date].filter(Boolean)));
    setHistoryOpen(false);
    if (brief.status === "generating") pollDailyBrief(brief.date);
    else if (!dailyBriefHasSummary(brief) && dailyBriefMeetingCount(brief, 0) > 0) generateDailyBriefForDate(brief);
  }

  function pollDailyBrief(date, attempt = 0, recoveryAttempt = 0) {
    if (!date || dailyBriefPollingRef.current.has(date)) return;
    const timer = window.setTimeout(async () => {
      dailyBriefPollingRef.current.delete(date);
      try {
        const payload = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`);
        mergeDailyBriefState(payload);
        if (payload?.date === date && isDailyBriefViewActive()) {
          updateDailyBriefAnswerMessage(payload, { loading: payload.status === "generating" && !dailyBriefHasSummary(payload) });
        }
        fetchDailyBriefHistory().catch(() => {});
        if (payload?.date === date) {
          const hasSummary = Boolean(String(payload.summaryMarkdown || "").trim());
          if (payload.status === "generating" && attempt < 180) {
            pollDailyBrief(date, attempt + 1, recoveryAttempt);
            return;
          }
          if (hasSummary) {
            clearActiveDailyBriefRef(date);
            setDailyBriefGeneratingDates((current) => {
              const next = new Set(current);
              next.delete(date);
              return next;
            });
            return;
          }
          if ((payload.status === "ready" || payload.status === "failed") && recoveryAttempt < 1 && attempt < 180) {
            const queued = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`, { method: "POST" });
            mergeDailyBriefState(queued);
            saveActiveDailyBriefRef(queued);
            pollDailyBrief(date, attempt + 1, recoveryAttempt + 1);
            return;
          }
          setDailyBriefGeneratingDates((current) => {
            const next = new Set(current);
            next.delete(date);
            return next;
          });
        }
      } catch {
        if (attempt < 30) pollDailyBrief(date, attempt + 1, recoveryAttempt);
      }
    }, attempt === 0 ? 1400 : 2200);
    dailyBriefPollingRef.current.set(date, timer);
  }

  async function refreshDailyBriefRecordingItem(recordingState, date, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const recordingId = recordingState?.id || "";
    const targetDate = date || todayDateKey();
    if (!recordingId || !targetDate) return;
    if (!canRefreshDailyBriefRecording(recordingState)) {
      onToast?.("会议提纲完成后，才能更新这一条简报。");
      return;
    }
    if (dailyBriefGeneratingDates.has(targetDate)) {
      onToast?.("今日简报正在生成，请稍等完成后再更新这一条。");
      return;
    }

    let keepGenerating = false;
    setDailyBriefRefreshingRecordingIds((current) => new Set([...current, recordingId]));
    setDailyBriefGeneratingDates((current) => new Set([...current, targetDate]));
    try {
      const payload = await api(`/api/meeting-briefs/${encodeURIComponent(targetDate)}`, { method: "POST" });
      mergeDailyBriefState(payload);
      updateDailyBriefAnswerMessage(payload);
      fetchDailyBriefHistory().catch(() => {});
      if (payload.status === "generating") {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(targetDate);
      } else if (dailyBriefHasSummary(payload)) {
        clearActiveDailyBriefRef(targetDate);
        onToast?.("已开始更新这一条简报内容。");
      } else {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(targetDate);
      }
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "这一条简报更新失败");
    } finally {
      setDailyBriefRefreshingRecordingIds((current) => {
        const next = new Set(current);
        next.delete(recordingId);
        return next;
      });
      if (!keepGenerating) {
        setDailyBriefGeneratingDates((current) => {
          const next = new Set(current);
          next.delete(targetDate);
          return next;
        });
      }
    }
  }

  async function generateDailyBriefForDate(brief, event) {
    event?.stopPropagation?.();
    const date = brief?.date || todayDateKey();
    if (!date || dailyBriefGeneratingDates.has(date)) return;
    const meetingCount = dailyBriefMeetingCount(brief, 0);
    if (!meetingCount) {
      onToast?.("当天没有可总结的录音");
      return;
    }

    let keepGenerating = false;
    const pendingBrief = {
      ...(brief || {}),
      date,
      displayDate: brief?.displayDate || displayDateFromDateKey(date),
      meetingCount,
      status: "generating",
      summaryMarkdown: "",
      dirty: true,
      updatedAt: new Date().toISOString(),
    };

    setDailyBriefGeneratingDates((current) => new Set([...current, date]));
    mergeDailyBriefState(pendingBrief);
    saveActiveDailyBriefRef(pendingBrief);

    try {
      const payload = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`, { method: "POST" });
      mergeDailyBriefState(payload);
      fetchDailyBriefHistory().catch(() => {});
      if (payload.status === "generating") {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(date);
      } else if (dailyBriefHasSummary(payload)) {
        clearActiveDailyBriefRef(date);
      } else if ((payload.status === "ready" || payload.status === "failed") && payload.date) {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(date);
      } else {
        clearActiveDailyBriefRef(date);
      }
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "会议简报生成失败");
    } finally {
      if (!keepGenerating) {
        setDailyBriefGeneratingDates((current) => {
          const next = new Set(current);
          next.delete(date);
          return next;
        });
      }
    }
  }

  function toggleDailyBriefDate(brief) {
    const date = brief?.date;
    if (!date) return;
    const willExpand = !expandedDailyBriefDates.has(date);
    setExpandedDailyBriefDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    if (willExpand && dailyBriefMeetingCount(brief, 0) > 0 && !dailyBriefHasSummary(brief) && brief.status !== "generating") {
      generateDailyBriefForDate(brief);
    }
  }

  function speakDailyBrief(brief, event) {
    event?.stopPropagation?.();
    const date = brief?.date || todayDateKey();
    const generating = dailyBriefGeneratingDates.has(date) || brief?.status === "generating";
    const content = dailyBriefListContent(brief, dailyBriefMeetingCount(brief, 0), generating);
    const segments = speechSegmentsFromText(content, "content", "朗读内容");
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    toggleTtsQueue(`daily-brief-${date}`, segments);
  }

  function speakDailyBriefLine(brief, line) {
    line?.event?.preventDefault?.();
    line?.event?.stopPropagation?.();
    const itemId = line?.itemId || `daily-brief-${brief?.date || brief?.briefDate || todayDateKey()}-line-${line?.index || 0}`;
    if (ttsState.playing || ttsState.loading) {
      stopTtsQueue();
      return;
    }

    const date = brief?.date || brief?.briefDate || todayDateKey();
    const meetingCount = dailyBriefMeetingCount(brief, 0);
    const generating = dailyBriefGeneratingDates.has(date) || brief?.status === "generating";
    const content =
      cleanQaVisibleText(brief?.content || brief?.answer || brief?.summaryMarkdown || "", "") ||
      dailyBriefListContent(brief, meetingCount, generating);
    const startIndex = Math.max(0, Number(line?.index || 0));
    const speechText = String(content || "")
      .split(/\r?\n/)
      .slice(startIndex)
      .map((rawLine) => {
        const text = cleanQaVisibleText(rawLine, "");
        return text.replace(/^[-*]\s*/, "• ");
      })
      .filter(Boolean)
      .join("\n");
    const segments = speechSegmentsFromText(speechText || line?.text || "", `line-${line?.index || 0}`, line?.label || "朗读段落");
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    startTtsQueue(itemId, segments);
  }

  async function shareDailyBriefPdf(item, event) {
    event?.stopPropagation?.();
    const date = item?.briefDate || item?.date;
    if (!date) return;
    const fileName = `${safeFileName(item?.question || item?.title || "今日会议简报")}-${date}.pdf`;
    try {
      const response = await fetchWithClient(`/api/meeting-briefs/${encodeURIComponent(date)}/share.pdf`);
      if (!response.ok) throw new Error("PDF 生成失败");
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: item?.question || item?.title || "今日会议简报",
          text: "今日会议简报 PDF",
          files: [file],
        });
        return;
      }
      downloadBlob(blob, fileName);
      onToast?.("PDF 已生成，可在下载文件中分享");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "分享失败");
    }
  }

  async function generateTodayBrief(event) {
    event?.stopPropagation?.();
    if (dailyBriefLoading) return;
    enterDailyBriefView();
    const pendingBrief = {
      ...(dailyBrief || {}),
      date: dailyBrief?.date || todayDateKey(),
      displayDate: dailyBrief?.displayDate || todayDisplayDateFallback(),
      meetingCount: dailyBriefMeetingCount(dailyBrief, todayBriefRecordings.length),
      recordingIds: todayBriefRecordings.map((item) => item.id).filter(Boolean),
      status: "generating",
      summaryMarkdown: "",
      dirty: true,
      updatedAt: new Date().toISOString(),
    };
    onSelectRecording?.("");
    setScopeIds([]);
    setDailyBrief(pendingBrief);
    setDailyBriefExpanded(true);
    showDailyBriefMessage(pendingBrief, { loading: true });
    setDailyBriefLoading(true);
    try {
      const active = pendingBrief;
      saveActiveDailyBriefRef(active);
      const payload = await api("/api/meeting-briefs/today", { method: "POST" });
      setDailyBrief(payload);
      const hasSummary = Boolean(String(payload?.summaryMarkdown || "").trim());
      if (payload.status === "generating") {
        saveActiveDailyBriefRef(payload);
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload, { loading: true });
        pollDailyBrief(payload.date);
      } else if (hasSummary) {
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload);
        clearActiveDailyBriefRef(payload.date);
      } else if ((payload.status === "ready" || payload.status === "failed") && payload.date) {
        pollDailyBrief(payload.date);
        saveActiveDailyBriefRef(payload);
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload, { loading: true });
      } else {
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload);
        clearActiveDailyBriefRef(payload.date);
      }
      fetchDailyBriefHistory().catch(() => {});
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "今日总结生成失败");
      const active = readActiveDailyBriefRef();
      if (active?.date) pollDailyBrief(active.date);
    } finally {
      setDailyBriefLoading(false);
    }
  }

  async function toggleHistoryFavorite(item, event) {
    event.stopPropagation();
    try {
      const payload = await api(`/api/qa-messages/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !item.favorite }),
      });
      updateHistoryMessage(payload.message);
      onToast?.(payload.message.favorite ? "已收藏到收藏夹" : "已取消收藏");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "收藏失败");
    }
  }

  async function deleteHistoryMessage(item, event) {
    event.stopPropagation();
    if (!window.confirm("删除这条问答记录？")) return;
    try {
      await api(`/api/qa-messages/${item.id}`, { method: "DELETE" });
      clearActiveQaMessageRef(item.id);
      setQaHistory((current) => current.filter((message) => message.id !== item.id));
      setAnswers((current) => current.filter((message) => message.id !== item.id));
      onToast?.("问答记录已删除");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function shareHistoryMessage(item, event) {
    event?.stopPropagation?.();
    const url = `/api/qa-messages/${item.id}/share.pdf`;
    const fileName = `${safeFileName(item.question || "问答记录")}.pdf`;

    try {
      const response = await fetchWithClient(url);
      if (!response.ok) throw new Error("PDF 生成失败");
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: item.question || "录音问答",
          text: "录音问答 PDF",
          files: [file],
        });
        return;
      }

      downloadBlob(blob, fileName);
      onToast?.("PDF 已生成，可在下载文件中分享");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "分享失败");
    }
  }

  async function regenerateQaMessage(item, event) {
    event?.stopPropagation?.();
    const question = String(item?.question || "").trim();
    if (!question) return;
    enterQaConversationView();
    try {
      const targetScopeIds = lockedRecordingId ? [lockedRecordingId] : messageScopeFromKnown(item, activeScopeIdsRef.current, answers);
      const payload = await api("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          recordingIds: targetScopeIds,
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
        }),
      });
      if (!payload.message?.id) throw new Error("问答创建失败");
      const scopedMessage = withQaMessageScope(payload.message, targetScopeIds, [item]);
      saveActiveQaMessageRef(scopedMessage);
      setAnswers((current) => current.map((message) => (message.id === item.id ? scopedMessage : message)));
      setQaHistory((current) => [scopedMessage, ...current.filter((message) => message.id !== item.id && message.id !== scopedMessage.id)]);
      pollQaMessage(scopedMessage.id, 0, targetScopeIds);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "重新生成失败");
    }
  }

  function compactSpeechText(value) {
    return stripQaInternalIndexMarkers(
      String(value || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  function speechSegmentsFromText(value, idPrefix = "content", label = "朗读内容", maxLength = 480) {
    const chunks = [];
    const appendChunk = (rawText) => {
      const cleaned = compactSpeechText(rawText);
      if (!cleaned) return;
      if (Array.from(cleaned).length <= maxLength) {
        chunks.push(cleaned);
        return;
      }
      let buffer = "";
      for (const char of Array.from(cleaned)) {
        if (Array.from(buffer).length >= maxLength) {
          chunks.push(buffer);
          buffer = "";
        }
        buffer += char;
      }
      if (buffer) chunks.push(buffer);
    };

    const parts = String(value || "")
      .replace(/([。！？!?；;])/g, "$1\n")
      .split(/\r?\n+/);
    let current = "";

    parts.forEach((part) => {
      const cleaned = compactSpeechText(part);
      if (!cleaned) return;
      const next = current ? `${current} ${cleaned}` : cleaned;
      if (Array.from(next).length <= maxLength) {
        current = next;
        return;
      }
      appendChunk(current);
      current = "";
      appendChunk(cleaned);
    });
    appendChunk(current);

    return chunks.map((text, index) => ({
      id: `${idPrefix}-${index + 1}`,
      label: index === 0 ? label : `${label}${index + 1}`,
      text,
    }));
  }

  function structuredSpeechSegments(structured) {
    const segments = [];
    const add = (id, label, text) => {
      const cleaned = compactSpeechText(text);
      if (cleaned) segments.push({ id, label, text: cleaned });
    };

    add("overall", "整体判断", structured?.overall_judgement);
    add("judgement-level", "判断等级", structured?.judgement_level ? `判断等级：${structured.judgement_level}` : "");
    if (Array.isArray(structured?.core_basis) && structured.core_basis.length > 0) {
      add("core-basis", "核心依据", `核心依据：${structured.core_basis.join("；")}`);
    }
    (Array.isArray(structured?.analysis) ? structured.analysis : []).forEach((point, index) => {
      const title = compactSpeechText(point?.title) || pointLabelForIndex(index);
      add(`analysis-${index}-conclusion`, `${title}：结论`, `${title}。结论：${point?.conclusion || ""}`);
      add(`analysis-${index}-reason`, `${title}：原因`, `原因：${point?.reason || ""}`);
      add(`analysis-${index}-basis`, `${title}：关键依据`, `关键依据：${point?.basis || ""}`);
    });
    add("final", "最后结论", structured?.final_conclusion);
    return segments;
  }

  function speechSegmentsForAnswerItem(item, structured) {
    if (structured) {
      const cleanStructuredText = (value, fallback = "") => cleanQaVisibleText(value, fallback);
      const cleanedStructured = {
        ...structured,
        overall_judgement: cleanStructuredText(structured.overall_judgement),
        judgement_level: cleanStructuredText(structured.judgement_level),
        final_conclusion: cleanStructuredText(structured.final_conclusion),
      };
      const analysis = Array.isArray(structured.analysis)
        ? structured.analysis.map((point, index) => ({
            ...point,
            title: cleanStructuredText(point?.title, pointLabelForIndex(index)),
            conclusion: cleanStructuredText(point?.conclusion),
            reason: cleanStructuredText(point?.reason),
            basis: cleanStructuredText(point?.basis),
          }))
        : [];
      const evidences = Array.isArray(structured.evidences)
        ? structured.evidences.map((evidence, index) => ({
            ...evidence,
            evidence_title: cleanStructuredText(evidence?.evidence_title, `证据 ${index + 1}`),
            quote: cleanStructuredText(evidence?.quote),
            evidence_role: cleanStructuredText(evidence?.evidence_role),
          }))
        : [];
      const coreBasis = Array.isArray(structured.core_basis) ? structured.core_basis.map((basis) => cleanStructuredText(basis)).filter(Boolean) : [];
      return structuredSpeechSegments({ ...cleanedStructured, core_basis: coreBasis, analysis, evidences });
    }

    const text = cleanAnswerForDisplay(item?.answer || item?.content || "");
    return speechSegmentsFromText(text, "answer", "朗读结论");
  }

  async function playTtsSegment(itemId, segments, index = 0, auto = false) {
    const segment = segments[index];
    const audio = ttsAudioRef.current;
    if (!segment || !audio) return;

    const key = `${itemId}:${segment.id}`;
    ttsQueueRef.current = { itemId, segments, index };
    setTtsState({ key, itemId, index, loading: true, playing: false });

    try {
      audioRef.current?.pause();
      setActiveCitationKey("");
      const payload = await api("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: segment.text }),
      });

      if (ttsQueueRef.current.itemId !== itemId || ttsQueueRef.current.index !== index) return;
      audio.src = mediaRequestUrl(payload.url, payload.id || Date.now());
      audio.load();
      await audio.play();
      setTtsState({ key, itemId, index, loading: false, playing: true });
    } catch (error) {
      if (!auto) onToast?.(error instanceof Error ? error.message : "朗读生成失败");
      ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
      setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
    }
  }

  function startTtsQueue(itemId, segments, index = 0) {
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    playTtsSegment(itemId, segments, index);
  }

  function toggleTtsSegment(itemId, segments, index = 0) {
    const segment = segments[index];
    if (!segment) return;
    const key = `${itemId}:${segment.id}`;
    if (ttsState.key === key && (ttsState.playing || ttsState.loading)) {
      stopTtsQueue();
      return;
    }
    startTtsQueue(itemId, segments, index);
  }

  function toggleTtsQueue(itemId, segments) {
    const audio = ttsAudioRef.current;
    if (!audio) return;
    if (ttsState.itemId === itemId && ttsState.loading) {
      stopTtsQueue();
      return;
    }
    if (ttsState.itemId === itemId && ttsState.key && !ttsState.loading) {
      if (ttsState.playing) {
        stopTtsQueue();
      } else {
        audio.play().catch(() => startTtsQueue(itemId, segments, Math.max(0, ttsState.index)));
      }
      return;
    }
    startTtsQueue(itemId, segments, 0);
  }

  function citationForEvidence(evidence, citations = [], index = 0) {
    const evidenceId = String(evidence?.id || "").trim();
    const matched =
      citations.find((citation) => String(citation.evidenceId || citation.id || "").trim() === evidenceId) ||
      citations.find((citation) => citationTimeLabel(citation) === `${evidence?.start_time || ""}-${evidence?.end_time || ""}`) ||
      citations[index];
    return matched || null;
  }

  function renderStructuredAnswer(item, structured, citations) {
    const cleanStructuredText = (value, fallback = "") => cleanQaVisibleText(value, fallback);
    const cleanedStructured = {
      ...structured,
      overall_judgement: cleanStructuredText(structured.overall_judgement),
      judgement_level: cleanStructuredText(structured.judgement_level),
      final_conclusion: cleanStructuredText(structured.final_conclusion),
    };
    const analysis = Array.isArray(structured.analysis)
      ? structured.analysis.map((point, index) => ({
          ...point,
          title: cleanStructuredText(point?.title, pointLabelForIndex(index)),
          conclusion: cleanStructuredText(point?.conclusion),
          reason: cleanStructuredText(point?.reason),
          basis: cleanStructuredText(point?.basis),
        }))
      : [];
    const evidences = Array.isArray(structured.evidences)
      ? structured.evidences.map((evidence, index) => ({
          ...evidence,
          analysis_title: cleanStructuredText(evidence?.analysis_title),
          evidence_title: cleanStructuredText(evidence?.evidence_title, `证据 ${index + 1}`),
          quote: cleanStructuredText(evidence?.quote),
          evidence_role: cleanStructuredText(evidence?.evidence_role),
        }))
      : [];
    const evidenceById = new Map(evidences.map((evidence) => [String(evidence.id || ""), evidence]));
    const evidenceGroupKey = `${item.id}-structured-evidence`;
    const evidenceExpanded = Boolean(expandedCitationGroups[evidenceGroupKey]);
    const thinkingGroupKey = `${item.id}-thinking`;
    const thinkingExpanded = Boolean(expandedCitationGroups[thinkingGroupKey]);
    const thinkingSteps = thinkingStepsForMessage(item);
    const coreBasis = Array.isArray(structured.core_basis) ? structured.core_basis.map((basis) => cleanStructuredText(basis)).filter(Boolean) : [];
    const answerTitle = cleanStructuredText(item.question);
    const speakSegments = structuredSpeechSegments({ ...cleanedStructured, core_basis: coreBasis, analysis, evidences });
    const speakIndexById = new Map(speakSegments.map((segment, index) => [segment.id, index]));
    const renderSpeakText = (segmentId, children, className = "") => {
      const index = speakIndexById.get(segmentId);
      const activeKey = `${item.id}:${segmentId}`;
      if (index === undefined) return children;
      return (
        <button
          className={`${className} speakable-text ${ttsState.key === activeKey ? "active" : ""}`.trim()}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTtsSegment(item.id, speakSegments, index);
          }}
        >
          {children}
        </button>
      );
    };

    return (
      <div className="chat-answer structured">
        {answerTitle ? <h2 className="answer-card-title">{answerTitle}</h2> : null}
        <button className={`thinking-summary ${thinkingExpanded ? "expanded" : ""}`} type="button" onClick={() => toggleCitationGroup(thinkingGroupKey)}>
          <Check size={14} />
          <span>{thinkingExpanded ? "收起思考过程" : "已思考，深度分析完成"}</span>
          {thinkingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {thinkingExpanded ? (
          <div className="thinking-detail-panel">
            <strong>思考过程</strong>
            <ol>
              {thinkingSteps.map((step, index) => (
                <li key={`${item.id}-thinking-${index}`}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {cleanedStructured.overall_judgement ? (
          <section className="structured-section">
            <h3>整体判断</h3>
            {renderSpeakText("overall", cleanedStructured.overall_judgement, "structured-paragraph")}
          </section>
        ) : null}

        {cleanedStructured.judgement_level || coreBasis.length > 0 ? (
          <section className="structured-section judgement-section">
            <h3>判断等级 / 核心依据</h3>
            {cleanedStructured.judgement_level ? (
              renderSpeakText("judgement-level", <span className="judgement-level-badge">{cleanedStructured.judgement_level}</span>, "structured-inline-text")
            ) : null}
            {coreBasis.length > 0 ? (
              <ul className="core-basis-list">
                {coreBasis.map((basis, index) => (
                  <li key={`${item.id}-core-basis-${index}`}>
                    {renderSpeakText("core-basis", basis, "structured-inline-text")}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {analysis.length > 0 ? (
          <section className="structured-section">
            <h3>分点分析</h3>
            <div className="analysis-list">
              {analysis.map((point, index) => (
                <article className="analysis-card" key={`${item.id}-analysis-${index}`}>
                  <h4>{point.title || pointLabelForIndex(index)}</h4>
                  <dl>
                    <div>
                      <dt>结论</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-conclusion`,
                          point.conclusion || "原文证据不足",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>原因</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-reason`,
                          point.reason || "原文证据不足，无法进一步判断。",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>关键依据</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-basis`,
                          point.basis || "原文证据不足",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                  </dl>
                  {Array.isArray(point.evidence_ids) && point.evidence_ids.length > 0 ? (
                    <div className="analysis-evidence-tags" aria-label="关联证据">
                      {point.evidence_ids.map((id) => {
                        const evidence = evidenceById.get(String(id));
                        return evidence ? <span key={`${point.title}-${id}`}>{evidence.evidence_title || id}</span> : null;
                      })}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {evidences.length > 0 ? (
          <section className="structured-section evidence-section">
            <button className="citation-fold-button" type="button" onClick={() => toggleCitationGroup(evidenceGroupKey)}>
              {evidenceExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {evidenceExpanded ? "收起" : "展开"} {evidences.length} 条原文证据索引
            </button>
            {evidenceExpanded ? (
              <div className="evidence-card-list">
                {evidences.map((evidence, index) => {
                  const citation = citationForEvidence(evidence, citations, index);
                  const key = citation ? citationKey(citation, index) : `${item.id}-evidence-${index}`;
                  const durationMs = citation ? citationSegmentDurationMs(citation) : 0;
                  const progressMs = citation ? citationProgressOffsetMs(citation, key) : 0;
                  return (
                    <article className="evidence-card" key={key}>
                      <header>
                        <strong>{evidence.evidence_title || `证据 ${index + 1}`}</strong>
                        <span>
                          {evidence.start_time || formatTimecode(citation?.startMs || 0)} - {evidence.end_time || formatTimecode(citation?.endMs || 0)}
                        </span>
                      </header>
                      {evidence.quote ? <p className="evidence-quote">{evidence.quote}</p> : null}
                      {evidence.evidence_role ? <p className="evidence-role">{evidence.evidence_role}</p> : null}
                      <div className="evidence-player">
                        <button
                          className={activeCitationKey === key ? "active" : ""}
                          type="button"
                          disabled={!citation}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (citation) playCitation(citation, key);
                          }}
                        >
                          {activeCitationKey === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                          <span>复听</span>
                        </button>
                        {citation ? (
                          <input
                            type="range"
                            min="0"
                            max={durationMs}
                            step="1000"
                            value={progressMs}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => seekCitation(citation, key, citationStartMs(citation) + Number(event.target.value))}
                            aria-label={`拖动证据 ${index + 1} 播放进度`}
                          />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {cleanedStructured.final_conclusion ? (
          <section className="structured-section final-conclusion">
            <h3>最后结论</h3>
            {renderSpeakText("final", cleanedStructured.final_conclusion, "structured-paragraph")}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <section className="screen detail-screen chat-detail-screen" aria-label="录音问答">
      <header className="chat-page-header compact">
        <button
          className={historyOpen ? "chat-history-title-button active" : "chat-history-title-button"}
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-label={historyOpen ? "关闭历史聊天记录" : "打开历史聊天记录"}
        >
          <span className="history-bars" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
        <h1>{uiText(language, "问答", "QA")}</h1>
        <span>{scopeLabel}</span>
      </header>

      <aside
        className={historyOpen ? "chat-history-panel open" : "chat-history-panel"}
        aria-label="历史聊天记录"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{historyMode === "favorites" ? "收藏夹" : "历史聊天记录"}</strong>
            <span>{historyMode === "favorites" ? `${visibleHistoryMessages.length} 条收藏` : `${visibleHistoryCount} 条记录`}</span>
          </div>
          <button type="button" onClick={() => setHistoryOpen(false)}>
            <X size={16} />
          </button>
        </header>

        <div className="chat-history-tabs" role="tablist" aria-label="历史类型">
          <button
            className={historyMode === "history" ? "active" : ""}
            type="button"
            onPointerDown={(event) => switchHistoryMode("history", event)}
            onClick={(event) => switchHistoryMode("history", event)}
          >
            历史
          </button>
          <button
            className={historyMode === "favorites" ? "active" : ""}
            type="button"
            onPointerDown={(event) => switchHistoryMode("favorites", event)}
            onClick={(event) => switchHistoryMode("favorites", event)}
          >
            收藏夹
          </button>
        </div>

        <div className="chat-history-list">
          {visibleHistoryCount > 0 ? (
            <>
              {visibleDailyBriefHistory.map((brief) => (
                <article
                  className="chat-history-item daily-brief-history-item"
                  key={brief.id || brief.date}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDailyBriefHistoryItem(brief)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDailyBriefHistoryItem(brief);
                    }
                  }}
                >
                  <button
                    className="chat-history-main"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDailyBriefHistoryItem(brief);
                    }}
                  >
                    <span>{brief.displayDate || brief.date}</span>
                    <strong>{brief.title || "今日会议简报"}</strong>
                    <em>
                      {Number(brief.meetingCount || 0)} 场会议 · {brief.status === "generating" ? "生成中" : brief.summaryMarkdown ? "已生成" : "暂无内容"}
                    </em>
                  </button>
                  <div className="chat-history-actions" aria-label="今日总结操作">
                    <button
                      className="history-share-button"
                      type="button"
                      aria-label="分享 PDF"
                      disabled={brief.status === "generating" || !brief.summaryMarkdown}
                      onClick={(event) => shareDailyBriefPdf(brief, event)}
                    >
                      {brief.status === "generating" ? <LoaderCircle className="spin-icon" size={14} /> : <Share2 size={14} />}
                    </button>
                  </div>
                </article>
              ))}
              {visibleHistoryMessages.map((item) => (
                <article
                className={item.favorite ? "chat-history-item favorite" : "chat-history-item"}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openHistoryItem(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openHistoryItem(item);
                  }
                }}
              >
                <button
                  className="chat-history-main"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openHistoryItem(item);
                  }}
                >
                  <span>{formatDate(item.createdAt)}</span>
                  <strong>{item.question}</strong>
                  {item.recordingNames?.length ? <em>{item.recordingNames.slice(0, 2).join("、")}</em> : null}
                </button>
                <div className="chat-history-actions" aria-label="问答操作">
                  <button
                    className="history-favorite-button"
                    type="button"
                    aria-label={item.favorite ? "取消收藏" : "收藏"}
                    onClick={(event) => toggleHistoryFavorite(item, event)}
                  >
                    <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
                  </button>
                  <button className="history-share-button" type="button" aria-label="分享 PDF" onClick={(event) => shareHistoryMessage(item, event)}>
                    <Share2 size={14} />
                  </button>
                  <button className="history-delete-button" type="button" aria-label="删除问答" onClick={(event) => deleteHistoryMessage(item, event)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
              ))}
            </>
          ) : (
            <p>{historyMode === "favorites" ? "还没有收藏的问答" : "还没有历史提问"}</p>
          )}
        </div>
      </aside>

      <section className={scopeExpanded ? "recording-scope-panel expanded" : "recording-scope-panel collapsed"} aria-label="选择录音">
        <div className="scope-toolbar">
          <button
            className={activeScopeIds.length === 0 ? "scope-all active" : "scope-all"}
            type="button"
            onClick={resetToAllRecordings}
          >
            {uiText(language, "全部录音", "All")}
          </button>
          <button
            className="scope-single"
            type="button"
            onClick={() => setScopeExpanded(true)}
            disabled={listLoading || activeRecordings.length === 0}
          >
            {listLoading ? uiText(language, "刷新中", "Refreshing") : uiText(language, "单选", "Single select")}
          </button>
          {activeRecordings.length > 0 ? (
            <button className="scope-toggle" type="button" onClick={() => setScopeExpanded((current) => !current)}>
              {scopeExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {scopeExpanded ? uiText(language, "收起", "Collapse") : uiText(language, "展开", "Expand")}
            </button>
          ) : null}
        </div>

        {listError ? <div className="scope-alert">{listError}</div> : null}

        {!scopeExpanded && activeRecordings.length > 0 ? (
          <button className="recording-scope-summary" type="button" onClick={openCurrentScopeConversation}>
            <span>{activeScopeIds.length === 0 ? "当前范围" : "正在询问"}</span>
            <strong>{scopeLabel}</strong>
            <em>{scopeSummaryMeta}</em>
          </button>
        ) : visibleRecordings.length > 0 ? (
          <div className="recording-scope-grid">
            {visibleRecordings.map((item) => {
              const selected = activeScopeIds.includes(item.id);
              const classes = [
                "scope-recording",
                selected ? "active" : "",
                isToday(item.createdAt) ? "is-today" : "is-past",
                hasHistoryForRecording(item.id) ? "has-history" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button className={classes} key={item.id} type="button" onClick={() => toggleScope(item.id)}>
                  <strong>{formatShortDate(item.createdAt)}</strong>
                  <span>{item.name}</span>
                  <em>{formatDuration(item.durationMs)}</em>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="scope-empty">暂无可提问的录音</div>
        )}
      </section>

      <div
        className={chatThreadClassName}
        ref={chatThreadRef}
        aria-label="问答记录"
      >
          {shouldShowDailyBriefCard ? (
            <DailyMeetingBriefCard
              brief={dailyBrief}
              loading={dailyBriefLoading}
              meetingCount={dailyBriefMeetingCount(dailyBrief, todayBriefRecordings.length)}
              onOpen={openDailyBriefCard}
            />
          ) : null}
          {shouldShowDailyBriefList ? (
            <DailyBriefListView
              briefs={dailyBriefList}
              expandedDates={expandedDailyBriefDates}
              generatingDates={dailyBriefGeneratingDates}
              ttsState={ttsState}
              refreshingRecordingIds={dailyBriefRefreshingRecordingIds}
              onToggle={toggleDailyBriefDate}
              onGenerate={generateDailyBriefForDate}
              onSpeak={speakDailyBrief}
              onSpeakLine={speakDailyBriefLine}
              onShare={shareDailyBriefPdf}
              onRefreshRecording={refreshDailyBriefRecordingItem}
            />
          ) : answers.length > 0 ? (
            answers.map((item) => {
            if (item.type === "daily-brief") {
              return (
                <DailyMeetingBriefMessage
                  key={item.id}
                  message={item}
                  ttsState={ttsState}
                  refreshingRecordingIds={dailyBriefRefreshingRecordingIds}
                  onSpeakLine={speakDailyBriefLine}
                  onShare={shareDailyBriefPdf}
                  onRefreshRecording={refreshDailyBriefRecordingItem}
                />
              );
            }
            const blocks = answerBlocksForDisplay(item.answer);
            const displayBlocks = blocks.length > 0 ? blocks : [cleanAnswerForDisplay(item.answer) || "暂无可展示的回答内容，请重新生成。"];
            const citations = Array.isArray(item.citations) ? item.citations : [];
            const structuredAnswer = structuredAnswerFromItem(item);
            const answerSpeakSegments = item.pending ? [] : speechSegmentsForAnswerItem(item, structuredAnswer);
            const answerTtsActive = ttsState.itemId === item.id;
            const answerTtsRunning = answerTtsActive && (ttsState.playing || ttsState.loading);
            const messageAttachments = Array.isArray(item.attachments) ? item.attachments : [];
            return (
              <article className="chat-message" key={item.id}>
                <div className="chat-question">{item.question}</div>
                <time className="chat-message-time">{formatDate(item.createdAt)}</time>
                {messageAttachments.length > 0 ? (
                  <div className="chat-message-attachments" aria-label="已上传附件">
                    {messageAttachments.map((attachment, attachmentIndex) => {
                      const previewType = attachmentPreviewType(attachment);
                      return (
                        <button
                          key={attachment.id || attachment.fileId || `${item.id}-attachment-${attachmentIndex}`}
                          type="button"
                          onClick={() => openAttachmentPreview(attachment, previewType)}
                        >
                          <span>{previewType === "image" ? "图片" : previewType === "audio" ? "录音" : previewType === "location" ? "地址" : "文件"}</span>
                          <strong>{attachment.name || "附件"}</strong>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {item.pending ? (
                  <div className="chat-thinking pending-thinking">
                    <div className="pending-thinking-title">
                      <LoaderCircle className="spin-icon" size={16} />
                      <span>正在深度思考并核对原文证据</span>
                    </div>
                    <ol>
                      {thinkingStepsForMessage(item).map((step, index) => (
                        <li key={`${item.id}-pending-thinking-${index}`}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : structuredAnswer ? (
                  renderStructuredAnswer(item, structuredAnswer, citations)
                ) : (
                  <div className="chat-answer">
                    {displayBlocks.map((block, index) => {
                      const blockCitations = citationsForBlock(block, index, displayBlocks, citations);
                      const groupKey = `${item.id}-point-${index}`;
                      const expanded = Boolean(expandedCitationGroups[groupKey]);
                      return (
                        <section className="chat-answer-point" key={groupKey}>
                          <p>{block}</p>
                          {blockCitations.length > 0 ? (
                            <div className="chat-citation-panel" aria-label={`${pointLabelForIndex(index)}依据`}>
                              <button className="citation-fold-button" type="button" onClick={() => toggleCitationGroup(groupKey)}>
                                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                {expanded ? "收起" : "展开"} {blockCitations.length} 个时间点
                              </button>
                              {expanded ? (
                                <div className="citation-bar-list">
                                  {blockCitations.map((citation, citationIndex) => {
                                    const absoluteIndex = citation._citationIndex ?? citationIndex;
                                    const key = citationKey(citation, absoluteIndex);
                                    const durationMs = citationSegmentDurationMs(citation);
                                    const progressMs = citationProgressOffsetMs(citation, key);
                                    return (
                                      <div className="citation-bar" key={key}>
                                        <button
                                          className={activeCitationKey === key ? "active" : ""}
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            playCitation(citation, key);
                                          }}
                                          title={citationTimeLabel(citation)}
                                          aria-label={`播放依据 ${absoluteIndex + 1}：${citationTimeLabel(citation)}`}
                                        >
                                          {activeCitationKey === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                                        </button>
                                        <div>
                                          <strong>{citationTimeLabel(citation)}</strong>
                                          <em>{citation.recordingName || `依据 ${absoluteIndex + 1}`}</em>
                                        </div>
                                        <input
                                          type="range"
                                          min="0"
                                          max={durationMs}
                                          step="1000"
                                          value={progressMs}
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                          }}
                                          onChange={(event) => {
                                            event.preventDefault();
                                            seekCitation(citation, key, citationStartMs(citation) + Number(event.target.value));
                                          }}
                                          aria-label={`拖动依据 ${absoluteIndex + 1} 播放进度`}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}
                {!item.pending ? (
                  <div className="chat-message-actions" aria-label="问答操作">
                    <button type="button" onClick={(event) => regenerateQaMessage(item, event)}>
                      <RefreshCw size={14} />
                      <span>重新生成</span>
                    </button>
                    {answerSpeakSegments.length > 0 ? (
                      <button
                        className={answerTtsRunning ? "playing" : ""}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleTtsQueue(item.id, answerSpeakSegments);
                        }}
                      >
                        {answerTtsRunning ? (
                          <Pause size={14} fill="currentColor" />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                        <span>{answerTtsRunning ? "朗读停止" : "朗读播放"}</span>
                      </button>
                    ) : null}
                    <button type="button" onClick={(event) => shareHistoryMessage(item, event)}>
                      <Share2 size={14} />
                      <span>分享 PDF</span>
                    </button>
                  </div>
                ) : null}
              </article>
            );
            })
          ) : shouldShowDailyBriefCard ? null : (
            <div className="chat-empty">
              <h2>{uiText(language, "开始提问", "Ask a question")}</h2>
            </div>
          )}
        <div ref={chatEndRef} className="chat-thread-end" aria-hidden="true" />
      </div>

      <form className={attachmentsOpen ? "chat-dock attachments-open" : "chat-dock"} onSubmit={askRecordings}>
        {images.length > 0 || attachments.length > 0 ? (
          <div className="chat-attachment-chips">
            {images.map((item) => (
              <span key={item.id}>
                <button className="attachment-chip-main" type="button" onClick={() => openAttachmentPreview(item, "image")}>
                  <em>{item.name}</em>
                </button>
                <button type="button" aria-label="移除图片" onClick={() => setImages((current) => current.filter((image) => image.id !== item.id))}>
                  <X size={13} />
                </button>
              </span>
            ))}
            {attachments.map((item) => (
              <span key={item.id}>
                <button className="attachment-chip-main" type="button" onClick={() => openAttachmentPreview(item, item.kind || "file")}>
                  <em>{item.name}</em>
                </button>
                <button type="button" aria-label="移除附件" onClick={() => setAttachments((current) => current.filter((attachment) => attachment.id !== item.id))}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-mode-button"
            aria-label={composerMode === "voice" ? "切换文字输入" : "切换语音输入"}
            onClick={() => setComposerMode((current) => (current === "voice" ? "text" : "voice"))}
          >
            {composerMode === "voice" ? <Keyboard size={20} /> : <Mic size={20} />}
          </button>

          {composerMode === "voice" ? (
            <button
              className={listening ? "hold-talk-button recording" : "hold-talk-button"}
              type="button"
              disabled={voiceBusy}
              onPointerDown={startVoiceInput}
              onPointerUp={stopVoiceInput}
              onPointerCancel={stopVoiceInput}
              onPointerLeave={stopVoiceInput}
              onContextMenu={(event) => event.preventDefault()}
            >
              {listening ? (
                <span className="voice-input-wave" aria-hidden="true">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <i key={index} style={{ "--i": index }} />
                  ))}
                </span>
              ) : null}
              <span>{voiceBusy ? "正在转文字..." : listening ? "松开转文字" : "按住说话"}</span>
            </button>
          ) : (
            <textarea
              value={question}
              rows={composerRows}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder=""
              aria-label="输入问题"
            />
          )}

          <button
            type="button"
            className={attachmentsOpen ? "chat-plus-button active" : "chat-plus-button"}
            aria-label={attachmentsOpen ? "收起上传菜单" : "添加内容"}
            onClick={() => setAttachmentsOpen((current) => !current)}
          >
            <Plus size={22} />
          </button>

          {composerMode === "text" ? (
            <button className="chat-send-button" type="submit" aria-label="发送问题" disabled={!question.trim() && images.length === 0 && attachments.length === 0}>
              <Send size={19} />
            </button>
          ) : null}
        </div>

        {attachmentsOpen ? (
          <div className="chat-attach-panel" aria-label="添加内容">
            <button type="button" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus size={22} />
              图片
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()}>
              <Camera size={22} />
              拍照
            </button>
            <button type="button" onClick={() => audioQuestionInputRef.current?.click()}>
              <FileAudio size={22} />
              录音
            </button>
            <button type="button" onClick={() => fileQuestionInputRef.current?.click()}>
              <FileUp size={22} />
              文件
            </button>
            <button type="button" onClick={addLocationAttachment}>
              <Link size={22} />
              地址
            </button>
          </div>
        ) : null}

        <input ref={imageInputRef} className="upload-input" type="file" accept="image/*" multiple onChange={addImages} />
        <input ref={cameraInputRef} className="upload-input" type="file" accept="image/*" capture="environment" onChange={addCameraImage} />
        <input ref={audioQuestionInputRef} className="upload-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.webm,.aac" onChange={addQuestionAudio} />
        <input ref={fileQuestionInputRef} className="upload-input" type="file" accept=".txt,.md,.csv,.json,.log,text/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={addQuestionFile} />
      </form>

      {attachmentPreview ? (
        <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label="附件预览" onClick={closeAttachmentPreview}>
          <section className="attachment-preview-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>{attachmentPreview.name || "附件"}</strong>
                <span>{attachmentPreviewType(attachmentPreview) === "image" ? "图片" : attachmentPreviewType(attachmentPreview) === "location" ? "地址" : attachmentPreviewType(attachmentPreview) === "audio" ? "录音" : "文件"}</span>
              </div>
              <button type="button" onClick={closeAttachmentPreview} aria-label="关闭附件预览">
                <X size={16} />
              </button>
            </header>
            {attachmentPreviewType(attachmentPreview) === "image" && attachmentPreviewUrl(attachmentPreview) ? (
              <img src={attachmentPreviewUrl(attachmentPreview)} alt={attachmentPreview.name || "上传图片"} />
            ) : attachmentPreviewType(attachmentPreview) === "audio" && attachmentPreviewUrl(attachmentPreview) ? (
              <audio controls src={attachmentPreviewUrl(attachmentPreview)} />
            ) : attachmentPreview.url ? (
              <a href={attachmentPreviewUrl(attachmentPreview)} target="_blank" rel="noreferrer">
                打开附件：{attachmentPreview.name || attachmentPreview.url}
              </a>
            ) : attachmentPreview.text ? (
              <pre>{attachmentPreview.text}</pre>
            ) : attachmentPreview.dataUrl ? (
              <a href={attachmentPreview.dataUrl} target="_blank" rel="noreferrer" download={attachmentPreview.name || "attachment"}>
                打开附件：{attachmentPreview.name || "附件"}
              </a>
            ) : (
              <p>这个附件目前只有文件名信息，发送后会作为提问上下文的一部分；如需查看完整内容，请选择文本类文件或图片。</p>
            )}
          </section>
        </div>
      ) : null}

    </section>
  );
}

function LegacyDetailView({ recording, transcriptionStatus, onBack, onRefreshRecording, onRename, onUpdateMeta }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(recording?.durationMs ? recording.durationMs / 1000 : 0);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);
  const [asking, setAsking] = useState(false);
  const [draftName, setDraftName] = useState(recording?.name || "");
  const [nameStatus, setNameStatus] = useState("saved");
  const [draftTag, setDraftTag] = useState(recording?.tag || "");
  const [tagStatus, setTagStatus] = useState("saved");
  const [speakerDrafts, setSpeakerDrafts] = useState(() => speakerDraftsForRecording(recording));
  const [selectedSpeakerKey, setSelectedSpeakerKey] = useState("");
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const speakers = useMemo(() => speakersForRecording(recording), [recording]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(recording?.durationMs ? recording.durationMs / 1000 : 0);
    setAnswers([]);
    setQuestion("");
    setDraftName(recording?.name || "");
    setNameStatus("saved");
    setDraftTag(recording?.tag || "");
    setTagStatus("saved");
    setSpeakerDrafts(speakerDraftsForRecording(recording));
    setSelectedSpeakerKey(speakersForRecording(recording)[0]?.key || "");
    setTranscriptExpanded(false);
  }, [recording?.id, recording?.name, recording?.durationMs, recording?.speakerName, recording?.tag, recording?.speakerMap, recording?.speakers]);

  if (!recording) {
    return (
      <section className="screen detail-screen">
        <button className="ghost-back" type="button" onClick={onBack}>
          <ArrowLeft size={20} />
          返回
        </button>
        <div className="empty-state">
          <div className="empty-icon">
            <ListMusic size={40} />
          </div>
          <h2>还没有可查看的详情</h2>
          <p>录一段音后，详情页会显示播放、转写和提问。</p>
        </div>
      </section>
    );
  }

  function seekTo(ms) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, ms / 1000);
    setCurrent(audio.currentTime);
    audio.play().catch(() => {});
  }

  function skip(seconds) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || duration || 0, audio.currentTime + seconds));
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  async function askRecording(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    setAsking(true);
    try {
      const payload = await api(`/api/recordings/${recording.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      setAnswers((currentAnswers) => [payload.message, ...currentAnswers]);
      setQuestion("");
    } finally {
      setAsking(false);
    }
  }

  async function transcribeAgain() {
    await api(`/api/recordings/${recording.id}/transcribe`, { method: "POST" });
    onRefreshRecording(recording.id);
  }

  async function commitDetailMeta() {
    const tag = draftTag.trim();
    setDraftTag(tag);
    if (tag !== (recording.tag || "")) {
      setTagStatus("saving");
      try {
        await onUpdateMeta(recording.id, { tag });
        setTagStatus("saved");
      } catch {
        setTagStatus("dirty");
      }
      return;
    }
    setTagStatus("saved");
  }

  async function commitDetailName() {
    const nextName = draftName.trim() || recording.name;
    setDraftName(nextName);
    if (nextName !== recording.name) {
      setNameStatus("saving");
      try {
        await onRename(recording.id, nextName);
        setNameStatus("saved");
      } catch {
        setNameStatus("dirty");
      }
      return;
    }
    setNameStatus("saved");
  }

  function updateSpeakerDraft(key, value) {
    setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: value }));
  }

  function commitSpeakerName(key) {
    const nextName = (speakerDrafts[key] || "").trim() || "说话人";
    const nextSpeakerMap = {
      ...(recording.speakerMap || {}),
      [key]: nextName,
    };
    setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: nextName }));
    onUpdateMeta(recording.id, { speakerMap: nextSpeakerMap, speakerName: speakers[0]?.key === key ? nextName : recording.speakerName });
  }

  const transcriptText = recording.transcriptText || recording.transcript.map((line) => line.text).join("\n");
  const transcriptHealth = recording.transcriptHealth || transcriptionStatus || {};
  const isFallbackTranscript = Boolean(transcriptHealth.isFallback);

  return (
    <section className="screen detail-screen" aria-label="录音详情">
      <header className="detail-header">
        <button className="ghost-back" type="button" onClick={onBack}>
          <ArrowLeft size={20} />
          记录
        </button>
        <span className={`detail-status ${recording.status}`}>
          {recording.status === "ready" ? "转写完成" : recording.status === "failed" ? "转写失败" : "服务处理中"}
        </span>
      </header>

      <div className="detail-title-row">
        <div>
          <p className="eyebrow">录音 {String(recording.seq).padStart(3, "0")}</p>
          <input
            className={`detail-title-input ${nameStatus}`}
            aria-label="录音名称"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
              setNameStatus("dirty");
            }}
            onBlur={commitDetailName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <span className={`favorite-badge ${recording.favorite ? "on" : ""}`}>
          <Star size={16} fill={recording.favorite ? "currentColor" : "none"} />
          {recording.favorite ? "已收藏" : "普通"}
        </span>
      </div>

      <div className="detail-meta-editor">
        <label>
          标记
          <div className={`tag-save-field ${tagStatus}`}>
            <input
              value={draftTag}
              onChange={(event) => {
                setDraftTag(event.target.value);
                setTagStatus("dirty");
              }}
              onBlur={() => {
                commitDetailMeta();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="例如：物业、会议、客户"
            />
            <button
              type="button"
              disabled={tagStatus === "saving"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={commitDetailMeta}
            >
              {tagStatus === "saving" ? <LoaderCircle className="spin-icon" size={15} /> : <Check size={15} />}
              <span>{tagStatus === "dirty" ? "保存" : tagStatus === "saving" ? "保存中" : "已保存"}</span>
            </button>
          </div>
        </label>
      </div>

      <div className="speaker-editor" aria-label="说话人">
        {speakers.map((speaker) => (
          <div className={selectedSpeakerKey === speaker.key ? "speaker-editor-row active" : "speaker-editor-row"} key={speaker.key}>
            <button type="button" onClick={() => setSelectedSpeakerKey((current) => (current === speaker.key ? "" : speaker.key))}>
              <UserRound size={15} />
              <span>{formatDuration(speaker.totalMs)}</span>
            </button>
            <input
              value={speakerDrafts[speaker.key] || speaker.name}
              onChange={(event) => updateSpeakerDraft(speaker.key, event.target.value)}
              onBlur={() => commitSpeakerName(speaker.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label={`${speaker.name}名称`}
            />
          </div>
        ))}
      </div>

      <div className="player-panel">
        <audio
          ref={audioRef}
            src={mediaRequestUrl(recording.audioUrl, recording.updatedAt || recording.createdAt)}
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || recording.durationMs / 1000)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        />
        <div className="mini-wave">
          {Array.from({ length: 28 }).map((_, index) => (
            <span key={index} style={{ "--bar": `${24 + ((index * 37) % 58)}%` }} />
          ))}
        </div>
        <input
          className="progress"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={Math.min(current, duration || 1)}
          onChange={(event) => seekTo(Number(event.target.value) * 1000)}
          aria-label="播放进度"
        />
        <div className="time-row">
          <span>{formatDuration(current * 1000)}</span>
          <span>{formatDuration((duration || 0) * 1000)}</span>
        </div>
        <div className="player-controls">
          <IconButton label="后退十秒" onClick={() => skip(-10)}>
            <Rewind size={23} />
          </IconButton>
          <button className="play-button" type="button" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <IconButton label="快进十秒" onClick={() => skip(10)}>
            <FastForward size={23} />
          </IconButton>
        </div>
      </div>

      <div className="detail-lower">
        <div className={transcriptExpanded ? "transcript-panel expanded" : "transcript-panel collapsed"}>
          <div className="panel-heading">
            <div>
              <h2>转写内容</h2>
              <span className={isFallbackTranscript ? "transcript-health warn" : "transcript-health"}>
                {isFallbackTranscript
                  ? "模拟转写，需要重新转写"
                  : transcriptHealth.configured === false
                    ? "真实转写未配置"
                    : `转写服务：${recording.transcriptProvider || transcriptionStatus?.mode || "local"}`}
              </span>
            </div>
            <div className="transcript-actions">
              <button type="button" onClick={() => setTranscriptExpanded((current) => !current)}>
                {transcriptExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {transcriptExpanded ? "收起" : "展开"}
              </button>
              <button type="button" onClick={transcribeAgain}>
                <RefreshCw size={16} />
                重新转写
              </button>
            </div>
          </div>
          {transcriptHealth.message ? <p className={isFallbackTranscript ? "transcript-warning" : "transcript-note"}>{transcriptHealth.message}</p> : null}
          {transcriptText ? (
            <div className="transcript-full">
              <h3>全文</h3>
              <p>{transcriptText}</p>
            </div>
          ) : null}
          <div className="transcript-lines">
            {recording.transcript.length > 0 ? (
              recording.transcript.map((line) => (
                <button
                  className={`transcript-line${selectedSpeakerKey && line.speakerKey === selectedSpeakerKey ? " is-highlight" : ""}${
                    selectedSpeakerKey && line.speakerKey !== selectedSpeakerKey ? " is-dim" : ""
                  }`}
                  key={line.id}
                  type="button"
                  onClick={() => seekTo(line.startMs)}
                >
                  <span>{formatTimecode(line.startMs)}</span>
                  <strong>
                    <em>{line.speakerName || recording.speakerName || "说话人 1"}</em>
                    {line.text}
                  </strong>
                </button>
              ))
            ) : (
              <p className="muted-copy">服务器正在分析音频，稍后刷新即可查看转写。</p>
            )}
          </div>
        </div>

        <div className="ask-panel">
          <form className="ask-form" onSubmit={askRecording}>
            <Search size={18} />
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="对这条录音提问" />
            <button type="submit" aria-label="发送问题" disabled={asking}>
              {asking ? <LoaderCircle className="spin-icon" size={18} /> : <Send className="send-icon" size={18} />}
            </button>
          </form>

          {answers.length > 0 ? (
            <div className="answer-list">
              {answers.map((item) => (
                <article key={item.id} className="answer-card">
                  <strong>{item.question}</strong>
                  <p>{item.answer}</p>
                  {Array.isArray(item.citations) && item.citations.length > 0 ? (
                    <div className="answer-citations" aria-label="回答索引">
                      {item.citations.map((citation) => (
                        <button
                          type="button"
                          key={`${citation.segmentId}-${citation.startMs}`}
                          onClick={() => seekTo(citation.startMs)}
                        >
                          <span>{formatTimecode(citation.startMs)}</span>
                          <em>{citation.text}</em>
                        </button>
                      ))}
                    </div>
                  ) : typeof item.jumpToMs === "number" ? (
                    <button type="button" onClick={() => seekTo(item.jumpToMs)}>
                      定位到 {formatTimecode(item.jumpToMs)}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ShareSheet({ share, onCopy, onClose }) {
  if (!share) return null;

  return (
    <div className="share-sheet-layer">
      <button className="share-sheet-scrim" type="button" aria-label="关闭分享面板" onClick={onClose} />
      <section className="share-sheet" aria-label="分享录音">
        <header>
          <div>
            <p className="eyebrow">Share</p>
            <h2>分享录音</h2>
          </div>
          <IconButton label="关闭分享" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <textarea readOnly value={share.text} onFocus={(event) => event.currentTarget.select()} />
        <button className="primary-pill" type="button" onClick={onCopy}>
          <Share2 size={17} />
          复制分享内容
        </button>
      </section>
    </div>
  );
}

function SettingsDrawer({ open, profile, auth, setProfile, onAccountEnter, onAccountLogout, onClose }) {
  const language = profile.language || "中文";
  const detectedName = String(profile.wecomName || "").trim();
  const loggedIn = Boolean(auth?.account?.username);
  const loggedInName = String(auth?.account?.username || auth?.profile?.username || profile.username || "").trim();
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [accountName, setAccountName] = useState(auth?.account?.username || profile.username || "");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMode, setAccountMode] = useState("register");
  const [accountBusy, setAccountBusy] = useState(false);
  const accountDisplayName = loggedIn ? loggedInName || accountName.trim() : "";
  const displayName = loggedIn
    ? accountDisplayName || detectedName || String(profile.name || "").trim() || uiText(language, "未设置姓名", "Name not set")
    : uiText(language, "未登录", "Signed out");
  const displaySubline = loggedIn
    ? avatarBusy
      ? uiText(language, "正在压缩头像...", "Compressing avatar...")
      : profile.company || uiText(language, "企业微信", "WeCom")
    : uiText(language, "登录账号后同步个人资料", "Sign in to sync profile");

  useEffect(() => {
    if (auth?.account?.username) setAccountName(auth.account.username);
    else if (profile.username) setAccountName(profile.username);
    else setAccountName("");
  }, [auth?.account?.username, profile.username]);

  async function submitAccount() {
    const username = accountName.trim();
    const password = accountPassword;
    if (loggedIn || !username || !password || accountBusy) return;
    setAccountBusy(true);
    try {
      await onAccountEnter?.({ username, password, mode: accountMode });
      setAccountPassword("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : uiText(language, accountMode === "login" ? "登录失败" : "注册账号失败", "Account failed"));
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAvatarChange(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || avatarBusy) return;
    if (!isImageFile(file)) {
      window.alert(uiText(language, "请选择图片文件", "Please choose an image file"));
      return;
    }
    setAvatarBusy(true);
    try {
      const avatarUrl = await compressAvatarImage(file);
      setProfile((current) => {
        const next = { ...current, avatarUrl };
        saveLocalProfile(next);
        return next;
      });
    } catch (error) {
      console.warn("Avatar compression failed:", error);
      window.alert(
        uiText(
          language,
          error instanceof Error ? error.message : "图片太大，请重新上传。",
          "The avatar image is too large or cannot be read. Please upload a smaller image.",
        ),
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className={open ? "drawer-layer open" : "drawer-layer"} aria-hidden={!open}>
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label={uiText(language, "关闭设置遮罩", "Close settings")} tabIndex={open ? 0 : -1} />
      <aside className={loggedIn ? "settings-drawer settings-drawer-signed-in" : "settings-drawer"} inert={open ? undefined : true}>
        <header>
          <div>
            <p className="eyebrow">Settings</p>
            <h2>{uiText(language, "个人信息", "Profile")}</h2>
          </div>
          <IconButton label={uiText(language, "关闭设置面板", "Close settings panel")} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>

        <div className="profile-card">
          <button
            className="avatar-uploader"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarBusy}
            aria-busy={avatarBusy}
            aria-label={uiText(language, "上传头像", "Upload avatar")}
          >
            <span className="avatar">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <UserRound size={34} />}
            </span>
          </button>
          <input ref={avatarInputRef} className="avatar-input" type="file" accept="image/*" onChange={handleAvatarChange} tabIndex={-1} />
          <div>
            <strong>{displayName}</strong>
            <span>{displaySubline}</span>
          </div>
        </div>

        {loggedIn ? (
          <div className="settings-logout-footer">
            <button className="account-logout-button" type="button" onClick={onAccountLogout}>
              {uiText(language, "退出登录", "Sign out")}
            </button>
          </div>
        ) : (
          <section className="account-card" aria-label={uiText(language, "账号", "Account")}>
            <div className="account-card-header">
              <strong>{uiText(language, "账号管理", "Account")}</strong>
            </div>
            <div className="account-tabs" role="tablist" aria-label={uiText(language, "账号操作", "Account action")}>
              <button className={accountMode === "register" ? "active" : ""} type="button" onClick={() => setAccountMode("register")}>
                {uiText(language, "注册账号", "Register")}
              </button>
              <button className={accountMode === "login" ? "active" : ""} type="button" onClick={() => setAccountMode("login")}>
                {uiText(language, "登录账号", "Login")}
              </button>
            </div>
            <div className="account-form">
              <label>
                {uiText(language, accountMode === "login" ? "账号" : "注册名", "Account name")}
                <input value={accountName} autoComplete="username" onChange={(event) => setAccountName(event.target.value)} />
              </label>
              <label>
                {uiText(language, "密码", "Password")}
                <input
                  value={accountPassword}
                  type="password"
                  autoComplete={accountMode === "login" ? "current-password" : "new-password"}
                  onChange={(event) => setAccountPassword(event.target.value)}
                />
              </label>
              <div className="account-actions">
                <button type="button" onClick={submitAccount} disabled={accountBusy}>
                  {accountBusy
                    ? uiText(language, accountMode === "login" ? "登录中" : "注册中", "Working")
                    : uiText(language, accountMode === "login" ? "登录进入" : "注册并进入", accountMode === "login" ? "Login" : "Register")}
                </button>
              </div>
              <p className="account-note">
                {uiText(
                  language,
                  accountMode === "login"
                    ? "登录后会同步这个账号下的录音、问答和搜索记录。"
                    : "每个注册账号的录音、问答、搜索记录独立保存；共享录音可查看，基于录音的问答只属于当前账号。",
                  "Each account keeps recordings, Q&A, and search history separate.",
                )}
              </p>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function BottomNav({ activeView, onNavigate, language, hidden = false }) {
  return (
    <nav className={hidden ? "bottom-nav hidden" : "bottom-nav"} aria-label={uiText(language, "底部导航", "Bottom navigation")} aria-hidden={hidden}>
      <button className={activeView === "records" ? "active" : ""} type="button" onClick={() => onNavigate("records")}>
        <Home size={21} />
        <span>{uiText(language, "记录", "Records")}</span>
      </button>
      <button className={activeView === "record" ? "active center" : "center"} type="button" onClick={() => onNavigate("record")}>
        <Mic size={24} />
        <span>{uiText(language, "录音", "Record")}</span>
      </button>
      <button className={activeView === "detail" ? "active" : ""} type="button" onClick={() => onNavigate("detail")}>
        <ListMusic size={21} />
        <span>{uiText(language, "问答", "QA")}</span>
      </button>
    </nav>
  );
}

export function App() {
  const [activeView, setActiveView] = useState("record");
  const [recordings, setRecordings] = useState([]);
  const [uploadingRecords, setUploadingRecords] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderStats, setFolderStats] = useState({ totalCount: 0, favoriteCount: 0, uncategorizedCount: 0, trashCount: 0 });
  const [transcriptionStatus, setTranscriptionStatus] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState({});
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareSheet, setShareSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [deletingRecordIds, setDeletingRecordIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0.12);
  const [status, setStatus] = useState("点击麦克风开始");
  const [recordingError, setRecordingError] = useState("");
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionSegmentsRef = useRef([]);
  const sessionDurationsRef = useRef([]);
  const uploadInputRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRafRef = useRef(0);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const totalElapsedBeforeSegmentRef = useRef(0);
  const stopReasonRef = useRef("idle");
  const resumeTimerRef = useRef(0);
  const rolloverTimerRef = useRef(0);
  const autosaveTimerRef = useRef(0);
  const recordingWatchdogTimerRef = useRef(0);
  const activeViewRef = useRef(activeView);
  const resumeAvailableRef = useRef(false);
  const isRecordingRef = useRef(false);
  const manualStopRequestedRef = useRef(false);
  const finalizingRecordingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const autosavedSegmentCountRef = useRef(0);
  const autosavedDurationMsRef = useRef(0);
  const keyboardBaseHeightRef = useRef(0);
  const recordingSessionIdRef = useRef("");
  const recordingSessionStartedAtRef = useRef("");
  const recordingSessionPersistedIdsRef = useRef([]);
  const recordingPersistingRef = useRef(false);
  const recordingPersistPromiseRef = useRef(Promise.resolve());
  const recoveryUploadInFlightRef = useRef(false);
  const selectedRecordingCacheRef = useRef(null);
  const optimisticRemovedRecordIdsRef = useRef(new Set());
  const backgroundUploadSessionIdsRef = useRef(new Set());
  const stoppedRecordingSnapshotsRef = useRef(new WeakMap());
  const hiddenStartedAtRef = useRef(0);
  const lastRecorderDataAtRef = useRef(0);
  const lastRecorderWatchdogActionAtRef = useRef(0);

  const selectedRecording = useMemo(() => {
    if (!selectedId) return null;
    return recordings.find((item) => item.id === selectedId) || (selectedRecordingCacheRef.current?.id === selectedId ? selectedRecordingCacheRef.current : null);
  }, [recordings, selectedId]);
  const recordsForView = useMemo(() => {
    if (selectedFolderId === "trash") return recordings;
    return [...uploadingRecords, ...recordings];
  }, [recordings, selectedFolderId, uploadingRecords]);

  useEffect(() => {
    if (selectedRecording?.id) selectedRecordingCacheRef.current = selectedRecording;
  }, [selectedRecording]);

  function createUploadCard({ name = "新录音", durationMs = 0, message = "正在上传服务器" } = {}) {
    const item = {
      id: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      durationMs,
      status: "uploading",
      message,
    };
    setUploadingRecords((current) => {
      const next = current.filter((existing) => {
        if (existing.id === item.id) return false;
        return existing.name !== item.name || existing.message !== item.message;
      });
      return [item, ...next].slice(0, 6);
    });
    return item.id;
  }

  function finishUploadCard(uploadId, recording) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
    if (recording) {
      setRecordings((current) => [recording, ...current.filter((item) => item.id !== recording.id)]);
    }
  }

  function updateUploadCard(uploadId, patch) {
    if (!uploadId) return;
    setUploadingRecords((current) => current.map((item) => (item.id === uploadId ? { ...item, ...patch } : item)));
  }

  function failUploadCard(uploadId) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
  }

  async function refreshFolders() {
    const payload = await api("/api/folders");
    setFolders(payload.folders);
    setFolderStats({
      totalCount: payload.totalCount || 0,
      favoriteCount: payload.favoriteCount || 0,
      uncategorizedCount: payload.uncategorizedCount || 0,
      trashCount: payload.trashCount || 0,
    });
  }

  async function refreshTranscriptionStatus() {
    const payload = await api("/api/transcription/status");
    setTranscriptionStatus(payload.transcription);
  }

  async function refreshRecordings(nextQuery = query, nextFolderId = selectedFolderId, options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("q", nextQuery);
      params.set("folderId", nextFolderId);
      const payload = await api(`/api/recordings?${params.toString()}`);
      const nextRecordings = (payload.recordings || []).filter((item) => !optimisticRemovedRecordIdsRef.current.has(item.id));
      setRecordings((current) =>
        recordingListSignature(current) === recordingListSignature(nextRecordings) ? current : nextRecordings,
      );
      if (options.autoSelect) {
        setSelectedId((current) => {
          if (current) return current;
          if (activeViewRef.current === "detail") return current;
          return nextRecordings[0]?.id || current;
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function refreshRecording(id) {
    const payload = await api(`/api/recordings/${id}`);
    setRecordings((current) =>
      current.some((item) => item.id === id)
        ? current.map((item) => (item.id === id ? payload.recording : item))
        : [payload.recording, ...current],
    );
  }

  useEffect(() => {
    const sharedId = new URLSearchParams(window.location.search).get("recording");
    if (sharedId) {
      setSelectedId(sharedId);
      setActiveView("detail");
    }
    refreshRecordings("");
    refreshFolders().catch(() => {});
    refreshTranscriptionStatus().catch(() => {});
    api("/api/profile")
      .then((payload) => {
        const serverProfile = payload.profile || {};
        const localProfile = getLocalProfile();
        const serverDefaults = sharedProfileDefaults(serverProfile);
        const serverOwnProfile = serverProfile.clientProfileSaved ? serverProfile : {};
        const mergedProfile = {
          ...serverDefaults,
          ...localProfile,
          ...serverOwnProfile,
          clientId: serverProfile.clientId || localProfile.clientId || getClientId(),
        };
        const accountName = getAccountDisplayName(mergedProfile);
        const normalizedProfile = accountName
          ? {
              ...mergedProfile,
              name: accountName,
              username: accountName,
            }
          : mergedProfile;
        setProfile(normalizedProfile);
        saveLocalProfile(normalizedProfile);
      })
      .catch(() => {
        const localProfile = getLocalProfile();
        const accountName = getAccountDisplayName(localProfile);
        const normalizedProfile = accountName
          ? {
              ...localProfile,
              name: accountName,
              username: accountName,
            }
          : localProfile;
        if (Object.keys(normalizedProfile).length > 0) setProfile(normalizedProfile);
      });

    const applyWecomUser = (user) => {
      if (!user?.name) return;
      setProfile((current) => {
        const accountName = getAccountDisplayName(current);
        const next = {
          ...current,
          name: accountName || user.name,
          username: accountName || current.username || "",
          wecomName: user.name,
          wecomUserId: user.userId || user.openUserId || current.wecomUserId || "",
          wecomConfigured: true,
          department: user.department || current.department || "",
          company: current.company || "企业微信",
        };
        saveLocalProfile(next);
        return next;
      });
    };

    const nameHint = readWecomNameHintFromUrl();
    if (nameHint) {
      applyWecomUser({ name: nameHint });
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      api(`/api/wecom/me?code=${encodeURIComponent(code)}`)
        .then((payload) => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: payload.configured !== false };
            saveLocalProfile(next);
            return next;
          });
          applyWecomUser(payload.user);
          window.sessionStorage.removeItem("wecomOAuthTried");
        })
        .catch(() => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: false };
            saveLocalProfile(next);
            return next;
          });
        });
    } else if (isWecomWebView() && !getLocalProfile().wecomName && !window.sessionStorage.getItem("wecomOAuthTried")) {
      api(`/api/wecom/oauth-url?redirect=${encodeURIComponent(window.location.href)}`)
        .then((payload) => {
          if (payload.configured && payload.url) {
            window.sessionStorage.setItem("wecomOAuthTried", "1");
            window.location.replace(payload.url);
          } else {
            setProfile((current) => {
              const next = { ...current, wecomConfigured: false };
              saveLocalProfile(next);
              return next;
            });
          }
        })
        .catch(() => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: false };
            saveLocalProfile(next);
            return next;
          });
        });
    }
  }, []);

  useEffect(() => {
    if (Object.keys(profile || {}).length > 0) saveLocalProfile(profile);
  }, [profile]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    const editableInputTypes = new Set(["email", "number", "password", "search", "tel", "text", "url"]);
    const visualViewport = window.visualViewport;

    function isEditableElement(element) {
      if (!element) return false;
      const tagName = element.tagName?.toLowerCase();
      if (tagName === "textarea") return true;
      if (tagName === "input") {
        const inputType = (element.getAttribute("type") || "text").toLowerCase();
        return editableInputTypes.has(inputType);
      }
      return Boolean(element.isContentEditable);
    }

    function viewportHeight() {
      return visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    }

    function updateKeyboardVisibility() {
      const height = viewportHeight();
      const activeElement = document.activeElement;
      const focusedForTyping = isEditableElement(activeElement);

      if (!height) {
        setKeyboardVisible(false);
        return;
      }

      if (!focusedForTyping) {
        keyboardBaseHeightRef.current = Math.max(keyboardBaseHeightRef.current, height);
        setKeyboardVisible(false);
        return;
      }

      keyboardBaseHeightRef.current = Math.max(keyboardBaseHeightRef.current || height, height);
      const baseHeight = keyboardBaseHeightRef.current || height;
      const keyboardInset = Math.max(0, baseHeight - height);
      const visualInset = visualViewport ? Math.max(0, (window.innerHeight || baseHeight) - visualViewport.height) : 0;
      setKeyboardVisible(keyboardInset > 120 || visualInset > 120);
    }

    let updateTimer = 0;
    function queueKeyboardUpdate() {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(updateKeyboardVisibility, 70);
    }

    updateKeyboardVisibility();
    visualViewport?.addEventListener("resize", updateKeyboardVisibility);
    visualViewport?.addEventListener("scroll", updateKeyboardVisibility);
    window.addEventListener("resize", updateKeyboardVisibility);
    document.addEventListener("focusin", queueKeyboardUpdate);
    document.addEventListener("focusout", queueKeyboardUpdate);

    return () => {
      window.clearTimeout(updateTimer);
      visualViewport?.removeEventListener("resize", updateKeyboardVisibility);
      visualViewport?.removeEventListener("scroll", updateKeyboardVisibility);
      window.removeEventListener("resize", updateKeyboardVisibility);
      document.removeEventListener("focusin", queueKeyboardUpdate);
      document.removeEventListener("focusout", queueKeyboardUpdate);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refreshRecordings(query, selectedFolderId).catch(() => {});
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query, selectedFolderId]);

  useEffect(() => {
    const hasProcessing = recordings.some(
      (recording) =>
        (recording.status !== "ready" && recording.status !== "failed") ||
        recording.meetingOutlineStatus === "generating",
    );
    if (!hasProcessing) return undefined;
    const interval = window.setInterval(() => {
      refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
    }, 1800);
    return () => window.clearInterval(interval);
  }, [recordings, query, selectedFolderId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    resumeAvailableRef.current = resumeAvailable;
  }, [resumeAvailable]);

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(rolloverTimerRef.current);
      window.clearTimeout(autosaveTimerRef.current);
      window.clearInterval(recordingWatchdogTimerRef.current);
      cancelAnimationFrame(analyserRafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close();
      releaseRecordingWakeLock();
    };
  }, []);

  function cleanupCapture() {
    window.clearInterval(timerRef.current);
    window.clearTimeout(rolloverTimerRef.current);
    window.clearTimeout(autosaveTimerRef.current);
    window.clearInterval(recordingWatchdogTimerRef.current);
    recordingWatchdogTimerRef.current = 0;
    cancelAnimationFrame(analyserRafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevel(0.12);
  }

  async function requestRecordingWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState === "hidden") return;
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) return;
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Wake Lock is a best-effort mobile helper; recording still works without it.
    }
  }

  function releaseRecordingWakeLock() {
    try {
      wakeLockRef.current?.release?.();
    } catch {
      // Ignore unsupported or already released wake locks.
    }
    wakeLockRef.current = null;
  }

  useEffect(() => {
    const tryResume = () => {
      if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
      requestRecordingWakeLock();
      scheduleResumeRecording();
    };

    const saveCurrentChunk = () => {
      const recorder = mediaRecorderRef.current;
      if (!isRecordingRef.current || !recorder) return;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
      }, 180);
    };

    const keepSessionAlive = () => {
      if (isRecordingRef.current || resumeAvailableRef.current) requestRecordingWakeLock();
      tryResume();
    };

    const rolloverAfterBackground = (hiddenMs) => {
      const recorder = mediaRecorderRef.current;
      if (
        hiddenMs < 5000 ||
        manualStopRequestedRef.current ||
        !isRecordingRef.current ||
        !recorder ||
        recorder.state !== "recording" ||
        stopReasonRef.current !== "recording"
      ) {
        return;
      }

      setStatus("已返回前台，正在校准录音时间并自动续录");
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (
          manualStopRequestedRef.current ||
          mediaRecorderRef.current !== recorder ||
          recorder.state !== "recording" ||
          stopReasonRef.current !== "recording"
        ) {
          return;
        }
        stopReasonRef.current = "rollover";
        try {
          recorder.stop();
        } catch {
          stopReasonRef.current = "recording";
          scheduleResumeRecording();
        }
      }, 120);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenStartedAtRef.current = Date.now();
        saveCurrentChunk();
        return;
      }
      const hiddenMs = hiddenStartedAtRef.current ? Date.now() - hiddenStartedAtRef.current : 0;
      hiddenStartedAtRef.current = 0;
      keepSessionAlive();
      rolloverAfterBackground(hiddenMs);
    };

    const warnBeforeLeaving = (event) => {
      if (!isRecordingRef.current && !resumeAvailableRef.current) return;
      saveCurrentChunk();
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", keepSessionAlive);
    window.addEventListener("pageshow", keepSessionAlive);
    window.addEventListener("pagehide", saveCurrentChunk);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", keepSessionAlive);
      window.removeEventListener("pageshow", keepSessionAlive);
      window.removeEventListener("pagehide", saveCurrentChunk);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, []);

  function startAnalyser(stream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 5.8));
      analyserRafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  async function uploadRecording(blob, durationMs, options = {}) {
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || "新录音",
          durationMs,
          message: options.uploadMessage || "正在上传录音并准备转写",
        }));
    updateUploadCard(uploadId, {
      name: options.name || "新录音",
      durationMs,
      message: options.uploadMessage || "正在上传录音并准备转写",
    });
    const formData = new FormData();
    formData.append("audio", blob, options.fileName || `recording-${Date.now()}.webm`);
    formData.append("durationMs", String(durationMs));
    formData.append("mimeType", blob.type || "audio/webm");
    if (options.name) formData.append("name", options.name);
    if (options.folderId) formData.append("folderId", options.folderId);

    try {
      const payload = await api("/api/recordings", {
        method: "POST",
        body: formData,
      });

      finishUploadCard(uploadId, payload.recording);
      if (!options.keepSelection && activeViewRef.current !== "detail") setSelectedId(payload.recording.id);
      if (options.toastMessage) {
        setToast(options.toastMessage);
      } else if (!options.silent) {
        setToast("录音已上传服务器，可在记录里查看");
      }
      window.setTimeout(() => {
        refreshRecordings(query, selectedFolderId).catch(() => {});
        refreshFolders().catch(() => {});
      }, 1400);
    } catch (error) {
      failUploadCard(uploadId);
      throw error;
    }
  }

  async function uploadRecordingSegments(segments, durationMs, options = {}) {
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
          durationMs,
          message: options.uploadMessage || "正在上传录音并准备转写",
        }));
    updateUploadCard(uploadId, {
      name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
      durationMs,
      message: options.uploadMessage || "正在上传录音并准备转写",
    });
    let longUploadSessionId = "";
    try {
      let payload;
      if (segments.length > LONG_RECORDING_DIRECT_UPLOAD_LIMIT) {
        const session = await api("/api/recording-upload-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
            durationMs,
            mimeType: segments[0]?.type || "audio/webm",
            folderId: options.folderId || null,
          }),
        });
        longUploadSessionId = session.sessionId || "";
        const batchSize = Math.max(1, Number(session.batchSize || LONG_RECORDING_UPLOAD_BATCH_SIZE));
        for (let start = 0; start < segments.length; start += batchSize) {
          const batch = segments.slice(start, start + batchSize);
          const batchForm = new FormData();
          batchForm.append("startIndex", String(start));
          batch.forEach((blob, index) => {
            batchForm.append("audio", blob, `recording-${Date.now()}-${start + index + 1}.webm`);
          });
          updateUploadCard(uploadId, {
            message: `正在后台上传 ${Math.min(start + batch.length, segments.length)}/${segments.length} 段`,
          });
          await api(`/api/recording-upload-sessions/${session.sessionId}/segments`, {
            method: "POST",
            body: batchForm,
          });
        }
        updateUploadCard(uploadId, { message: "正在合并录音并准备转写" });
        payload = await api(`/api/recording-upload-sessions/${session.sessionId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationMs }),
        });
      } else {
        const formData = new FormData();
        segments.forEach((blob, index) => {
          formData.append("audio", blob, options.fileName || `recording-${Date.now()}-${index + 1}.webm`);
        });
        formData.append("durationMs", String(durationMs));
        formData.append("mimeType", segments[0]?.type || "audio/webm");
        if (options.name) formData.append("name", options.name);
        if (options.folderId) formData.append("folderId", options.folderId);
        payload = await api("/api/recordings/segments", {
          method: "POST",
          body: formData,
        });
      }

      finishUploadCard(uploadId, payload.recording);
      if (!options.keepSelection && activeViewRef.current !== "detail") setSelectedId(payload.recording.id);
      if (options.toastMessage) {
        setToast(options.toastMessage);
      } else if (!options.silent) {
        setToast("录音已上传服务器，可在记录里查看");
      }
      window.setTimeout(() => {
        refreshRecordings(query, selectedFolderId).catch(() => {});
        refreshFolders().catch(() => {});
      }, 1400);
    } catch (error) {
      if (longUploadSessionId) {
        api(`/api/recording-upload-sessions/${longUploadSessionId}`, { method: "DELETE" }).catch(() => {});
      }
      failUploadCard(uploadId);
      throw error;
    }
  }

  function ensureRecordingSessionManifest() {
    if (recordingSessionIdRef.current) {
      return {
        id: recordingSessionIdRef.current,
        startedAt: recordingSessionStartedAtRef.current || new Date().toISOString(),
      };
    }

    const existing = readRecordingSessionManifest();
    if (existing?.id && (existing.segments || []).length === 0) {
      recordingSessionIdRef.current = existing.id;
      recordingSessionStartedAtRef.current = existing.startedAt || existing.createdAt || new Date().toISOString();
      recordingSessionPersistedIdsRef.current = [];
      return existing;
    }

    const startedAt = new Date().toISOString();
    const session = {
      id: `recording-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt,
      createdAt: startedAt,
      clientId: getClientId(),
      clientName: getClientName(),
      segments: [],
    };
    recordingSessionIdRef.current = session.id;
    recordingSessionStartedAtRef.current = startedAt;
    recordingSessionPersistedIdsRef.current = [];
    writeRecordingSessionManifest(session);
    return session;
  }

  async function persistCurrentRecordingSegment(index, blob, durationMs, mimeType) {
    if (!blob?.size) return "";
    const session = ensureRecordingSessionManifest();
    const id = `${session.id}-${String(index + 1).padStart(4, "0")}`;
    const row = {
      id,
      sessionId: session.id,
      index,
      durationMs,
      size: blob.size,
      mimeType: mimeType || blob.type || "audio/webm",
      createdAt: new Date().toISOString(),
      blob,
    };
    await putRecordingRecoverySegment(row);

    const manifest = readRecordingSessionManifest() || session;
    const segments = (manifest.segments || []).filter((segment) => segment.id !== id);
    segments.push({
      id,
      sessionId: session.id,
      index,
      durationMs,
      size: blob.size,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
    });
    segments.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    writeRecordingSessionManifest({
      ...manifest,
      id: session.id,
      startedAt: session.startedAt || manifest.startedAt || recordingSessionStartedAtRef.current,
      clientId: manifest.clientId || getClientId(),
      clientName: manifest.clientName || getClientName(),
      updatedAt: new Date().toISOString(),
      segments,
    });
    return id;
  }

  async function appendRecordingSessionSegment(blob, durationMs, mimeType) {
    if (!blob?.size) return;
    const segmentIndex = sessionDurationsRef.current.length;
    sessionSegmentsRef.current.push(blob);
    sessionDurationsRef.current.push(durationMs);
    totalElapsedBeforeSegmentRef.current += durationMs;
    try {
      const persistedId = await persistCurrentRecordingSegment(segmentIndex, blob, durationMs, mimeType || blob.type || "audio/webm");
      if (persistedId) {
        recordingSessionPersistedIdsRef.current[segmentIndex] = persistedId;
        sessionSegmentsRef.current[segmentIndex] = null;
      }
    } catch {
      // Keep the in-memory blob if mobile persistent storage is unavailable.
    }
  }

  async function persistBufferedRecordingChunk(mimeType = "") {
    const task = recordingPersistPromiseRef.current
      .catch(() => {})
      .then(async () => {
        const chunks = chunksRef.current;
        if (chunks.length === 0) return;
        recordingPersistingRef.current = true;
        const chunksToPersist = chunks.slice();
        chunks.length = 0;
        try {
          const now = Date.now();
          const durationMs = Math.max(0, now - startedAtRef.current);
          startedAtRef.current = now;
          const blob = new Blob(chunksToPersist, { type: mimeType || "audio/webm" });
          await appendRecordingSessionSegment(blob, durationMs, mimeType || blob.type || "audio/webm");
        } finally {
          recordingPersistingRef.current = false;
        }
      });
    recordingPersistPromiseRef.current = task.catch(() => {});
    return task;
  }

  async function recordingSegmentsForRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    const segments = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const memoryBlob = sessionSegmentsRef.current[index];
      if (memoryBlob?.size > 0) {
        segments.push(memoryBlob);
        continue;
      }

      const persistedId = recordingSessionPersistedIdsRef.current[index];
      if (!persistedId) continue;
      try {
        const row = await getRecordingRecoverySegment(persistedId);
        if (row?.blob?.size > 0) segments.push(row.blob);
      } catch {
        // If persistent recovery is unavailable, skip missing chunks instead of blocking saved audio.
      }
    }
    return segments;
  }

  async function removePersistedSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    const ids = recordingSessionPersistedIdsRef.current.slice(startIndex, endIndex).filter(Boolean);
    await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));

    const manifest = readRecordingSessionManifest();
    if (!manifest?.id) return;
    const remaining = (manifest.segments || []).filter((segment) => Number(segment.index || 0) < startIndex || Number(segment.index || 0) >= endIndex);
    if (remaining.length === 0) {
      removeRecordingRecoveryManifest(manifest.id);
      clearRecordingSessionManifest(manifest.id);
      return;
    }
    writeRecordingSessionManifest({ ...manifest, segments: remaining, updatedAt: new Date().toISOString() });
  }

  async function clearCurrentRecordingRecovery() {
    const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
    if (!sessionId) return;
    await clearRecordingRecoverySession(sessionId);
  }

  async function recoverSingleRecordingManifest(manifestSnapshot) {
    const manifest = normalizeRecordingSessionManifest(manifestSnapshot);
    const manifestSegments = (manifest?.segments || []).slice().sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    if (!manifest?.id || manifestSegments.length === 0) return true;

    try {
      const rows = [];
      for (const segment of manifestSegments) {
        try {
          const row = await getRecordingRecoverySegment(segment.id);
          if (row?.blob?.size > 0) rows.push(row);
        } catch {
          // Continue with the segments that can still be recovered.
        }
      }

      if (rows.length === 0) {
        await clearRecordingRecoveryManifest(manifest);
        return true;
      }

      const durationMs = Math.max(1000, rows.reduce((total, row) => total + Math.max(0, Number(row.durationMs || 0)), 0));
      const startedAt = manifest.startedAt || rows[0]?.createdAt || new Date().toISOString();
      const uploadId = createUploadCard({
        name: `中断自动保存 ${formatDate(startedAt)}`,
        durationMs,
        message: "正在恢复上次中断前的录音",
      });

      await uploadRecordingSegments(
        rows.map((row) => row.blob),
        durationMs,
        {
          uploadId,
          name: `中断自动保存 ${formatDate(startedAt)}`,
          toastMessage: "上次中断前的录音已自动恢复上传",
        },
      );
      await clearRecordingRecoveryManifest(manifest);
      return true;
    } catch (error) {
      setToast(recordingUploadErrorMessage(error));
      return false;
    }
  }

  async function recoverInterruptedRecordingSession(manifestSnapshot = null) {
    if (recoveryUploadInFlightRef.current) return false;
    const manifests = manifestSnapshot ? [manifestSnapshot] : readRecoverableRecordingManifests();
    if (manifests.length === 0) return true;
    recoveryUploadInFlightRef.current = true;

    try {
      let ok = true;
      for (const manifest of manifests) {
        if (backgroundUploadSessionIdsRef.current.has(manifest.id)) continue;
        const recovered = await recoverSingleRecordingManifest(manifest);
        if (!recovered) ok = false;
      }
      return ok;
    } finally {
      recoveryUploadInFlightRef.current = false;
    }
  }

  useEffect(() => {
    requestPersistentRecordingStorage();
    recoverInterruptedRecordingSession().catch(() => {});
  }, []);

  function resetRecordingSession(options = {}) {
    const clearPersisted = Boolean(options.clearPersisted);
    const sessionId = recordingSessionIdRef.current;
    sessionSegmentsRef.current = [];
    sessionDurationsRef.current = [];
    totalElapsedBeforeSegmentRef.current = 0;
    autosavedSegmentCountRef.current = 0;
    autosavedDurationMsRef.current = 0;
    recordingSessionIdRef.current = "";
    recordingSessionStartedAtRef.current = "";
    recordingSessionPersistedIdsRef.current = [];
    if (clearPersisted && sessionId) clearRecordingRecoverySession(sessionId).catch(() => {});
    setResumeAvailable(false);
  }

  function preserveCurrentChunk(recorder) {
    try {
      if (recorder?.state === "recording") recorder.requestData();
    } catch {
      // Some mobile WebViews throw when the recorder is already being stopped.
    }
  }

  function durationForSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    return sessionDurationsRef.current.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
  }

  function stoppedRecordingSnapshot() {
    return {
      sessionId: recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "",
      startedAtMs: startedAtRef.current || Date.now(),
      stoppedAtMs: Date.now(),
      uploadStartIndex: Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length),
      sessionSegments: sessionSegmentsRef.current.slice(),
      sessionDurations: sessionDurationsRef.current.slice(),
      persistedIds: recordingSessionPersistedIdsRef.current.slice(),
      chunks: chunksRef.current,
      autosavedSegmentCount: autosavedSegmentCountRef.current,
      autosavedDurationMs: autosavedDurationMsRef.current,
    };
  }

  function resetRecorderUiForNext(sessionId = "") {
    resetRecordingSession();
    releaseRecordingWakeLock();
    setElapsedMs(0);
    setIsRecording(false);
    isRecordingRef.current = false;
    setResumeAvailable(false);
    resumeAvailableRef.current = false;
    stopReasonRef.current = "idle";
    manualStopRequestedRef.current = false;
    finalizingRecordingRef.current = false;
    setLevel(0.12);
    setStatus("点击麦克风开始");
  }

  async function clearRecordingRecoverySnapshot(snapshot) {
    const ids = (snapshot?.persistedIds || []).filter(Boolean);
    await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
    removeRecordingRecoveryManifest(snapshot?.sessionId);
    clearRecordingSessionManifest(snapshot?.sessionId);
  }

  async function recordingSegmentsForSnapshot(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
    const segments = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const memoryBlob = snapshot.sessionSegments[index];
      if (memoryBlob?.size > 0) {
        segments.push(memoryBlob);
        continue;
      }

      const persistedId = snapshot.persistedIds[index];
      if (!persistedId) continue;
      try {
        const row = await getRecordingRecoverySegment(persistedId);
        if (row?.blob?.size > 0) segments.push(row.blob);
      } catch {
        // Keep uploading whatever segments are still available.
      }
    }
    return segments;
  }

  function durationForSnapshotRange(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
    return snapshot.sessionDurations.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
  }

  async function uploadStoppedRecordingSnapshot(snapshot, mimeType = "audio/webm") {
    if (!snapshot) return;
    const finalChunks = Array.isArray(snapshot.chunks) ? snapshot.chunks.slice() : [];
    const sessionSegments = snapshot.sessionSegments.slice();
    const sessionDurations = snapshot.sessionDurations.slice();
    const persistedIds = snapshot.persistedIds.slice();
    if (finalChunks.length > 0) {
      const finalBlob = new Blob(finalChunks, { type: mimeType || finalChunks[0]?.type || "audio/webm" });
      const finalDurationMs = Math.max(0, (snapshot.stoppedAtMs || Date.now()) - (snapshot.startedAtMs || Date.now()));
      sessionSegments.push(finalBlob);
      sessionDurations.push(finalDurationMs);
      persistedIds.push("");
    }

    const uploadSnapshot = {
      ...snapshot,
      sessionSegments,
      sessionDurations,
      persistedIds,
    };
    const uploadStartIndex = Math.min(snapshot.uploadStartIndex || 0, sessionSegments.length);
    const segments = await recordingSegmentsForSnapshot(uploadSnapshot, uploadStartIndex);
    const durationMs = Math.max(1000, durationForSnapshotRange(uploadSnapshot, uploadStartIndex));
    const sessionId = snapshot.sessionId || "";

    if (segments.length === 0) {
      if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
      if (uploadStartIndex > 0) setToast("中断前录音已自动保存");
      backgroundUploadSessionIdsRef.current.delete(sessionId);
      return;
    }

    let uploaded = false;
    try {
      await uploadRecordingSegments(segments, durationMs, { keepSelection: true });
      uploaded = true;
      setRecordingError("");
    } catch (error) {
      setRecordingError("");
      setToast(recordingUploadErrorMessage(error));
    } finally {
      if (uploaded) {
        await clearRecordingRecoverySnapshot(uploadSnapshot).catch(() => {});
      }
      if (sessionId) {
        backgroundUploadSessionIdsRef.current.delete(sessionId);
      }
    }
  }

  async function autoSaveInterruptedRecording() {
    const startIndex = autosavedSegmentCountRef.current;
    const endIndex = sessionSegmentsRef.current.length;
    const segments = await recordingSegmentsForRange(startIndex, endIndex);
    if (segments.length === 0) return;

    const durationMs = Math.max(1000, durationForSegmentRange(startIndex, endIndex));
    try {
      await uploadRecordingSegments(segments, durationMs, {
        name: `中断自动保存 ${formatDate(new Date().toISOString())}`,
        keepSelection: true,
        silent: true,
        toastMessage: "意外中断前的录音已自动保存",
      });
      await removePersistedSegmentRange(startIndex, endIndex);
      autosavedSegmentCountRef.current = endIndex;
      autosavedDurationMsRef.current += durationMs;
    } catch (error) {
      setRecordingError("");
      setToast(recordingUploadErrorMessage(error));
    }
  }

  function rolloverRecorderSegment() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
    stopReasonRef.current = "rollover";
    try {
      recorder.stop();
    } catch {
      stopReasonRef.current = "recording";
      scheduleResumeRecording();
    }
  }

  function scheduleRecorderRollover() {
    window.clearTimeout(rolloverTimerRef.current);
    rolloverTimerRef.current = window.setTimeout(rolloverRecorderSegment, RECORDING_ROLLOVER_MS);
  }

  function scheduleRecordingAutosave() {
    if (RECORDING_AUTOSAVE_CHUNK_MS <= 0) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm")
          .catch(() => {})
          .finally(() => {
            if (recorder.state === "recording" && stopReasonRef.current === "recording") scheduleRecordingAutosave();
          });
      }, 120);
    }, RECORDING_AUTOSAVE_CHUNK_MS);
  }

  function stopRecordingWatchdog() {
    window.clearInterval(recordingWatchdogTimerRef.current);
    recordingWatchdogTimerRef.current = 0;
  }

  function scheduleRecordingWatchdog() {
    stopRecordingWatchdog();
    recordingWatchdogTimerRef.current = window.setInterval(() => {
      if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
      const recorder = mediaRecorderRef.current;

      if (!recorder) {
        if (isRecordingRef.current || resumeAvailableRef.current) {
          handleCaptureInterrupted("录音器被系统暂停，已保留当前片段并准备自动续录。");
        }
        return;
      }

      if (recorder.state === "paused") {
        try {
          recorder.resume();
          setStatus("录音已自动恢复，正在继续");
          return;
        } catch {
          handleCaptureInterrupted("录音被系统暂停，已保留当前片段并准备自动续录。");
          return;
        }
      }

      if (recorder.state === "inactive") {
        handleCaptureInterrupted("录音器意外停止，已保留当前片段并准备自动续录。");
        return;
      }

      const now = Date.now();
      const lastDataAt = lastRecorderDataAtRef.current || startedAtRef.current || now;
      const staleMs = now - lastDataAt;
      const staleThresholdMs = Math.max(RECORDING_DATA_SLICE_MS * 3, 90 * 1000);
      if (staleMs < staleThresholdMs || now - lastRecorderWatchdogActionAtRef.current < 30 * 1000) return;

      lastRecorderWatchdogActionAtRef.current = now;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
      }, 160);
    }, RECORDING_WATCHDOG_MS);
  }

  function handleCaptureInterrupted(reason = "电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。") {
    if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
    const recorder = mediaRecorderRef.current;
    stopReasonRef.current = "interrupted";
    setRecordingError(reason);
    setStatus("麦克风暂时被占用，等待自动续录");
    preserveCurrentChunk(recorder);
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        return;
      }
    } catch {
      // Fall through to the recovery path below.
    }

    window.clearInterval(timerRef.current);
    cleanupCapture();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    isRecordingRef.current = false;
    setResumeAvailable(true);
    resumeAvailableRef.current = true;
    persistBufferedRecordingChunk(recorder?.mimeType || "audio/webm")
      .then(() => autoSaveInterruptedRecording())
      .catch(() => {})
      .finally(() => scheduleResumeRecording());
  }

  function scheduleResumeRecording() {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
      beginRecording({ resume: true, automatic: true }).catch(() => {});
    }, 900);
  }

  async function finishRecordingSession() {
    finalizingRecordingRef.current = true;
    const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
    const sessionManifest = readRecordingSessionManifest();
    const uploadStartIndex = Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length);
    const segments = await recordingSegmentsForRange(uploadStartIndex);
    const durationMs = Math.max(1000, durationForSegmentRange(uploadStartIndex));
    const releaseRecorderUi = () => {
      resetRecordingSession();
      releaseRecordingWakeLock();
      setElapsedMs(0);
      stopReasonRef.current = "idle";
      manualStopRequestedRef.current = false;
      finalizingRecordingRef.current = false;
      setStatus("点击麦克风开始");
    };

    if (segments.length === 0) {
      if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
      releaseRecorderUi();
      if (uploadStartIndex > 0) setToast("中断前录音已自动保存");
      return;
    }

    if (sessionId) backgroundUploadSessionIdsRef.current.add(sessionId);
    releaseRecorderUi();

    let uploaded = false;
    try {
      await uploadRecordingSegments(segments, durationMs);
      uploaded = true;
      setRecordingError("");
    } catch (error) {
      setRecordingError("");
      setToast(recordingUploadErrorMessage(error));
    } finally {
      if (uploaded && sessionManifest?.id) {
        await clearRecordingRecoveryManifest(sessionManifest).catch(() => {});
      }
      if (sessionId) {
        backgroundUploadSessionIdsRef.current.delete(sessionId);
      }
    }
  }

  async function beginRecording(options = {}) {
    if (finalizingRecordingRef.current) return;
    const resume = Boolean(options.resume);
    if (!resume) manualStopRequestedRef.current = false;
    setRecordingError("");

    if (!canRequestMicrophone()) {
      setRecordingError("手机端录音必须通过 HTTPS 打开。请部署到 HTTPS 域名后，再从企业微信应用入口访问。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError("当前环境不支持网页录音，请升级企业微信或使用系统浏览器打开。");
      return;
    }

    try {
      if (!resume) {
        const staleManifests = readRecoverableRecordingManifests().filter((manifest) => !backgroundUploadSessionIdsRef.current.has(manifest.id));
        if (staleManifests.length > 0) {
          recoverInterruptedRecordingSession().catch(() => {});
          setToast("正在后台恢复中断前的录音");
        }
        resetRecordingSession();
        ensureRecordingSessionManifest();
        await requestPersistentRecordingStorage();
      }
      const stream = await requestMicrophoneStream();
      await requestRecordingWakeLock();
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      const recorderChunks = [];
      chunksRef.current = recorderChunks;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      lastRecorderDataAtRef.current = startedAtRef.current;
      lastRecorderWatchdogActionAtRef.current = 0;
      stopReasonRef.current = "recording";

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          lastRecorderDataAtRef.current = Date.now();
          recorderChunks.push(event.data);
          if (stopReasonRef.current === "recording") {
            persistBufferedRecordingChunk(recorder.mimeType || event.data.type || "audio/webm").catch(() => {});
          }
        }
      };

      recorder.onstop = async () => {
        const manualSnapshot = stoppedRecordingSnapshotsRef.current.get(recorder);
        if (manualSnapshot) {
          stoppedRecordingSnapshotsRef.current.delete(recorder);
          await uploadStoppedRecordingSnapshot(manualSnapshot, recorder.mimeType || "audio/webm");
          return;
        }

        const reason = stopReasonRef.current === "recording" ? "interrupted" : stopReasonRef.current;
        await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm");
        if (mediaRecorderRef.current === recorder) {
          cleanupCapture();
          mediaRecorderRef.current = null;
        }

        if (reason === "manual") {
          await finishRecordingSession();
          return;
        }

        if (reason === "rollover") {
          if (manualStopRequestedRef.current) {
            await finishRecordingSession();
            return;
          }
          setIsRecording(false);
          isRecordingRef.current = false;
          setResumeAvailable(true);
          resumeAvailableRef.current = true;
          setStatus("长录音保护分段中，正在继续录音");
          beginRecording({ resume: true, automatic: true }).catch(() => scheduleResumeRecording());
          return;
        }

        if (reason === "interrupted") {
          if (manualStopRequestedRef.current) return;
          await autoSaveInterruptedRecording();
          setIsRecording(false);
          isRecordingRef.current = false;
          setResumeAvailable(true);
          resumeAvailableRef.current = true;
          setStatus("麦克风已被系统暂停，返回后自动续录");
          scheduleResumeRecording();
          return;
        }

        stopReasonRef.current = "idle";
      };

      recorder.onerror = () => handleCaptureInterrupted("录音被系统中断，已保留当前片段，返回页面后会自动续录。");
      stream.oninactive = () => handleCaptureInterrupted("麦克风音频流被系统暂停，已保留当前片段，返回页面后会自动续录。");
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => handleCaptureInterrupted("电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。");
        track.onmute = () => {
          if (stopReasonRef.current === "recording") setStatus("麦克风暂时被系统占用，正在等待恢复");
        };
        track.onunmute = () => {
          if (stopReasonRef.current === "recording") setStatus("录音中，再点一次停止");
        };
      });

      if (RECORDING_DATA_SLICE_MS > 0) recorder.start(RECORDING_DATA_SLICE_MS);
      else recorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;
      setResumeAvailable(false);
      resumeAvailableRef.current = false;
      setStatus(resume ? "续录中，再点一次停止" : "录音中，再点一次停止");
      scheduleRecorderRollover();
      scheduleRecordingAutosave();
      scheduleRecordingWatchdog();
      startAnalyser(stream);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(totalElapsedBeforeSegmentRef.current + Date.now() - startedAtRef.current);
      }, 80);
    } catch (error) {
      setRecordingError(microphoneErrorMessage(error));
      cleanupCapture();
      if (resume || sessionSegmentsRef.current.length > 0) {
        setResumeAvailable(true);
        setStatus("麦克风尚未恢复，点击麦克风继续录音");
      }
    }
  }

  async function stopRecording() {
    if (finalizingRecordingRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      manualStopRequestedRef.current = true;
      stopReasonRef.current = "manual";
      finalizingRecordingRef.current = true;
      preserveCurrentChunk(recorder);
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      await recordingPersistPromiseRef.current.catch(() => {});
      window.clearInterval(timerRef.current);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(rolloverTimerRef.current);
      window.clearTimeout(autosaveTimerRef.current);
      setIsRecording(false);
      isRecordingRef.current = false;
      setResumeAvailable(false);
      resumeAvailableRef.current = false;
      setStatus("正在保存录音");
      try {
        recorder.stop();
      } catch {
        await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
        cleanupCapture();
        mediaRecorderRef.current = null;
        await finishRecordingSession().catch((error) => {
          setToast(recordingUploadErrorMessage(error));
          finalizingRecordingRef.current = false;
        });
      }
      return;
    }
  }

  function toggleRecording() {
    const recorder = mediaRecorderRef.current;
    if (isRecordingRef.current || recorder?.state === "recording") stopRecording();
    else beginRecording();
  }

  async function handleUploadFile(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const mediaFiles = files.filter(isUploadableMediaFile);
    if (mediaFiles.length === 0) {
      setToast("请选择音频或视频文件");
      return;
    }
    if (mediaFiles.length !== files.length) {
      setToast("已跳过不支持的文件");
    } else if (mediaFiles.length > 1) {
      setToast(`正在上传 ${mediaFiles.length} 个录音文件`);
    }

    const folderId =
      selectedFolderId !== "all" &&
      selectedFolderId !== "uncategorized" &&
      selectedFolderId !== "favorites" &&
      selectedFolderId !== "trash"
        ? selectedFolderId
        : undefined;

    const firstDisplayName = mediaFiles[0]?.name?.replace(/\.[^.]+$/, "") || "新录音";
    const uploadId = createUploadCard({
      name: mediaFiles.length > 1 ? "上传录音" : firstDisplayName,
      durationMs: 0,
      message: "正在读取文件，准备上传",
    });

    try {
      if (mediaFiles.length === 1) {
        const file = mediaFiles[0];
        const durationMs = await getAudioFileDuration(file);
        const rawName = file.name.replace(/\.[^.]+$/, "");
        await uploadRecording(file, durationMs, {
          name: rawName || undefined,
          fileName: file.name,
          folderId,
          uploadId,
        });
        setToast("录音已上传并开始转写");
        return;
      }

      const durations = await Promise.all(mediaFiles.map((file) => getAudioFileDuration(file)));
      const durationMs = durations.reduce((total, value) => total + Math.max(0, value || 0), 0);
      await uploadRecordingSegments(mediaFiles, durationMs, {
        name: "上传录音",
        folderId,
        uploadId,
        toastMessage: `${mediaFiles.length} 个录音文件已上传并开始转写`,
      });
      refreshRecordings(query, selectedFolderId).catch(() => {});
      refreshFolders().catch(() => {});
    } catch (error) {
      failUploadCard(uploadId);
      setToast(error instanceof Error ? error.message : "上传失败");
    }
  }

  async function createFolder(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;

    const payload = await api("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    await refreshFolders();
    setSelectedFolderId(payload.folder.id);
    setToast("文件夹已创建");
  }

  async function renameFolder(id, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;

    await api(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    await refreshFolders();
    setToast("文件夹已重命名");
  }

  async function deleteFolder(id) {
    await api(`/api/folders/${id}`, { method: "DELETE" });
    if (selectedFolderId === id) setSelectedFolderId("all");
    await refreshFolders();
    await refreshRecordings(query, selectedFolderId === id ? "all" : selectedFolderId);
    setToast("文件夹已删除，录音已回到未分类");
  }

  async function moveRecording(id, folderId) {
    const payload = await api(`/api/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });

    setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
    await refreshFolders();
    if (selectedFolderId !== "all") {
      await refreshRecordings(query, selectedFolderId);
    }
  }

  async function renameRecording(id, name) {
    const payload = await api(`/api/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
  }

  async function updateRecordingMeta(id, patch) {
    const previous = recordings;
    setRecordings((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    try {
      const payload = await api(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
      if (Object.prototype.hasOwnProperty.call(patch, "shared")) {
        setToast(payload.recording.shared ? "已开启共享" : "已设为仅自己可见");
      }
    } catch (error) {
      setRecordings(previous);
      setToast(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function toggleFavorite(recording) {
    const payload = await api(`/api/recordings/${recording.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !recording.favorite }),
    });
    setRecordings((current) => current.map((item) => (item.id === recording.id ? payload.recording : item)));
    refreshFolders().catch(() => {});
    if (selectedFolderId === "favorites") {
      refreshRecordings(query, "favorites").catch(() => {});
    }
  }

  async function retranscribeRecording(recording) {
    if (!recording?.id || recording.status === "transcribing" || recording.status === "processing") return;
    setToast("已开始重新转写");
    setRecordings((current) =>
      current.map((item) =>
        item.id === recording.id
          ? { ...item, status: "transcribing", errorMessage: "", transcriptHealth: { ...(item.transcriptHealth || {}), isFallback: false } }
          : item,
      ),
    );
    try {
      await api(`/api/recordings/${recording.id}/transcribe`, { method: "POST" });
      window.setTimeout(() => refreshRecording(recording.id).catch(() => {}), 900);
      refreshTranscriptionStatus().catch(() => {});
    } catch (error) {
      await refreshRecording(recording.id).catch(() => {});
      setToast(error instanceof Error ? error.message : "重新转写失败");
    }
  }

  async function shareRecording(recording, mode = "both") {
    const shareMode = ["text", "audio", "both", "outline"].includes(mode) ? mode : "both";
    if (shareMode === "outline") setToast("正在准备会议提纲 PDF");
    else if (shareMode !== "text") setToast("正在准备 MP3 分享");
    const audioDownloadUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/audio.mp3`;
    const transcriptUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/transcript.txt`;
    const outlineUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/meeting-outline.pdf`;
    const audioFileName = safeFileNameWithExtension(recording.name, ".mp3");
    const text =
      shareMode === "text"
        ? `${recording.name}\n文字：TXT`
        : shareMode === "audio"
          ? `${recording.name}\n时长：${formatDuration(recording.durationMs)}\n录音：MP3`
          : shareMode === "outline"
            ? `${recording.name}\n会议提纲：PDF`
          : `${recording.name}\n时长：${formatDuration(recording.durationMs)}\n录音：MP3\n文字：TXT`;
    const transcriptFile = transcriptTextFileForRecording(recording);
    let audioFile = null;
    let audioShareInfo = null;
    let outlineFile = null;

    async function getAudioShareInfo() {
      if (audioShareInfo) return audioShareInfo;
      const payload = await api(`/api/recordings/${recording.id}/audio-share-url`, { method: "POST" });
      const downloadUrl = new URL(payload.url || audioDownloadUrl, window.location.origin);
      downloadUrl.searchParams.set("download", "1");
      audioShareInfo = {
        ...payload,
        url: downloadUrl.toString(),
        fileName: safeFileNameWithExtension(payload.fileName || audioFileName, ".mp3"),
        contentType: payload.contentType || "audio/mpeg",
      };
      return audioShareInfo;
    }

    async function getAudioFile() {
      if (audioFile) return audioFile;
      const shareInfo = await getAudioShareInfo();
      const audioResponse = await fetchWithClient(shareInfo.url, { cache: "no-store" });
      if (!audioResponse.ok) throw new Error("MP3 录音读取失败");
      const responseType = audioResponse.headers.get("content-type") || "";
      if (/application\/json|text\/|text\/html/i.test(responseType)) throw new Error("MP3 录音读取失败");
      const audioBlob = await audioResponse.blob();
      if (!audioBlob.size) throw new Error("MP3 录音读取失败");
      const mp3Blob = audioBlob.type === "audio/mpeg" ? audioBlob : audioBlob.slice(0, audioBlob.size, "audio/mpeg");
      audioFile = new File([mp3Blob], safeFileNameWithExtension(shareInfo.fileName || audioFileName, ".mp3"), {
        type: "audio/mpeg",
      });
      return audioFile;
    }

    async function getOutlineFile() {
      if (outlineFile) return outlineFile;
      const outlineResponse = await fetchWithClient(outlineUrl, { cache: "no-store" });
      if (!outlineResponse.ok) throw new Error("会议提纲 PDF 生成失败");
      const outlineBlob = await outlineResponse.blob();
      outlineFile = new File([outlineBlob], `${safeFileName(recording.name)}-会议提纲.pdf`, { type: "application/pdf" });
      return outlineFile;
    }

    function invokeWecom(name, payload) {
      if (!window.wx?.invoke) return Promise.resolve(false);
      return new Promise((resolve, reject) => {
        window.wx.invoke(name, payload, (result) => {
          const message = String(result?.err_msg || result?.errmsg || "");
          if (!message || message.includes(":ok")) resolve(true);
          else reject(new Error(message));
        });
      });
    }

    async function shareWecomAudioFile() {
      if (!isWecomWebView() || !window.wx?.invoke) return false;
      const payload = await api(`/api/recordings/${recording.id}/wecom-audio-media`, { method: "POST" });
      const mediaId = payload.mediaId || payload.media_id;
      if (!mediaId) throw new Error("企业微信 MP3 文件素材生成失败");
      await invokeWecom("sendChatMessage", {
        msgtype: "file",
        file: {
          mediaid: mediaId,
        },
      });
      setToast("已打开企业微信 MP3 文件分享");
      return true;
    }

    async function shareFiles(files, shareText = text, options = {}) {
      if (!navigator.share || !navigator.canShare) return false;
      try {
        if (!navigator.canShare({ files })) return false;
      } catch {
        return false;
      }
      const payload = { files };
      if (!options.fileOnly) {
        payload.title = recording.name;
        if (shareText) payload.text = shareText;
      }
      await navigator.share(payload);
      return true;
    }

    async function downloadAudioFileFallback(toastText) {
      const shareInfo = await getAudioShareInfo();
      openDownloadUrl(shareInfo.url, shareInfo.fileName || audioFileName);
      setToast(toastText);
    }

    async function shareUrl(url, shareText = text) {
      if (!navigator.share) return false;
      await navigator.share({ title: recording.name, text: shareText, url });
      return true;
    }

    try {
      if (shareMode === "text") {
        if (await shareFiles([transcriptFile])) return;
        if (await shareUrl(transcriptUrl, `${text}\nTXT：${transcriptUrl}`)) return;
      } else if (shareMode === "audio") {
        try {
          if (await shareWecomAudioFile()) return;
        } catch {
          // Continue with system file sharing or local save.
        }
        const mp3File = await getAudioFile();
        if (await shareFiles([mp3File], "", { fileOnly: true })) {
          setToast("已调起 MP3 文件分享");
          return;
        }
        await downloadAudioFileFallback("已开始下载 MP3 文件，请从企业微信文件里发送");
        return;
      } else if (shareMode === "outline") {
        const pdfFile = await getOutlineFile();
        if (await shareFiles([pdfFile], `${recording.name}\n会议提纲 PDF`)) return;
        if (await shareUrl(outlineUrl, `${text}\nPDF：${outlineUrl}`)) return;
        downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
        setToast("会议提纲 PDF 已下载，请从文件发送");
        return;
      } else {
        try {
          if (await shareWecomAudioFile()) {
            downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
            setToast("已打开企业微信 MP3 文件分享，TXT 已保存到本机");
            return;
          }
        } catch {
          // Continue with system file sharing or local save.
        }
        const mp3File = await getAudioFile();
        if (await shareFiles([transcriptFile, mp3File], "", { fileOnly: true })) {
          setToast("已调起 MP3 和 TXT 文件分享");
          return;
        }
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback("TXT 已保存，已开始下载 MP3 文件，请从企业微信文件里发送");
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (shareMode === "outline") {
        try {
          const pdfFile = await getOutlineFile();
          downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
          setToast("会议提纲 PDF 已下载，请从企业微信文件里发送");
          return;
        } catch {
          setToast(error instanceof Error ? error.message : "会议提纲 PDF 分享失败");
          return;
        }
      }
      if (shareMode === "audio") {
        try {
          await downloadAudioFileFallback("已开始下载 MP3 文件，请从企业微信文件里发送");
          return;
        } catch {
          setToast(error instanceof Error ? error.message : "MP3 分享失败");
          return;
        }
      }
    }

    if (["audio", "both"].includes(shareMode)) {
      try {
        if (shareMode === "both") downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback(
          shareMode === "both" ? "TXT 已保存，已开始下载 MP3 文件，请从企业微信文件里发送" : "已开始下载 MP3 文件，请从企业微信文件里发送",
        );
        return;
      } catch (error) {
        setToast(error instanceof Error ? error.message : "MP3 分享失败");
        return;
      }
    }

    if (!["audio", "both"].includes(shareMode) && window.wx?.invoke) {
      try {
        await new Promise((resolve, reject) => {
          window.wx.invoke(
            "shareAppMessage",
            {
              title: recording.name,
              desc:
                shareMode === "text"
                  ? "TXT 文字稿"
                  : shareMode === "outline"
                    ? "会议提纲 PDF"
                  : shareMode === "audio"
                    ? `MP3 录音，时长 ${formatDuration(recording.durationMs)}`
                    : `TXT 文字稿 + MP3 录音，时长 ${formatDuration(recording.durationMs)}`,
              link: shareMode === "outline" ? outlineUrl : shareMode === "audio" ? audioDownloadUrl : shareMode === "text" ? transcriptUrl : audioDownloadUrl,
              imgUrl: "",
            },
            (result) => {
              const message = String(result?.err_msg || "");
              if (!message || message.includes(":ok")) resolve();
              else reject(new Error(message));
            },
          );
        });
        setToast("已打开企业微信分享");
        return;
      } catch {
        // Fall through to copy/share sheet.
      }
    }

    try {
      const fallbackText =
        shareMode === "text"
          ? `${text}\nTXT：${transcriptUrl}`
          : shareMode === "audio"
            ? `${text}\nMP3 文件已准备，请从本机文件发送。`
            : shareMode === "outline"
              ? `${text}\nPDF：${outlineUrl}`
              : `${text}\nTXT：${transcriptUrl}\nMP3 文件已准备，请从本机文件发送。`;
      await navigator.clipboard.writeText(fallbackText);
      if (shareMode === "text") {
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        setToast("TXT 已下载，文字链接已复制");
      } else if (shareMode === "audio") {
        await downloadAudioFileFallback("已开始下载 MP3 文件，没有复制网页链接");
      } else if (shareMode === "outline") {
        const pdfFile = await getOutlineFile();
        downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
        setToast("会议提纲 PDF 已下载，链接已复制");
      } else {
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback("TXT 已保存，已开始下载 MP3 文件，没有复制录音网页链接");
      }
    } catch {
      setShareSheet({
        title: recording.name,
        text:
          shareMode === "text"
            ? `${text}\nTXT：${transcriptUrl}`
            : shareMode === "audio"
              ? `${text}\nMP3 文件已准备，请从本机文件发送。`
              : shareMode === "outline"
                ? `${text}\nPDF：${outlineUrl}`
                : `${text}\nTXT：${transcriptUrl}\nMP3 文件已准备，请从本机文件发送。`,
      });
    }
  }

  async function copyShareSheet() {
    if (!shareSheet?.text) return;
    try {
      await navigator.clipboard.writeText(shareSheet.text);
      setToast("分享内容已复制");
      setShareSheet(null);
    } catch {
      setToast("请长按选择内容复制");
    }
  }

  function markRecordingDeleting(id, deleting) {
    if (!id) return;
    setDeletingRecordIds((current) => {
      if (deleting) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  }

  function adjustFolderStatsAfterRecordingRemoval(recording, { permanent = false } = {}) {
    setFolderStats((current) => {
      const wasInTrash = Boolean(recording.deletedAt);
      const wasActive = !wasInTrash;
      return {
        ...current,
        totalCount: wasActive ? Math.max(0, current.totalCount - 1) : current.totalCount,
        favoriteCount: wasActive && recording.favorite ? Math.max(0, current.favoriteCount - 1) : current.favoriteCount,
        uncategorizedCount: wasActive && !recording.folderId ? Math.max(0, current.uncategorizedCount - 1) : current.uncategorizedCount,
        trashCount: permanent
          ? Math.max(0, current.trashCount - (wasInTrash ? 1 : 0))
          : wasActive
            ? current.trashCount + 1
            : current.trashCount,
      };
    });
  }

  function hideRecordingFromUi(recording, options = {}) {
    optimisticRemovedRecordIdsRef.current.add(recording.id);
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
    setSelectedId((current) => (current === recording.id ? "" : current));
    adjustFolderStatsAfterRecordingRemoval(recording, options);
  }

  function releaseOptimisticRecordingRemoval(id) {
    optimisticRemovedRecordIdsRef.current.delete(id);
  }

  async function runSmoothDelete(recording, { permanent = false } = {}) {
    const endpoint = `/api/recordings/${recording.id}${permanent ? "?permanent=true" : ""}`;
    hideRecordingFromUi(recording, { permanent });

    try {
      await api(endpoint, { method: "DELETE" });
      releaseOptimisticRecordingRemoval(recording.id);
      refreshFolders().catch(() => {});
      refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
    } catch (error) {
      releaseOptimisticRecordingRemoval(recording.id);
      refreshFolders().catch(() => {});
      refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
      setToast("删除失败，请稍后重试");
    }
  }

  async function deleteRecording(recording) {
    const confirmed = window.confirm(`把「${recording.name}」移入回收站？`);
    if (!confirmed) return;
    runSmoothDelete(recording).catch(() => {});
  }

  async function restoreRecording(recording) {
    const payload = await api(`/api/recordings/${recording.id}/restore`, { method: "POST" });
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
    setSelectedId(payload.recording.id);
    refreshFolders().catch(() => {});
    setToast("录音已恢复");
  }

  async function permanentDeleteRecording(recording) {
    const confirmed = window.confirm(`彻底删除「${recording.name}」？删除后不能恢复。`);
    if (!confirmed) return;
    runSmoothDelete(recording, { permanent: true }).catch(() => {});
  }

  function applyAuthPayload(payload, message) {
    const accountUsername = String(payload.account?.username || payload.profile?.username || "").trim();
    const nextAuth = {
      token: payload.token,
      expiresAt: payload.expiresAt,
      account: payload.account,
      profile: payload.profile,
    };
    saveStoredAuth(nextAuth);
    setAuth(nextAuth);
    const nextProfile = {
      ...profile,
      ...(payload.profile || {}),
      accountLoggedIn: true,
      name: accountUsername || payload.profile?.name || profile.name || "",
      username: accountUsername,
      clientId: payload.account?.clientId || payload.profile?.clientId || getClientId(),
    };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
    window.localStorage.removeItem(QA_ACTIVE_MESSAGE_KEY);
    setSelectedId("");
    setToast(message);
    refreshFolders().catch(() => {});
    refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
  }

  async function enterAccount({ username, password, mode = "register" }) {
    const isLogin = mode === "login";
    const accountProfile = {
      ...profile,
      name: username,
      username,
    };
    const payload = await api(isLogin ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, profile: accountProfile, mergeLocal: !isLogin }),
    });
    applyAuthPayload(payload, isLogin ? "已登录账号，数据已同步" : "账号已注册，数据已同步");
  }

  function logoutAccount() {
    clearStoredAuth();
    setAuth(null);
    window.localStorage.removeItem(QA_ACTIVE_MESSAGE_KEY);
    window.localStorage.removeItem(DAILY_BRIEF_ACTIVE_KEY);
    const clientId = getClientId();
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    window.localStorage.removeItem(profileStorageKey(clientId));
    const nextProfile = {
      clientId,
      language: profile.language || "中文",
      recordsTitle: profile.recordsTitle || "我的录音",
      accountLoggedIn: false,
      name: "",
      username: "",
      avatarUrl: "",
      company: "",
      department: "",
      phone: "",
    };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
    setSelectedId("");
    setToast("已退出登录");
    refreshFolders().catch(() => {});
    refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
  }

  async function saveProfile() {
    const clientId = getClientId();
    const profileToSave = { ...profile, clientId };
    setProfile(profileToSave);
    saveLocalProfile(profileToSave);
    try {
      const payload = await api("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileToSave),
      });
      const nextProfile = {
        ...profileToSave,
        ...(payload.profile || {}),
        clientId: (payload.profile || {}).clientId || clientId,
      };
      setProfile(nextProfile);
      saveLocalProfile(nextProfile);
      setToast(uiText(nextProfile.language || profileToSave.language || "中文", "个人信息已保存", "Profile saved"));
      return nextProfile;
    } catch {
      setToast(uiText(profileToSave.language || "中文", "个人信息已保存到本机，服务器同步失败", "Profile saved on this device, server sync failed"));
      return profileToSave;
    }
  }
  async function saveRecordsTitle(recordsTitle) {
    const nextProfile = { ...profile, recordsTitle };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
  }

  function openDetail(id) {
    setSelectedId(id);
    setActiveView("detail");
  }

  function navigate(view) {
    if (view === "detail") setSelectedId("");
    setActiveView(view);
  }

  return (
    <main className={keyboardVisible ? "app-shell keyboard-visible" : "app-shell"}>
      <div className="h5-app">
        <div className="view-stack">
          {activeView === "record" ? (
            <RecorderView
              elapsedMs={elapsedMs}
              isRecording={isRecording}
              level={level}
              recordingError={recordingError}
              onToggleRecording={toggleRecording}
            />
          ) : null}

          {activeView === "records" ? (
            <RecordsView
              recordings={recordsForView}
              folders={folders}
              folderStats={folderStats}
              recordsTitle={profile.recordsTitle || "我的录音"}
              selectedFolderId={selectedFolderId}
              query={query}
              setQuery={setQuery}
              loading={loading}
              deletingRecordIds={deletingRecordIds}
              uploadBusy={uploadingRecords.length > 0}
              onOpenSettings={() => setSettingsOpen(true)}
              onStartRecording={() => setActiveView("record")}
              onUploadFile={() => uploadInputRef.current?.click()}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
              onSelectFolder={setSelectedFolderId}
              onOpenDetail={openDetail}
              onRename={renameRecording}
              onUpdateMeta={updateRecordingMeta}
              onMove={moveRecording}
              onToggleFavorite={toggleFavorite}
              onRetranscribe={retranscribeRecording}
              onShare={shareRecording}
              onDelete={deleteRecording}
              onRestore={restoreRecording}
              onPermanentDelete={permanentDeleteRecording}
              onUpdateRecordsTitle={saveRecordsTitle}
              language={profile.language}
              onRefresh={() => {
                refreshRecordings(query, selectedFolderId);
                refreshFolders().catch(() => {});
                refreshTranscriptionStatus().catch(() => {});
              }}
            />
          ) : null}

          {activeView === "detail" ? (
            <DetailView
              recording={selectedRecording}
              recordings={recordings}
              transcriptionStatus={transcriptionStatus}
              onBack={() => setActiveView("records")}
              onRename={renameRecording}
              onUpdateMeta={updateRecordingMeta}
              onToast={setToast}
              language={profile.language}
              onSelectRecording={(id) => setSelectedId(id)}
              onRefreshRecording={(id) => window.setTimeout(() => refreshRecording(id).catch(() => {}), 1200)}
            />
          ) : null}
        </div>

        <BottomNav activeView={activeView} onNavigate={navigate} language={profile.language} hidden={keyboardVisible} />
      </div>

      <input
        ref={uploadInputRef}
        className="upload-input"
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.webm,.aac,.mp4,.mov,.m4v"
        multiple
        onChange={handleUploadFile}
      />

      <SettingsDrawer
        open={settingsOpen}
        profile={profile}
        auth={auth}
        setProfile={setProfile}
        onSave={saveProfile}
        onAccountEnter={enterAccount}
        onAccountLogout={logoutAccount}
        onClose={() => {
          saveProfile().catch(() => {});
          setSettingsOpen(false);
        }}
      />
      <ShareSheet share={shareSheet} onCopy={copyShareSheet} onClose={() => setShareSheet(null)} />
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}
