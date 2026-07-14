import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ffmpegCommand() {
  const configured = env("FFMPEG_PATH", env("FFMPEG_BIN", ""));
  if (configured) return configured;
  if (process.platform !== "win32" && existsSync("/usr/bin/ffmpeg")) return "/usr/bin/ffmpeg";
  return ffmpegStaticPath?.default || "ffmpeg";
}

function ffprobeCommand() {
  const configured = env("FFPROBE_PATH", env("FFPROBE_BIN", ""));
  if (configured) return configured;
  if (process.platform !== "win32" && existsSync("/usr/bin/ffprobe")) return "/usr/bin/ffprobe";
  const ffmpegPath = ffmpegCommand();
  const sibling = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  if (sibling !== ffmpegPath && existsSync(sibling)) return sibling;
  return "ffprobe";
}

function ffmpegTimeoutMs() {
  const defaultTimeoutMs = 2 * 60 * 60 * 1000;
  let timeoutMs = numeric(env("STORAGE_FFMPEG_TIMEOUT_MS", env("ASR_FFMPEG_TIMEOUT_MS", String(defaultTimeoutMs))), defaultTimeoutMs);
  if (timeoutMs > 0 && timeoutMs < 1000) timeoutMs *= 1000;
  return timeoutMs;
}

function runProcess(command, args, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback();
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGKILL");
            finish(() => reject(new Error(`${command} timeout`)));
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(() => reject(error.code === "ENOENT" ? new Error("ffmpeg is not installed") : error));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve(options.includeStderr ? `${stdout}\n${stderr}` : stdout);
          return;
        }
        reject(new Error(`${command} failed (${code}): ${(stderr || stdout).slice(-1200)}`));
      });
    });
  });
}

function ffmpegBaseArgs() {
  return ["-nostdin", "-hide_banner", "-loglevel", "error"];
}

function concatFileLine(filePath) {
  return `file '${path.resolve(filePath).replace(/'/g, "'\\''")}'`;
}

async function assertAudioFile(filePath) {
  const info = await stat(filePath);
  if (!info.size) throw new Error("converted audio is empty");
  return info;
}

function appendFileToStream(sourcePath, output) {
  return new Promise((resolve, reject) => {
    const input = createReadStream(sourcePath);
    const onError = (error) => {
      input.destroy();
      reject(error);
    };
    input.once("error", onError);
    output.once("error", onError);
    input.once("end", () => {
      output.off("error", onError);
      resolve();
    });
    input.pipe(output, { end: false });
  });
}

async function concatenateFiles(sourcePaths, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const output = createWriteStream(targetPath);
  try {
    for (const sourcePath of sourcePaths) {
      await appendFileToStream(sourcePath, output);
    }
    await new Promise((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
      output.end();
    });
    await assertAudioFile(targetPath);
  } catch (error) {
    output.destroy();
    await rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }
}

function enoughDuration(actualMs, expectedMs) {
  if (!expectedMs || expectedMs <= 0) return true;
  if (!actualMs || actualMs <= 0) return false;
  return actualMs >= Math.max(1000, expectedMs * 0.8);
}

export async function convertAudioFileToMp3(sourcePath, targetPath) {
  logger.info("[CALL] convertAudioFileToMp3 ", {message: `sourcePath: ${sourcePath}, targetPath: ${targetPath}`})
  await mkdir(path.dirname(targetPath), { recursive: true });
  const bitrate = env("STORAGE_MP3_BITRATE", "96k");
  const sampleRate = env("STORAGE_MP3_SAMPLE_RATE", "16000");
  const inputArgs = /^https?:\/\//i.test(String(sourcePath || ""))
    ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_at_eof", "1", "-reconnect_delay_max", "5"]
    : [];
  try {
    await runProcess(
      ffmpegCommand(),
      [
        "-y",
        ...ffmpegBaseArgs(),
        "-fflags",
        "+genpts",
        ...inputArgs,
        "-i",
        sourcePath,
        "-vn",
        "-ar",
        sampleRate,
        "-ac",
        "1",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        targetPath,
      ],
      ffmpegTimeoutMs(),
    );
    await assertAudioFile(targetPath);
    logger.info("[CALL] convertAudioFileToMp3 ", {message: "success"})
  } catch (error) {
    logger.error("[CALL] convertAudioFileToMp3 ", {message: `error: ${error.message}`})
    throw error;
  }
}

