import req from "../utils/request.js";

export function getWeChatJsSdkConfig(url) {
  return req.get("/api/wechat/js-sdk-config", { params: { url } });
}
