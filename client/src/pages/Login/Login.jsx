import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, saveLocalProfile } from "../../utils/index.js";

const CORP_ID = "ww0854a981ec186692";
const AGENT_ID = "1000058";
const OAUTH_STATE_KEY = "wecomLoginOAuthState";

let callbackRequest = null;

function createOAuthState() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isWeComClient() {
  return /wxwork/i.test(window.navigator.userAgent);
}

function getCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("code") || searchParams.has("state")) return searchParams;

  const hashQueryIndex = window.location.hash.indexOf("?");
  return hashQueryIndex >= 0
    ? new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1))
    : searchParams;
}

function getAuthorizeUrl() {
  const state = createOAuthState();
  window.sessionStorage.setItem(OAUTH_STATE_KEY, state);

  // OAuth providers append code/state to the query string. Keep the callback
  // outside the hash, then main.jsx will route it back to /#/login.
  const callbackUrl = `${window.location.origin}/`;
  const inWeCom = isWeComClient();
  const url = new URL(
    inWeCom
      ? "https://open.weixin.qq.com/connect/oauth2/authorize"
      : "https://open.work.weixin.qq.com/wwopen/sso/qrConnect",
  );
  url.searchParams.set("appid", CORP_ID);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("agentid", AGENT_ID);
  if (inWeCom) {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "snsapi_base");
    url.hash = "wechat_redirect";
  }
  return url.toString();
}

async function exchangeCode(code) {
  const payload = await api(`/api/wecom/me?code=${encodeURIComponent(code)}`);
  if (!payload.configured) throw new Error("服务端尚未配置企业微信应用 Secret");
  if (!payload.authenticated || !payload.user) throw new Error("未能获取企业微信用户身份");

  const user = payload.user;
  const profilePayload = {
    name: user.name || user.userId,
    company: "企业微信",
    department: user.department || "",
    wecomName: user.name || "",
    wecomUserId: user.userId || user.openUserId || "",
    wecomConfigured: true,
  };
  const profileResponse = await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify(profilePayload),
  });
  const profile = { ...profilePayload, ...(profileResponse.profile || {}) };
  saveLocalProfile(profile);
  return profile;
}

export default function Login() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = getCallbackParams();
    const code = params.get("code");
    if (!code) return;

    const returnedState = params.get("state") || "";
    const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY) || "";
    if (!expectedState || returnedState !== expectedState) {
      setError("登录校验失败，请重新发起企业微信登录");
      setStatus("error");
      return;
    }

    setStatus("loading");
    if (!callbackRequest) callbackRequest = exchangeCode(code);
    callbackRequest
      .then(() => {
        window.sessionStorage.removeItem(OAUTH_STATE_KEY);
        navigate("/user", { replace: true });
      })
      .catch((requestError) => {
        callbackRequest = null;
        setError(requestError instanceof Error ? requestError.message : "企业微信登录失败");
        setStatus("error");
      });
  }, [navigate]);

  function startLogin() {
    setError("");
    setStatus("redirecting");
    window.location.assign(getAuthorizeUrl());
  }

  const working = status === "loading" || status === "redirecting";
  const inWeCom = isWeComClient();

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="login-title">
        <div style={styles.logo}>企</div>
        <h1 id="login-title" style={styles.title}>企业微信登录</h1>
        <p style={styles.description}>使用企业成员身份登录录音工作台</p>
        <button type="button" style={styles.button} onClick={startLogin} disabled={working}>
          {working ? "正在登录…" : inWeCom ? "企业微信授权登录" : "使用企业微信扫码登录"}
        </button>
        {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#f5f7fa",
    color: "#17233d",
  },
  card: {
    width: "min(100%, 380px)",
    padding: "40px 28px",
    borderRadius: 20,
    background: "#fff",
    boxShadow: "0 18px 50px rgba(28, 49, 79, 0.10)",
    textAlign: "center",
  },
  logo: {
    width: 64,
    height: 64,
    margin: "0 auto 20px",
    display: "grid",
    placeItems: "center",
    borderRadius: 18,
    background: "#07c160",
    color: "#fff",
    fontSize: 30,
    fontWeight: 700,
  },
  title: { margin: 0, fontSize: 26 },
  description: { margin: "12px 0 28px", color: "#6b778c", lineHeight: 1.6 },
  button: {
    width: "100%",
    minHeight: 48,
    border: 0,
    borderRadius: 12,
    background: "#07c160",
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { margin: "18px 0 0", color: "#d14343", lineHeight: 1.5 },
};
