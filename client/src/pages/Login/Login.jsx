import { useEffect, useRef, useState } from "react";
import { createWWLoginPanel } from "@wecom/jssdk";
import { ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  exchangeWecomCode,
  getWecomLoginConfig,
  getWecomOAuthUrl,
  updateWecomProfile,
} from "../../api/wecom.js";
import { clearStoredAuth, saveLocalProfile } from "../../utils/index.js";
import { isInWeCom } from "../../utils/wecom.js";
import { hasWecomIdentity, useWecomAuthStore } from "../../stores/useWecomAuthStore.js";
import LoginFailed from "./components/LoginFailed.jsx";
import "./Login.css";

const OAUTH_STATE_KEY = "wecomLoginOAuthState";
const AUTO_LOGIN_STARTED_KEY = "wecomAutoLoginStarted";
const LOGIN_RETURN_TO_KEY = "wecomLoginReturnTo";
let embeddedLoginRequest = null;
let codeExchangeRequest = null;
let codeExchangeValue = "";

function createOAuthState() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCallbackParams(fallbackSearch = "", fallbackHash = "") {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("code") || searchParams.has("state")) return searchParams;

  const hashQueryIndex = window.location.hash.indexOf("?");
  if (hashQueryIndex >= 0) {
    const hashParams = new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1));
    if (hashParams.has("code") || hashParams.has("state")) return hashParams;
  }

  const fallbackParams = new URLSearchParams(fallbackSearch);
  if (fallbackParams.has("code") || fallbackParams.has("state")) return fallbackParams;

  const fallbackHashQueryIndex = fallbackHash.indexOf("?");
  return fallbackHashQueryIndex >= 0
    ? new URLSearchParams(fallbackHash.slice(fallbackHashQueryIndex + 1))
    : searchParams;
}

