import req from "../utils/request.js";

async function requestWecom(config) {
  try {
    return await req.request(config);
  } catch (error) {
    const payload = error.response?.data;
    const message =
      (typeof payload === "string" ? payload : payload?.error || payload?.message) ||
      error.message ||
      "企业微信登录请求失败";
    throw new Error(message, { cause: error });
  }
}

export function getWecomLoginConfig() {
  return requestWecom({
    method: "GET",
    url: "/api/wecom/login-config",
  });
}

export function getWecomOAuthUrl(redirect, state) {
  return requestWecom({
    method: "GET",
    url: "/api/wecom/oauth-url",
    params: { redirect, state },
  });
}

export function exchangeWecomCode(code) {
  return requestWecom({
    method: "GET",
    url: "/api/wecom/me",
    params: { code },
  });
}

export function updateWecomProfile(profile, authToken) {
  return requestWecom({
    method: "PUT",
    url: "/api/profile",
    data: profile,
    headers: authToken ? { "X-WeCom-Auth-Token": authToken } : undefined,
  });
}
