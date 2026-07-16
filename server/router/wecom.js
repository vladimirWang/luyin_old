import express from "express";
import logger from "../utils/log.js";
import { getWecomUserByCode, wecomConfig } from "../utils/wecom.js";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

function normalizeRedirectUri(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

router.get("/login-config", (request, response) => {
  const config = wecomConfig();
  const redirectUri = normalizeRedirectUri(config.redirectUri);
  response.json({
    configured: Boolean(config.appid && config.agentid && config.corpSecret && redirectUri),
    appid: config.appid || "",
    agentid: config.agentid || "",
    redirectUri,
  });
});

router.get("/oauth-url", (request, response) => {
  const config = wecomConfig();
  if (!config.appid || !config.corpSecret) {
    response.json({ configured: false });
    return;
  }

  const redirect = normalizeRedirectUri(config.redirectUri || request.query.redirect);
  if (!redirect) {
    response.status(500).json({ configured: false, error: "企业微信回调地址必须是无 # 片段的 HTTPS URL" });
    return;
  }
  const requestedState = String(request.query.state || "").trim();
  const state = /^[A-Za-z0-9._~-]{8,200}$/.test(requestedState) ? requestedState : "wecom_recorder";
  const url =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(config.appid)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}` +
    (config.agentid ? `&agentid=${encodeURIComponent(config.agentid)}` : "") +
    "#wechat_redirect";
  response.json({ configured: true, url });
});

router.get("/me", async (request, response, next) => {
  logger.info("request /wecom/me", { message: "start" });
  const { hasWecomConfig } = dependencies;
  try {
    const code = String(request.query.code || "").trim();
    if (!code || !hasWecomConfig()) {
      logger.info("request /wecom/me", {message: `code or hasWecomConfig not existed`})
      response.json({ configured: hasWecomConfig(), authenticated: false, user: null });
      return;
    }
    logger.info("request /wecom/me", {message: `start get user by code`})
    const user = await getWecomUserByCode(code);
    response.json({ configured: true, authenticated: Boolean(user?.name), user });
  } catch (error) {
    next(error);
  }
});

export default router;
