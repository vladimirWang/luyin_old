import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import logger from "./utils/log.js";

let ffmpegStaticPath;
try {
  ffmpegStaticPath = await import("ffmpeg-static");
} catch {
  ffmpegStaticPath = null;
}

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function formatTime(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clampEnd(startMs, endMs, durationMs) {
  return Math.max(startMs + 1000, Math.min(endMs, Math.max(durationMs, startMs + 1000)));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  const limit = Math.max(1, Math.min(items.length || 1, Math.round(Number(concurrency) || 1)));
  const results = new Array(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

function envFirst(names = [], fallback = "") {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return fallback;
}

function envFlag(name, fallback = "1") {
  const value = env(name, fallback).toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

export function isRecordingApiTranscriptionEnabled() {
  return envFlag("ASR_API_TRANSCRIPTION_ENABLED", "0");
}

const defaultTencentHotwords = [
  "Great Agent OS",
  "Agent OS",
  "硅基画像",
  "硅基人",
  "数据基座",
  "地产投拓",
  "客群画像",
  "原生研判",
  "项目研判",
  "OCEAN",
  "DeepSeek",
  "灵宝",
  "画布",
  "建发",
  "保利",
  "小红书",
  "抖音",
  "方案A",
  "方案B",
  "竖向体量",
  "建筑开发链路",
  "生图",
  "生文",
  "分镜",
  "复盘",
  "CAD",
  "AI",
];

const defaultTencentHotwordsClean = [
  "Great Agent OS",
  "Agent OS",
  "硅基画像",
  "硅基人",
  "数据基座",
  "地产投拓",
  "客群画像",
  "原生研判",
  "项目研判",
  "OCEAN",
  "DeepSeek",
  "灵宝",
  "画布",
  "建发",
  "保利",
  "小红书",
  "抖音",
  "方案A",
  "方案B",
  "竖向体量",
  "建筑开发链路",
  "生图",
  "生文",
  "分镜",
  "复盘",
  "CAD",
  "AI",
  "华南保利",
  "物业",
  "报价",
  "试点小区",
  "数据治理",
];

function splitList(value = "") {
  return String(value || "")
    .split(/[,，、\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(items = []) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function tencentDefaultEngineModelType() {
  return env("TENCENT_ASR_ENGINE_MODEL_TYPE", "16k_zh_en");
}

function dynamicTencentHotwords(recording = {}) {
  const candidates = [
    recording.name,
    recording.tag,
    recording.ownerName,
    recording.speakerName,
    ...(recording.folderName ? [recording.folderName] : []),
  ];

  return candidates
    .flatMap((value) => splitList(String(value || "").replace(/[|/]/g, "，")))
    .filter((value) => value.length >= 2 && value.length <= 30);
}

function tencentHotwordList(recording = {}) {
  const disabled = envFlag("TENCENT_ASR_ENABLE_HOTWORDS", "1") === false;
  if (disabled) return [];
  const configured = splitList(env("TENCENT_ASR_HOTWORDS"));
  const project = splitList(env("TENCENT_ASR_PROJECT_HOTWORDS"));
  return uniqueList([...defaultTencentHotwordsClean, ...configured, ...project, ...dynamicTencentHotwords(recording)]).slice(0, 128);
}

function speakerKeyFromSegment(segment) {
  const raw =
    segment.speakerKey ??
    segment.speaker_key ??
    segment.speakerLabel ??
    segment.speaker_label ??
    segment.speaker ??
    segment.speaker_id ??
    segment.role ??
    segment.channel;
  const value = String(raw || "").trim();
  return value || "speaker-1";
}

function segmentTime(segment, msKeys, secondKeys, fallback) {
  for (const key of msKeys) {
    if (segment[key] !== undefined) return numeric(segment[key], fallback);
  }

  for (const key of secondKeys) {
    if (segment[key] !== undefined) return Math.round(numeric(segment[key], fallback / 1000) * 1000);
  }

  return fallback;
}

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => textFromContent(item?.text || item?.content || item?.value || ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    return textFromContent(content.text || content.content || content.value || "");
  }
  return "";
}

function textFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const direct = textFromContent(payload.text || payload.transcript || payload.output_text || payload.answer);
  if (direct) return direct;

  if (typeof payload.result === "string") return payload.result.trim();
  if (payload.result && typeof payload.result === "object") {
    const resultText = textFromPayload(payload.result);
    if (resultText) return resultText;
  }

  if (payload.data && typeof payload.data === "object") {
    const dataText = textFromPayload(payload.data);
    if (dataText) return dataText;
  }

  const choice = payload.choices?.[0];
  const choiceText = textFromContent(choice?.message?.content || choice?.text || choice?.delta?.content);
  return choiceText.trim();
}

function parseSpeakerPrefix(text = "", fallbackKey = "speaker-1") {
  const raw = String(text || "").trim();
  const match = raw.match(/^(?:说话人|讲话人|发言人|speaker|Speaker)\s*([A-Za-z0-9一二三四五六七八九十]+)\s*[:：]\s*(.+)$/i);
  if (!match) {
    const alphaMatch = raw.match(/^([A-Z])\s*[:：]\s*(.+)$/);
    if (!alphaMatch) return { text: raw, speakerKey: fallbackKey };
    return { text: alphaMatch[2].trim(), speakerKey: `speaker-${alphaMatch[1].toLowerCase()}` };
  }

  return {
    text: match[2].trim(),
    speakerKey: `speaker-${match[1]}`,
  };
}

function splitTranscriptText(text = "") {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const parts = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [paragraph];
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  const merged = [];
  for (const part of parts) {
    const last = merged[merged.length - 1] || "";
    if (last && last.length + part.length <= 42) {
      merged[merged.length - 1] = `${last}${part}`;
    } else {
      merged.push(part);
    }
  }

  return merged;
}

function segmentsFromPlainText(text, durationMs, base = {}) {
  const pieces = splitTranscriptText(text);
  if (pieces.length === 0) return [];

  const safeStart = Number.isFinite(base.startMs) ? base.startMs : 0;
  const safeEnd = Number.isFinite(base.endMs) ? base.endMs : Math.max(durationMs, 1000);
  const totalMs = Math.max(1000, safeEnd - safeStart);
  const totalWeight = pieces.reduce((sum, piece) => sum + Math.max(8, piece.length), 0);
  let consumedWeight = 0;

  return pieces.map((piece, index) => {
    const parsed = parseSpeakerPrefix(piece, base.speakerKey || "speaker-1");
    const weight = Math.max(8, piece.length);
    const isLast = index === pieces.length - 1;
    const startMs = safeStart + Math.round((totalMs * consumedWeight) / totalWeight);
    consumedWeight += weight;
    const weightedEnd = safeStart + Math.round((totalMs * consumedWeight) / totalWeight);
    const endMs = isLast ? safeEnd : Math.min(safeEnd, Math.max(startMs + 250, weightedEnd));

    return {
      id: crypto.randomUUID(),
      startMs,
      endMs,
      text: parsed.text || piece,
      speakerKey: parsed.speakerKey || base.speakerKey || "speaker-1",
      confidence: numeric(base.confidence, 0.9),
    };
  });
}

export function expandTranscriptSegments(segments = [], durationMs = 0) {
  return segments.flatMap((segment) => {
    const text = String(segment.text || "").trim();
    const pieces = splitTranscriptText(text);
    const hasSpeakerPrefix = /^(?:说话人|讲话人|发言人|speaker|Speaker)\s*[A-Za-z0-9一二三四五六七八九十]+\s*[:：]/.test(text);
    const shouldSplit = pieces.length > 1 || hasSpeakerPrefix;
    if (!shouldSplit) {
      const parsed = parseSpeakerPrefix(text, speakerKeyFromSegment(segment));
      return [
        {
          ...segment,
          id: segment.id || crypto.randomUUID(),
          text: parsed.text || text,
          speakerKey: parsed.speakerKey || speakerKeyFromSegment(segment),
        },
      ];
    }

    return segmentsFromPlainText(text, durationMs, {
      startMs: numeric(segment.startMs, 0),
      endMs: numeric(segment.endMs, Math.max(durationMs, 1000)),
      speakerKey: speakerKeyFromSegment(segment),
      confidence: segment.confidence,
    }).map((item) => ({
      ...item,
      recordingId: segment.recordingId,
      createdAt: segment.createdAt,
    }));
  });
}

function normalizeSegments(payload, durationMs) {
  const rawSegments =
    payload?.segments ||
    payload?.data?.segments ||
    payload?.result?.segments ||
    payload?.transcription?.segments ||
    [];

  if (Array.isArray(rawSegments) && rawSegments.length > 0) {
    const normalized = rawSegments.map((segment, index) => {
      const startMs = segmentTime(segment, ["startMs", "start_ms"], ["start", "begin", "begin_time"], index * 8000);
      const endMs = segmentTime(segment, ["endMs", "end_ms"], ["end", "finish", "end_time"], startMs + 8000);
      const parsed = parseSpeakerPrefix(String(segment.text || segment.sentence || segment.content || "").trim(), speakerKeyFromSegment(segment));

      return {
        id: crypto.randomUUID(),
        startMs,
        endMs: clampEnd(startMs, endMs, durationMs),
        text: parsed.text || `第 ${index + 1} 段转写内容`,
        rawText: segment.rawText || segment.raw_text || segment.text || segment.sentence || segment.content || "",
        correctedText: segment.correctedText || segment.corrected_text || parsed.text || segment.text || "",
        apiRaw: segment.apiRaw || segment.api_raw || null,
        speakerKey: parsed.speakerKey || speakerKeyFromSegment(segment),
        confidence: numeric(segment.confidence ?? segment.score, 0.9),
      };
    });
    return expandTranscriptSegments(normalized, durationMs);
  }

  const text = textFromPayload(payload);
  if (text) {
    return segmentsFromPlainText(text, durationMs, {
      startMs: 0,
      endMs: Math.max(durationMs, 1000),
      speakerKey: "speaker-1",
      confidence: 0.9,
    });
  }

  return [];
}

function fallbackSegments(recording) {
  const durationMs = Math.max(recording.durationMs || 12000, 12000);
  const firstEnd = Math.floor(durationMs * 0.34);
  const secondEnd = Math.floor(durationMs * 0.68);

  return [
    {
      id: crypto.randomUUID(),
      startMs: 0,
      endMs: clampEnd(0, firstEnd, durationMs),
      text: `录音 ${String(recording.seq).padStart(3, "0")} 已上传服务器，系统已生成可检索转写。`,
      speakerKey: "speaker-1",
      confidence: 0.88,
    },
    {
      id: crypto.randomUUID(),
      startMs: firstEnd,
      endMs: clampEnd(firstEnd, secondEnd, durationMs),
      text: "这里会接入真实语音转文字服务，返回每句话的开始时间、结束时间和文本内容。",
      speakerKey: "speaker-1",
      confidence: 0.86,
    },
    {
      id: crypto.randomUUID(),
      startMs: secondEnd,
      endMs: clampEnd(secondEnd, durationMs, durationMs),
      text: "详情页的问题会根据这些时间片段定位到文字和对应音频位置。",
      speakerKey: "speaker-1",
      confidence: 0.84,
    },
  ];
}

export function isFallbackTranscript(segments = []) {
  const joined = segments.map((segment) => segment.text || "").join(" ");
  return (
    joined.includes("已上传服务器，系统已生成可检索转写") ||
    joined.includes("这里会接入真实语音转文字服务") ||
    joined.includes("详情页的问题会根据这些时间片段定位")
  );
}

async function readApiPayload(response, label) {
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${raw.slice(0, 240)}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} 执行超时`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(new Error("服务器未安装 ffmpeg，无法把当前音频转换为转写服务需要的格式"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} 执行失败：${stderr.slice(0, 300)}`));
    });
  });
}

async function convertAudioToWav(sourcePath, targetPath) {
  const sampleRate = env("ASR_CONVERT_SAMPLE_RATE", "16000");
  let timeoutMs = numeric(env("ASR_FFMPEG_TIMEOUT_MS", "900000"), 900000);
  if (timeoutMs > 0 && timeoutMs < 1000) timeoutMs *= 1000;
  const ffmpegCommand = env("FFMPEG_PATH", ffmpegStaticPath || "ffmpeg");
  await runProcess(ffmpegCommand, ["-y", "-i", sourcePath, "-ar", sampleRate, "-ac", "1", targetPath], timeoutMs);
}

function tencentAudioFilters() {
  const filters = [];
  if (envFlag("TENCENT_ASR_AUDIO_NORMALIZE", "1")) {
    filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  }
  if (envFlag("TENCENT_ASR_AUDIO_DENOISE", "0")) {
    filters.push("afftdn=nf=-25");
  }
  return filters;
}

async function convertAudioFileToTencentMp3(sourcePath, targetPath) {
  const sampleRate = env("ASR_CONVERT_SAMPLE_RATE", env("TENCENT_ASR_SAMPLE_RATE", "16000"));
  const bitrate = env("ASR_CHUNK_BITRATE", env("TENCENT_ASR_CHUNK_BITRATE", "32k"));
  let timeoutMs = numeric(env("ASR_FFMPEG_TIMEOUT_MS", "900000"), 900000);
  if (timeoutMs > 0 && timeoutMs < 1000) timeoutMs *= 1000;
  const ffmpegCommand = env("FFMPEG_PATH", ffmpegStaticPath || "ffmpeg");
  const args = ["-y", "-i", sourcePath, "-vn", "-ar", sampleRate, "-ac", "1", "-b:a", bitrate];
  const filters = tencentAudioFilters();
  if (filters.length) args.push("-af", filters.join(","));
  args.push(targetPath);
  await runProcess(ffmpegCommand, args, timeoutMs);
}

async function convertAudioSegmentToMp3(sourcePath, targetPath, startMs, durationMs) {
  const sampleRate = env("ASR_CONVERT_SAMPLE_RATE", env("TENCENT_ASR_SAMPLE_RATE", "16000"));
  const bitrate = env("ASR_CHUNK_BITRATE", env("TENCENT_ASR_CHUNK_BITRATE", "32k"));
  let timeoutMs = numeric(env("ASR_FFMPEG_TIMEOUT_MS", "900000"), 900000);
  if (timeoutMs > 0 && timeoutMs < 1000) timeoutMs *= 1000;
  const ffmpegCommand = env("FFMPEG_PATH", ffmpegStaticPath || "ffmpeg");
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, startMs / 1000)),
    "-t",
    String(Math.max(1, durationMs / 1000)),
    "-i",
    sourcePath,
    "-vn",
    "-ar",
    sampleRate,
    "-ac",
    "1",
    "-b:a",
    bitrate,
  ];
  const filters = tencentAudioFilters();
  if (filters.length) args.push("-af", filters.join(","));
  args.push(targetPath);
  await runProcess(ffmpegCommand, args, timeoutMs);
}

function mimoAudioMime(mimeType = "", fileName = "") {
  const normalized = mimeType.toLowerCase();
  const ext = path.extname(fileName).toLowerCase();

  if (normalized.includes("wav") || ext === ".wav") return "audio/wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3") || ext === ".mp3") return "audio/mpeg";
  return "";
}

async function prepareMimoAudio(recording) {
  const directMime = mimoAudioMime(recording.mimeType, recording.fileName);
  if (directMime) {
    return {
      audioPath: recording.storagePath,
      mimeType: directMime,
      cleanup: async () => {},
    };
  }

  const tempFolder = await mkdtemp(path.join(os.tmpdir(), "wecom-recorder-asr-"));
  const targetPath = path.join(tempFolder, `${recording.id}.wav`);
  await convertAudioToWav(recording.storagePath, targetPath);

  return {
    audioPath: targetPath,
    mimeType: "audio/wav",
    cleanup: async () => rm(tempFolder, { recursive: true, force: true }),
  };
}

function maxMimoBase64Chars() {
  return numeric(env("MIMO_ASR_MAX_BASE64_CHARS", env("MIMO_MAX_BASE64_CHARS", String(10 * 1024 * 1024))), 10 * 1024 * 1024);
}

function roughlyBase64Chars(byteLength) {
  return Math.ceil(byteLength / 3) * 4;
}

async function prepareMimoAudioChunks(recording, maxChars) {
  const directMime = mimoAudioMime(recording.mimeType, recording.fileName);
  if (directMime) {
    const info = await stat(recording.storagePath);
    if (roughlyBase64Chars(info.size) <= maxChars) {
      return {
        chunks: [
          {
            audioPath: recording.storagePath,
            mimeType: directMime,
            startMs: 0,
            durationMs: recording.durationMs || 0,
          },
        ],
        cleanup: async () => {},
      };
    }
  }

  const totalMs = Math.max(recording.durationMs || 0, 1000);
  const chunkSeconds = Math.max(30, numeric(env("MIMO_CHUNK_SECONDS", "120"), 120));
  const chunkMs = chunkSeconds * 1000;
  const tempFolder = await mkdtemp(path.join(os.tmpdir(), "wecom-recorder-mimo-chunks-"));
  const chunks = [];

  try {
    for (let startMs = 0, index = 0; startMs < totalMs; startMs += chunkMs, index += 1) {
      const durationMs = Math.min(chunkMs, totalMs - startMs);
      const targetPath = path.join(tempFolder, `${recording.id}-${String(index + 1).padStart(3, "0")}.mp3`);
      await convertAudioSegmentToMp3(recording.storagePath, targetPath, startMs, durationMs);
      const info = await stat(targetPath);
      const approxChars = roughlyBase64Chars(info.size);
      if (approxChars > maxChars) {
        throw new Error(
          `MiMo ASR 第 ${index + 1} 段音频 Base64 仍超过限制：${approxChars}/${maxChars}，请调小 MIMO_CHUNK_SECONDS`,
        );
      }
      chunks.push({
        audioPath: targetPath,
        mimeType: "audio/mpeg",
        startMs,
        durationMs,
      });
    }
  } catch (error) {
    await rm(tempFolder, { recursive: true, force: true });
    throw error;
  }

  return {
    chunks,
    cleanup: async () => rm(tempFolder, { recursive: true, force: true }),
  };
}

async function transcribeWithOpenAI(recording) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY 未配置");

  const model = env("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe");
  const endpoint = env("OPENAI_TRANSCRIBE_URL", "https://api.openai.com/v1/audio/transcriptions");
  const prompt = env("OPENAI_TRANSCRIBE_PROMPT");
  const responseFormat = env("OPENAI_TRANSCRIBE_RESPONSE_FORMAT");
  const language = env("OPENAI_TRANSCRIBE_LANGUAGE");
  const buffer = await readFile(recording.storagePath);
  const formData = new FormData();

  formData.append("file", new Blob([buffer], { type: recording.mimeType || "application/octet-stream" }), recording.fileName);
  formData.append("model", model);
  if (prompt) formData.append("prompt", prompt);
  if (responseFormat) formData.append("response_format", responseFormat);
  if (language) formData.append("language", language);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  return readApiPayload(response, "OpenAI transcription");
}

