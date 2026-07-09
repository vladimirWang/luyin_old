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