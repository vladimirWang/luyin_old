import { RefreshCw, ShieldAlert } from "lucide-react";

export default function LoginFailed({ message, onRetry }) {
  return (
    <main className="wecom-login-page">
      <section className="wecom-login-card" aria-labelledby="wecom-login-failed-title">
        <header className="wecom-login-header">
          <div>
            <span className="wecom-login-eyebrow">WECOM RECORDER</span>
            <h1 id="wecom-login-failed-title">登录未完成</h1>
            <p>暂时无法验证你的企业成员身份</p>
          </div>
          <span className="wecom-login-logo wecom-login-logo-error" aria-hidden="true">
            <ShieldAlert size={31} strokeWidth={2.4} />
          </span>
        </header>

        <div className="wecom-login-failed-panel" role="alert">
          <span className="wecom-login-failed-icon" aria-hidden="true">
            <ShieldAlert size={38} strokeWidth={2.2} />
          </span>
          <h2>企业微信自动登录失败</h2>
          <p>{message || "登录请求没有完成，请重新发起企业微信授权。"}</p>
          <button className="wecom-login-retry-button" type="button" onClick={onRetry}>
            <RefreshCw size={19} strokeWidth={2.5} />
            重新登录
          </button>
        </div>

        <p className="wecom-login-help">如果反复失败，请联系管理员检查应用可信域名和 OAuth 回调地址</p>
      </section>
    </main>
  );
}