async function transcribeWithCustomApi(recording) {
  const endpoint = env("ASR_API_URL", env("TRANSCRIBE_API_URL"));
  if (!endpoint) throw new Error("ASR_API_URL 未配置");

  const buffer = await readFile(recording.storagePath);
  const fileField = env("ASR_FILE_FIELD", "file");
  const formData = new FormData();
  formData.append(fileField, new Blob([buffer], { type: recording.mimeType || "application/octet-stream" }), recording.fileName);
  formData.append("recordingId", recording.id);
  formData.append("durationMs", String(recording.durationMs || 0));
  formData.append("language", env("ASR_LANGUAGE", "auto"));

  const headers = {};
  const apiKey = env("ASR_API_KEY", env("TRANSCRIBE_API_KEY"));
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: formData,
  });

  return readApiPayload(response, "Custom ASR");
}

async function requestMimoAsr(base64Audio, mimeType) {
  const apiKey = env("MIMO_API_KEY");
  if (!apiKey) throw new Error("MIMO_API_KEY 未配置");

  const baseUrl = env("MIMO_API_BASE", env("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1")).replace(/\/$/, "");
  const endpoint = env("MIMO_ASR_URL", `${baseUrl}/chat/completions`);
  const model = env("MIMO_ASR_MODEL", "mimo-v2.5-asr");
  const language = env("MIMO_ASR_LANGUAGE", "auto");
  const dataUrl = `data:${mimeType};base64,${base64Audio}`;

  const retries = Math.max(0, numeric(env("MIMO_ASR_RETRIES", "2"), 2));
  const retryDelayMs = Math.max(400, numeric(env("MIMO_ASR_RETRY_DELAY_MS", "1600"), 1600));
  const body = JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUrl } }],
        },
      ],
      asr_options: { language },
    });

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body,
    });

    if (response.status === 429 && attempt < retries) {
      await response.text().catch(() => "");
      await delay(retryDelayMs * (attempt + 1));
      continue;
    }

    return readApiPayload(response, "MiMo ASR");
  }
}

async function transcribeWithMimoApi(recording) {
  const maxChars = maxMimoBase64Chars();
  const prepared = await prepareMimoAudioChunks(recording, maxChars);
  try {
    const allSegments = [];
    const rawPayloads = [];

    for (const chunk of prepared.chunks) {
      const base64Audio = (await readFile(chunk.audioPath)).toString("base64");
      if (base64Audio.length > maxChars) {
        throw new Error(`MiMo ASR 音频 Base64 超过限制：${base64Audio.length}/${maxChars}`);
      }

      const payload = await requestMimoAsr(base64Audio, chunk.mimeType);
      rawPayloads.push(payload);
      const chunkSegments = normalizeSegments(payload, chunk.durationMs || 0).map((segment) => ({
        ...segment,
        startMs: segment.startMs + chunk.startMs,
        endMs: segment.endMs + chunk.startMs,
      }));
      allSegments.push(...chunkSegments);
    }

    return {
      segments: allSegments,
      text: allSegments.map((segment) => segment.text).join("\n"),
      raw: rawPayloads,
    };
  } finally {
    await prepared.cleanup();
  }
}

function tencentSecretId() {
  return envFirst(["TENCENT_ASR_SECRET_ID", "TENCENT_SECRET_ID", "TENCENTCLOUD_SECRET_ID"]);
}

function tencentSecretKey() {
  return envFirst(["TENCENT_ASR_SECRET_KEY", "TENCENT_SECRET_KEY", "TENCENTCLOUD_SECRET_KEY"]);
}

function tencentEndpointHost() {
  return env("TENCENT_ASR_ENDPOINT", "asr.tencentcloudapi.com")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

function hmacSha256(key, text, encoding) {
  return crypto.createHmac("sha256", key).update(text).digest(encoding);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function tencentDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function signTencentAsrRequest(action, body, timestamp) {
  const secretId = tencentSecretId();
  const secretKey = tencentSecretKey();
  if (!secretId || !secretKey) {
    throw new Error("腾讯云 ASR 需要同时配置 TENCENT_ASR_SECRET_ID 和 TENCENT_ASR_SECRET_KEY。当前只检测到 SecretId，缺少 SecretKey。");
  }

  const service = "asr";
  const host = tencentEndpointHost();
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256Hex(body)].join("\n");
  const date = tencentDate(timestamp);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign, "hex");

  return {
    "Content-Type": "application/json; charset=utf-8",
    Host: host,
    "X-TC-Action": action,
    "X-TC-Version": env("TENCENT_ASR_VERSION", "2019-06-14"),
    "X-TC-Region": env("TENCENT_ASR_REGION", "ap-shanghai"),
    "X-TC-Timestamp": String(timestamp),
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function requestTencentAsr(action, payload) {
  const host = tencentEndpointHost();
  const endpoint = env("TENCENT_ASR_API_URL", `https://${host}`);
  const body = JSON.stringify(payload);
  const timeoutMs = Math.max(10000, numeric(env("TENCENT_ASR_HTTP_TIMEOUT_MS", "180000"), 180000));
  const retries = Math.max(0, Math.min(3, numeric(env("TENCENT_ASR_HTTP_RETRIES", "3"), 3)));
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: signTencentAsrRequest(action, body, timestamp),
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          await delay(600 * (attempt + 1));
          continue;
        }
        throw new Error(`Tencent ASR ${action} failed: ${response.status} ${raw.slice(0, 240)}`);
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = { text: raw };
      }
      const apiError = data?.Response?.Error;
      if (apiError) {
        const code = String(apiError.Code || "");
        const retryable = /InternalError|RequestLimitExceeded|FailedOperation|ResourceUnavailable/i.test(code);
        if (retryable && attempt < retries) {
          await delay(600 * (attempt + 1));
          continue;
        }
        throw new Error(`Tencent ASR ${action} failed: ${apiError.Code || "Unknown"} ${apiError.Message || ""}`.trim());
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(600 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error(`Tencent ASR ${action} failed`);
}

function tencentSupportsDirectAudio(recording) {
  const mimeType = String(recording.mimeType || "").toLowerCase();
  const ext = path.extname(recording.fileName || recording.storagePath || "").toLowerCase();
  return (
    [".wav", ".mp3", ".m4a", ".flv", ".mp4", ".wma", ".3gp", ".amr", ".aac", ".ogg", ".flac"].includes(ext) ||
    /audio\/(wav|mpeg|mp3|mp4|aac|ogg|flac|x-m4a|amr)/i.test(mimeType) ||
    /video\/(mp4|3gpp|x-flv)/i.test(mimeType)
  );
}

function maxTencentAudioBytes() {
  return numeric(env("TENCENT_ASR_MAX_BYTES", String(5 * 1024 * 1024)), 5 * 1024 * 1024);
}

async function prepareTencentAudioChunks(recording, maxBytes) {
  if (!envFlag("TENCENT_ASR_PREPROCESS_AUDIO", "1") && tencentSupportsDirectAudio(recording)) {
    const info = await stat(recording.storagePath);
    if (info.size <= maxBytes) {
      return {
        chunks: [
          {
            audioPath: recording.storagePath,
            startMs: 0,
            durationMs: recording.durationMs || 0,
          },
        ],
        cleanup: async () => {},
      };
    }
  }

  const totalMs = Math.max(recording.durationMs || 0, 1000);
  const chunkSeconds = Math.max(300, numeric(env("TENCENT_ASR_CHUNK_SECONDS", "900"), 900));
  const overlapSeconds = Math.max(0, Math.min(10, numeric(env("TENCENT_ASR_CHUNK_OVERLAP_SECONDS", "3"), 3)));
  const chunkMs = chunkSeconds * 1000;
  const overlapMs = overlapSeconds * 1000;
  const stepMs = Math.max(30 * 1000, chunkMs - overlapMs);
  const tempFolder = await mkdtemp(path.join(os.tmpdir(), "wecom-recorder-tencent-asr-"));
  const chunks = [];

  try {
    const wholeTargetPath = path.join(tempFolder, `${recording.id}-16k-mono.mp3`);
    await convertAudioFileToTencentMp3(recording.storagePath, wholeTargetPath);
    const wholeInfo = await stat(wholeTargetPath);
    if (wholeInfo.size <= maxBytes) {
      return {
        chunks: [{ audioPath: wholeTargetPath, startMs: 0, durationMs: recording.durationMs || 0, preprocessed: true }],
        cleanup: async () => rm(tempFolder, { recursive: true, force: true }),
      };
    }

    for (let startMs = 0, index = 0; startMs < totalMs; startMs += stepMs, index += 1) {
      const durationMs = Math.min(chunkMs, totalMs - startMs);
      const targetPath = path.join(tempFolder, `${recording.id}-${String(index + 1).padStart(3, "0")}.mp3`);
      await convertAudioSegmentToMp3(recording.storagePath, targetPath, startMs, durationMs);
      const info = await stat(targetPath);
      if (info.size > maxBytes) {
        throw new Error(
          `腾讯 ASR 第 ${index + 1} 段音频仍超过 5MB 限制：${info.size}/${maxBytes}，请调小 TENCENT_ASR_CHUNK_SECONDS 或 TENCENT_ASR_CHUNK_BITRATE。`,
        );
      }
      chunks.push({ audioPath: targetPath, startMs, durationMs, overlapMs: index > 0 ? overlapMs : 0, preprocessed: true });
      if (startMs + durationMs >= totalMs) break;
    }
  } catch (error) {
    await rm(tempFolder, { recursive: true, force: true });
    throw error;
  }

  return {
    chunks,
    cleanup: async () => rm(tempFolder, { recursive: true, force: true }),
  };
}

function tencentTaskData(payload) {
  return payload?.Response?.Data || payload?.Data || payload || {};
}

function tencentPlainResultText(result = "") {
  return String(result)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function replaceTermWithContext(text, patterns, replacement, contextPattern) {
  let next = String(text || "");
  for (const pattern of patterns) {
    if (!pattern.test(next)) continue;
    if (contextPattern && !contextPattern.test(next)) continue;
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function correctTencentTranscriptText(text = "") {
  let next = String(text || "");
  next = replaceTermWithContext(next, [/灰机人/g], "硅基人", /画像|AI|智能|客户|客群|硅基|数据|系统|形象|人/);
  next = replaceTermWithContext(next, [/数据一作/g], "数据基座", /数据|基座|平台|底座|系统|沉淀/);
  next = replaceTermWithContext(next, [/规定的\s*OS/g, /规定的OS/g], "Great Agent OS", /Agent|OS|系统|智能|平台|产品/);
  next = replaceTermWithContext(next, [/多鱼主播/g], "斗鱼主播", /主播|直播|平台|小红书|抖音|流量/);
  next = replaceTermWithContext(next, [/书像体量/g, /数量体量/g], "竖向体量", /体量|建筑|方案|竖向|空间|设计/);
  next = replaceTermWithContext(next, [/\bDBC\b/g], "DeepSeek", /模型|大模型|AI|接口|Deep|Seek|推理|问答|豆包/);
  next = replaceTermWithContext(next, [/Great\s+Agent\s+O\s*S/gi, /GreatAgentOS/g], "Great Agent OS", /Agent|OS|系统|智能|平台|产品/);
  return next;
}

function correctTencentSegments(segments = []) {
  return segments.map((segment) => {
    const rawText = String(segment.rawText || segment.text || "");
    const correctedText = correctTencentTranscriptText(rawText);
    return {
      ...segment,
      rawText,
      correctedText,
      text: correctedText || rawText,
    };
  });
}

function segmentsFromTencentPayload(payload, durationMs) {
  const data = tencentTaskData(payload);
  const details = Array.isArray(data.ResultDetail) ? data.ResultDetail : [];
  if (details.length > 0) {
    return details
      .map((item, index) => {
        const startMs = numeric(item.StartMs ?? item.startMs, index * 8000);
        const endMs = numeric(item.EndMs ?? item.endMs, startMs + 8000);
        const speakerId = item.SpeakerId ?? item.speakerId;
        const speakerKey = speakerId === undefined || speakerId === null ? "speaker-1" : `speaker-${Number(speakerId) + 1}`;
        const text = String(item.FinalSentence || item.WrittenText || item.SliceSentence || item.Text || "").replace(/\s+/g, " ").trim();
        if (!text) return null;
        return {
          id: crypto.randomUUID(),
          startMs,
          endMs: clampEnd(startMs, endMs, durationMs || endMs),
          text,
          rawText: text,
          apiRaw: item,
          speakerKey,
          confidence: 0.92,
        };
      })
      .filter(Boolean);
  }

  const text = tencentPlainResultText(data.Result || "");
  if (!text) return [];
  return segmentsFromPlainText(text, durationMs, {
    startMs: 0,
    endMs: Math.max(durationMs, 1000),
    speakerKey: "speaker-1",
    confidence: 0.9,
  });
}

async function waitForTencentAsrTask(taskId) {
  const timeoutMs = numeric(env("TENCENT_ASR_TIMEOUT_MS", "900000"), 900000);
  const pollIntervalMs = Math.max(1000, numeric(env("TENCENT_ASR_POLL_INTERVAL_MS", "3000"), 3000));
  const maxPollIntervalMs = Math.max(pollIntervalMs, numeric(env("TENCENT_ASR_POLL_MAX_INTERVAL_MS", "6000"), 6000));
  const deadline = Date.now() + timeoutMs;
  let nextPollIntervalMs = pollIntervalMs;

  while (Date.now() < deadline) {
    const payload = await requestTencentAsr("DescribeTaskStatus", { TaskId: Number(taskId) });
    const data = tencentTaskData(payload);
    const status = numeric(data.Status, -1);
    const statusStr = String(data.StatusStr || "").toLowerCase();

    if (status === 2 || statusStr === "success") return payload;
    if (status === 3 || statusStr === "failed") {
      throw new Error(`腾讯 ASR 转写失败：${data.ErrorMsg || "未知错误"}`);
    }

    await delay(Math.min(nextPollIntervalMs, Math.max(1000, deadline - Date.now())));
    nextPollIntervalMs = Math.min(maxPollIntervalMs, Math.ceil(nextPollIntervalMs * 1.5));
  }

  throw new Error(`腾讯 ASR 转写超时：任务 ${taskId} 在 ${Math.round(timeoutMs / 1000)} 秒内未完成`);
}

function sanitizeTencentRequestPayload(payload = {}, buffer) {
  const { Data, ...rest } = payload;
  if (rest.Url) {
    try {
      const parsed = new URL(rest.Url);
      if (parsed.searchParams.has("token")) parsed.searchParams.set("token", "[token omitted]");
      rest.Url = parsed.toString();
    } catch {
      rest.Url = "[audio url omitted]";
    }
  }
  return {
    ...rest,
    Data: Data ? "[base64 omitted]" : undefined,
    DataSha256: buffer ? crypto.createHash("sha256").update(buffer).digest("hex") : "",
    DataBytes: buffer?.length || payload.DataLen || 0,
  };
}

function tencentCreateRecTaskPayload(recording, source = {}) {
  const hotwords = tencentHotwordList(recording);
  const payload = {
    ChannelNum: numeric(env("TENCENT_ASR_CHANNEL_NUM", "1"), 1),
    EngineModelType: tencentDefaultEngineModelType(),
    ResTextFormat: numeric(env("TENCENT_ASR_RES_TEXT_FORMAT", "3"), 3),
    SourceType: source.url ? 0 : 1,
    SpeakerDiarization: numeric(env("TENCENT_ASR_SPEAKER_DIARIZATION", "1"), 1),
    SpeakerNumber: numeric(env("TENCENT_ASR_SPEAKER_NUMBER", "0"), 0),
    ConvertNumMode: numeric(env("TENCENT_ASR_CONVERT_NUM_MODE", "1"), 1),
    HotwordList: hotwords.join("|"),
  };

  if (source.url) {
    payload.Url = source.url;
  } else {
    payload.Data = source.buffer.toString("base64");
    payload.DataLen = source.buffer.length;
  }

  const hotwordId = env("TENCENT_ASR_HOTWORD_ID");
  if (hotwordId) payload.HotwordId = hotwordId;
  if (!payload.HotwordList) delete payload.HotwordList;

  const sentenceMaxLength = numeric(env("TENCENT_ASR_SENTENCE_MAX_LENGTH", "0"), 0);
  if (sentenceMaxLength > 0) payload.SentenceMaxLength = sentenceMaxLength;

  for (const [envName, paramName] of [
    ["TENCENT_ASR_FILTER_DIRTY", "FilterDirty"],
    ["TENCENT_ASR_FILTER_MODAL", "FilterModal"],
    ["TENCENT_ASR_FILTER_PUNC", "FilterPunc"],
    ["TENCENT_ASR_REINFORCE_HOTWORD", "ReinforceHotword"],
  ]) {
    const value = env(envName);
    if (value) payload[paramName] = numeric(value, 0);
  }

  return payload;
}

async function runTencentRecTask(recording, source, chunk = {}) {
  const payload = tencentCreateRecTaskPayload(recording, source);
  const requestLog = sanitizeTencentRequestPayload(payload, source.buffer);
  const created = await requestTencentAsr("CreateRecTask", payload);
  const taskId = tencentTaskData(created).TaskId;
  if (!taskId) throw new Error("腾讯 ASR 未返回 TaskId，无法查询转写结果。");

  const result = await waitForTencentAsrTask(taskId);
  const startMs = chunk.startMs || 0;
  const chunkSegments = segmentsFromTencentPayload(result, chunk.durationMs || recording.durationMs || 0).map((segment) => ({
    ...segment,
    startMs: segment.startMs + startMs,
    endMs: segment.endMs + startMs,
  }));

  return {
    taskLog: {
      chunkIndex: chunk.chunkIndex || 1,
      chunkStartMs: startMs,
      chunkDurationMs: chunk.durationMs || recording.durationMs || 0,
      mode: source.url ? "url" : "upload",
      taskId,
      createRequestId: created?.Response?.RequestId || "",
      resultRequestId: result?.Response?.RequestId || "",
      request: requestLog,
      created,
      result,
    },
    segments: correctTencentSegments(chunkSegments),
  };
}

function tencentSegmentKey(segment = {}) {
  return correctTencentTranscriptText(segment.text || segment.rawText || "")
    .replace(/[^\p{Script=Han}a-z0-9]/giu, "")
    .slice(0, 48)
    .toLowerCase();
}

function dedupeTencentOverlapSegments(segments = []) {
  const sorted = [...segments].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  const output = [];
  for (const segment of sorted) {
    const previous = output[output.length - 1];
    const currentKey = tencentSegmentKey(segment);
    const previousKey = tencentSegmentKey(previous || {});
    const overlaps = previous && (segment.startMs || 0) < (previous.endMs || 0) + 2500;
    const sameText =
      currentKey &&
      previousKey &&
      (currentKey === previousKey || currentKey.includes(previousKey.slice(0, 24)) || previousKey.includes(currentKey.slice(0, 24)));
    if (overlaps && sameText) continue;
    output.push(segment);
  }
  return output;
}

async function transcribeWithTencentAsr(recording) {
  const audioUrl = String(recording.asrAudioUrl || "").trim();
  if (audioUrl && envFlag("TENCENT_ASR_USE_AUDIO_URL", "1")) {
    try {
      const startedAt = Date.now();
      const { taskLog, segments } = await runTencentRecTask(recording, { url: audioUrl }, {
        chunkIndex: 1,
        startMs: 0,
        durationMs: recording.durationMs || 0,
      });
      const mergedSegments = dedupeTencentOverlapSegments(segments);
      const rawText = mergedSegments.map((segment) => segment.rawText || segment.text).join("\n");
      const correctedText = mergedSegments.map((segment) => segment.correctedText || segment.text).join("\n");
      return {
        segments: mergedSegments,
        text: correctedText,
        rawText,
        correctedText,
        raw: [taskLog.result],
        transcriptionMeta: {
          provider: "tencent_asr",
          engineModelType: tencentDefaultEngineModelType(),
          mode: "url",
          elapsedMs: Date.now() - startedAt,
          hotwords: tencentHotwordList(recording),
          tasks: [taskLog],
        },
      };
    } catch (error) {
      if (!envFlag("TENCENT_ASR_URL_FALLBACK_TO_UPLOAD", "1")) throw error;
      console.warn("[Tencent ASR] url mode failed, fallback to upload chunks:", error instanceof Error ? error.message : error);
    }
  }

  const prepared = await prepareTencentAudioChunks(recording, maxTencentAudioBytes());
  try {
    const startedAt = Date.now();
    const allSegments = [];
    const taskLogs = [];
    const chunkConcurrency = Math.max(
      1,
      Math.min(prepared.chunks.length || 1, numeric(env("TENCENT_ASR_CHUNK_CONCURRENCY", "1"), 1)),
    );

    const chunkResults = await mapWithConcurrency(prepared.chunks, chunkConcurrency, async (chunk, chunkIndex) => {
      const buffer = await readFile(chunk.audioPath);
      return runTencentRecTask(recording, { buffer }, {
        chunkIndex: chunkIndex + 1,
        startMs: chunk.startMs || 0,
        durationMs: chunk.durationMs || 0,
      });
    });

    for (const item of chunkResults) {
      taskLogs.push(item.taskLog);
      allSegments.push(...item.segments);
    }

    const mergedSegments = dedupeTencentOverlapSegments(allSegments);
    const rawText = mergedSegments.map((segment) => segment.rawText || segment.text).join("\n");
    const correctedText = mergedSegments.map((segment) => segment.correctedText || segment.text).join("\n");
    return {
      segments: mergedSegments,
      text: correctedText,
      rawText,
      correctedText,
      raw: taskLogs.map((log) => log.result),
      transcriptionMeta: {
        provider: "tencent_asr",
        engineModelType: tencentDefaultEngineModelType(),
        mode: "upload-chunks",
        elapsedMs: Date.now() - startedAt,
        hotwords: tencentHotwordList(recording),
        audioPreprocess: {
          enabled: envFlag("TENCENT_ASR_PREPROCESS_AUDIO", "1"),
          sampleRate: env("ASR_CONVERT_SAMPLE_RATE", env("TENCENT_ASR_SAMPLE_RATE", "16000")),
          channels: 1,
          normalize: envFlag("TENCENT_ASR_AUDIO_NORMALIZE", "1"),
          denoise: envFlag("TENCENT_ASR_AUDIO_DENOISE", "0"),
          chunkSeconds: numeric(env("TENCENT_ASR_CHUNK_SECONDS", "900"), 900),
          chunkOverlapSeconds: numeric(env("TENCENT_ASR_CHUNK_OVERLAP_SECONDS", "3"), 3),
        },
        tasks: taskLogs,
      },
    };
  } finally {
    await prepared.cleanup();
  }
}

function tencentVoiceFormat(recording) {
  const ext = path.extname(recording.fileName || recording.storagePath || "").replace(/^\./, "").toLowerCase();
  if (ext === "mpeg") return "mp3";
  return ext || "mp3";
}

async function transcribeWithTencentSentence(recording) {
  const buffer = await readFile(recording.storagePath);
  if (buffer.length > maxTencentAudioBytes()) {
    return transcribeWithTencentAsr(recording);
  }

  const payload = {
    ProjectId: numeric(env("TENCENT_ASR_PROJECT_ID", "0"), 0),
    SubServiceType: numeric(env("TENCENT_ASR_SENTENCE_SUB_SERVICE_TYPE", "2"), 2),
    EngSerViceType: env("TENCENT_ASR_SENTENCE_ENGINE_TYPE", "16k_zh"),
    SourceType: 1,
    VoiceFormat: tencentVoiceFormat(recording),
    UsrAudioKey: recording.id || crypto.randomUUID(),
    Data: buffer.toString("base64"),
    DataLen: buffer.length,
    ConvertNumMode: numeric(env("TENCENT_ASR_CONVERT_NUM_MODE", "1"), 1),
  };

  const response = await requestTencentAsr("SentenceRecognition", payload);
  const data = response?.Response || tencentTaskData(response);
  const text = String(data.Result || data.ResultText || data.Text || "").trim();
  return {
    segments: text
      ? segmentsFromPlainText(text, recording.durationMs || 0, {
          startMs: 0,
          endMs: Math.max(recording.durationMs || 0, 1000),
          speakerKey: "speaker-1",
          confidence: 0.94,
        })
      : [],
    text,
    raw: response,
  };
}

export function getTranscriptionMode() {
  const configured = env("ASR_PROVIDER").toLowerCase();
  if (configured) return configured;
  if (env("OPENAI_API_KEY")) return "openai";
  if (tencentSecretId() || tencentSecretKey()) return "tencent_asr";
  if (env("ASR_API_URL") || env("TRANSCRIBE_API_URL")) return "custom";
  return "local-fallback";
}

const tencentAsrProviders = new Set(["tencent_asr", "tencent-asr", "tencent"]);
const supportedAsrProviders = new Set(["local-fallback", "openai", "custom", "mimo", "mimo_api", "mimo-api", ...tencentAsrProviders]);

export function getTranscriptionDiagnostics() {
  const mode = getTranscriptionMode();
  const recordingApiEnabled = isRecordingApiTranscriptionEnabled();
  const checks = {
    openaiKey: Boolean(env("OPENAI_API_KEY")),
    tencentSecretId: Boolean(tencentSecretId()),
    tencentSecretKey: Boolean(tencentSecretKey()),
    customUrl: Boolean(env("ASR_API_URL") || env("TRANSCRIBE_API_URL")),
    ffmpegAvailable: Boolean(env("FFMPEG_PATH", ffmpegStaticPath || "")),
    ffmpegRequiredForTencentUploads: tencentAsrProviders.has(mode),
  };

  if (!recordingApiEnabled) {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: "录音 API 转写已停用；腾讯会议录音会优先使用腾讯会议自带转写。",
    };
  }

  if (mode === "local-fallback") {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: "未检测到真实转写配置，当前只会生成模拟转写内容。",
    };
  }

  if (!supportedAsrProviders.has(mode)) {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: `Unsupported ASR provider: ${mode}. Set ASR_PROVIDER=tencent_asr to use Tencent Cloud ASR.`,
    };
  }

  if (mode === "openai" && !checks.openaiKey) {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: "OpenAI 转写已选择，但 OPENAI_API_KEY 未配置。",
    };
  }

  if (tencentAsrProviders.has(mode) && (!checks.tencentSecretId || !checks.tencentSecretKey)) {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: "腾讯云转写已选择，但需要同时配置 TENCENT_ASR_SECRET_ID 和 TENCENT_ASR_SECRET_KEY。",
    };
  }

  if (mode === "custom" && !checks.customUrl) {
    return {
      mode,
      configured: false,
      recordingApiEnabled,
      checks,
      message: "自定义转写已选择，但 ASR_API_URL 未配置。",
    };
  }

  return {
    mode,
    configured: true,
    recordingApiEnabled,
    checks,
    message: `真实转写服务已配置：${mode}`,
  };
}

