import crypto from "node:crypto";
import { projectRoot } from "../config.js";

const accountTokenSecret =
  process.env.ACCOUNT_TOKEN_SECRET ||
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(`${projectRoot}:account-token`).digest("hex");

/** 使用服务端密钥为账号登录载荷签名。 */
export function signAccountToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", accountTokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** 校验并解析账号 Token；签名无效或 Token 过期时返回 null。 */
export function parseAccountToken(token = "") {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [body, signature = ""] = raw.split(".");
  const expected = crypto.createHmac("sha256", accountTokenSecret).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.accountId || Number(payload.expiresAt || 0) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 从 Express 请求头或查询参数中读取账号 Token。 */
export function requestAccountToken(request) {
  return String(
    request.get("x-auth-token") ||
      request.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      request.query?.authToken ||
      "",
  ).trim();
}

/** 获取当前请求中已经校验通过的账号载荷。 */
export function requestAccountPayload(request) {
  return parseAccountToken(requestAccountToken(request));
}
