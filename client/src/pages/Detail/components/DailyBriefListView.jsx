import { ChevronDown, ChevronUp, LoaderCircle, Pause, Play, RefreshCw, Share2 } from "lucide-react";
import { cleanQaVisibleText, dailyBriefDisplayDate, dailyBriefMeetingCount } from "../../../utils/index.js";

function normalizeDailyBriefTitle(value = "") {
  return cleanQaVisibleText(value, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isDailyBriefRecordingHeading(text = "") {
  return /^\d+[.、]\s*/.test(cleanQaVisibleText(text, ""));
}

function isDailyBriefSectionHeading(text = "") {
  const value = cleanQaVisibleText(text, "");
  return /^(今日会议简报|[一二三四五六七八九十]+、|\d+[.、]\s*)/.test(value);
}

function matchDailyBriefRecordingState(text = "", recordingStates = []) {
  if (!isDailyBriefRecordingHeading(text)) return null;
  const title = normalizeDailyBriefTitle(text);
  if (!title) return null;
  return recordingStates.find((state) => {
    const name = normalizeDailyBriefTitle(state?.name || state?.title || "");
    return name && (title.includes(name) || name.includes(title));
  }) || null;
}

function dailyBriefOutlineWaitingText(state) {
  if (!state || state.hasMeetingOutline || state.meetingOutlineStatus === "ready") return "";
  if (!state.transcriptReady || ["uploaded", "uploading", "processing", "transcribing"].includes(state.status)) {
    return "这条录音还在转写，今日简报先保留位置。转写和会议提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "generating") {
    return "这条录音的会议提纲正在生成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "failed") {
    return "这条录音的会议提纲暂未生成成功，今日简报先保留位置。请先重新转写或生成提纲后再更新。";
  }
  return "这条录音的会议提纲还没有生成完成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
}

export function canRefreshDailyBriefRecording(state) {
  return Boolean(state?.canRefreshDailyBriefItem || state?.hasMeetingOutline || state?.meetingOutlineStatus === "ready");
}

function renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading }) {
  if (onSpeakLine) {
    return (
      <button
        className={`${className} daily-brief-line-button ${active ? "active" : ""}`.trim()}
        key={`daily-brief-line-${index}`}
        type="button"
        onClick={(event) => onSpeakLine({ event, text: visibleText, index, itemId, label: heading ? "朗读标题" : "朗读段落" })}
      >
        {visibleText}
      </button>
    );
  }
  return (
    <p className={className} key={`daily-brief-line-${index}`}>
      {visibleText || text}
    </p>
  );
}

export function renderDailyBriefLines(markdown = "", options = {}) {
  const {
    speechIdPrefix = "daily-brief-line",
    ttsState,
    onSpeakLine,
    recordingStates = [],
    refreshingRecordingIds,
    briefDate,
    onRefreshRecording,
  } = options;
  const lines = String(markdown || "").split(/\r?\n/);
  let waitingRecordingState = null;

  return lines.flatMap((line, index) => {
    const text = cleanQaVisibleText(line, "");
    const recordingState = matchDailyBriefRecordingState(text, recordingStates);
    const waitingText = dailyBriefOutlineWaitingText(recordingState);

    if (!text) return waitingRecordingState ? [] : [<div className="daily-brief-gap" key={`daily-brief-gap-${index}`} />];
    if (isDailyBriefSectionHeading(text)) waitingRecordingState = waitingText ? recordingState : null;
    else if (waitingRecordingState) return [];

    const heading = isDailyBriefSectionHeading(text);
    const bullet = /^[-*]\s*/.test(text);
    const visibleText = text.replace(/^[-*]\s*/, bullet ? "• " : "");
    const className = heading ? "daily-brief-line heading" : bullet ? "daily-brief-line bullet" : "daily-brief-line";
    const itemId = `${speechIdPrefix}-line-${index}`;
    const active = ttsState?.itemId === itemId && (ttsState.playing || ttsState.loading);
    const lineElement = renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading });

    if (!recordingState) return [lineElement];

    const refreshing = Boolean(refreshingRecordingIds?.has?.(recordingState.id));
    const canRefresh = canRefreshDailyBriefRecording(recordingState) && typeof onRefreshRecording === "function";
    return [
      <div className="daily-brief-recording-heading-row" key={`daily-brief-recording-heading-${index}`}>
        <div className="daily-brief-recording-heading-text">{lineElement}</div>
        {canRefresh ? (
          <button
            className="daily-brief-recording-refresh"
            type="button"
            disabled={refreshing}
            onClick={(event) => onRefreshRecording(recordingState, briefDate, event)}
          >
            {refreshing ? <LoaderCircle className="spin-icon" size={13} /> : <RefreshCw size={13} />}
            <span>{refreshing ? "更新中" : "重新生成此条"}</span>
          </button>
        ) : null}
      </div>,
      waitingText ? (
        <div className="daily-brief-outline-waiting" key={`daily-brief-outline-waiting-${index}`}>
          {waitingText}
        </div>
      ) : null,
    ].filter(Boolean);
  });
}

