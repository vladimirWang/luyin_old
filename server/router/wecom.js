import express from "express";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/login-config", (request, response) => {
  const { wecomConfig } = dependencies;
  const config = wecomConfig();
  response.json({
    configured: Boolean(config.appid && config.agentid && config.corpSecret),
    appid: config.appid || "",
    agentid: config.agentid || "",
  });
});

router.get("/oauth-url", (request, response) => {
  const { wecomConfig } = dependencies;
  const config = wecomConfig();
  if (!config.appid || !config.corpSecret) {
    response.json({ configured: false });
    return;
  }

  const redirect = String(request.query.redirect || `${request.protocol}://${request.get("host")}/`);
  const url =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(config.appid)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    "&response_type=code&scope=snsapi_base&state=wecom_recorder" +
    (config.agentid ? `&agentid=${encodeURIComponent(config.agentid)}` : "") +
    "#wechat_redirect";
  response.json({ configured: true, url });
});

router.get("/me", async (request, response, next) => {
  const { hasWecomConfig, getWecomUserByCode } = dependencies;
  try {
    const code = String(request.query.code || "").trim();
    if (!code || !hasWecomConfig()) {
      response.json({ configured: hasWecomConfig(), authenticated: false, user: null });
      return;
    }

    const user = await getWecomUserByCode(code);
    response.json({ configured: true, authenticated: Boolean(user?.name), user });
  } catch (error) {
    next(error);
  }
});

export default router;
