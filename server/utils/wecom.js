import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import logger from "./log.js";
import { projectRoot } from "../config.js";
import { redisClient } from "../plugins/redis.js";

const WECOM_ACCESS_TOKEN_KEY = "wecom:access-token";
const WECOM_ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS = 120;
const wecomSessionSecret =
  process.env.WECOM_SESSION_SECRET ||
  crypto.createHash("sha256").update(`${projectRoot}:wecom-session`).digest("hex");
const WECOM_SESSION_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.WECOM_SESSION_TTL_MS || 24 * 60 * 60 * 1000));

export function signWecomIdentity(identity = {}) {
  const payload = {
    appUserId: String(identity.appUserId || "").trim(),
    wecomUserId: String(identity.wecomUserId || identity.userId || "").trim(),
    name: String(identity.name || "").trim().slice(0, 120),
    expiresAt: Date.now() + WECOM_SESSION_TTL_MS,
  };
  if (!payload.appUserId || !payload.wecomUserId || !payload.name) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", wecomSessionSecret).update(body).digest("base64url");
  return { token: `${body}.${signature}`, expiresAt: payload.expiresAt };
}

export function parseWecomIdentityToken(token = "") {
  const raw = String(token || "").trim();
  if (!raw.includes(".")) return null;
  const [body, signature = ""] = raw.split(".");
  const expected = crypto.createHmac("sha256", wecomSessionSecret).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.appUserId || !payload?.wecomUserId || !payload?.name || Number(payload.expiresAt || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requestWecomIdentity(request) {
  const token = String(request.get("x-wecom-auth-token") || "").trim();
  return parseWecomIdentityToken(token);
}

export function wecomOwnerClientId(identity = {}) {
  const userId = String(identity.wecomUserId || identity.userId || "").trim();
  return userId ? `wecom-${userId}`.slice(0, 120) : "";
}

export function getWecomConfig() {
  return {
    appid: process.env.WECOM_CORP_ID || "",
    agentid: process.env.WECOM_AGENT_ID || "",
    corpSecret: process.env.WECOM_APP_SECRET || "",
    redirectUri: String(process.env.WECOM_REDIRECT_URI).trim(),
  };
}

export async function getWecomAccessToken() {
  logger.info("[call] getWecomAccessToken step 0", {
    message: "Enterprise WeChat access token lookup started",
    redisReady: redisClient.isReady,
  });
  if (!redisClient.isReady) {
    logger.error("[call] getWecomAccessToken step 1", {
      message: "Enterprise WeChat access token lookup failed: Redis is unavailable",
      reason: "redis_unavailable",
    });
    throw new Error("Redis 未就绪，无法读取或保存企业微信 access_token");
  }

  const cachedToken = String((await redisClient.get(WECOM_ACCESS_TOKEN_KEY)) || "").trim();
  if (cachedToken) {
    const ttlSeconds = await redisClient.ttl(WECOM_ACCESS_TOKEN_KEY);
    logger.info("[call] getWecomAccessToken step 2", {
      message: "Enterprise WeChat access token loaded from Redis",
      ttlSeconds,
    });
    return cachedToken;
  }

  const appid = process.env.WECOM_CORP_ID || "";
  const corpSecret = process.env.WECOM_APP_SECRET || "";
  if (!appid || !corpSecret) {
    logger.warn("[call] getWecomAccessToken step 3", {
      message: "Enterprise WeChat access token request skipped: configuration is missing",
      hasCorpId: Boolean(appid),
      hasCorpSecret: Boolean(corpSecret),
    });
    return "";
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(appid)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  logger.info("[call] getWecomAccessToken step 4", {
    message: "Enterprise WeChat access token API request started",
    corpId: appid,
  });

  let response;
  let payload;
  try {
    response = await fetch(url);
    payload = await response.json();
  } catch (error) {
    logger.error("[call] getWecomAccessToken step 5", {
      message: "Enterprise WeChat access token API transport failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!response.ok || payload.errcode) {
    logger.error("[call] getWecomAccessToken step 6", {
      message: "Enterprise WeChat access token API request rejected",
      httpStatus: response.status,
      errcode: payload.errcode,
      errmsg: payload.errmsg || "",
    });
    throw new Error(payload.errmsg || `企业微信 access_token 获取失败（HTTP ${response.status}）`);
  }

  if (!payload.access_token) {
    logger.error("[call] getWecomAccessToken step 7", {
      message: "Enterprise WeChat access token API response is invalid",
      httpStatus: response.status,
      expiresIn: payload.expires_in,
    });
    throw new Error("企业微信 access_token 响应缺少 access_token");
  }

  const ttlSeconds = Math.max(
    1,
    Math.floor(Number(payload.expires_in || 7200) - WECOM_ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS),
  );
  await redisClient.set(WECOM_ACCESS_TOKEN_KEY, String(payload.access_token), {
    EX: ttlSeconds,
  });
  logger.info("[call] getWecomAccessToken step 8", {
    message: "Enterprise WeChat access token persisted in Redis",
    ttlSeconds,
  });
  return String(payload.access_token);
}

export async function getWecomUserByCode(code) {
  logger.info("call getWecomUserByCode: ", { message: "start get access token" });
  const token = await getWecomAccessToken();
  if (!token || !code) return null;
  // 使用企业微信 OAuth code 获取当前登录用户的 UserId 或 OpenId。
  const identityResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
  );
  const identity = await identityResponse.json();
  if (identity.errcode) throw new Error(identity.errmsg || "企业微信用户身份获取失败");

  const userId = identity.UserId || identity.userid || "";
  if (!userId) {
    return {
      userId: "",
      openUserId: identity.OpenId || identity.open_userid || "",
      name: identity.name || "",
      department: "",
      departments: [],
    };
  }
  return getWecomUserByUserId(userId, token);
}

export async function getWecomUserByUserId(userId, accessToken = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const token = accessToken || (await getWecomAccessToken());
  if (!token) return null;
  // 使用 UserId 获取企业通讯录中的成员姓名、部门等详细资料。
  const userResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(normalizedUserId)}`,
  );
  const user = await userResponse.json();
  if (user.errcode) throw new Error(user.errmsg || "企业微信成员信息获取失败");

  return {
    userId: normalizedUserId,
    openUserId: user.open_userid || "",
    name: user.name || user.alias || normalizedUserId,
    department: Array.isArray(user.department) ? user.department.join(",") : "",
    departments: Array.isArray(user.department) ? user.department : [],
    departmentOrder: Array.isArray(user.order) ? user.order : [],
    avatar: user.avatar || user.thumb_avatar || "",
    mobile: user.mobile || "",
    email: user.email || user.biz_mail || "",
    position: user.position || "",
    externalPosition: user.external_position || "",
    gender: user.gender || "",
    status: user.status || "",
    qrCode: user.qr_code || "",
    alias: user.alias || "",
  };
}

export async function getWecomDepartmentIds(parentDepartmentId = "") {
  const normalizedParentDepartmentId =
    String(parentDepartmentId || "").trim() === ""
      ? ""
      : Number(parentDepartmentId);
  if (
    normalizedParentDepartmentId !== "" &&
    (!Number.isInteger(normalizedParentDepartmentId) || normalizedParentDepartmentId <= 0)
  ) {
    throw new Error("id 必须是大于 0 的整数");
  }

  logger.info("[call] getWecomDepartmentIds step 0", {
    message: "Enterprise WeChat department ID lookup started",
    hasParentDepartmentId: normalizedParentDepartmentId !== "",
    parentDepartmentId: normalizedParentDepartmentId,
  });
  const token = await getWecomAccessToken();
  if (!token) {
    logger.warn("[call] getWecomDepartmentIds step 1", {
      message: "Enterprise WeChat department ID lookup skipped: access token is unavailable",
      reason: "missing_access_token",
    });
    throw new Error("企业微信应用未配置或 access_token 获取失败");
  }

  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/department/simplelist");
  url.searchParams.set("access_token", token);
  if (normalizedParentDepartmentId !== "") {
    url.searchParams.set("id", String(normalizedParentDepartmentId));
  }
  const response = await fetch(url);
  const payload = await response.json();

  
  logger.info("[call] getWecomDepartmentIds simplelist response, ", {message: `typeof: ${typeof payload}, keys: ${JSON.stringify(Object.keys(payload))}`})
  if (!response.ok || payload.errcode !== 0) {
    logger.warn("[call] getWecomDepartmentIds step 2", {
      message: "Enterprise WeChat department ID lookup rejected",
      hasParentDepartmentId: normalizedParentDepartmentId !== "",
      parentDepartmentId: normalizedParentDepartmentId,
      httpStatus: response.status,
      errcode: Number(payload.errcode || 0),
      errmsg: String(payload.errmsg || ""),
    });
    throw new Error(
      `企业微信错误 ${Number(payload.errcode || 0)}：${payload.errmsg || `部门 ID 列表获取失败（HTTP ${response.status}）`}`,
    );
  }

  const departmentIds = Array.isArray(payload.department_id) ? payload.department_id : [];
  logger.info("[call] getWecomDepartmentIds step 3", {
    message: "Enterprise WeChat department ID lookup completed",
    hasParentDepartmentId: normalizedParentDepartmentId !== "",
    parentDepartmentId: normalizedParentDepartmentId,
    departmentCount: departmentIds.length,
  });
  return departmentIds.map((department) => ({
    id: Number(department.id || 0),
    parentid: Number(department.parentid || 0),
    order: Number(department.order || 0),
  }));
}

export async function getWecomDepartmentMembers(departmentId, fetchChild = false) {
  const normalizedDepartmentId = Number(departmentId);
  if (!Number.isInteger(normalizedDepartmentId) || normalizedDepartmentId <= 0) {
    throw new Error("department_id 必须是大于 0 的整数");
  }

  logger.info("[call] getWecomDepartmentMembers step 0", {
    message: "Enterprise WeChat department member lookup started",
    departmentId: normalizedDepartmentId,
    fetchChild: Boolean(fetchChild),
  });
  const token = await getWecomAccessToken();
  if (!token) {
    logger.warn("[call] getWecomDepartmentMembers step 1", {
      message: "Enterprise WeChat department member lookup skipped: access token is unavailable",
      departmentId: normalizedDepartmentId,
      reason: "missing_access_token",
    });
    throw new Error("企业微信应用未配置或 access_token 获取失败");
  }

  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/user/simplelist");
  url.searchParams.set("access_token", token);
  url.searchParams.set("department_id", String(normalizedDepartmentId));
  url.searchParams.set("fetch_child", fetchChild ? "1" : "0");
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.errcode !== 0) {
    logger.warn("[call] getWecomDepartmentMembers step 2", {
      message: "Enterprise WeChat department member lookup rejected",
      departmentId: normalizedDepartmentId,
      fetchChild: Boolean(fetchChild),
      httpStatus: response.status,
      errcode: Number(payload.errcode || 0),
      errmsg: String(payload.errmsg || ""),
    });
    throw new Error(payload.errmsg || `企业微信部门成员获取失败（HTTP ${response.status}）`);
  }

  const userlist = Array.isArray(payload.userlist) ? payload.userlist : [];
  logger.info("[call] getWecomDepartmentMembers step 3", {
    message: "Enterprise WeChat department member lookup completed",
    departmentId: normalizedDepartmentId,
    fetchChild: Boolean(fetchChild),
    memberCount: userlist.length,
  });
  return userlist.map((member) => ({
    userid: String(member.userid || ""),
    name: String(member.name || ""),
    department: Array.isArray(member.department) ? member.department : [],
    open_userid: String(member.open_userid || ""),
  }));
}

export async function uploadWecomTemporaryFile(filePath, fileName, contentType = "application/octet-stream") {
  const token = await getWecomAccessToken();
  if (!token) throw new Error("企业微信文件分享未配置，请先设置企业微信应用密钥。");

  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("media", new Blob([buffer], { type: contentType }), fileName);

  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=file`,
    {
      method: "POST",
      body: form,
    },
  );
  const payload = await response.json().catch(async () => ({ errmsg: await response.text().catch(() => "") }));
  if (!response.ok || payload.errcode) {
    throw new Error(payload.errmsg || "企业微信 MP3 文件上传失败");
  }
  const mediaId = String(payload.media_id || payload.mediaId || "").trim();
  if (!mediaId) throw new Error("企业微信 MP3 文件上传失败，未返回文件素材。");
  return {
    mediaId,
    createdAt: payload.created_at || "",
    type: payload.type || "file",
  };
}

export function hasWecomConfig() {
  const config = getWecomConfig();
  return Boolean(config.appid && config.agentid && config.corpSecret && config.redirectUri);
}