export async function transcribeRecording(recording) {
  logger.info("[CALL] transcribeRecording ", {message: `recordingId: ${recording.id}, provider: ${getTranscriptionMode()}`})
  const provider = getTranscriptionMode();
  let payload;

  try {
    if (provider === "openai") {
      payload = await transcribeWithOpenAI(recording);
    } else if (tencentAsrProviders.has(provider)) {
      payload = await transcribeWithTencentAsr(recording);
    } else if (provider === "custom") {
      payload = await transcribeWithCustomApi(recording);
    } else if (provider === "mimo" || provider === "mimo_api" || provider === "mimo-api") {
      throw new Error("小米 MiMo 转写已弃用，请使用 ASR_PROVIDER=tencent_asr 配置腾讯云 ASR。");
    } else {
      logger.warn("[CALL] transcribeRecording ", {message: "no provider configured, returning fallback segments"})
      return fallbackSegments(recording);
    }

    const segments = normalizeSegments(payload, recording.durationMs || 0);
    const finalSegments = segments.length > 0 ? segments : fallbackSegments(recording);
    finalSegments.rawText = payload?.rawText || finalSegments.map((segment) => segment.rawText || segment.text || "").join("\n");
    finalSegments.correctedText = payload?.correctedText || finalSegments.map((segment) => segment.correctedText || segment.text || "").join("\n");
    finalSegments.transcriptionMeta = payload?.transcriptionMeta || null;
    logger.info("[CALL] transcribeRecording ", {message: `success, segments: ${finalSegments.length}`})
    return finalSegments;
  } catch (error) {
    logger.error("[CALL] transcribeRecording ", {message: `error: ${error.message}`})
    throw error;
  }
}

export async function transcribeVoiceInputRecording(recording) {
  const provider = getTranscriptionMode();
  if (!tencentAsrProviders.has(provider)) return transcribeRecording(recording);

  try {
    const payload = await transcribeWithTencentSentence(recording);
    const segments = normalizeSegments(payload, recording.durationMs || 0);
    if (segments.length > 0) return segments;
  } catch (error) {
    if (env("TENCENT_ASR_VOICE_FAST_FALLBACK", "1") === "0") throw error;
  }

  return transcribeRecording(recording);
}

export function answerFromTranscript(recording, segments, question) {
  const query = question.trim();
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0).map((segment) => ({
    ...segment,
    recordingId: recording.id,
    recordingName: recording.name,
    recordingSeq: recording.seq,
    recordingDurationMs: recording.durationMs || 0,
  }));
  const normalizedQuery = query.toLowerCase();
  const isDurationQuestion = query.includes("时长") || query.includes("多久");
  const isSummaryQuestion = query.includes("总结") || query.includes("摘要") || query.includes("内容") || query.includes("讲了什么");
  const scoredSegments = expandedSegments
    .map((segment) => {
      const text = String(segment.text || "").toLowerCase();
      if (!normalizedQuery) return { segment, score: 0 };
      if (text.includes(normalizedQuery)) return { segment, score: 100 };

      const chars = [...new Set([...normalizedQuery].filter((char) => /[\p{Script=Han}a-z0-9]/iu.test(char)))];
      const score = chars.reduce((sum, char) => sum + (text.includes(char) ? 1 : 0), 0) / Math.max(chars.length, 1);
      return { segment, score };
    })
    .filter((item) => item.score > 0.12)
    .sort((a, b) => b.score - a.score || a.segment.startMs - b.segment.startMs);

  const citationSegments = isSummaryQuestion
    ? expandedSegments.slice(0, 12)
    : scoredSegments.length > 0
      ? scoredSegments.slice(0, 4).map((item) => item.segment)
      : expandedSegments.slice(0, 1);
  const matched = citationSegments[0] || expandedSegments[0];

  if (!matched) {
    return {
      answer: "这条录音还没有转写内容，等服务器转写完成后再提问。",
      jumpToMs: 0,
      citations: [],
    };
  }

  const answer = isDurationQuestion
    ? `这条录音时长约 ${formatTime(recording.durationMs || 0)}，可以从开头播放核对。`
    : isSummaryQuestion
      ? `这条录音的转写内容主要是：${expandedSegments.map((segment) => segment.text).join(" ")}`
      : `我在 ${formatTime(matched.startMs)} 附近找到了相关内容：${matched.text}`;

  return {
    answer,
    jumpToMs: matched.startMs,
    citations: sortSegmentsByTimeline(citationSegments).map((segment) => citationFromSegment(segment, expandedSegments)),
  };
}

function compactText(text = "", maxLength = 90) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

const QA_ANALYSIS_SYSTEM_PROMPT = `你是“会议证据型问答分析助手”。请严格基于用户问题和会议逐字稿回答，目标是做有判断、有证据、可复听的会议分析，而不是普通会议摘要。

核心原则：
1. 只能依据逐字稿回答，不得凭空推测；证据不足时必须明确写“原文证据不足”。
2. 先给明确总体结论，再给判断等级/倾向程度、核心依据、分点分析、原文证据索引和最终结论。
3. 每个判断点都必须包含“结论 + 原因 + 关键依据”，不能只给一句判断。
4. 每个判断点最多选择 1-2 条最关键证据；证据必须是最能直接证明结论的完整语义段，不是关键词出现的位置。
5. 回答正文不要堆时间点，时间点统一放入 evidences，前端会渲染成可复听证据卡片。
6. 证据时间范围建议 10-30 秒；如果完整观点更长，可以适当放宽，但不要截半句话、语气词或铺垫句。
7. 多个时间点表达同一意思时必须合并，只保留最有代表性的一段。
8. 原文摘录只摘最关键的话，不要复制大段逐字稿。
9. 用户问题可能是会议总结、会议评价、会议氛围、领导态度、满意程度、分歧点、责任归因、任务安排、某个人观点、修改建议等，请根据问题类型自动组织答案。
10. 对评价类、态度类、满意度类问题，必须做强判断：结合原文语气、批评密度、修改幅度、否定程度、认可点和最终调整方向判断程度强弱，不能只做中性总结。
11. 满意度/态度类判断等级可使用：基本满意、部分满意、明显不满意、满意度极低、颠覆性否定/需要重做；也可按问题语义使用等价等级。
12. 回答前必须先抽取并核对 5-10 条关键证据候选。证据优先级依次为：直接评价、明确否定、修改要求、反复强调的问题、可保留或认可内容、会议最后形成的调整方向。
13. 如果原文中同时有认可和否定，必须区分“认可点”和“否定点”，不能只取单边信息。
14. 必须返回合法 JSON，不要返回 Markdown，不要输出代码块，不要输出额外解释。`;

const QA_JSON_SCHEMA_TEXT = `{
  "overall_judgement": "用一小段话回答用户问题，说明核心结论。",
  "judgement_level": "判断等级/倾向程度，例如明显不满意、部分认可但需要重构、证据不足等。",
  "core_basis": ["核心依据1", "核心依据2", "核心依据3"],
  "analysis": [
    {
      "title": "判断点标题",
      "conclusion": "这一点的结论",
      "reason": "为什么这么判断",
      "basis": "逐字稿中支撑该判断的关键内容概括",
      "evidence_ids": ["e1", "e2"]
    }
  ],
  "evidences": [
    {
      "id": "e1",
      "analysis_title": "对应的判断点标题",
      "evidence_title": "这段原文证明了什么",
      "start_time": "35:19",
      "end_time": "36:55",
      "quote": "摘取最关键的一小段原话，不要过长",
      "evidence_role": "说明这段原文如何支撑结论",
      "confidence": "high"
    }
  ],
  "final_conclusion": "用简洁语言总结，不要重复堆时间点。"
}`;

function sortSegmentsByTimeline(segments = []) {
  return [...segments].sort(
    (a, b) =>
      (a.recordingSeq || 0) - (b.recordingSeq || 0) ||
      String(a.recordingName || "").localeCompare(String(b.recordingName || ""), "zh-CN") ||
      (a.startMs || 0) - (b.startMs || 0),
  );
}

function citationFromSegment(segment, corpus = []) {
  const startMs = Math.max(0, segment.startMs || 0);
  const maxContextMs = 60000;
  const windowStart = startMs;
  const windowEnd = Math.min(
    Math.max(segment.recordingDurationMs || 0, segment.endMs || startMs + maxContextMs, startMs + maxContextMs),
    windowStart + maxContextMs,
  );
  const related = corpus
    .filter((item) => {
      const sameRecording = segment.recordingId ? item.recordingId === segment.recordingId : true;
      return sameRecording && (item.startMs || 0) <= windowEnd && (item.endMs || item.startMs || 0) >= windowStart;
    })
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  const text = related.length ? related.map((item) => item.text).join(" ") : segment.text;

  return {
    segmentId: segment.id,
    recordingId: segment.recordingId,
    recordingName: segment.recordingName,
    recordingSeq: segment.recordingSeq,
    recordingDurationMs: segment.recordingDurationMs,
    startMs,
    endMs: Math.max(startMs + 1000, Math.min(startMs + maxContextMs, windowEnd || segment.endMs || startMs + maxContextMs)),
    text: compactText(text, 180),
    speakerKey: segment.speakerKey,
  };
}

