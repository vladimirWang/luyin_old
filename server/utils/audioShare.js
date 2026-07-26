import crypto from "node:crypto";
import { projectRoot } from "../config.js";

const audioDownloadTokenSecret =
  process.env.AUDIO_DOWNLOAD_TOKEN_SECRET ||
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(`${projectRoot}:audio-download`).digest("hex");

export function createAudioDownloadToken(recordingId, ttlMs = 30 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${recordingId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", audioDownloadTokenSecret).update(payload).digest("base64url");
  return `${expiresAt}.${signature}`;
}

export function hasValidAudioDownloadToken(token, recordingId) {
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
