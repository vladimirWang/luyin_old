import { getWeChatJsSdkConfig } from "../api/wechat.js";

const WECHAT_JS_SDK_URL = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";

function loadWeChatJsSdk() {
  if (window.wx?.config) return Promise.resolve(window.wx);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${WECHAT_JS_SDK_URL}"]`);
    const script = existing || document.createElement("script");
    const handleLoad = () => (window.wx?.config ? resolve(window.wx) : reject(new Error("微信 JS-SDK 加载失败")));
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("微信 JS-SDK 加载失败")), { once: true });
    if (!existing) {
      script.src = WECHAT_JS_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function updateWeChatShareData(wx, method, data) {
  return new Promise((resolve, reject) => {
    wx[method]({
      ...data,
      success: resolve,
      fail: (error) => reject(new Error(error?.errMsg || "微信分享配置失败")),
    });
  });
}

export async function configureWeChatAudioLinkShare({ title, description, link, imageUrl = "" }) {
  const wx = await loadWeChatJsSdk();
  const pageUrl = window.location.href.split("#")[0];
  const config = await getWeChatJsSdkConfig(pageUrl);
  if (!config?.configured) throw new Error("微信分享未配置，请设置微信公众号参数");

  await new Promise((resolve, reject) => {
    wx.ready(resolve);
    wx.error((error) => reject(new Error(error?.errMsg || "微信 JS-SDK 签名校验失败")));
    wx.config({
      debug: false,
      appId: config.appId,
      timestamp: config.timestamp,
      nonceStr: config.nonceStr,
      signature: config.signature,
      jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"],
    });
  });

  await Promise.all([
    updateWeChatShareData(wx, "updateAppMessageShareData", {
      title,
      desc: description,
      link,
      imgUrl: imageUrl,
    }),
    updateWeChatShareData(wx, "updateTimelineShareData", {
      title,
      link,
      imgUrl: imageUrl,
    }),
  ]);
}