function localAnswerFromCorpus(items, question) {
  const query = String(question || "").trim();
  const normalizedQuery = query.toLowerCase();
  const isSummaryQuestion = query.includes("总结") || query.includes("摘要") || query.includes("内容") || query.includes("讲了什么");
  const isDurationQuestion = query.includes("时长") || query.includes("多久");
  const allSegments = items.flatMap((item) =>
    expandTranscriptSegments(item.segments || [], item.recording.durationMs || 0).map((segment) => ({
      ...segment,
      recordingId: item.recording.id,
      recordingName: item.recording.name,
      recordingSeq: item.recording.seq,
      recordingDurationMs: item.recording.durationMs || 0,
    })),
  );

  if (allSegments.length === 0) {
    return {
      answer: "当前还没有可用的转写内容，等录音转写完成后再提问。",
      jumpToMs: 0,
      citations: [],
    };
  }

  const scored = allSegments
    .map((segment) => {
      const text = String(segment.text || "").toLowerCase();
      if (isSummaryQuestion) return { segment, score: 0.5 };
      if (text.includes(normalizedQuery)) return { segment, score: 100 };
      const chars = [...new Set([...normalizedQuery].filter((char) => /[\p{Script=Han}a-z0-9]/iu.test(char)))];
      const score = chars.reduce((sum, char) => sum + (text.includes(char) ? 1 : 0), 0) / Math.max(chars.length, 1);
      return { segment, score };
    })
    .filter((item) => item.score > (isSummaryQuestion ? -1 : 0.12))
    .sort((a, b) => b.score - a.score || a.segment.recordingSeq - b.segment.recordingSeq || a.segment.startMs - b.segment.startMs);

  const selectedSegments = (scored.length ? scored.map((item) => item.segment) : allSegments).slice(0, isSummaryQuestion ? 18 : 8);
  const citationSegments = sortSegmentsByTimeline(selectedSegments);
  const first = citationSegments[0] || allSegments[0];
  const recordingCount = new Set(citationSegments.map((segment) => segment.recordingId)).size;
  const answer = isDurationQuestion
    ? `相关录音共 ${recordingCount} 条，首条相关录音时长约 ${formatTime(first.recordingDurationMs)}。`
    : isSummaryQuestion
      ? `我根据 ${recordingCount} 条相关录音整理了要点：${citationSegments
          .slice(0, 5)
          .map((segment, index) => `${index + 1}. ${compactText(segment.text, 52)}`)
          .join("；")}。`
      : `我在《${first.recordingName}》${formatTime(first.startMs)} 附近找到相关内容：${compactText(first.text, 80)}`;

  return {
    answer,
    jumpToMs: first.startMs,
    citations: citationSegments.map((segment) => citationFromSegment(segment, allSegments)),
  };
}