export async function mergeAudioFilesToMp3(sourcePaths, targetPath) {
  logger.info("[CALL] mergeAudioFilesToMp3 ", {message: `sourcePaths: ${sourcePaths.length} files, targetPath: ${targetPath}`})
  const validPaths = sourcePaths.filter(Boolean);
  if (validPaths.length === 0) {
    logger.error("[CALL] mergeAudioFilesToMp3 ", {message: "missing audio segments"})
    throw new Error("missing audio segments");
  }
  if (validPaths.length === 1) {
    await convertAudioFileToMp3(validPaths[0], targetPath);
    logger.info("[CALL] mergeAudioFilesToMp3 ", {message: "single file, converted directly"})
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempDir = `${targetPath}.parts-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(tempDir, { recursive: true });

  try {
    const standaloneDurations = await Promise.all(validPaths.map((filePath) => probeAudioDurationMs(filePath)));
    const standaloneDurationSum = standaloneDurations.reduce((sum, durationMs) => sum + Math.max(0, durationMs), 0);
    const hasMultipleStandaloneSegments = standaloneDurations.filter((durationMs) => durationMs > 0).length > 1;
    const joinedPath = path.join(tempDir, "joined-input");
    try {
      await concatenateFiles(validPaths, joinedPath);
      await convertAudioFileToMp3(joinedPath, targetPath);
      const joinedDurationMs = await probeAudioDurationMs(targetPath);
      if (hasMultipleStandaloneSegments && !enoughDuration(joinedDurationMs, standaloneDurationSum)) {
        throw new Error("raw concatenation only preserved part of the standalone audio files");
      }
      logger.info("[CALL] mergeAudioFilesToMp3 ", {message: "success with raw concatenation"})
      return;
    } catch {
      logger.warn("[CALL] mergeAudioFilesToMp3 ", {message: "raw concatenation failed, falling back to mp3 concat"})
      await rm(targetPath, { force: true }).catch(() => {});
    }

    const convertedPaths = [];
    for (let index = 0; index < validPaths.length; index += 1) {
      const partPath = path.join(tempDir, `${String(index + 1).padStart(4, "0")}.mp3`);
      await convertAudioFileToMp3(validPaths[index], partPath);
      convertedPaths.push(partPath);
    }

    const concatListPath = path.join(tempDir, "concat.txt");
    await writeFile(concatListPath, `${convertedPaths.map(concatFileLine).join("\n")}\n`, "utf8");
    await runProcess(
      ffmpegCommand(),
      ["-y", ...ffmpegBaseArgs(), "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", targetPath],
      ffmpegTimeoutMs(),
    );
    await assertAudioFile(targetPath);
    logger.info("[CALL] mergeAudioFilesToMp3 ", {message: "success with mp3 concat"})
  } catch (error) {
    logger.error("[CALL] mergeAudioFilesToMp3 ", {message: `error: ${error.message}`})
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 用来读取音频文件的实际时长，并统一返回毫秒数
 * @param {*} filePath 
 * @returns number
 */
export async function probeAudioDurationMs(filePath) {
  try {
    const output = await runProcess(
      ffprobeCommand(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      ffmpegTimeoutMs(),
    );
    const seconds = Number(String(output || "").trim());
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  } catch {
    // Keep the upload path resilient when ffprobe is unavailable.
  }
  try {
    const output = await runProcess(
      ffmpegCommand(),
      ["-nostdin", "-hide_banner", "-loglevel", "info", "-i", filePath, "-t", "0.1", "-f", "null", "-"],
      ffmpegTimeoutMs(),
      { includeStderr: true },
    );
    const match = String(output || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (match) {
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2] || 0);
      const seconds = Number(match[3] || 0);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      if (Number.isFinite(totalSeconds) && totalSeconds > 0) return Math.round(totalSeconds * 1000);
    }
  } catch {
    // Keep the upload path resilient when ffmpeg cannot inspect duration.
  }
  return 0;
}

export async function fileInfo(filePath) {
  const info = await stat(filePath);
  return { size: info.size };
}

export function transcriptTextFromSegments(recording, segments = []) {
  return segments
    .map((segment) => {
      const start = Math.floor(Math.max(0, segment.startMs || 0) / 1000);
      const minutes = String(Math.floor(start / 60)).padStart(2, "0");
      const seconds = String(start % 60).padStart(2, "0");
      const speaker = segment.speakerName || segment.speakerKey || recording.speakerName || "speaker-1";
      return `[${minutes}:${seconds}] ${speaker}: ${segment.text || ""}`;
    })
    .join("\n");
}

export async function writeTranscriptTextFile(recording, segments, transcriptPath) {
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  const text = transcriptTextFromSegments(recording, segments);
  await writeFile(transcriptPath, `${text}\n`, "utf8");
  return text;
}

export async function readTextFile(filePath) {
  return readFile(filePath, "utf8");
}
