import crypto from "node:crypto";

let accessTokenCache = { value: "", expiresAt: 0 };
let jsApiTicketCache = { value: "", expiresAt: 0 };

export function getWeChatConfig() {
  return {
    appId: String(process.env.WECHAT_APP_ID || "").trim(),
    appSecret: String(process.env.WECHAT_APP_SECRET || "").trim(),
  };
}

export function createWeChatJsSdkSignature({ ticket, nonceStr, timestamp, url }) {
  const source = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return crypto.createHash("sha1").update(source).digest("hex");
}

async function getWeChatAccessToken() {
  const now = Date.now();
  if (accessTokenCache.value && accessTokenCache.expiresAt > now + 60_000) return accessTokenCache.value;

  const { appId, appSecret } = getWeChatConfig();
  if (!appId || !appSecret) return "";
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.errcode || !payload.access_token) {
    throw new Error(payload.errmsg || `WeChat access token request failed: ${response.status}`);
  }
  accessTokenCache = {
    value: payload.access_token,
    expiresAt: now + Math.max(300, Number(payload.expires_in || 7200) - 120) * 1000,
  };
  return accessTokenCache.value;
}

async function getWeChatJsApiTicket() {
  const now = Date.now();
  if (jsApiTicketCache.value && jsApiTicketCache.expiresAt > now + 60_000) return jsApiTicketCache.value;

  const accessToken = await getWeChatAccessToken();
  if (!accessToken) return "";
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${encodeURIComponent(accessToken)}&type=jsapi`,
  );
  const payload = await response.json();
  if (!response.ok || payload.errcode || !payload.ticket) {
    throw new Error(payload.errmsg || `WeChat JSAPI ticket request failed: ${response.status}`);
  }
  jsApiTicketCache = {
    value: payload.ticket,
    expiresAt: now + Math.max(300, Number(payload.expires_in || 7200) - 120) * 1000,
  };
  return jsApiTicketCache.value;
}

export async function createWeChatJsSdkConfig(pageUrl) {
  const { appId, appSecret } = getWeChatConfig();
  if (!appId || !appSecret) return { configured: false };

  const ticket = await getWeChatJsApiTicket();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    configured: true,
    appId,
    timestamp,
    nonceStr,
    signature: createWeChatJsSdkSignature({
      ticket,
      nonceStr,
      timestamp,
      url: pageUrl,
    }),
  };
}