function dailyBriefListContent(brief, meetingCount = 0, loading = false) {
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  const displayDate = dailyBriefDisplayDate(brief);
  if (loading || brief?.status === "generating") {
    return [
      `今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
      "",
      "正在生成",
      "系统正在汇总当天录音的会议提纲，完成后会自动展示在这张卡片里。",
    ].join("\n");
  }
  if (!meetingCount) {
    return [`会议简报｜${displayDate}`, "", "当天暂无可总结的录音。"].join("\n");
  }
  return [
    `会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
    "",
    "展开后会生成并展示当天录音的核心内容。",
    "你可以朗读内容，也可以在生成完成后分享 PDF。",
  ].join("\n");
}

export function dailyBriefHasSummary(brief) {
  return Boolean(cleanQaVisibleText(brief?.summaryMarkdown || "", ""));
}

export function DailyBriefListView({
  briefs,
  expandedDates,
  generatingDates,
  ttsState,
  refreshingRecordingIds,
  onToggle,
  onGenerate,
  onSpeak,
  onSpeakLine,
  onShare,
  onRefreshRecording,
}) {
  if (!briefs.length) {
    return (
      <div className="daily-brief-list-empty">
        <strong>还没有会议简报</strong>
        <span>上传录音后，会按日期生成每天一张简报卡。</span>
      </div>
    );
  }

  return (
    <div className="daily-brief-list" aria-label="会议简报列表">
      {briefs.map((brief) => {
        const date = brief.date || "";
        const expanded = expandedDates.has(date);
        const meetingCount = dailyBriefMeetingCount(brief, 0);
        const generating = generatingDates.has(date) || brief.status === "generating";
        const hasSummary = dailyBriefHasSummary(brief);
        const content = dailyBriefListContent(brief, meetingCount, generating);
        const speechId = `daily-brief-${date}`;
        const speaking = ttsState.itemId === speechId && ttsState.playing;
        const speechLoading = ttsState.itemId === speechId && ttsState.loading;

        return (
          <article className={expanded ? "daily-brief-list-card expanded" : "daily-brief-list-card"} key={date || brief.id}>
            <div className="daily-brief-list-header">
              <button className="daily-brief-list-toggle" type="button" onClick={() => onToggle(brief)}>
                <span className="daily-brief-list-date">{dailyBriefDisplayDate(brief)}</span>
                <span className="daily-brief-list-main">
                  <strong>{brief.title || "会议简报"}</strong>
                  <em>{meetingCount ? `${meetingCount} 场会议` : "暂无录音"}</em>
                </span>
                <span className={generating ? "daily-brief-list-status generating" : "daily-brief-list-status"}>
                  {generating ? "生成中" : hasSummary ? "已生成" : "待生成"}
                </span>
                <span className="daily-brief-list-chevron" aria-hidden="true">
                  {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
              </button>
            </div>

            {expanded ? (
              <div className="daily-brief-list-content">
                <div className="daily-brief-list-body">
                  {renderDailyBriefLines(content, {
                    speechIdPrefix: speechId,
                    ttsState,
                    recordingStates: brief.recordingStates || [],
                    refreshingRecordingIds,
                    briefDate: date,
                    onRefreshRecording,
                    onSpeakLine: (line) => onSpeakLine?.(brief, line),
                  })}
                </div>
                <div className="daily-brief-list-actions">
                  {meetingCount > 0 ? (
                    <button type="button" onClick={(event) => onGenerate(brief, event)} disabled={generating}>
                      {generating ? <LoaderCircle className="spin-icon" size={14} /> : <RefreshCw size={14} />}
                      <span>{hasSummary ? "重新生成" : "生成简报"}</span>
                    </button>
                  ) : null}
                  <button type="button" onClick={(event) => onSpeak(brief, event)} disabled={!content.trim()}>
                    {speechLoading ? <LoaderCircle className="spin-icon" size={14} /> : speaking ? <Pause size={14} /> : <Play size={14} />}
                    <span>{speaking ? "停止朗读" : "朗读内容"}</span>
                  </button>
                  <button type="button" onClick={(event) => onShare(brief, event)} disabled={!hasSummary || generating}>
                    <Share2 size={14} />
                    <span>分享 PDF</span>
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
