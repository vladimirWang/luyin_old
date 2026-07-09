import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const targetDate = process.argv[2];
const packageDir = process.argv[3];

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
    if (!process.env[key]) process.env[key] = value;
  }
}

function dateKeyInShanghai(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function safeName(value, fallback = "recording") {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function resolveFile(filePath = "") {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

function formatDuration(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimecode(ms = 0) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function csvCell(value = "") {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function transcriptText(recording, segments) {
  if (!segments.length) return "暂无转写内容。\n";
  return `${segments
    .map((segment) => `[${formatTimecode(segment.startMs)}] ${segment.speakerKey || "speaker-1"}: ${segment.text || ""}`)
    .join("\n")}\n`;
}

async function copyIfExists(sourcePath, targetPath) {
  const resolved = resolveFile(sourcePath);
  if (!resolved || !existsSync(resolved)) return false;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(resolved, targetPath);
  return true;
}

await loadEnvFile(path.join(projectRoot, ".env"));
const { loadDb } = await import("./server/db.mjs");
const db = await loadDb();
const recordings = (db.recordings || [])
  .filter((recording) => !recording.deletedAt && dateKeyInShanghai(recording.createdAt) === targetDate)
  .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || Number(a.seq || 0) - Number(b.seq || 0));

await rm(packageDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });

const summaries = [];
const csvRows = [["序号", "录音ID", "名称", "用户", "创建时间", "时长", "状态", "标签", "共享", "音频文件", "转写段数", "问答数", "会议提纲状态"]];

for (let index = 0; index < recordings.length; index += 1) {
  const recording = recordings[index];
  const owner = recording.ownerName || recording.ownerClientId || "unknown-user";
  const folderName = safeName(`${String(index + 1).padStart(2, "0")}-${String(recording.seq || "000").padStart(3, "0")}-${recording.name || recording.id}-${owner}`);
  const folder = path.join(packageDir, folderName);
  await mkdir(folder, { recursive: true });

  const segments = (db.transcriptSegments || []).filter((segment) => segment.recordingId === recording.id);
  const qaMessages = (db.qaMessages || []).filter(
    (message) => message.recordingId === recording.id || (Array.isArray(message.recordingIds) && message.recordingIds.includes(recording.id)),
  );
  const sourceAudio = resolveFile(recording.storagePath);
  const audioExt = path.extname(sourceAudio || recording.fileName || "") || ".mp3";
  const audioFile = `audio${audioExt}`;
  const audioCopied = await copyIfExists(sourceAudio, path.join(folder, audioFile));
  if (!audioCopied) await writeFile(path.join(folder, "MISSING_AUDIO.txt"), `未找到音频文件：${recording.storagePath || recording.fileName || "无路径"}\n`, "utf8");

  if (!(await copyIfExists(recording.transcriptPath, path.join(folder, "transcript.txt")))) {
    await writeFile(path.join(folder, "transcript.generated.txt"), transcriptText(recording, segments), "utf8");
  }
  await copyIfExists(recording.transcriptRawPath, path.join(folder, "transcript.raw.txt"));
  await copyIfExists(recording.transcriptCorrectedPath, path.join(folder, "transcript.corrected.txt"));
  await copyIfExists(recording.transcriptionMetaPath, path.join(folder, "transcription-meta.json"));

  if (recording.meetingOutline) {
    await writeFile(path.join(folder, "meeting-outline.json"), `${JSON.stringify(recording.meetingOutline, null, 2)}\n`, "utf8");
  }
  if (qaMessages.length) {
    await writeFile(path.join(folder, "qa-messages.json"), `${JSON.stringify(qaMessages, null, 2)}\n`, "utf8");
  }

  const metadata = {
    id: recording.id,
    seq: recording.seq,
    name: recording.name,
    ownerName: recording.ownerName || "",
    ownerClientId: recording.ownerClientId || "",
    createdAt: recording.createdAt || "",
    createdDateShanghai: dateKeyInShanghai(recording.createdAt),
    updatedAt: recording.updatedAt || "",
    durationMs: recording.durationMs || 0,
    duration: formatDuration(recording.durationMs),
    status: recording.status || "",
    tag: recording.tag || "",
    shared: recording.shared !== false,
    sharedAt: recording.sharedAt || "",
    source: recording.source || "",
    mimeType: recording.mimeType || "",
    size: recording.size || 0,
    transcriptProvider: recording.transcriptProvider || "",
    transcriptSource: recording.transcriptSource || "",
    transcribedAt: recording.transcribedAt || "",
    transcriptSegmentCount: segments.length,
    qaMessageCount: qaMessages.length,
    meetingOutlineStatus: recording.meetingOutlineStatus || "",
    meetingOutlinedAt: recording.meetingOutlinedAt || "",
    audioIncluded: audioCopied,
  };
  await writeFile(path.join(folder, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  summaries.push({ ...metadata, folder: folderName, audioFile: audioCopied ? audioFile : "" });
  csvRows.push([
    recording.seq || "",
    recording.id,
    recording.name || "",
    recording.ownerName || recording.ownerClientId || "",
    recording.createdAt || "",
    formatDuration(recording.durationMs),
    recording.status || "",
    recording.tag || "",
    recording.shared !== false ? "是" : "否",
    audioCopied ? audioFile : "未找到",
    segments.length,
    qaMessages.length,
    recording.meetingOutlineStatus || "",
  ]);
}

const totalDurationMs = summaries.reduce((sum, item) => sum + Number(item.durationMs || 0), 0);
const index = {
  generatedAt: new Date().toISOString(),
  date: targetDate,
  timezone: "Asia/Shanghai",
  scope: "all users, non-deleted recordings",
  recordingCount: summaries.length,
  totalDurationMs,
  totalDuration: formatDuration(totalDurationMs),
  recordings: summaries,
};
await writeFile(path.join(packageDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
await writeFile(path.join(packageDir, "index.csv"), `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");
await writeFile(
  path.join(packageDir, "README.txt"),
  [
    `打包日期：${targetDate}`,
    "时区：Asia/Shanghai",
    "范围：所有用户今天创建且未删除的录音。",
    `录音数量：${summaries.length}`,
    `总时长：${formatDuration(totalDurationMs)}`,
    "每条录音文件夹包含：audio.mp3、transcript.txt 或 transcript.generated.txt、metadata.json、meeting-outline.json（如有）、qa-messages.json（如有）。",
    "",
  ].join("\n"),
  "utf8",
);

const packageSizeBytes = existsSync(packageDir) ? statSync(packageDir).size : 0;
console.log(JSON.stringify({ ok: true, packageDir, recordingCount: summaries.length, totalDurationMs, totalDuration: formatDuration(totalDurationMs), packageSizeBytes }));