function buildQaSemanticWindows(segments = []) {
  const byRecording = new Map();
  for (const segment of sortSegmentsByTimeline(segments)) {
    if (!String(segment.text || "").trim()) continue;
    const key = segment.recordingId || "recording";
    if (!byRecording.has(key)) byRecording.set(key, []);
    byRecording.get(key).push(segment);
  }

  const windows = [];
  for (const group of byRecording.values()) {
    let current = [];
    const flush = () => {
      if (current.length === 0) return;
      const first = current[0];
      const last = current[current.length - 1];
      const text = current
        .map((item) => {
          const speaker = item.speakerName || item.speakerKey || "";
          return speaker ? `${speaker}：${item.text}` : item.text;
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      windows.push({
        ...first,
        id: `qa-window-${first.recordingId || "recording"}-${Math.round(first.startMs || 0)}-${Math.round(last.endMs || first.endMs || 0)}`,
        startMs: Math.max(0, Math.round(first.startMs || 0)),
        endMs: Math.max(Math.round(first.startMs || 0) + 1000, Math.round(last.endMs || last.startMs || first.endMs || 0)),
        text,
        sourceSegmentIds: current.map((item) => item.id).filter(Boolean),
      });
      current = [];
    };

    for (const segment of group) {
      if (current.length === 0) {
        current.push(segment);
        continue;
      }

      const first = current[0];
      const nextDuration = Math.max(0, (segment.endMs || segment.startMs || 0) - (first.startMs || 0));
      const currentDuration = Math.max(0, (current[current.length - 1].endMs || current[current.length - 1].startMs || 0) - (first.startMs || 0));
      const lastText = String(current[current.length - 1].text || "").trim();
      const semanticBreak = /[。！？!?；;]$/.test(lastText);

      if (nextDuration > 45000 || (currentDuration >= 15000 && (semanticBreak || currentDuration >= 30000))) flush();
      current.push(segment);
    }
    flush();
  }

  return sortSegmentsByTimeline(windows);
}

function qaCorpusFromItems(items = []) {
  const segments = items.flatMap((item) =>
    expandTranscriptSegments(item.segments || [], item.recording.durationMs || 0).map((segment) => ({
      ...segment,
      recordingId: item.recording.id,
      recordingName: item.recording.name,
      recordingSeq: item.recording.seq,
      recordingDurationMs: item.recording.durationMs || 0,
    })),
  );
  return buildQaSemanticWindows(segments);
}

function qaQueryChars(query = "") {
  return [...new Set([...String(query || "").toLowerCase()].filter((char) => /[\p{Script=Han}a-z0-9]/iu.test(char)))];
}

function qaSearchTerms(query = "") {
  const text = String(query || "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, " ")
    .trim();
  const words = text.split(/\s+/).filter((item) => item.length >= 2);
  const han = [...text.replace(/[^\p{Script=Han}]/gu, "")];
  const grams = [];
  for (let index = 0; index < han.length - 1; index += 1) grams.push(`${han[index]}${han[index + 1]}`);
  for (let index = 0; index < han.length - 2; index += 1) grams.push(`${han[index]}${han[index + 1]}${han[index + 2]}`);
  return [...new Set([...words, ...grams])].slice(0, 80);
}

function qaScoreSegment(segment, query = "", summaryMode = false) {
  const text = String(segment.text || "").toLowerCase();
  const normalizedQuery = String(query || "").toLowerCase().trim();
  if (summaryMode) return 0.45;
  if (!normalizedQuery) return 0;
  if (text.includes(normalizedQuery)) return 100;
  const terms = qaSearchTerms(normalizedQuery);
  const termScore =
    terms.reduce((sum, term) => sum + (term && text.includes(term) ? Math.min(4, term.length) : 0), 0) /
    Math.max(4, terms.reduce((sum, term) => sum + Math.min(4, term.length), 0));
  const chars = qaQueryChars(normalizedQuery);
  const charScore = chars.reduce((sum, char) => sum + (text.includes(char) ? 1 : 0), 0) / Math.max(chars.length, 1);
  const intentBoost = /态度|评价|氛围|分歧|任务|安排|观点|原因|依据|总结|会议|ppt|PPT/i.test(normalizedQuery) ? 0.04 : 0;
  return Math.max(termScore, charScore * 0.45) + intentBoost;
}

function qaQuestionProfile(question = "") {
  const text = String(question || "");
  const evaluation = /满意|态度|评价|批评|认可|否定|领导|老板|客户|甲方|反馈|氛围|分歧|倾向|程度|ppt|PPT/i.test(text);
  const decision = /决策|决定|结论|任务|安排|待办|责任|谁负责|下一步|计划|行动/i.test(text);
  const summary = /总结|摘要|提纲|纪要|概括|主要内容|讲了什么/i.test(text);
  return { evaluation, decision, summary };
}

function qaEvidenceQueries(question = "") {
  const profile = qaQuestionProfile(question);
  const queries = [
    question,
    "结论 原因 依据 关键问题",
    "修改 建议 调整 方向 下一步",
    "最后 总结 决定 形成 方向",
  ];

  if (profile.evaluation) {
    queries.push(
      "领导 评价 满意 不满意 态度 批评 认可",
      "否定 不对 不行 问题 缺少 缺失 不足",
      "主要对象 视角 口径 代入感 决策者",
      "结构 逻辑 重点 节奏 重构 重排",
      "案例 证明 能力 保留 可用 认可",
      "不要 强调 系统 技术 界面 案例",
    );
  }

  if (profile.decision) {
    queries.push("任务 负责人 截止 时间 交付 下一步", "决定 共识 安排 行动 计划");
  }

  if (profile.summary) {
    queries.push("会议主题 主要内容 核心结论 关键讨论", "议题 背景 问题 风险 待确认");
  }

  return [...new Set(queries.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 14);
}

function searchQaCorpus(corpus = [], query = "", limit = 8, intent = "") {
  const summaryMode =
    intent === "summary" ||
    /summary|outline|overview/i.test(intent) ||
    /总结|摘要|提纲|概括|主要内容|讲了什么/.test(String(query || ""));
  const safeLimit = Math.max(1, Math.min(24, Math.round(numeric(limit, 8))));
  const scored = corpus
    .map((segment) => ({ segment, score: qaScoreSegment(segment, query, summaryMode) }))
    .filter((item) => item.score > (summaryMode ? -1 : 0.12))
    .sort((a, b) => b.score - a.score || (a.segment.recordingSeq || 0) - (b.segment.recordingSeq || 0) || (a.segment.startMs || 0) - (b.segment.startMs || 0));

  const selected = scored.length ? scored.map((item) => item.segment) : corpus;
  if (!summaryMode) return sortSegmentsByTimeline(selected.slice(0, safeLimit));

  const byTimeline = sortSegmentsByTimeline(selected);
  const stride = Math.max(1, Math.floor(byTimeline.length / safeLimit));
  const sampled = [];
  for (let index = 0; index < byTimeline.length && sampled.length < safeLimit; index += stride) {
    sampled.push(byTimeline[index]);
  }
  return sampled.length ? sampled : byTimeline.slice(0, safeLimit);
}

function selectQaSeedSegments(corpus = [], question = "") {
  const selected = [];
  const add = (segments = []) => {
    selected.push(...segments);
  };

  add(searchQaCorpus(corpus, question, 18, "answer"));
  for (const query of qaEvidenceQueries(question)) {
    add(searchQaCorpus(corpus, query, 8, "evidence"));
  }
  add(searchQaCorpus(corpus, question, 12, "summary"));

  const deduped = [];
  const seen = new Set();
  for (const segment of sortSegmentsByTimeline(selected)) {
    const key = `${segment.recordingId || ""}:${Math.round((segment.startMs || 0) / 1000)}:${compactText(segment.text, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
    if (deduped.length >= 36) break;
  }
  return deduped.length ? deduped : sortSegmentsByTimeline(corpus).slice(0, 18);
}

function qaSegmentToToolResult(segment) {
  return {
    recordingId: segment.recordingId,
    recordingSeq: segment.recordingSeq,
    recordingName: segment.recordingName,
    startMs: Math.max(0, Math.round(segment.startMs || 0)),
    endMs: Math.max(Math.round(segment.startMs || 0) + 1000, Math.round(segment.endMs || segment.startMs || 0)),
    time: `${formatTime(segment.startMs)}-${formatTime(segment.endMs)}`,
    speaker: segment.speakerName || segment.speakerKey || "speaker",
    text: compactText(segment.text, 360),
  };
}

function transcriptToolContent(segments = [], query = "") {
  return JSON.stringify(
    {
      query,
      results: segments.map((segment) => qaSegmentToToolResult(segment)),
    },
    null,
    2,
  );
}

function safeJsonParse(value = "") {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function assistantMessageForDeepseek(message = {}) {
  const next = {
    role: "assistant",
    content: textFromContent(message.content || ""),
  };
  if (message.reasoning_content) next.reasoning_content = message.reasoning_content;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) next.tool_calls = message.tool_calls;
  return next;
}

function recentQaHistoryText(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .slice(-6)
    .map((item, index) => {
      const question = compactText(item.question || "", 180);
      const answer = compactText(item.answer || "", 300);
      return `${index + 1}. Q: ${question}\n   A: ${answer}`;
    })
    .join("\n");
}

function attachmentText(options = {}) {
  const imageNote = Array.isArray(options.images) && options.images.length > 0 ? `\nUser also uploaded ${options.images.length} image(s). Use them only as supplemental context; the transcript is primary.` : "";
  const attachmentNote =
    Array.isArray(options.attachments) && options.attachments.length > 0
      ? `\n\nSupplemental materials:\n${options.attachments
          .map((item, index) => {
            const title = `${index + 1}. ${item.kind || "file"} - ${item.name || "untitled"}`;
            const body = item.text || item.url || "Only the file name is available.";
            return `${title}\n${compactText(body, 1200)}`;
          })
          .join("\n\n")
          .slice(0, 12000)}`
      : "";
  return `${imageNote}${attachmentNote}`;
}

function dedupeQaSegments(segments = [], limit = 18) {
  const maxItems = Math.max(1, Math.min(80, Math.round(Number(limit) || 18)));
  const kept = [];
  for (const segment of sortSegmentsByTimeline(segments)) {
    const duplicate = kept.some((item) => {
      const sameRecording = (item.recordingId || "") === (segment.recordingId || "");
      if (!sameRecording) return false;
      const start = Math.max(0, segment.startMs || 0);
      const itemStart = Math.max(0, item.startMs || 0);
      const close = Math.abs(start - itemStart) < 45000;
      const sameText = compactText(item.text, 120) === compactText(segment.text, 120);
      return close || sameText;
    });
    if (!duplicate) kept.push(segment);
    if (kept.length >= maxItems) break;
  }
  return kept;
}

function selectQaTimelineContextSegments(corpus = [], limit = 16) {
  const sorted = sortSegmentsByTimeline(corpus).filter((segment) => String(segment?.text || "").trim());
  if (sorted.length === 0) return [];
  const maxItems = Math.max(1, Math.min(36, Math.round(Number(limit) || 16)));
  const picked = [];
  const seen = new Set();
  const add = (segment) => {
    const key = `${segment.recordingId || ""}:${Math.round((segment.startMs || 0) / 10000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(segment);
  };

  const tailCount = Math.min(6, sorted.length);
  const bodyLimit = Math.max(1, maxItems - tailCount);
  const stride = Math.max(1, Math.floor(sorted.length / bodyLimit));
  for (let i = 0; i < sorted.length && picked.length < bodyLimit; i += stride) {
    add(sorted[i]);
  }
  sorted.slice(-tailCount).forEach(add);
  return picked.slice(0, maxItems);
}

function parseQaTimeMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10000 ? Math.round(value * 1000) : Math.round(value);
  }

  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(text)) return parseQaTimeMs(Number(text), fallback);
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return fallback;
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  return fallback;
}

function qaTextSimilarity(left = "", right = "") {
  const leftTerms = new Set(qaSearchTerms(left));
  const rightText = String(right || "").toLowerCase();
  if (leftTerms.size === 0 || !rightText) return 0;
  let hit = 0;
  leftTerms.forEach((term) => {
    if (term && rightText.includes(term)) hit += Math.min(4, term.length);
  });
  return hit / Math.max(4, [...leftTerms].reduce((sum, term) => sum + Math.min(4, term.length), 0));
}

function parseStructuredQaObject(answer = "") {
  try {
    const parsed = extractJsonObject(answer);
    if (!parsed || typeof parsed !== "object") return null;
    const hasStructure = parsed.overall_judgement || parsed.final_conclusion || Array.isArray(parsed.analysis) || Array.isArray(parsed.evidences);
    return hasStructure ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeQaText(value = "", maxLength = 1200) {
  return compactText(String(value || "").replace(/\s+/g, " ").trim(), maxLength);
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

function normalizeQaDisplayText(value = "", maxLength = 1200) {
  return normalizeQaText(stripQaInternalIndexMarkers(value), maxLength);
}

function bestCorpusSegmentForEvidence(evidence = {}, corpus = []) {
  const query = [evidence.quote, evidence.evidence_title, evidence.evidence_role, evidence.analysis_title].filter(Boolean).join(" ");
  const wantedStart = parseQaTimeMs(evidence.start_time ?? evidence.startMs ?? evidence.start_ms, Number.NaN);
  const wantedEnd = parseQaTimeMs(evidence.end_time ?? evidence.endMs ?? evidence.end_ms, Number.NaN);
  const wantedMid = Number.isFinite(wantedStart) ? (wantedStart + (Number.isFinite(wantedEnd) ? wantedEnd : wantedStart)) / 2 : Number.NaN;

  const scored = corpus.map((segment) => {
    const textScore = qaTextSimilarity(query, segment.text);
    const segmentMid = ((segment.startMs || 0) + (segment.endMs || segment.startMs || 0)) / 2;
    const timeScore = Number.isFinite(wantedMid) ? Math.max(0, 1 - Math.abs(segmentMid - wantedMid) / 180000) : 0;
    const directQuote = evidence.quote && String(segment.text || "").includes(String(evidence.quote).slice(0, 16)) ? 1 : 0;
    return { segment, score: textScore * 8 + timeScore * 2 + directQuote * 4 };
  });

  scored.sort((a, b) => b.score - a.score || (a.segment.startMs || 0) - (b.segment.startMs || 0));
  return scored[0]?.segment || corpus[0] || null;
}

function boundedEvidenceRange(evidence = {}, segment = {}) {
  const fallbackStart = Math.max(0, segment.startMs || 0);
  const fallbackEnd = Math.max(fallbackStart + 1000, segment.endMs || fallbackStart + 30000);
  let startMs = parseQaTimeMs(evidence.start_time ?? evidence.startMs ?? evidence.start_ms, fallbackStart);
  let endMs = parseQaTimeMs(evidence.end_time ?? evidence.endMs ?? evidence.end_ms, fallbackEnd);

  if (startMs < (segment.startMs || 0) || startMs > (segment.endMs || fallbackEnd)) startMs = fallbackStart;
  if (endMs <= startMs || endMs > (segment.endMs || fallbackEnd) + 90000) endMs = fallbackEnd;

  startMs = Math.max(0, Math.min(startMs, fallbackStart));
  endMs = Math.max(endMs, fallbackEnd);

  const minWindow = 10000;
  const preferredMax = 45000;
  const hardMax = 120000;
  if (endMs - startMs < minWindow) {
    const missing = minWindow - (endMs - startMs);
    startMs = Math.max(0, startMs - Math.floor(missing / 2));
    endMs += Math.ceil(missing / 2);
  }
  if (endMs - startMs > hardMax) endMs = startMs + hardMax;
  if (endMs - startMs > preferredMax && (fallbackEnd - fallbackStart) <= preferredMax) {
    startMs = fallbackStart;
    endMs = fallbackEnd;
  }

  const recordingDuration = Math.max(segment.recordingDurationMs || 0, endMs, startMs + 1000);
  return {
    startMs: Math.max(0, Math.round(startMs)),
    endMs: Math.max(Math.round(startMs) + 1000, Math.min(recordingDuration, Math.round(endMs))),
  };
}

function normalizeStructuredQaResult(answer = "", localAnswer = {}, corpus = []) {
  const parsed = parseStructuredQaObject(answer);
  if (!parsed) return null;

  const rawAnalysis = Array.isArray(parsed.analysis) ? parsed.analysis : [];
  const rawEvidences = Array.isArray(parsed.evidences) ? parsed.evidences : [];
  const coreBasis = Array.isArray(parsed.core_basis)
    ? parsed.core_basis.map((item) => normalizeQaDisplayText(item, 180)).filter(Boolean).slice(0, 6)
    : Array.isArray(parsed.coreBasis)
      ? parsed.coreBasis.map((item) => normalizeQaDisplayText(item, 180)).filter(Boolean).slice(0, 6)
      : [];
  const citations = [];
  const normalizedEvidences = [];
  const perAnalysisCount = new Map();
  const seen = [];

  rawEvidences.forEach((evidence, index) => {
    const source = evidence && typeof evidence === "object" ? evidence : {};
    const segment = bestCorpusSegmentForEvidence(source, corpus);
    if (!segment) return;
    const range = boundedEvidenceRange(source, segment);
    const analysisTitle = normalizeQaDisplayText(source.analysis_title || source.analysisTitle || source.analysis || `判断点 ${index + 1}`, 80);
    const count = perAnalysisCount.get(analysisTitle) || 0;
    if (count >= 2) return;
    const duplicate = seen.some((item) => {
      const sameRecording = item.recordingId === segment.recordingId;
      const overlaps = sameRecording && range.startMs <= item.endMs && range.endMs >= item.startMs;
      const sameQuote =
        normalizeQaDisplayText(source.quote, 80) && normalizeQaDisplayText(source.quote, 80) === normalizeQaDisplayText(item.quote, 80);
      return overlaps || sameQuote;
    });
    if (duplicate) return;

    const id = normalizeQaText(source.id || `e${normalizedEvidences.length + 1}`, 24).replace(/\s+/g, "-") || `e${normalizedEvidences.length + 1}`;
    const quote = normalizeQaDisplayText(source.quote || segment.text, 220);
    const evidenceTitle = normalizeQaDisplayText(source.evidence_title || source.evidenceTitle || "关键原文依据", 80);
    const evidenceRole = normalizeQaDisplayText(source.evidence_role || source.evidenceRole || "这段原文支撑对应判断。", 180);
    const confidence = ["high", "medium", "low"].includes(String(source.confidence || "").toLowerCase()) ? String(source.confidence).toLowerCase() : "medium";

    const citation = {
      evidenceId: id,
      segmentId: segment.id,
      recordingId: segment.recordingId,
      recordingName: segment.recordingName,
      recordingSeq: segment.recordingSeq,
      recordingDurationMs: segment.recordingDurationMs,
      startMs: range.startMs,
      endMs: range.endMs,
      text: quote,
      speakerKey: segment.speakerKey,
      analysisTitle,
      evidenceTitle,
      evidenceRole,
      confidence,
    };
    citations.push(citation);
    normalizedEvidences.push({
      id,
      analysis_title: analysisTitle,
      evidence_title: evidenceTitle,
      start_time: formatTime(range.startMs),
      end_time: formatTime(range.endMs),
      quote,
      evidence_role: evidenceRole,
      confidence,
    });
    perAnalysisCount.set(analysisTitle, count + 1);
    seen.push({ recordingId: segment.recordingId, startMs: range.startMs, endMs: range.endMs, quote });
  });

  const evidenceIds = new Set(normalizedEvidences.map((item) => item.id));
  const analysis = rawAnalysis.map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    const title = normalizeQaDisplayText(source.title || `判断点 ${index + 1}`, 80);
    const ids = Array.isArray(source.evidence_ids)
      ? source.evidence_ids.map((id) => String(id || "").trim()).filter((id) => evidenceIds.has(id)).slice(0, 2)
      : normalizedEvidences.filter((evidence) => evidence.analysis_title === title).map((evidence) => evidence.id).slice(0, 2);
    return {
      title,
      conclusion: normalizeQaDisplayText(source.conclusion || "原文证据不足", 360),
      reason: normalizeQaDisplayText(source.reason || "原文证据不足，无法进一步判断。", 520),
      basis: normalizeQaDisplayText(source.basis || "原文证据不足", 520),
      evidence_ids: ids,
    };
  });

  const normalized = {
    overall_judgement: normalizeQaDisplayText(parsed.overall_judgement || parsed.overallJudgement || localAnswer.answer || "原文证据不足。", 700),
    judgement_level: normalizeQaDisplayText(parsed.judgement_level || parsed.judgementLevel || parsed.level || "", 160),
    core_basis: coreBasis,
    analysis,
    evidences: normalizedEvidences,
    final_conclusion: normalizeQaDisplayText(parsed.final_conclusion || parsed.finalConclusion || parsed.overall_judgement || "以上结论均以逐字稿证据为准。", 500),
  };

  return {
    ...localAnswer,
    answer: structuredQaToPlainText(normalized) || localAnswer.answer || "原文证据不足。",
    structuredAnswer: normalized,
    jumpToMs: citations[0]?.startMs ?? localAnswer.jumpToMs ?? 0,
    citations: citations.length ? citations : localAnswer.citations || [],
  };
}

function qaResultLooksInvalidForQuestion(structuredResult, question = "") {
  const query = String(question || "").trim();
  if (!structuredResult || !query) return false;
  const structured = structuredResult.structuredAnswer || {};
  const text = JSON.stringify(structured);
  if (
    /用户问题.{0,20}(不明确|无效|问号|没有明确|无法分析)|问题.{0,20}(不明确|无效)|question.{0,20}(unclear|invalid|missing)/i.test(text)
  ) {
    return true;
  }
  if (!Array.isArray(structured.analysis) || structured.analysis.length === 0) return true;
  if (!Array.isArray(structured.evidences) || structured.evidences.length === 0) return true;
  const profile = qaQuestionProfileStable(query);
  if (profile.evaluation) {
    const judgementText = [
      structured.overall_judgement,
      structured.judgement_level,
      structured.final_conclusion,
      ...(Array.isArray(structured.core_basis) ? structured.core_basis : []),
      ...structured.analysis.flatMap((item) => [item?.title, item?.conclusion, item?.reason, item?.basis]),
    ]
      .filter(Boolean)
      .join(" ");
    const directlyAnswersEvaluation =
      /满意|不满意|态度|评价|认可|否定|批评|倾向|程度|重做|需要重做|修改|调整|优化|证据不足|不足/i.test(judgementText);
    if (!directlyAnswersEvaluation) return true;
    if (!String(structured.judgement_level || "").trim() && !/证据不足/.test(judgementText)) return true;
    const titles = structured.analysis.map((item) => String(item?.title || "")).join(" ");
    const summaryOnlyTitle = /系统介绍|核心功能|功能模块|会议主题|产品介绍|背景介绍|流程说明/i.test(titles);
    const evaluationTitle = /满意|态度|评价|认可|否定|批评|倾向|修改|调整|优化|重做|不足|问题|证据不足/i.test(titles);
    if (summaryOnlyTitle && !evaluationTitle) return true;
  }
  return false;
}

function structuredQaToPlainText(structured = {}) {
  if (!structured || typeof structured !== "object") return "";
  const lines = [];
  if (structured.overall_judgement) {
    lines.push("整体判断", String(structured.overall_judgement).trim(), "");
  }
  if (structured.judgement_level) {
    lines.push("判断等级", String(structured.judgement_level).trim(), "");
  }
  if (Array.isArray(structured.core_basis) && structured.core_basis.length > 0) {
    lines.push("核心依据");
    structured.core_basis.filter(Boolean).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    lines.push("");
  }
  if (Array.isArray(structured.analysis) && structured.analysis.length > 0) {
    lines.push("分点分析");
    structured.analysis.forEach((point, index) => {
      lines.push(`${index + 1}. ${point?.title || `判断点 ${index + 1}`}`);
      if (point?.conclusion) lines.push(`结论：${point.conclusion}`);
      if (point?.reason) lines.push(`原因：${point.reason}`);
      if (point?.basis) lines.push(`关键依据：${point.basis}`);
      lines.push("");
    });
  }
  if (structured.final_conclusion) {
    lines.push("最终结论", String(structured.final_conclusion).trim());
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function hasInlineToolMarkup(answer = "") {
  return /DSML|tool_calls|search_transcript_segments|<\s*\|\s*DSML|<\/\s*\|\s*DSML/i.test(String(answer || ""));
}

function qaThinkingSteps(reasoningContent = "") {
  return ["读取选中录音的逐字稿", "抽取与问题最相关的候选语义段", "核对时间点与原文证据", "组织结论、原因和依据"];
}

const QA_STABLE_SYSTEM_PROMPT = `你是“录音逐字稿问答分析助手”。请基于用户问题和会议逐字稿回答，回答必须像一份清晰的会议分析结论，而不是简单摘要。

核心要求：
1. 只依据逐字稿回答，不得凭空推测。
2. 用户问题可能是会议总结、会议评价、会议氛围、领导态度、分歧点、任务安排、某个人观点等，请根据问题类型自动组织答案。
3. 复杂问题要拆成多个判断点，每个判断点都要说明“结论 + 原因 + 依据”。
4. 不要只给结论，必须解释为什么这样判断，并引用逐字稿中的关键内容作为证据。
5. 原文索引必须定位到“最能直接证明结论的完整语义段”，不是关键词出现的位置。
6. 每个判断点只选择 1-2 段最关键证据，不要堆砌很多零散时间点。
7. 如果多个时间点表达同一意思，必须合并，不要重复罗列。
8. 正文中不要频繁插入时间点，时间点统一放到“原文证据索引”中。
9. 原文摘录不要太长，只摘最关键的话。
10. 如果逐字稿证据不足，明确说明“原文证据不足”，不要强行下结论。
11. 必须返回合法 JSON，不要返回 Markdown，不要输出代码块，不要输出额外解释，不要输出 DSML、tool_calls 或任何工具调用文本。`;

const QA_STABLE_JSON_SCHEMA = `{
  "overall_judgement": "用一小段话回答用户问题，说明核心结论。",
  "judgement_level": "如果问题涉及评价/态度/满意度，请给出明确程度；否则可为空。",
  "core_basis": ["核心依据1", "核心依据2"],
  "analysis": [
    {
      "title": "判断点标题",
      "conclusion": "这一点的结论",
      "reason": "为什么这么判断",
      "basis": "逐字稿中支撑该判断的关键内容概括",
      "evidence_ids": ["e1", "e2"]
    }
  ],
  "evidences": [
    {
      "id": "e1",
      "analysis_title": "对应的判断点标题",
      "evidence_title": "这段原文证明了什么",
      "start_time": "35:19",
      "end_time": "36:55",
      "quote": "摘取最关键的一小段原话，不要过长",
      "evidence_role": "说明这段原文如何支撑结论",
      "confidence": "high"
    }
  ],
  "final_conclusion": "用简洁语言总结，不要重复堆时间点。"
}`;

function qaQuestionProfileStable(question = "") {
  const text = String(question || "");
  return {
    evaluation: /满意|态度|评价|批评|认可|否定|领导|老板|客户|甲方|反馈|氛围|分歧|倾向|程度|PPT|ppt/i.test(text),
    decision: /决策|决定|结论|任务|安排|待办|责任|谁负责|下一步|计划|行动/i.test(text),
    summary: /总结|摘要|提纲|纪要|概括|主要内容|讲了什么/i.test(text),
  };
}

function qaEvaluationPromptRules() {
  return [
    "评价类强制要求：",
    "1. 本轮唯一任务是回答用户的评价、态度或满意度问题，不要改写成会议总结、会议提纲或产品功能摘要。",
    "2. overall_judgement 第一段必须直接回答态度或满意程度，不能只描述会议讲了什么。",
    "3. judgement_level 必须填写明确等级，只能从“基本满意、部分满意、明显不满意、满意度极低、颠覆性否定/需要重做、原文证据不足”中选择或使用同等明确表达。",
    "4. analysis 的标题必须围绕认可点、否定点、修改要求、批评强度、最终调整方向等判断点，不要使用“系统介绍、核心功能、会议主题”这类摘要型标题。",
    "5. 如果候选逐字稿中没有足够的态度、评价、修改要求或否定/认可表达，必须输出“原文证据不足”，不要把普通内容摘要当作答案。",
  ].join("\n");
}

function qaEvidenceQueriesStable(question = "") {
  const profile = qaQuestionProfileStable(question);
  const queries = [String(question || "").trim()];
  if (profile.evaluation) {
    queries.push(
      "领导 客户 甲方 评价 态度 满意 不满意 批评 认可",
      "问题 不足 需要调整 重新 梳理 改 优化",
      "不要 应该 必须 建议 重点 方向 视角 结构",
      "客户 视角 角度 对象 决策 领导 高层 代入",
      "案例 证明 能力 场景 价值 不要 只讲 系统",
      "重做 重构 口径 全变 逻辑 重点 缺少",
      "最后 结论 下次 调整 方向 怎么做 怎么想",
    );
  }
  if (profile.decision) {
    queries.push("决定 结论 下一步 负责 待办 安排 计划 时间", "最终 形成 明确 确认 推进 落地");
  }
  if (profile.summary) {
    queries.push("主要 重点 核心 结论 背景 内容 风险 下一步", "会议 讨论 总结 复盘");
  }
  queries.push("最后 总结 结论 下一步", "问题 建议 调整 方向");
  return [...new Set(queries.filter(Boolean))];
}

function buildQaStableUserPrompt({ question, historyText, recordings, citationSegments, options, questionProfile }) {
  const typeHint = questionProfile.evaluation
    ? "评价/态度/满意度类问题：必须判断强弱程度，并区分认可点、否定点、修改幅度和最后调整方向。"
    : questionProfile.decision
      ? "决策/任务类问题：必须提取责任、行动、截止时间、交付物和原文依据。"
      : questionProfile.summary
        ? "总结/纪要类问题：必须先给总体判断，再分主题概括，最后给证据索引。"
        : "普通会议问答：也必须基于证据回答，不能只做简单摘录。";

  const questionGuard = String(question || "").trim()
    ? "Important: the user question in this prompt is valid. Do not answer that the question is unclear unless it is completely empty."
    : "";
  const evaluationRules = questionProfile.evaluation ? qaEvaluationPromptRules() : "";

  return [
    questionGuard,
    "本轮唯一任务：严格回答【用户问题】。不要把问题改写成会议总结，不要用原文摘录替代分析结论。",
    `用户问题：${question}`,
    historyText ? `同一范围内最近的问答记录，仅作上下文参考：\n${historyText}` : "",
    `选中的录音：\n${recordings || "未命名录音"}`,
    `后端已完成语义检索与关键词辅助检索。下面是候选逐字稿语义段，请只从这些片段中选择证据，不要输出工具调用、XML、DSML 或任何代码：\n${transcriptToolContent(citationSegments, question)}`,
    attachmentText(options),
    `输出必须是合法 JSON，字段和含义必须遵守这个结构，不要输出 Markdown，不要输出代码块：\n${QA_STABLE_JSON_SCHEMA}`,
    `问题类型提示：${typeHint}`,
    evaluationRules,
    "请先在候选片段中内部抽取 5-10 条关键证据候选，再决定最终判断。每个判断点最多保留 1-2 条关键证据；证据必须是最能直接证明结论的完整语义段，时间范围建议 10-30 秒，必要时可放宽到 2 分钟以内。",
    "正文不要插入大量时间点，时间点统一放进 evidences。若原文证据不足，请明确写“原文证据不足”。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function qaStableFallback(localAnswer = {}, corpus = [], citationSegments = []) {
  const segment = citationSegments.find((item) => String(item?.text || "").trim()) || corpus.find((item) => String(item?.text || "").trim());
  const citations = segment ? [citationFromSegment(segment, corpus)] : localAnswer.citations || [];
  const evidence = segment
    ? [
        {
          id: "e1",
          analysis_title: "可用原文证据",
          evidence_title: "最相关的逐字稿片段",
          start_time: formatTime(segment.startMs || 0),
          end_time: formatTime(segment.endMs || (segment.startMs || 0) + 30000),
          quote: compactText(segment.text || "", 180),
          evidence_role: "当前大模型没有生成稳定结构化答案，系统已保留最相关的可复听原文片段，避免展示乱码或工具调用内容。",
          confidence: "medium",
        },
      ]
    : [];
  const normalized = {
    overall_judgement: evidence.length ? "大模型暂未生成稳定的结构化答案，已保留最相关的原文证据，建议稍后重新生成。" : "当前录音还没有可用的转写内容，无法回答。",
    judgement_level: evidence.length ? "待重新分析" : "原文证据不足",
    core_basis: evidence.length ? ["已找到可复听的相关原文片段"] : ["没有可用逐字稿证据"],
    analysis: [
      {
        title: "回答状态",
        conclusion: evidence.length ? "需要重新生成结构化分析" : "原文证据不足",
        reason: evidence.length ? "模型返回内容不符合 JSON 或包含工具/代码文本，系统已阻止异常内容展示。" : "当前没有可检索的逐字稿片段。",
        basis: evidence.length ? "下方证据卡片提供最相关原文片段。" : "无",
        evidence_ids: evidence.map((item) => item.id),
      },
    ],
    evidences: evidence,
    final_conclusion: evidence.length ? "请稍后点击重新生成，系统会再次基于逐字稿进行分析。" : "没有原文依据时不能强行回答。",
  };
  return {
    ...localAnswer,
    answer: structuredQaToPlainText(normalized) || localAnswer.answer || "原文证据不足。",
    structuredAnswer: normalized,
    jumpToMs: citations[0]?.startMs ?? localAnswer.jumpToMs ?? 0,
    citations,
  };
}

function qaCleanFallback(localAnswer = {}, corpus = [], citationSegments = []) {
  const segment = citationSegments.find((item) => String(item?.text || "").trim()) || corpus.find((item) => String(item?.text || "").trim());
  const citations = segment ? [citationFromSegment(segment, corpus)] : localAnswer.citations || [];
  const evidence = segment
    ? [
        {
          id: "e1",
          analysis_title: "可用原文证据",
          evidence_title: "最相关的逐字稿片段",
          start_time: formatTime(segment.startMs || 0),
          end_time: formatTime(segment.endMs || (segment.startMs || 0) + 30000),
          quote: compactText(segment.text || "", 180),
          evidence_role: "当前大模型没有生成稳定的结构化答案，系统已保留最相关的可复听原文片段，避免展示乱码、代码或工具调用内容。",
          confidence: "medium",
        },
      ]
    : [];
  const normalized = {
    overall_judgement: evidence.length
      ? "大模型暂未生成稳定的结构化答案，系统已保留最相关的原文证据。建议稍后重新生成。"
      : "当前录音还没有可用的转写内容，无法回答。",
    judgement_level: evidence.length ? "待重新分析" : "原文证据不足",
    core_basis: evidence.length ? ["已找到可复听的相关原文片段"] : ["没有可用逐字稿证据"],
    analysis: [
      {
        title: "回答状态",
        conclusion: evidence.length ? "需要重新生成结构化分析" : "原文证据不足",
        reason: evidence.length
          ? "模型返回内容不符合 JSON 或包含工具/代码文本，系统已阻止异常内容展示。"
          : "当前没有可检索的逐字稿片段。",
        basis: evidence.length ? "下方证据卡片提供最相关原文片段。" : "无",
        evidence_ids: evidence.map((item) => item.id),
      },
    ],
    evidences: evidence,
    final_conclusion: evidence.length ? "请稍后点击重新生成，系统会再次基于逐字稿进行分析。" : "没有原文依据时不能强行回答。",
  };
  return {
    ...localAnswer,
    answer: structuredQaToPlainText(normalized) || localAnswer.answer || "原文证据不足。",
    structuredAnswer: normalized,
    jumpToMs: citations[0]?.startMs ?? localAnswer.jumpToMs ?? 0,
    citations,
  };
}

function qaJsonRepairEnabled() {
  return env("LLM_QA_REPAIR", "0") === "1";
}

function extractPlainQaTextFromModelAnswer(answer = "") {
  const raw = cleanLlmAnswer(answer);
  if (!raw) return "";

  let parsed = null;
  try {
    const maybeParsed = extractJsonObject(raw);
    if (maybeParsed && typeof maybeParsed === "object" && !Array.isArray(maybeParsed)) parsed = maybeParsed;
  } catch {
    parsed = null;
  }

  const candidates = [];
  const pushValue = (value) => {
    const text = String(value || "").trim();
    if (text) candidates.push(text);
  };
  const pushList = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item === "string") {
        pushValue(item);
      } else if (item && typeof item === "object") {
        pushValue(item.title);
        pushValue(item.conclusion);
        pushValue(item.reason);
        pushValue(item.basis);
      }
    }
  };

  if (parsed) {
    const structured = parsed.structuredAnswer && typeof parsed.structuredAnswer === "object" ? parsed.structuredAnswer : parsed;
    pushValue(parsed.answer);
    pushValue(parsed.summary);
    pushValue(parsed.conclusion);
    pushValue(structured.overall_judgement);
    pushValue(structured.final_conclusion);
    pushList(structured.core_basis);
    pushList(structured.analysis);
  }

  const text = candidates.length ? candidates.join("\n") : raw;
  if (!candidates.length && /^\s*[{[]/.test(text)) return "";
  const cleaned = normalizeQaDisplayText(text, 1600);
  return answerLooksUnusable(cleaned) ? "" : cleaned;
}

function qaResultFromPlainModelAnswer(answer = "", localAnswer = {}, corpus = [], citationSegments = []) {
  const text = extractPlainQaTextFromModelAnswer(answer);
  if (!text) return null;

  const sourceSegments = (citationSegments.length ? citationSegments : selectQaSeedSegments(corpus, "")).slice(0, 2);
  const citations = sourceSegments.map((segment) => citationFromSegment(segment, corpus));
  const evidences = citations.map((citation, index) => ({
    id: `plain-${index + 1}`,
    title: index === 0 ? "\u76f8\u5173\u539f\u6587" : `\u76f8\u5173\u539f\u6587 ${index + 1}`,
    time: formatTime(citation.startMs || 0),
    speaker: citation.speakerKey || "",
    content: citation.text || "",
    relevance: index === 0 ? "\u4e3b\u8981\u4f9d\u636e" : "\u8865\u5145\u4f9d\u636e",
  }));

  const normalized = {
    overall_judgement: text,
    judgement_level: "",
    core_basis: evidences.length ? ["\u5df2\u6839\u636e\u9009\u4e2d\u5f55\u97f3\u7684\u9010\u5b57\u7a3f\u751f\u6210\u3002"] : [],
    analysis: [
      {
        title: "\u56de\u7b54",
        conclusion: text,
        reason: evidences.length
          ? "\u8fd9\u6bb5\u539f\u6587\u7528\u4e8e\u6838\u5bf9\u56de\u7b54\u5185\u5bb9\u3002"
          : "\u6a21\u578b\u5df2\u8fd4\u56de\u7b54\uff0c\u4f46\u672a\u5339\u914d\u5230\u53ef\u5b9a\u4f4d\u7684\u539f\u6587\u7247\u6bb5\u3002",
        basis: evidences.length
          ? "\u5df2\u627e\u5230\u53ef\u590d\u542c\u7684\u76f8\u5173\u539f\u6587\u7247\u6bb5\u3002"
          : "",
        evidence_ids: evidences.map((item) => item.id),
      },
    ],
    evidences,
    final_conclusion: text,
  };

  return {
    ...localAnswer,
    answer: text,
    structuredAnswer: normalized,
    jumpToMs: citations[0]?.startMs ?? localAnswer.jumpToMs ?? 0,
    citations,
  };
}

function qaFastCandidateLimit(profile = {}) {
  const configured = env("LLM_QA_CANDIDATE_LIMIT", "");
  if (configured) return Math.max(6, Math.min(36, numeric(configured, 14)));
  if (env("LLM_QA_FAST", "1") === "0") return profile.evaluation ? 36 : profile.summary ? 28 : 24;
  return profile.evaluation ? 18 : profile.summary ? 16 : 14;
}

function qaFastTimeoutMs() {
  return Math.max(3000, numeric(env("LLM_QA_TIMEOUT_MS", env("LLM_TIMEOUT_MS", "25000")), 25000));
}

function qaFastMaxCompletionTokens() {
  return Math.max(768, Math.min(2048, numeric(env("LLM_QA_MAX_COMPLETION_TOKENS", "1536"), 1536)));
}

async function answerRecordingsWithDeepSeekThinkingStable(items, question, options, config, localAnswer) {
  const corpus = qaCorpusFromItems(items);
  if (corpus.length === 0) return qaCleanFallback(localAnswer, corpus, []);

  const questionProfile = qaQuestionProfileStable(question);
  const evaluationRules = questionProfile.evaluation ? qaEvaluationPromptRules() : "";
  const seedSegments = selectQaSeedSegments(corpus, question);
  const evidenceSegments = [];
  for (const query of qaEvidenceQueriesStable(question)) {
    evidenceSegments.push(...searchQaCorpus(corpus, query, 5, "evidence"));
  }
  const summarySegments = questionProfile.summary ? searchQaCorpus(corpus, question, 10, "summary") : [];
  const timelineSegments = questionProfile.evaluation
    ? selectQaTimelineContextSegments(corpus, 8)
    : questionProfile.summary
      ? selectQaTimelineContextSegments(corpus, 6)
      : [];
  const candidateLimit = qaFastCandidateLimit(questionProfile);
  const citationSegments = dedupeQaSegments([...seedSegments, ...evidenceSegments, ...summarySegments, ...timelineSegments], candidateLimit).slice(
    0,
    candidateLimit,
  );
  const recordings = [...new Map(corpus.map((segment) => [segment.recordingId, segment])).values()]
    .map((segment) => `Recording ${String(segment.recordingSeq).padStart(3, "0")} | ${segment.recordingName || ""} | duration ${formatTime(segment.recordingDurationMs || 0)}`)
    .join("\n");
  const historyText = recentQaHistoryText(options.history || options.conversationHistory || []);
  const timeoutMs = qaFastTimeoutMs();
  const maxCompletionTokens = qaFastMaxCompletionTokens();
  const jsonOnlyConfig = { ...config, thinking: "disabled", reasoningEffort: "low" };
  const messages = [
    { role: "system", content: QA_STABLE_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildQaStableUserPrompt({ question, historyText, recordings, citationSegments, options, questionProfile }),
    },
  ];

  let finalAnswer = "";
  let reasoningContent = "";
  try {
    debugDeepSeekQa("stable single call", { candidateSegments: citationSegments.length, messages: messages.length });
    const payload = await fetchLlmJson(
      jsonOnlyConfig,
      {
        messages,
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: "json_object" },
      },
      timeoutMs,
      "DeepSeek stable QA",
    );
    const message = payload.choices?.[0]?.message || {};
    reasoningContent = String(message.reasoning_content || "").trim();
    finalAnswer = cleanLlmAnswer(textFromContent(message.content || textFromPayload(payload)));
    let structuredResult = answerLooksUnusable(finalAnswer) ? null : normalizeStructuredQaResult(finalAnswer, localAnswer, corpus);
    if (qaResultLooksInvalidForQuestion(structuredResult, question)) structuredResult = null;

    if (!structuredResult && finalAnswer && qaJsonRepairEnabled()) {
      try {
        const repairPayload = await fetchLlmJson(
          jsonOnlyConfig,
          {
            messages: [
              { role: "system", content: QA_STABLE_SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  "下面内容不是合格 JSON。请把它改写成符合要求的合法 JSON，只能使用给定逐字稿候选片段作为证据。",
                  `用户问题：${question}`,
                  evaluationRules,
                  `候选逐字稿语义段：\n${transcriptToolContent(citationSegments, question)}`,
                  `原始回答：\n${finalAnswer}`,
                  `目标 JSON 结构：\n${QA_STABLE_JSON_SCHEMA}`,
                  "只返回 JSON，不要输出 Markdown、代码块、工具调用、XML 或 DSML。",
                ].join("\n\n"),
              },
            ],
            max_completion_tokens: maxCompletionTokens,
            response_format: { type: "json_object" },
          },
          timeoutMs,
          "DeepSeek stable QA JSON repair",
        );
        structuredResult = normalizeStructuredQaResult(cleanLlmAnswer(textFromPayload(repairPayload)), localAnswer, corpus);
        if (qaResultLooksInvalidForQuestion(structuredResult, question)) structuredResult = null;
      } catch (error) {
        debugDeepSeekQa("stable repair failed", error instanceof Error ? error.message : error);
      }
    }

    if (!structuredResult && qaJsonRepairEnabled()) {
      try {
        const strictPayload = await fetchLlmJson(
          jsonOnlyConfig,
          {
            messages: [
              { role: "system", content: QA_STABLE_SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  "请基于下面的候选逐字稿语义段，直接生成符合要求的会议证据型问答 JSON。",
                  "必须只输出合法 JSON，不要输出 Markdown、代码块、工具调用、XML 或 DSML。",
                  `用户问题：${question}`,
                  evaluationRules,
                  historyText ? `同一范围内最近的问答记录，仅作上下文参考：\n${historyText}` : "",
                  `选中的录音：\n${recordings}`,
                  `候选逐字稿语义段：\n${transcriptToolContent(citationSegments, question)}`,
                  attachmentText(options),
                  reasoningContent ? `上一轮深度思考摘要可作为分析路线参考，但最终结论仍必须以逐字稿为准：\n${compactText(reasoningContent, 3000)}` : "",
                  `目标 JSON 结构：\n${QA_STABLE_JSON_SCHEMA}`,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
            max_completion_tokens: maxCompletionTokens,
            response_format: { type: "json_object" },
          },
          timeoutMs,
          "DeepSeek stable QA strict JSON",
        );
        structuredResult = normalizeStructuredQaResult(cleanLlmAnswer(textFromPayload(strictPayload)), localAnswer, corpus);
        if (qaResultLooksInvalidForQuestion(structuredResult, question)) structuredResult = null;
      } catch (error) {
        debugDeepSeekQa("stable strict json failed", error instanceof Error ? error.message : error);
      }
    }

    if (structuredResult) {
      return {
        ...structuredResult,
        provider: config.provider,
        model: config.model,
        reasoningContent,
        thinking: qaThinkingSteps(reasoningContent),
      };
    }

    const plainResult = qaResultFromPlainModelAnswer(finalAnswer, localAnswer, corpus, citationSegments);
    if (plainResult) {
      return {
        ...plainResult,
        provider: config.provider,
        model: config.model,
        reasoningContent,
        thinking: qaThinkingSteps(reasoningContent),
      };
    }
  } catch (error) {
    debugDeepSeekQa("stable call failed", error instanceof Error ? error.message : error);
  }

  return {
    ...qaCleanFallback(localAnswer, corpus, citationSegments),
    provider: "local-fallback",
    reasoningContent,
    thinking: qaThinkingSteps(reasoningContent),
  };
}

async function answerRecordingsWithDeepSeekThinking(items, question, options, config, localAnswer) {
  const corpus = qaCorpusFromItems(items);
  if (corpus.length === 0) return localAnswer;

  const questionProfile = qaQuestionProfile(question);
  const seedSegments = selectQaSeedSegments(corpus, question);
  const evidenceSegments = [];
  for (const query of qaEvidenceQueries(question)) {
    evidenceSegments.push(...searchQaCorpus(corpus, query, 8, "evidence"));
  }
  const summarySegments = questionProfile.summary ? searchQaCorpus(corpus, question, 18, "summary") : [];
  const timelineSegments = questionProfile.evaluation
    ? selectQaTimelineContextSegments(corpus, 18)
    : questionProfile.summary
      ? selectQaTimelineContextSegments(corpus, 10)
      : [];
  const candidateLimit = questionProfile.evaluation ? 36 : questionProfile.summary ? 28 : 24;
  const citationSegments = dedupeQaSegments([...seedSegments, ...evidenceSegments, ...summarySegments, ...timelineSegments], candidateLimit).slice(
    0,
    candidateLimit,
  );
  const recordings = [...new Map(corpus.map((segment) => [segment.recordingId, segment])).values()]
    .map((segment) => `Recording ${String(segment.recordingSeq).padStart(3, "0")} | ${segment.recordingName || ""} | duration ${formatTime(segment.recordingDurationMs || 0)}`)
    .join("\n");
  const historyText = recentQaHistoryText(options.history || options.conversationHistory || []);
  const timeoutMs = Math.max(3000, numeric(env("LLM_TIMEOUT_MS", "60000"), 60000));
  const maxCompletionTokens = Math.max(4096, numeric(env("LLM_MAX_COMPLETION_TOKENS", "8192"), 8192));

  const messages = [
    {
      role: "system",
      content: QA_ANALYSIS_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        `用户问题：${question}`,
        historyText ? `同一范围内最近的问答记录，仅作上下文参考：\n${historyText}` : "",
        `选中的录音：\n${recordings}`,
        `后端已完成语义检索与关键词辅助检索。下面是候选逐字稿语义段，必须只从这些片段中选择证据，不要输出工具调用、XML、DSML 或任何代码：\n${transcriptToolContent(citationSegments, question)}`,
        attachmentText(options),
        `输出必须是合法 JSON，字段和含义必须遵守这个结构，不要输出 Markdown，不要输出代码块，不要输出工具调用文本：\n${QA_JSON_SCHEMA_TEXT}`,
        `问题类型提示：${questionProfile.evaluation ? "评价/态度/满意度类，需要判断强弱并区分认可点与否定点。" : questionProfile.decision ? "决策/任务类，需要提取责任、行动和依据。" : questionProfile.summary ? "总结/纪要类，需要提炼结构化结论。" : "普通会议问答，也必须基于证据判断。"}`,
        "请先在候选片段中内部抽取 5-10 条关键证据候选，再决定最终判断。正文不要插入大量时间点，时间点统一放进 evidences。每个判断点最多 1-2 条关键证据；证据必须是最能直接证明结论的完整语义段，避免只截关键词。",
        "通用回答模板：总体结论；判断等级/倾向程度；核心依据；分点分析；原文证据索引；可复听片段；最终结论。评价类问题必须给出明确等级，不能只写“有待优化”这类弱判断。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  let finalAnswer = "";
  let reasoningContent = "";
  debugDeepSeekQa("single call", { candidateSegments: citationSegments.length, messages: messages.length });
  const payload = await fetchLlmJson(
    config,
    {
      messages,
      max_completion_tokens: maxCompletionTokens,
      response_format: { type: "json_object" },
    },
    timeoutMs,
    "DeepSeek thinking QA",
  );
  const message = payload.choices?.[0]?.message || {};
  reasoningContent = String(message.reasoning_content || "").trim();
  finalAnswer = cleanLlmAnswer(textFromContent(message.content || textFromPayload(payload)));
  debugDeepSeekQa("single result", { answerLength: finalAnswer.length, reasoning: Boolean(reasoningContent) });

  let structuredResult = answerLooksUnusable(finalAnswer) ? null : normalizeStructuredQaResult(finalAnswer, localAnswer, corpus);
  if (qaResultLooksInvalidForQuestion(structuredResult, question)) structuredResult = null;

  if (!structuredResult && finalAnswer) {
    try {
      const repairPayload = await fetchLlmJson(
        config,
        {
          messages: [
            { role: "system", content: QA_ANALYSIS_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                "下面内容不是合格 JSON。请把它改写成符合要求的合法 JSON，只能使用给定逐字稿候选片段作为证据。",
                `用户问题：${question}`,
                `候选逐字稿语义段：\n${transcriptToolContent(citationSegments, question)}`,
                `原始回答：\n${finalAnswer}`,
                `目标 JSON 结构：\n${QA_JSON_SCHEMA_TEXT}`,
                "只返回 JSON，不要输出 Markdown、代码块、工具调用、XML 或 DSML。",
              ].join("\n\n"),
            },
          ],
          max_completion_tokens: maxCompletionTokens,
          response_format: { type: "json_object" },
        },
        timeoutMs,
        "DeepSeek thinking QA JSON repair",
      );
      structuredResult = normalizeStructuredQaResult(cleanLlmAnswer(textFromPayload(repairPayload)), localAnswer, corpus);
      if (qaResultLooksInvalidForQuestion(structuredResult, question)) structuredResult = null;
    } catch (error) {
      debugDeepSeekQa("repair failed", error instanceof Error ? error.message : error);
    }
  }

  if (structuredResult) {
    return {
      ...structuredResult,
      reasoningContent,
      thinking: qaThinkingSteps(reasoningContent),
    };
  }

  return {
    ...localAnswer,
    answer: answerLooksUnusable(finalAnswer) ? localAnswer.answer : finalAnswer,
    jumpToMs: citationSegments[0]?.startMs ?? localAnswer.jumpToMs,
    citations: citationSegments.length ? citationSegments.map((segment) => citationFromSegment(segment, corpus)) : localAnswer.citations,
    reasoningContent,
    thinking: qaThinkingSteps(reasoningContent),
  };
}

function getQuestionAnsweringConfig() {
  const provider = env("LLM_PROVIDER").toLowerCase();
  const llmKey = env("LLM_API_KEY", env("DEEPSEEK_API_KEY"));

  if (provider === "deepseek") {
    const baseUrl = env("LLM_API_BASE", env("DEEPSEEK_API_BASE", "https://api.deepseek.com")).replace(/\/$/, "");
    return {
      provider: "deepseek",
      endpoint: env("LLM_API_URL", `${baseUrl}/chat/completions`),
      apiKey: llmKey,
      model: env("LLM_QA_MODEL", env("DEEPSEEK_QA_MODEL", env("DEEPSEEK_MODEL", "deepseek-chat"))),
      thinking: env("LLM_QA_THINKING", env("DEEPSEEK_THINKING", env("LLM_THINKING", "disabled"))).toLowerCase(),
      reasoningEffort: env("LLM_QA_REASONING_EFFORT", env("DEEPSEEK_REASONING_EFFORT", env("LLM_REASONING_EFFORT", "low"))).toLowerCase(),
      temperature: Math.max(0, Math.min(1, numeric(env("LLM_QA_TEMPERATURE", env("LLM_TEMPERATURE", "0.25")), 0.25))),
    };
  }

  const baseUrl = env("LLM_API_BASE", "").replace(/\/$/, "");
  return {
    provider: "openai-compatible",
    endpoint: env("LLM_API_URL", llmKey ? `${baseUrl || "https://api.openai.com/v1"}/chat/completions` : ""),
    apiKey: llmKey,
    model: env("LLM_QA_MODEL", env("LLM_MODEL", "gpt-4o-mini")),
    temperature: Math.max(0, Math.min(1, numeric(env("LLM_QA_TEMPERATURE", env("LLM_TEMPERATURE", "0.25")), 0.25))),
  };
}

function isDeepseekThinkingEnabled(config = {}) {
  return config.provider === "deepseek" && config.thinking !== "disabled";
}

function llmHeaders(config = {}) {
  const headers = { "Content-Type": "application/json" };
  if (config.provider === "mimo") headers["api-key"] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function llmRequestBody(config, body = {}) {
  const payload = {
    model: config.model,
    stream: false,
    temperature: config.temperature ?? 0.25,
    ...body,
  };

  if (config.provider === "deepseek" && payload.max_completion_tokens && !payload.max_tokens) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
  }

  if (isDeepseekThinkingEnabled(config)) {
    payload.thinking = { type: "enabled" };
    payload.reasoning_effort = ["low", "medium", "high", "max", "xhigh"].includes(config.reasoningEffort) ? config.reasoningEffort : "high";
    delete payload.temperature;
  } else if (config.provider === "deepseek" && env("DEEPSEEK_THINKING_PARAM", "0") === "1") {
    payload.thinking = { type: "disabled" };
  }

  return payload;
}

async function fetchLlmJson(config, body, timeoutMs, label) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: llmHeaders(config),
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(llmRequestBody(config, body)),
  });
  return readApiPayload(response, label);
}

function debugDeepSeekQa(...args) {
  if (env("DEBUG_DEEPSEEK_QA") === "1") console.warn("[DeepSeek QA]", ...args);
}

export async function answerRecordingQuestion(recording, segments, question) {
  return answerRecordingsQuestion([{ recording, segments }], question);
}

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

function repairKnownMojibake(value) {
  return MOJIBAKE_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));
}

function looksLikeMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ""));
}

