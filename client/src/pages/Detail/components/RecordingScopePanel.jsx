import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDuration, formatShortDate, isToday, uiText } from "../../../utils/index.js";

export function RecordingScopePanel({
  expanded,
  activeRecordingIds,
  recordings,
  loading,
  error,
  scopeLabel,
  scopeSummaryMeta,
  language,
  hasHistory,
  onReset,
  onOpenCurrent,
  onSelect,
  onExpandedChange,
}) {
  const visibleRecordings = expanded ? recordings : recordings.slice(0, 3);

  return (
    <section className={expanded ? "recording-scope-panel expanded" : "recording-scope-panel collapsed"} aria-label="选择录音">
      <div className="scope-toolbar">
        <button
          className={activeRecordingIds.length === 0 ? "scope-all active" : "scope-all"}
          type="button"
          onClick={onReset}
          aria-pressed={activeRecordingIds.length === 0}
        >
          {uiText(language, "全部录音", "All")}
        </button>
        <button
          className={expanded || activeRecordingIds.length > 0 ? "scope-single active" : "scope-single"}
          type="button"
          onClick={() => onExpandedChange(true)}
          disabled={loading || recordings.length === 0}
          aria-pressed={expanded || activeRecordingIds.length > 0}
        >
          {loading ? uiText(language, "刷新中", "Refreshing") : uiText(language, "单选", "Single select")}
        </button>
        {recordings.length > 0 ? (
          <button className="scope-toggle" type="button" onClick={() => onExpandedChange(!expanded)}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {expanded ? uiText(language, "收起", "Collapse") : uiText(language, "展开", "Expand")}
          </button>
        ) : null}
      </div>

      {error ? <div className="scope-alert">{error}</div> : null}

      {!expanded && recordings.length > 0 ? (
        <button className="recording-scope-summary" type="button" onClick={onOpenCurrent}>
          <span>{activeRecordingIds.length === 0 ? "当前范围" : "正在询问"}</span>
          <strong>{scopeLabel}</strong>
          <em>{scopeSummaryMeta}</em>
        </button>
      ) : visibleRecordings.length > 0 ? (
        <div className="recording-scope-grid">
          {visibleRecordings.map((item) => {
            const selected = activeRecordingIds.includes(item.id);
            const classes = [
              "scope-recording",
              selected ? "active" : "",
              isToday(item.createdAt) ? "is-today" : "is-past",
              hasHistory(item.id) ? "has-history" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button className={classes} key={item.id} type="button" onClick={() => onSelect(item.id)}>
                <strong>{formatShortDate(item.createdAt)}</strong>
                <span>{item.name}</span>
                <em>{formatDuration(item.durationMs)}</em>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="scope-empty">暂无可提问的录音</div>
      )}
    </section>
  );
}
