// 说明：从输入载荷中解析出后续流程需要的数据。
export function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// 说明：封装 firstEnv 的业务规则，供路由或后台任务复用。
export function firstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

// 说明：封装 splitEnvList 的业务规则，供路由或后台任务复用。
export function splitEnvList(value = "") {
  return String(value || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function envFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export function firstNonEmptyValue(values = []) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return value;
  }
  return "";
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

export function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeTtsText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1800);
}

export function detectTtsAudioFormat(buffer, fallbackExt = "mp3") {
  const signature = buffer.subarray(0, 12).toString("ascii");
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WAVE") {
    return { ext: "wav", contentType: "audio/wav" };
  }
  if (signature.startsWith("ID3") || buffer[0] === 0xff) {
    return { ext: "mp3", contentType: "audio/mpeg" };
  }
  if (signature.startsWith("OggS")) {
    return { ext: "ogg", contentType: "audio/ogg" };
  }
  if (signature.startsWith("fLaC")) {
    return { ext: "flac", contentType: "audio/flac" };
  }
  if (fallbackExt === "wav") return { ext: "wav", contentType: "audio/wav" };
  if (fallbackExt === "ogg") return { ext: "ogg", contentType: "audio/ogg" };
  if (fallbackExt === "flac") return { ext: "flac", contentType: "audio/flac" };
  return { ext: "mp3", contentType: "audio/mpeg" };
}

export function userSafeErrorMessage(error, fallback = "操作失败，请稍后重试。") {
  const raw = String(error instanceof Error ? error.message : error || "");
  if (!raw) return fallback;

  if (/EPERM|EBUSY|EACCES|ENOENT|rename|db\.json|\.tmp|Cannot POST|DOCTYPE|<html|JSON parse|Bad control character|Expected .*JSON|tool_calls|DSML|parameter name=/i.test(raw)) {
    return fallback;
  }

  return raw.slice(0, 120);
}

export function userSafeTranscriptionError(error) {
  const raw = String(error instanceof Error ? error.message : error || "");
  if (/EPERM|EBUSY|EACCES|ENOENT|rename|db\.json|\.tmp/i.test(raw)) {
    return "系统正在保存数据，请稍后点击重新转写。";
  }
  if (/timed out|timeout|429|rate|limit|busy|network|fetch|ECONN|ETIMEDOUT/i.test(raw)) {
    return "转写服务暂时繁忙，请稍后点击重新转写。";
  }
  return "转写失败，请稍后点击重新转写。";
}

/**
 * 判断当前请求用户是否拥有删除全部录音的权限。
 *
 * 当前产品已关闭该特殊权限，因此始终返回 false。保留独立函数作为统一的
 * 权限入口，后续若恢复该能力，应在这里接入可信的服务端身份判断，不能依赖
 * 客户端传入的请求头或查询参数。
 *
 * @returns {boolean} 当前固定返回 false。
 */
export function canDeleteAllRecordings() {
  return false;
}

/**
 * 判断指定客户端是否可以读取一条录音。
 *
 * 无归属人的历史录音保持可读；有归属人的录音仅对所有者或明确共享的用户
 * 可读。`shared` 只有显式设为 false 时才视为未共享，以兼容旧数据。
 *
 * @param {object|null|undefined} recording 录音数据。
 * @param {unknown} clientId 当前访问者的客户端 ID。
 * @returns {boolean} 当前访问者是否具有读取权限。
 */
export function canReadRecording(recording, clientId) {
  if (!recording) return false;
  const ownerClientId = String(recording.ownerClientId || "").trim();
  const viewerClientId = String(clientId || "").trim();
  return !ownerClientId || ownerClientId === viewerClientId || recording.shared !== false;
}