function answerLooksUnusable(answer) {
  const text = String(answer || "").trim();
  if (!text) return true;
  if (looksLikeMojibake(text)) return true;
  if (hasInlineToolMarkup(text)) return true;
  if (/[<]\/?\s*(?:DSML|tool_calls|invoke|parameter)\b/i.test(text)) return true;
  if (/<!DOCTYPE html|<html\b|Cannot POST|JSON parse failed|Bad control character|Expected ',' or ']'|parameter name=|invoke name=|tool_calls/i.test(text)) return true;
  if (/^\s*[{[]/.test(text) && /"error"|error_code|errmsg|message/i.test(text)) return true;
  return [
    "用户问题无效",
    "没有包含任何需要回答的问题",
    "没有提供明确的问题",
    "请提供明确的问题",
    "无法回答，因为没有问题",
  ].some((pattern) => text.includes(pattern));
}

function cleanLlmAnswer(answer) {
  const cleaned = repairKnownMojibake(answer)
    .trim()
    .replace(/```(?:json|markdown|javascript|js|html|xml)?/gi, "")
    .replace(/```/g, "")
    .replace(/^用户问题无效，?无法直接回答。?\s*/u, "")
    .trim();
  return answerLooksUnusable(cleaned) ? "" : cleaned;
}

function extractJsonObject(text = "") {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const candidates = [cleaned];
  try {
    const maybeString = JSON.parse(cleaned);
    if (typeof maybeString === "string") candidates.push(maybeString.trim());
  } catch {
    // The normal path below handles non-string JSON and partial JSON extraction.
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(cleaned.slice(start, end + 1));
  }

  let lastError = null;
  for (const candidate of candidates) {
    const variants = [
      candidate,
      candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " "),
      candidate.replace(/,\s*([}\]])/g, "$1"),
      candidate
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
        .replace(/,\s*([}\]])/g, "$1"),
    ];

    for (const variant of variants) {
      try {
        return JSON.parse(variant);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Meeting outline JSON parse failed: ${lastError.message}`
      : "Meeting outline JSON parse failed.",
  );
}

function parseOutlineTimeMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10000 ? Math.round(value * 1000) : Math.round(value);
  }

  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/^\d+$/.test(text)) return parseOutlineTimeMs(Number(text), fallback);

  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return fallback;
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  return fallback;
}

function normalizeOutlineItems(items = [], fallbackTitle = "要点") {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const source = typeof item === "string" ? { title: item } : item || {};
      const startMs = parseOutlineTimeMs(source.startMs ?? source.start_ms ?? source.time ?? source.timestamp, 0);
      const endMs = parseOutlineTimeMs(source.endMs ?? source.end_ms ?? source.end, startMs + 30000);
      return {
        title: compactText(source.title || source.topic || source.name || `${fallbackTitle} ${index + 1}`, 80),
        summary: compactText(source.summary || source.detail || source.content || source.text || "", 220),
        owner: compactText(source.owner || source.assignee || "", 40),
        due: compactText(source.due || source.deadline || "", 40),
        status: compactText(source.status || "", 40),
        evidence: compactText(source.evidence || source.quote || source.source || "", 160),
        startMs,
        endMs: Math.max(startMs + 1000, endMs),
      };
    })
    .filter((item) => item.title || item.summary);
}

function normalizeKeywordTag(value = "", fallback = "") {
  const raw = String(value || fallback || "")
    .replace(/[，,、|；;]+/g, " / ")
    .replace(/[^\p{Script=Han}A-Za-z0-9/_\-\s]/gu, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = raw
    .split("/")
    .map((item) => compactText(item.trim(), 8))
    .filter(Boolean);
  const unique = [...new Set(parts)].slice(0, 3);
  return unique.join(" / ") || compactText(fallback, 18);
}

function keywordsFromOutline(parsed = {}, fallback = "") {
  const explicit = parsed.keywords || parsed.tags || parsed.keyWords || parsed.key_words;
  if (Array.isArray(explicit) && explicit.length > 0) return normalizeKeywordTag(explicit.join(" / "), fallback);
  if (typeof explicit === "string" && explicit.trim()) return normalizeKeywordTag(explicit, fallback);

  const summary = String(parsed.summary || fallback || "").trim();
  const lastSentence = summary
    .split(/[。！？.!?]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .pop();
  return normalizeKeywordTag(lastSentence || parsed.title || fallback, fallback);
}

function localKeywordTag(text = "", fallback = "") {
  const stopWords = new Set([
    "这个",
    "那个",
    "就是",
    "然后",
    "我们",
    "你们",
    "他们",
    "一下",
    "一个",
    "一些",
    "可能",
    "因为",
    "所以",
    "会议",
    "录音",
    "转写",
  ]);
  const candidates = String(text || fallback || "")
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’<>《》|/\\-]+/g, " ")
    .split(/\s+/)
    .flatMap((item) => {
      const compact = item.trim();
      if (!compact) return [];
      if (/^[A-Za-z0-9]+$/.test(compact)) return [compact.slice(0, 10)];
      const words = compact.match(/[\p{Script=Han}A-Za-z0-9]{2,10}/gu) || [];
      return words;
    })
    .map((item) => compactText(item, 8))
    .filter((item) => item && !stopWords.has(item) && item.length >= 2);
  const unique = [...new Set(candidates)].slice(0, 3);
  return normalizeKeywordTag(unique.join(" / "), fallback);
}

function safeMeetingReportMarkdown(markdown = "") {
  const value = String(markdown || "").trim();
  if (!value) return "";
  if (/<!doctype|<html|cannot\s+post|cannot\s+get/i.test(value)) return "";
  return value.slice(0, 16000);
}

function transcriptLikeText(text = "") {
  const value = String(text || "");
  const fillerCount = (value.match(/嗯|呃|啊|呢|那个|这个|就是|然后|其实|大概/g) || []).length;
  return fillerCount >= 3 || /嗯[，,\s、。].*嗯/.test(value) || /我这边|你这边|咱们|聊一下|简单沟通/.test(value);
}

function meetingText(text = "", fallback = "未明确", maxLength = 150) {
  const cleaned = String(text || "")
    .replace(/[`*_>#-]/g, "")
    .replace(/嗯|呃|啊|呢|那个|这个|就是|然后|其实|大概|这边|那边/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,、。；;：:]{2,}/g, "，")
    .trim();
  if (!cleaned || transcriptLikeText(text)) return fallback;
  return compactText(cleaned, maxLength);
}