function returnPathWithoutOAuthParams(locationLike) {
  const pathname = String(locationLike?.pathname || "");
  const params = new URLSearchParams(locationLike?.search || "");
  params.delete("code");
  params.delete("state");
  const search = params.toString();
  const hash = String(locationLike?.hash || "").split("?")[0];
  return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

function errorMessage(error, fallback = "企业微信登录失败，请稍后重试") {
  if (error instanceof Error && error.message) return error.message;
  return String(error?.errMsg || error?.message || fallback);
}

function requestEmbeddedLoginUrl() {
  if (embeddedLoginRequest) return embeddedLoginRequest;
  const previousAttempts = Number(window.sessionStorage.getItem(AUTO_LOGIN_STARTED_KEY) || 0);
  if (previousAttempts >= 2) {
    return Promise.reject(new Error("未能获得企业微信授权码，请确认应用可信域名和回调地址配置"));
  }

  const state = createOAuthState();
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  window.sessionStorage.setItem(OAUTH_STATE_KEY, state);
  window.sessionStorage.setItem(AUTO_LOGIN_STARTED_KEY, String(previousAttempts + 1));
  embeddedLoginRequest = getWecomOAuthUrl(redirectUri, state);
  return embeddedLoginRequest;
}

async function exchangeCode(code) {
  const payload = await exchangeWecomCode(code);
  if (!payload.configured) throw new Error("服务端尚未配置企业微信应用 Secret");
  if (!payload.authenticated || !payload.user) throw new Error("未能获取企业微信用户身份");

  const user = payload.user;
  const profilePayload = {
    name: user.name || user.userId,
    username: "",
    accountLoggedIn: false,
    company: "企业微信",
    department: user.department || "",
    wecomName: user.name || "",
    wecomUserId: user.userId || user.openUserId || "",
    wecomConfigured: true,
  };
  clearStoredAuth();
  const profileResponse = await updateWecomProfile(profilePayload, user.authToken);
  const profile = { ...(profileResponse.profile || {}), ...profilePayload };
  saveLocalProfile(profile);
  return { profile, user };
}

function exchangeCodeOnce(code) {
  if (codeExchangeRequest && codeExchangeValue === code) return codeExchangeRequest;
  codeExchangeValue = code;
  codeExchangeRequest = exchangeCode(code).catch((error) => {
    codeExchangeRequest = null;
    codeExchangeValue = "";
    throw error;
  });
  return codeExchangeRequest;
}

export default function WeComLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const storedUser = useWecomAuthStore((state) => state.user);
  const setUser = useWecomAuthStore((state) => state.setUser);
  const panelRef = useRef(null);
  const loginStartedRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const inWeCom = isInWeCom();

  function showLoginFailed(loginError) {
    const message = errorMessage(loginError, "企业微信自动登录失败");
    setError(message);
    setStatus("failed");
    navigate("/login?status=failed", {
      replace: true,
      state: { loginError: message },
    });
  }

  function retryAutoLogin() {
    embeddedLoginRequest = null;
    codeExchangeRequest = null;
    codeExchangeValue = "";
    loginStartedRef.current = false;
    window.sessionStorage.removeItem(OAUTH_STATE_KEY);
    window.sessionStorage.removeItem(AUTO_LOGIN_STARTED_KEY);
    setError("");
    setStatus("loading");
    navigate("/login", { replace: true, state: null });
  }

  useEffect(() => {
    let cancelled = false;

    async function finishLogin(code) {
      if (!code || loginStartedRef.current) return;
      loginStartedRef.current = true;
      setError("");
      setStatus("authorizing");
      try {
        const { user } = await exchangeCodeOnce(code);
        if (cancelled) return;
        setUser(user);
        window.sessionStorage.removeItem(OAUTH_STATE_KEY);
        window.sessionStorage.removeItem(AUTO_LOGIN_STARTED_KEY);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash.split("?")[0]}`);
        const statePath = location.state?.from?.pathname || "";
        const stateSearch = location.state?.from?.search || "";
        const requestedLocation = window.sessionStorage.getItem(LOGIN_RETURN_TO_KEY) || `${statePath}${stateSearch}`;
        window.sessionStorage.removeItem(LOGIN_RETURN_TO_KEY);
        navigate(requestedLocation && !requestedLocation.startsWith("/login") ? requestedLocation : "/records", { replace: true });
      } catch (requestError) {
        if (cancelled) return;
        loginStartedRef.current = false;
        if (inWeCom) {
          showLoginFailed(requestError);
        } else {
          setError(errorMessage(requestError));
          setStatus("error");
        }
      }
    }

    async function startEmbeddedLogin() {
      try {
        setStatus("authorizing");
        const payload = await requestEmbeddedLoginUrl();
        if (!payload.configured || !payload.url) {
          throw new Error("服务端尚未完整配置企业微信应用");
        }
        if (cancelled) return;
        window.location.replace(payload.url);
      } catch (requestError) {
        if (cancelled) return;
        embeddedLoginRequest = null;
        window.sessionStorage.removeItem(AUTO_LOGIN_STARTED_KEY);
        window.sessionStorage.removeItem(OAUTH_STATE_KEY);
        showLoginFailed(requestError);
      }
    }

    async function mountLoginPanel() {
      try {
        const config = await getWecomLoginConfig();
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
        window.sessionStorage.setItem(OAUTH_STATE_KEY, state);
        panelRef.current = createWWLoginPanel({
          el: "#wecom-login-panel",
          params,
          onLoginSuccess({ code }) {
            finishLogin(code);
          },
          onLoginFail(loginError) {
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

    const requestedStatus = new URLSearchParams(location.search).get("status");
    if (requestedStatus === "failed") {
      setError(String(location.state?.loginError || "登录请求没有完成，请重新发起企业微信授权。"));
      setStatus("failed");
      return () => {
        cancelled = true;
      };
    }

    const callbackParams = getCallbackParams(location.state?.from?.search, location.state?.from?.hash);
    const callbackCode = callbackParams.get("code");
    const returnPath = returnPathWithoutOAuthParams(location.state?.from);
    if (returnPath && !returnPath.startsWith("/login")) {
      window.sessionStorage.setItem(LOGIN_RETURN_TO_KEY, returnPath);
    }
    if (hasWecomIdentity(storedUser)) {
      navigate("/", { replace: true });
    } else if (callbackCode) {
      const returnedState = callbackParams.get("state") || "";
      const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY) || "";
      if (!expectedState || returnedState !== expectedState) {
        if (inWeCom) {
          showLoginFailed(new Error("登录校验失败，请重新发起企业微信登录"));
        } else {
          setError("登录校验失败，请重新发起企业微信登录");
          setStatus("error");
        }
      } else {
        finishLogin(callbackCode);
      }
    } else if (inWeCom) {
      startEmbeddedLogin();
    } else {
      mountLoginPanel();
    }
    return () => {
      cancelled = true;
      loginStartedRef.current = false;
      panelRef.current?.unmount();
      panelRef.current = null;
    };
  }, [inWeCom, location.hash, location.search, location.state, navigate, setUser, storedUser]);

  if (status === "failed") {
    return <LoginFailed message={error} onRetry={retryAutoLogin} />;
  }

  return (
    <main className="wecom-login-page">
      <section className="wecom-login-card" aria-labelledby="wecom-login-title">
        <header className="wecom-login-header">
          <div>
            <span className="wecom-login-eyebrow">WECOM RECORDER</span>
            <h1 id="wecom-login-title">企业微信登录</h1>
            <p>使用企业成员身份安全登录录音工作台</p>
          </div>
          <span className="wecom-login-logo" aria-hidden="true">
            <ShieldCheck size={31} strokeWidth={2.4} />
          </span>
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
