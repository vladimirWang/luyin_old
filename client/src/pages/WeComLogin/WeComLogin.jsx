import { useEffect, useRef, useState } from "react";
import { createWWLoginPanel } from "@wecom/jssdk";
import { useNavigate } from "react-router-dom";
import { api, saveLocalProfile } from "../../utils/index.js";
import "./WeComLogin.css";

const OAUTH_STATE_KEY = "wecomLoginOAuthState";

function createOAuthState() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("code") || searchParams.has("state")) return searchParams;

  const hashQueryIndex = window.location.hash.indexOf("?");
  return hashQueryIndex >= 0
    ? new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1))
    : searchParams;
}

function errorMessage(error, fallback = "企业微信登录失败，请稍后重试") {
  if (error instanceof Error && error.message) return error.message;
  return String(error?.errMsg || error?.message || fallback);
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

export default function WeComLogin() {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const loginStartedRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function finishLogin(code) {
      if (!code || loginStartedRef.current) return;
      loginStartedRef.current = true;
      setError("");
      setStatus("authorizing");
      try {
        await exchangeCode(code);
        if (cancelled) return;
        window.sessionStorage.removeItem(OAUTH_STATE_KEY);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash.split("?")[0]}`);
        navigate("/user", { replace: true });
      } catch (requestError) {
        if (cancelled) return;
        loginStartedRef.current = false;
        setError(errorMessage(requestError));
        setStatus("error");
      }
    }

    async function mountLoginPanel() {
      try {
        let config = await api("/api/wecom/login-config");
        console.log("wecom login config: ", config)
        if (cancelled) return;
        if (!config.configured || !config.appid || !config.agentid) {
          throw new Error("服务端尚未完整配置企业微信 CorpID、AgentID 和 Secret");
        }
        const redirectUri = String(config.redirectUri || "").trim();
        const parsedRedirectUri = new URL(redirectUri);
        if (parsedRedirectUri.protocol !== "https:" || parsedRedirectUri.hash) {
          throw new Error("企业微信回调地址必须是无 # 片段的 HTTPS URL");
        }
        const state = createOAuthState();

        const params = {
            login_type: "CorpApp",
            appid: config.appid,
            agentid: String(config.agentid),
            redirect_uri: parsedRedirectUri.toString(),
            redirect_type: "callback",
            panel_size: window.matchMedia("(max-width: 520px)").matches ? "small" : "middle",
            state,
            lang: "zh",
            color_scheme: "light",
          }
        console.log("二维码入参: ", params)
        window.sessionStorage.setItem(OAUTH_STATE_KEY, state);
        panelRef.current = createWWLoginPanel({
          el: "#wecom-login-panel",
          params,
          onLoginSuccess({ code }) {
            console.log("ww login success: ", code)
            finishLogin(code);
          },
          onLoginFail(loginError) {
            console.log("ww login fail: ", loginError)
            if (cancelled) return;
            setError(errorMessage(loginError));
            setStatus("error");
          },
        });
        setStatus("ready");
      } catch (mountError) {
        if (cancelled) return;
        setError(errorMessage(mountError, "企业微信登录组件加载失败"));
        setStatus("error");
      }
    }

    const callbackParams = getCallbackParams();
    const callbackCode = callbackParams.get("code");
    console.log("call back code: ", callbackCode)
    if (callbackCode) {
      const returnedState = callbackParams.get("state") || "";
      const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY) || "";
      if (!expectedState || returnedState !== expectedState) {
        setError("登录校验失败，请重新发起企业微信登录");
        setStatus("error");
      } else {
        finishLogin(callbackCode);
      }
    } else {
      mountLoginPanel();
    }
    return () => {
      cancelled = true;
      panelRef.current?.unmount();
      panelRef.current = null;
    };
  }, [navigate]);

  return (
    <main className="wecom-login-page">
      <section className="wecom-login-card" aria-labelledby="wecom-login-title">
        <header className="wecom-login-header">
          <div className="wecom-login-logo" aria-hidden="true">企</div>
          <div>
            <h1 id="wecom-login-title">企业微信登录</h1>
            <p>使用企业成员身份安全登录录音工作台</p>
          </div>
        </header>

        <div className="wecom-login-panel-shell" aria-busy={status === "loading" || status === "authorizing"}>
          <div id="wecom-login-panel" />
          {status === "loading" ? <p className="wecom-login-status">正在加载登录组件…</p> : null}
          {status === "authorizing" ? (
            <div className="wecom-login-mask">
              <span className="wecom-login-spinner" />
              <p>正在验证企业成员身份…</p>
            </div>
          ) : null}
        </div>

        {error ? <p className="wecom-login-error" role="alert">{error}</p> : null}
        <p className="wecom-login-help">请使用企业微信扫码，或在已登录企业微信的电脑上确认登录</p>
      </section>
    </main>
  );
}