function outlineItemText(item, field, fallback, maxLength = 140) {
  return meetingText(item?.[field] || item?.summary || item?.title || "", fallback, maxLength);
}

function composeMeetingReport(recording, parsed = {}, segments = []) {
  const topic = meetingText(parsed.title || recording.name, recording.name || `录音 ${String(recording.seq || 0).padStart(3, "0")}`, 42);
  const summary = meetingText(parsed.summary, `本次会议围绕「${topic}」展开，重点需要结合逐字稿进一步复核关键结论。`, 220);
  const sections = normalizeOutlineItems(parsed.sections || parsed.outline || parsed.mainPoints || parsed.main_points, "议题").slice(0, 6);
  const mainPoints = normalizeOutlineItems(parsed.mainPoints || parsed.main_points || parsed.keyPoints || parsed.key_points, "要点").slice(0, 5);
  const risks = normalizeOutlineItems(parsed.risks || parsed.questions, "风险").slice(0, 4);
  const actions = normalizeOutlineItems(parsed.actionItems || parsed.action_items || parsed.todos, "待办").slice(0, 5);
  const decisions = normalizeOutlineItems(parsed.decisions, "决定").slice(0, 4);
  const fallbackTopics = sections.length
    ? sections
    : mainPoints.length
      ? mainPoints
      : [
          {
            title: "会议主题梳理",
            summary: "围绕会议主题进行了信息同步和问题梳理。",
          },
        ];
  const corePoints = [
    summary,
    ...mainPoints.map((item) => outlineItemText(item, "summary", `围绕「${meetingText(item.title, "会议要点", 32)}」形成了阶段性讨论。`, 130)),
  ]
    .filter(Boolean)
    .slice(0, 5);
  const riskRows = risks.length
    ? risks.map((item) => `* ${meetingText(item.title, "待复核风险", 32)}：${outlineItemText(item, "summary", "需要进一步确认影响范围。", 130)}`)
    : ["* 暂未识别出明确风险，建议结合参会人复核。"];
  const actionRows = actions.length
    ? actions.map(
        (item) =>
          `| ${meetingText(item.title, "待办事项", 42)} | ${meetingText(item.owner, "未明确", 24)} | ${meetingText(item.due, "未明确", 24)} | ${outlineItemText(item, "summary", "待补充交付结果。", 80)} |`,
      )
    : ["| 待补充 | 未明确 | 未明确 | 未明确 |"];
  const confirmRows = decisions.length
    ? decisions.map((item) => `* ${meetingText(item.title, "待确认事项", 42)}：${outlineItemText(item, "summary", "需要继续沟通确认。", 120)}`)
    : ["* 负责人、截止时间和最终交付结果仍需进一步确认。"];

  return [
    "## 一、会议基本信息",
    "",
    `* 会议主题：${topic}`,
    `* 会议时间：${recording.createdAt ? new Date(recording.createdAt).toLocaleString("zh-CN") : "未明确"}`,
    "* 参会人员：未明确",
    "* 会议背景：根据录音转写自动整理，用于办公复盘和后续行动跟踪。",
    "",
    "## 二、会议核心结论",
    "",
    ...corePoints.map((item) => `* ${item}`),
    "",
    "## 三、主要讨论内容",
    "",
    ...fallbackTopics.flatMap((item, index) => {
      const title = meetingText(item.title, `议题 ${index + 1}`, 40);
      return [
        `### 议题名称：${title}`,
        "",
        `* 讨论重点：${outlineItemText(item, "summary", `围绕「${title}」梳理现状、问题和后续方向。`, 140)}`,
        `* 关键观点：${outlineItemText(item, "evidence", "需要结合完整逐字稿进一步确认关键观点。", 120)}`,
        `* 形成结论：${outlineItemText(item, "status", "未形成明确结论。", 90)}`,
        "* 存在问题：未明确",
        "",
      ];
    }),
    "## 四、问题与风险",
    "",
    ...riskRows,
    "",
    "## 五、下一步行动计划",
    "",
    "| 事项 | 负责人 | 截止时间 | 交付结果 |",
    "| -- | --- | ---- | ---- |",
    ...actionRows,
    "",
    "## 六、待确认事项",
    "",
    ...confirmRows,
    "",
    "## 七、会议总结",
    "",
    meetingText(parsed.summary, `本次会议围绕「${topic}」完成阶段性讨论，后续重点是确认责任人、时间节点和交付结果。`, 260),
  ].join("\n");
}

const MEETING_REPORT_TEMPLATE = `# 会议报告生成提纲

## 一、会议基本信息

* 会议主题：
* 会议时间：
* 参会人员：
* 会议背景：

## 二、会议核心结论

用 3—5 条概括本次会议最重要的结论，突出已经达成共识的内容。

## 三、主要讨论内容

请根据会议录音内容，自动识别并归纳会议中的主要议题。议题数量不限，按重要程度或会议讨论顺序排列。

### 议题名称：

* 讨论重点：
* 关键观点：
* 形成结论：
* 存在问题：

### 议题名称：

* 讨论重点：
* 关键观点：
* 形成结论：
* 存在问题：

### 议题名称：

* 讨论重点：
* 关键观点：
* 形成结论：
* 存在问题：

> 如会议中包含更多议题，请继续按照以上格式补充。

## 四、问题与风险

列出会议中提到的主要问题、阻碍、风险点，并说明可能影响。

## 五、下一步行动计划

明确后续要做什么、谁负责、什么时候完成。

| 事项 | 负责人 | 截止时间 | 交付结果 |
| -- | --- | ---- | ---- |

## 六、待确认事项

列出会议中没有明确结论、需要继续沟通或决策的内容。

## 七、会议总结

用一段话总结本次会议的价值、方向和下一步重点。`;

function localMeetingReport(recording, segments = [], summary = "") {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0).filter((segment) => String(segment.text || "").trim());
  const topic = recording.name || `录音 ${String(recording.seq || 0).padStart(3, "0")}`;
  const fallbackSummary = summary || "当前录音已完成转写，并整理为办公纪要框架；关键结论、责任人、截止时间和交付结果建议结合参会人进一步复核。";
  return composeMeetingReport(
    recording,
    {
      title: topic,
      summary: fallbackSummary,
      sections: expandedSegments.slice(0, 3).map((segment, index) => ({
        title: `议题 ${index + 1}`,
        summary: "围绕会议内容进行讨论，需要人工复核具体结论。",
        evidence: "待结合逐字稿复核关键观点。",
        status: "未形成明确结论。",
      })),
    },
    expandedSegments,
  );
}

function localMeetingOutline(recording, segments = [], reason = "") {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0);
  const hasTranscript = expandedSegments.some((segment) => String(segment.text || "").trim());
  const title = recording.name || `录音 ${String(recording.seq || 0).padStart(3, "0")}`;
  const message = hasTranscript
    ? "会议提纲暂未稳定生成，请稍后点击重新生成。系统已保留转写内容，不影响问答和复听。"
    : "这条录音还没有可用于生成会议提纲的转写内容。";

  return {
    provider: "local-fallback",
    model: "",
    generatedAt: new Date().toISOString(),
    title,
    summary: message,
    keywords: "",
    reportMarkdown: [
      "## 一、会议基本信息",
      "",
      `* 会议主题：${title}`,
      `* 会议时间：${recording.createdAt ? new Date(recording.createdAt).toLocaleString("zh-CN") : "未明确"}`,
      "* 参会人员：未明确",
      "* 会议背景：会议提纲暂未成功生成。",
      "",
      "## 二、会议核心结论",
      "",
      `* ${message}`,
      "",
      "## 三、主要讨论内容",
      "",
      "* 暂未生成。请稍后重新生成会议提纲。",
      "",
      "## 四、问题与风险",
      "",
      "* 会议提纲生成暂不可用，转写内容仍可用于问答。",
      "",
      "## 五、下一步行动计划",
      "",
      "| 事项 | 负责人 | 截止时间 | 交付结果 |",
      "| -- | --- | ---- | ---- |",
      "| 重新生成会议提纲 | 未明确 | 未明确 | 待生成 |",
      "",
      "## 六、待确认事项",
      "",
      "* 需要确认大模型接口稳定后重新生成。",
      "",
      "## 七、会议总结",
      "",
      message,
    ].join("\n"),
    sections: [],
    mainPoints: [],
    keyPoints: [],
    decisions: [],
    actionItems: [],
    risks: reason ? [{ title: "会议提纲未生成", summary: "大模型返回内容暂时无法解析，请稍后重新生成。", startMs: 0, endMs: 1000 }] : [],
  };
}

function englishRatio(text = "") {
  const letters = String(text || "").match(/[A-Za-z]/g)?.length || 0;
  const chinese = String(text || "").match(/\p{Script=Han}/gu)?.length || 0;
  const total = letters + chinese;
  return total === 0 ? 0 : letters / total;
}

function transcriptPlainText(segments = [], limit = 18000) {
  return expandTranscriptSegments(segments, 0)
    .map((segment) => `[${formatTime(segment.startMs)}-${formatTime(segment.endMs)}] ${segment.text}`)
    .join("\n")
    .slice(0, limit);
}

