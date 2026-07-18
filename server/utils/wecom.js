import { readFile } from "node:fs/promises";
import logger from "./log.js";

let wecomTokenCache = { value: "", expiresAt: 0 };

export function getWecomConfig() {
  return {
    appid: process.env.WECOM_CORP_ID || "",
    agentid: process.env.WECOM_AGENT_ID || "",
    corpSecret: process.env.WECOM_APP_SECRET || "",
    redirectUri: String(process.env.WECOM_REDIRECT_URI).trim(),
  };
}

export async function getWecomAccessToken() {
  const now = Date.now();
  if (wecomTokenCache.value && wecomTokenCache.expiresAt > now + 60000) {
    logger.debug("wecom.access_token.cache_hit", {
      expiresInSeconds: Math.floor((wecomTokenCache.expiresAt - now) / 1000),
    });
    return wecomTokenCache.value;
  }

  const appid = process.env.WECOM_CORP_ID || "";
  const corpSecret = process.env.WECOM_APP_SECRET || "";
  if (!appid || !corpSecret) {
    logger.warn("wecom.access_token.config_missing", {
      hasCorpId: Boolean(appid),
      hasCorpSecret: Boolean(corpSecret),
    });
    return "";
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(appid)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  logger.info("wecom.access_token.request_started", { corpId: appid });

  let response;
  let payload;
  try {
    response = await fetch(url);
    payload = await response.json();
  } catch (error) {
    logger.error("wecom.access_token.request_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!response.ok || payload.errcode) {
    logger.error("wecom.access_token.api_error", {
      httpStatus: response.status,
      errcode: payload.errcode,
      errmsg: payload.errmsg || "",
    });
    throw new Error(payload.errmsg || `企业微信 access_token 获取失败（HTTP ${response.status}）`);
  }

  if (!payload.access_token) {
    logger.error("wecom.access_token.invalid_response", {
      httpStatus: response.status,
      expiresIn: payload.expires_in,
    });
    throw new Error("企业微信 access_token 响应缺少 access_token");
  }

  wecomTokenCache = {
    value: payload.access_token,
    expiresAt: now + Math.max(300, Number(payload.expires_in || 7200) - 120) * 1000,
  };

  logger.info("wecom.access_token.request_succeeded", {
    expiresInSeconds: Math.floor((wecomTokenCache.expiresAt - now) / 1000),
  });
  return wecomTokenCache.value;
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
  // 使用 UserId 获取企业通讯录中的成员姓名、部门等详细资料。
  const userResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(userId)}`,
  );
  const user = await userResponse.json();
  if (user.errcode) throw new Error(user.errmsg || "企业微信成员信息获取失败");

  return {
    userId,
    openUserId: user.open_userid || "",
    name: user.name || user.alias || userId,
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