import { useMemo, useState } from "react";
import { LoaderCircle, Share2, Star, Trash2, X } from "lucide-react";
import { formatDate } from "../../../utils/index.js";

const EMPTY_ITEMS = Object.freeze([]);

export function ChatHistoryPanel({
  open,
  messages = EMPTY_ITEMS,
  dailyBriefs = EMPTY_ITEMS,
  onClose,
  onOpenMessage,
  onOpenDailyBrief,
  onToggleFavorite,
  onShareMessage,
  onShareDailyBrief,
  onDeleteMessage,
}) {
  const [mode, setMode] = useState("history");
  const visibleMessages = useMemo(
    () => (mode === "favorites" ? messages.filter((item) => item.favorite) : messages),
    [messages, mode],
  );
  const visibleDailyBriefs = mode === "history" ? dailyBriefs : EMPTY_ITEMS;
  const visibleCount = visibleMessages.length + visibleDailyBriefs.length;

  function switchMode(nextMode, event) {
    event.stopPropagation();
    setMode(nextMode);
  }

  return (
    <aside
      className={open ? "chat-history-panel open" : "chat-history-panel"}
      aria-label="历史聊天记录"
      aria-hidden={!open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <strong>{mode === "favorites" ? "收藏夹" : "历史聊天记录"}</strong>
          <span>{mode === "favorites" ? `${visibleMessages.length} 条收藏` : `${visibleCount} 条记录`}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭历史聊天记录">
          <X size={16} />
        </button>
      </header>

      <div className="chat-history-tabs" role="tablist" aria-label="历史类型">
        <button
          className={mode === "history" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "history"}
          onClick={(event) => switchMode("history", event)}
        >
          历史
        </button>
        <button
          className={mode === "favorites" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={mode === "favorites"}
          onClick={(event) => switchMode("favorites", event)}
        >
          收藏夹
        </button>
      </div>

      <div className="chat-history-list">
        {visibleCount > 0 ? (
          <>
            {visibleDailyBriefs.map((brief) => (
              <article
                className="chat-history-item daily-brief-history-item"
                key={brief.id || brief.date}
                role="button"
                tabIndex={0}
                onClick={() => onOpenDailyBrief?.(brief)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenDailyBrief?.(brief);
                  }
                }}
              >
                <button
                  className="chat-history-main"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDailyBrief?.(brief);
                  }}
                >
                  <span>{brief.displayDate || brief.date}</span>
                  <strong>{brief.title || "今日会议简报"}</strong>
                  <em>
                    {Number(brief.meetingCount || 0)} 场会议 · {brief.status === "generating" ? "生成中" : brief.summaryMarkdown ? "已生成" : "暂无内容"}
                  </em>
                </button>
                <div className="chat-history-actions" aria-label="今日总结操作">
                  <button
                    className="history-share-button"
                    type="button"
                    aria-label="分享 PDF"
                    disabled={brief.status === "generating" || !brief.summaryMarkdown}
                    onClick={(event) => onShareDailyBrief?.(brief, event)}
                  >
                    {brief.status === "generating" ? <LoaderCircle className="spin-icon" size={14} /> : <Share2 size={14} />}
                  </button>
                </div>
              </article>
            ))}

            {visibleMessages.map((item) => (
              <article
                className={item.favorite ? "chat-history-item favorite" : "chat-history-item"}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenMessage?.(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenMessage?.(item);
                  }
                }}
              >
                <button
                  className="chat-history-main"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMessage?.(item);
                  }}
                >
                  <span>{formatDate(item.createdAt)}</span>
                  <strong>{item.question}</strong>
                  {item.recordingNames?.length ? <em>{item.recordingNames.slice(0, 2).join("、")}</em> : null}
                </button>
                <div className="chat-history-actions" aria-label="问答操作">
                  <button
                    className="history-favorite-button"
                    type="button"
                    aria-label={item.favorite ? "取消收藏" : "收藏"}
                    onClick={(event) => onToggleFavorite?.(item, event)}
                  >
                    <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
                  </button>
                  <button className="history-share-button" type="button" aria-label="分享 PDF" onClick={(event) => onShareMessage?.(item, event)}>
                    <Share2 size={14} />
                  </button>
                  <button className="history-delete-button" type="button" aria-label="删除问答" onClick={(event) => onDeleteMessage?.(item, event)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </>
        ) : (
          <p>{mode === "favorites" ? "还没有收藏的问答" : "还没有历史提问"}</p>
        )}
      </div>
    </aside>
  );
}