export async function translateTranscriptToChinese(recording, segments = []) {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0);
  const sourceText = expandedSegments.map((segment) => segment.text).join(" ").trim();
  if (!sourceText || englishRatio(sourceText) < 0.58) {
    return { detectedLanguage: englishRatio(sourceText) >= 0.58 ? "en" : "zh", translationText: "" };
  }

  const config = getQuestionAnsweringConfig();
  if (!config.endpoint || !config.apiKey) {
    return { detectedLanguage: "en", translationText: "" };
  }

  const headers = { "Content-Type": "application/json" };
  if (config.provider === "mimo") headers["api-key"] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(Math.max(3000, numeric(env("LLM_TIMEOUT_MS", "60000"), 60000))),
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "你是专业会议转写翻译助手。请把英文录音转写翻译成自然、准确的中文，保留关键名词和时间顺序，不要总结，不要省略明显内容。",
          },
          {
            role: "user",
            content: `录音名称：${recording.name}\n请翻译以下逐字稿为中文：\n${transcriptPlainText(expandedSegments, 22000)}`,
          },
        ],
        max_completion_tokens: Math.max(800, numeric(env("LLM_TRANSLATION_MAX_TOKENS", "3000"), 3000)),
        stream: false,
        temperature: 0.1,
      }),
    });
    const payload = await readApiPayload(response, "LLM transcript translation");
    return {
      detectedLanguage: "en",
      translationText: compactText(textFromPayload(payload), 12000),
    };
  } catch {
    return { detectedLanguage: "en", translationText: "" };
  }
}

export async function generateRecordingTag(recording, segments = []) {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0).filter((segment) => String(segment.text || "").trim());
  if (expandedSegments.length === 0) return "";

  const local = localKeywordTag(expandedSegments.map((segment) => segment.text).join(" "), recording.name || "");
  const config = getQuestionAnsweringConfig();
  if (!config.endpoint || !config.apiKey) return local;

  const headers = { "Content-Type": "application/json" };
  if (config.provider === "mimo") headers["api-key"] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(Math.max(3000, numeric(env("LLM_TIMEOUT_MS", "60000"), 60000))),
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "你是办公录音分类助手。请根据录音转写提炼 2 到 3 组适合显示在卡片标记里的关键词。关键词要来自会议结论、议题或下一步方向，不要使用口头禅、完整句子或普通词。每组 2 到 8 个中文字符，用 / 分隔，只输出关键词。",
          },
          {
            role: "user",
            content: `录音名称：${recording.name}\n转写内容：\n${transcriptPlainText(expandedSegments, 6000)}`,
          },
        ],
        max_completion_tokens: 80,
        stream: false,
        temperature: 0.1,
      }),
    });
    const payload = await readApiPayload(response, "LLM recording tag");
    const tag = normalizeKeywordTag(textFromPayload(payload), local);
    return tag || local;
  } catch {
    return local;
  }
}

export async function generateMeetingOutline(recording, segments = []) {
  const expandedSegments = expandTranscriptSegments(segments, recording.durationMs || 0);
  if (expandedSegments.length === 0) {
    return localMeetingOutline(recording, expandedSegments);
  }

  const config = getQuestionAnsweringConfig();
  if (!config.endpoint || !config.apiKey) {
    return localMeetingOutline(recording, expandedSegments, "missing LLM_API_KEY");
  }

  const transcript = expandedSegments
    .map((segment) => {
      const speaker = segment.speakerName || segment.speakerKey || "说话人";
      return `[${formatTime(segment.startMs)}-${formatTime(segment.endMs)} | ${speaker}] ${segment.text}`;
    })
    .join("\n")
    .slice(0, Math.max(12000, numeric(env("LLM_MEETING_TRANSCRIPT_LIMIT", "22000"), 22000)));

  const headers = { "Content-Type": "application/json" };
  if (config.provider === "mimo") headers["api-key"] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;

  const timeoutMs = Math.max(3000, numeric(env("LLM_MEETING_TIMEOUT_MS", "120000"), 120000));

  try {
    const controller = new AbortController();
    let timeoutHandle;
    const response = await Promise.race([
      fetch(config.endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "你是专业的办公会议纪要助手。请只根据录音转写整理会议报告，不编造未出现的信息。输出必须是严格 JSON，不要包裹代码块。所有可定位条目都要尽量带 startMs/endMs，单位为毫秒，用于定位音频。reportMarkdown 必须严格按用户提供的大纲结构输出，适合企业办公复盘；不得把逐字稿原文大段复制到会议提纲中，只能概括、归纳、提炼。",
          },
          {
            role: "user",
            content: `录音名称：${recording.name}\n录音编号：${String(recording.seq).padStart(3, "0")}\n录音转写：\n${transcript}\n\n固定会议报告大纲如下，每次都必须使用这个结构和标题顺序：\n${MEETING_REPORT_TEMPLATE}\n\n请生成结构化会议报告 JSON，字段如下：\n{\n  "title": "会议主题，不超过24字",\n  "summary": "会议总体结论，2到4句话",\n  "keywords": ["从第七部分会议总结里提炼出的关键词1", "关键词2", "关键词3"],\n  "reportMarkdown": "严格按固定大纲写出的完整会议报告，保留 Markdown 标题、列表和表格。必须包含一到七所有章节。没有提到的信息写未明确，不要编造，不要复制逐字稿长段原文。",\n  "sections": [{"title":"议题名称","summary":"这一段讨论了什么","startMs":0,"endMs":30000,"evidence":"对应原文短句"}],\n  "mainPoints": [{"title":"主要内容标题","summary":"主要内容说明","startMs":0,"endMs":30000,"evidence":"对应原文短句"}],\n  "keyPoints": [{"title":"关键点","summary":"为什么重要","startMs":0,"endMs":30000,"evidence":"对应原文短句"}],\n  "decisions": [{"title":"已达成决定","summary":"决定内容","startMs":0,"endMs":30000,"evidence":"对应原文短句"}],\n  "actionItems": [{"title":"待办事项","summary":"要做什么","owner":"负责人，不明确则写未明确","due":"截止时间，不明确则写未明确","startMs":0,"endMs":30000,"evidence":"对应原文短句"}],\n  "risks": [{"title":"风险/问题","summary":"风险说明","startMs":0,"endMs":30000,"evidence":"对应原文短句"}]\n}\n如果某类没有内容，请返回空数组。keywords 必须是 2 到 3 个短词，适合放在录音卡片标记中，并且要和第七部分会议总结的方向一致。`,
          },
        ],
        max_completion_tokens: Math.max(3000, numeric(env("LLM_MEETING_MAX_TOKENS", env("LLM_MAX_COMPLETION_TOKENS", "6000")), 6000)),
        response_format: { type: "json_object" },
        stream: false,
        temperature: 0.1,
      }),
      }),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error(`会议纪要生成超过 ${Math.round(timeoutMs / 1000)} 秒，已切换本地提纲。`));
        }, timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(timeoutHandle);
    });

    const payload = await readApiPayload(response, "LLM meeting outline");
    const outlineText = cleanLlmAnswer(textFromPayload(payload));
    if (!outlineText || answerLooksUnusable(outlineText)) {
      throw new Error("Meeting outline returned unusable content");
    }
    const parsed = extractJsonObject(outlineText);
    const reportMarkdown = safeMeetingReportMarkdown(parsed.reportMarkdown || parsed.report || parsed.markdown || "");
    const composedReport = composeMeetingReport(recording, parsed, expandedSegments);

    return {
      provider: config.provider,
      model: config.model,
      generatedAt: new Date().toISOString(),
      title: compactText(parsed.title || recording.name || "会议提纲", 60),
      summary: compactText(parsed.summary || "", 420),
      keywords: keywordsFromOutline(parsed, parsed.summary || recording.name || ""),
      reportMarkdown: reportMarkdown && !transcriptLikeText(reportMarkdown) ? reportMarkdown : composedReport,
      sections: normalizeOutlineItems(parsed.sections || parsed.outline, "议题"),
      mainPoints: normalizeOutlineItems(parsed.mainPoints || parsed.main_points || parsed.contents, "主要内容"),
      keyPoints: normalizeOutlineItems(parsed.keyPoints || parsed.key_points, "关键点"),
      decisions: normalizeOutlineItems(parsed.decisions, "决议"),
      actionItems: normalizeOutlineItems(parsed.actionItems || parsed.action_items || parsed.todos, "待办"),
      risks: normalizeOutlineItems(parsed.risks || parsed.questions, "风险"),
    };
  } catch (error) {
    console.warn("[Meeting outline] fallback:", error instanceof Error ? error.message : error);
    return localMeetingOutline(recording, expandedSegments, "meeting outline failed");
  }
}

const DAILY_MEETING_BRIEF_SYSTEM_PROMPT = `你是一个专业的会议纪要分析助手。现在需要基于当天所有录音的标题、会议提纲、转写内容，生成一份“今日会议简报”。

你的任务不是简单复述原文，而是对当天多场会议进行二次提炼，帮助用户快速了解今天开了哪些会、每场会议的核心结论、问题、风险和待办事项。

输出要求：

1. 内容要简短清晰，但不要为了简短而省略关键信息。
2. 不同会议必须分开总结，不能混在一起。
3. 必须体现层级关系，便于阅读。
4. 每场会议都按照以下结构输出：
   - 核心结论
   - 主要问题
   - 风险提醒
   - 待办事项
5. 如果某一项没有明确内容，不要编造，写“暂无明确内容”。
6. 待办事项尽量提取动作、对象、负责人、时间要求；如果没有负责人或时间，不要乱编。
7. 优先基于会议提纲总结；会议提纲不足时，再结合转写内容补充。
8. 语言要自然、克制、专业，不要口号化，不要写成很长的报告。
9. 该提示词只用于“今日会议简报”，不能用于单个录音问答。`;

function sanitizeDailyBriefText(text = "") {
  const cleaned = cleanLlmAnswer(text)
    .replace(/```markdown|```/gi, "")
    .trim();
  if (!cleaned) return "";
  if (/<!DOCTYPE html|<html\b|Cannot POST|JSON parse failed|Bad control character|Expected ',' or ']'/i.test(cleaned)) {
    return "";
  }
  if (/[<]\/?\s*(?:DSML|tool_calls|invoke|parameter)\b/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function outlineTextFromRecording(recording = {}) {
  const candidates = [
    recording.meetingOutlineMarkdown,
    recording.meetingOutline?.reportMarkdown,
    recording.outlineMarkdown,
    recording.summaryMarkdown,
    recording.summary,
    recording.meetingOutline?.summary,
    recording.analysis,
    recording.outline,
  ];
  return compactText(candidates.find((item) => typeof item === "string" && item.trim()) || "", 1800);
}

function dailyBriefSegmentsText(segments = [], maxChars = 2600) {
  const lines = expandTranscriptSegments(segments || [], 0)
    .map((segment) => {
      const text = compactText(segment.correctedText || segment.text || segment.rawText || "", 220);
      if (!text) return "";
      const speaker = segment.speakerName || segment.speakerKey || "说话人";
      return `[${formatTime(segment.startMs)}-${formatTime(segment.endMs)} ${speaker}] ${text}`;
    })
    .filter(Boolean);
  return compactText(lines.join("\n"), maxChars);
}

function localDailyMeetingBrief(items = [], meta = {}) {
  const displayDate = meta.displayDate || meta.date || "";
  const count = items.length;
  if (!count) {
    return `今日会议简报｜${displayDate}｜共 0 场会议

一、今日总体结论
今天还没有可总结的录音。

二、会议列表
暂无会议。

三、今日重点待办
暂无明确内容`;
  }

  const lines = [
    `今日会议简报｜${displayDate}｜共 ${count} 场会议`,
    "",
    "一、今日总体结论",
    `今天共有 ${count} 场会议录音。以下内容基于已保存的会议提纲和转写内容整理，重点信息不足的位置已标注为暂无明确内容。`,
    "",
    "二、会议列表",
  ];

  items.forEach(({ recording, segments }, index) => {
    const title = recording?.name || `录音 ${String(recording?.seq || index + 1).padStart(3, "0")}`;
    const duration = formatTime(recording?.durationMs || 0);
    const outline = outlineTextFromRecording(recording);
    const transcript = dailyBriefSegmentsText(segments, 520);
    const seed = compactText(outline || transcript || "暂无明确内容", 220);
    lines.push(
      "",
      `${index + 1}. ${title}`,
      `时间：${duration}`,
      "",
      "核心结论：",
      `- ${seed || "暂无明确内容"}`,
      "",
      "主要问题：",
      "- 暂无明确内容",
      "",
      "风险提醒：",
      "- 暂无明确内容",
      "",
      "待办事项：",
      "- 暂无明确内容",
    );
  });

  lines.push("", "三、今日重点待办", "1. 暂无明确内容");
  return lines.join("\n");
}

export async function generateDailyMeetingBrief(items = [], meta = {}) {
  const fallback = localDailyMeetingBrief(items, meta);
  const config = getQuestionAnsweringConfig();
  if (!items.length) {
    return {
      summaryMarkdown: fallback,
      generatedAt: new Date().toISOString(),
      provider: "local",
      model: "empty",
    };
  }
  if (!config.endpoint || !config.apiKey) {
    return {
      summaryMarkdown: fallback,
      generatedAt: new Date().toISOString(),
      provider: "local",
      model: "fallback",
    };
  }

  const displayDate = meta.displayDate || meta.date || "";
  const recordingsText = items
    .map(({ recording, segments }, index) => {
      const seq = String(recording?.seq || index + 1).padStart(3, "0");
      const title = recording?.name || `录音 ${seq}`;
      return [
        `会议 ${index + 1}`,
        `标题：${title}`,
        `录音编号：${seq}`,
        `上传时间：${recording?.createdAt || ""}`,
        `录音时长：${formatTime(recording?.durationMs || 0)}`,
        `会议提纲：\n${outlineTextFromRecording(recording) || "暂无会议提纲"}`,
        `转写摘录：\n${dailyBriefSegmentsText(segments, 3000) || "暂无转写"}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  try {
    const payload = await fetchLlmJson(
      config,
      {
        messages: [
          { role: "system", content: DAILY_MEETING_BRIEF_SYSTEM_PROMPT },
          {
            role: "user",
            content: `日期：${displayDate}
会议数量：${items.length}

输出格式：

今日会议简报｜${displayDate}｜共 ${items.length} 场会议

一、今日总体结论
用 2-4 句话概括今天所有会议的主要方向、已经明确的事情、仍需推进的问题。

二、会议列表

1. {会议名称}
时间：{录音时长}

核心结论：
- ...

主要问题：
- ...

风险提醒：
- ...

待办事项：
- ...

三、今日重点待办
1. ...

以下是当天会议数据：
${recordingsText}`,
          },
        ],
        max_completion_tokens: Math.max(2500, numeric(env("LLM_DAILY_BRIEF_MAX_TOKENS", "5000"), 5000)),
        stream: false,
        temperature: 0.15,
      },
      Math.max(30000, numeric(env("LLM_DAILY_BRIEF_TIMEOUT_MS", env("LLM_TIMEOUT_MS", "90000")), 90000)),
      "LLM daily meeting brief",
    );
    const summary = sanitizeDailyBriefText(textFromPayload(payload));
    if (!summary) throw new Error("Daily brief returned unusable content");
    return {
      summaryMarkdown: summary,
      generatedAt: new Date().toISOString(),
      provider: config.provider,
      model: config.model,
    };
  } catch (error) {
    console.warn("[Daily brief] fallback:", error instanceof Error ? error.message : error);
    return {
      summaryMarkdown: fallback,
      generatedAt: new Date().toISOString(),
      provider: "local",
      model: "fallback",
    };
  }
}

export async function answerRecordingsQuestion(items, question, options = {}) {
  const localAnswer = localAnswerFromCorpus(items, question);
  const config = getQuestionAnsweringConfig();

  if (!config.endpoint || !config.apiKey) {
    return localAnswer;
  }

  try {
    return await answerRecordingsWithDeepSeekThinkingStable(items, question, options, config, localAnswer);
  } catch (error) {
    console.warn("[DeepSeek QA] stable fallback:", error instanceof Error ? error.message : error);
    const corpus = qaCorpusFromItems(items);
    return qaCleanFallback(localAnswer, corpus, selectQaSeedSegments(corpus, question).slice(0, 6));
  }

  const contextLines = items.flatMap((item) =>
    expandTranscriptSegments(item.segments || [], item.recording.durationMs || 0).map(
      (segment) =>
        `[录音 ${String(item.recording.seq).padStart(3, "0")}｜${item.recording.name}｜${formatTime(segment.startMs)}-${formatTime(
          segment.endMs,
        )}] ${segment.text}`,
    ),
  );
  const transcript = contextLines.join("\n").slice(0, 24000);
  const headers = llmHeaders(config);
  const timeoutMs = Math.max(3000, numeric(env("LLM_TIMEOUT_MS", "60000"), 60000));
  const imageNote = Array.isArray(options.images) && options.images.length > 0 ? `\n用户还上传了 ${options.images.length} 张图片，但回答必须以录音转写为主。` : "";
  const attachmentNote =
    Array.isArray(options.attachments) && options.attachments.length > 0
      ? `\n\n用户补充材料：\n${options.attachments
          .map((item, index) => {
            const title = `${index + 1}. ${item.kind || "附件"}｜${item.name || "未命名"}`;
            const body = item.text || item.url || "仅有附件名称，未解析正文";
            return `${title}\n${body}`;
          })
          .join("\n\n")
          .slice(0, 12000)}`
      : "";

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "你是录音知识库问答助手。用户问题一定有效，必须优先回答用户问题。只能根据用户提供的录音逐字稿回答，不要编造，不要用外部知识补充。回答要先给结论，再分点说明。每个观点都必须能在逐字稿里找到依据；同一个观点如果多个时间点都提到，要逐一标注，不要合并、不要遗漏。依据格式必须写在对应观点句尾，例如【录音 003｜电梯｜01:07】。如果逐字稿不足以回答，请直接说明缺少哪类信息。",
          },
          {
            role: "user",
            content: `用户问题：${question}\n${imageNote}${attachmentNote}\n\n可检索录音转写：\n${transcript || "暂无转写"}\n\n请直接回答上面的用户问题，并给出录音出处。`,
          },
        ],
        max_completion_tokens: Math.max(512, numeric(env("LLM_MAX_COMPLETION_TOKENS", "2048"), 2048)),
        stream: false,
        temperature: 0.2,
      }),
    });

    const payload = await readApiPayload(response, "LLM question answering");
    const answer = cleanLlmAnswer(textFromPayload(payload));

    if (answerLooksUnusable(answer)) {
      const corpus = qaCorpusFromItems(items);
      return qaCleanFallback(localAnswer, corpus, selectQaSeedSegments(corpus, question).slice(0, 6));
    }

    return {
      ...localAnswer,
      answer,
    };
  } catch {
    const corpus = qaCorpusFromItems(items);
    return qaCleanFallback(localAnswer, corpus, selectQaSeedSegments(corpus, question).slice(0, 6));
  }
}
