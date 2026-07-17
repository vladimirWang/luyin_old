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
