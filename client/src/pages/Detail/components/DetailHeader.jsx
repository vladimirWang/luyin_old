import { uiText } from "../../../utils/index.js";

export function DetailHeader({ historyOpen, scopeLabel, language, onToggleHistory }) {
  return (
    <header className="chat-page-header compact">
      <button
        className={historyOpen ? "chat-history-title-button active" : "chat-history-title-button"}
        type="button"
        onClick={onToggleHistory}
        aria-label={historyOpen ? "关闭历史聊天记录" : "打开历史聊天记录"}
      >
        <span className="history-bars" aria-hidden="true">
          <i />
          <i />
        </span>
      </button>
      <h1>{uiText(language, "问答", "QA")}</h1>
      <span>{scopeLabel}</span>
    </header>
  );
}
