import { cleanQaVisibleText, dailyBriefDisplayDate } from "../../../utils/index.js";

function normalizeTitle(value = "") {
  return cleanQaVisibleText(value, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isRecordingHeading(text = "") {
  return /^\d+[.、]\s*/.test(cleanQaVisibleText(text, ""));
}

function isSectionHeading(text = "") {
  return /^(今日会议简报|[一二三四五六七八九十]+、|\d+[.、]\s*)/.test(cleanQaVisibleText(text, ""));
}

function matchRecordingState(text = "", recordingStates = []) {
  if (!isRecordingHeading(text)) return null;
  const title = normalizeTitle(text);
  return recordingStates.find((state) => {
    const name = normalizeTitle(state?.name || state?.title || "");
    return name && (title.includes(name) || name.includes(title));
  }) || null;
}

function outlineWaitingText(state) {
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

function lineElement({ visibleText, className, index, itemId, active, onSpeakLine, heading }) {
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
  return <p className={className} key={`daily-brief-line-${index}`}>{visibleText}</p>;
}

export function renderDailyBriefLines(markdown = "", options = {}) {
  const { speechIdPrefix = "daily-brief-line", ttsState, onSpeakLine, recordingStates = [] } = options;
  let waitingRecordingState = null;

  return String(markdown || "").split(/\r?\n/).flatMap((line, index) => {
    const text = cleanQaVisibleText(line, "");
    const recordingState = matchRecordingState(text, recordingStates);
    const waitingText = outlineWaitingText(recordingState);
    if (!text) return waitingRecordingState ? [] : [<div className="daily-brief-gap" key={`daily-brief-gap-${index}`} />];
    if (isSectionHeading(text)) waitingRecordingState = waitingText ? recordingState : null;
    else if (waitingRecordingState) return [];

    const heading = isSectionHeading(text);
    const bullet = /^[-*]\s*/.test(text);
    const visibleText = text.replace(/^[-*]\s*/, bullet ? "• " : "");
    const className = heading ? "daily-brief-line heading" : bullet ? "daily-brief-line bullet" : "daily-brief-line";
    const itemId = `${speechIdPrefix}-line-${index}`;
    const active = ttsState?.itemId === itemId && (ttsState.playing || ttsState.loading);
    const content = lineElement({ visibleText, className, index, itemId, active, onSpeakLine, heading });

    if (!recordingState) return [content];
    return [
      <div className="daily-brief-recording-heading-row" key={`daily-brief-recording-heading-${index}`}>
        <div className="daily-brief-recording-heading-text">{content}</div>
      </div>,
      waitingText ? <div className="daily-brief-outline-waiting" key={`daily-brief-outline-waiting-${index}`}>{waitingText}</div> : null,
    ].filter(Boolean);
  });
}

export function dailyBriefListContent(brief, meetingCount = 0, loading = false) {
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  const displayDate = dailyBriefDisplayDate(brief);
  if (loading || brief?.status === "generating") {
    return [`今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`, "", "正在生成", "系统正在汇总当天录音的会议提纲，完成后会自动展示在这张卡片里。"].join("\n");
  }
  if (!meetingCount) return [`会议简报｜${displayDate}`, "", "当天暂无可总结的录音。"].join("\n");
  return [`会议简报｜${displayDate}｜共 ${meetingCount} 场会议`, "", "展开后会生成并展示当天录音的核心内容。", "你可以朗读内容，也可以在生成完成后分享 PDF。"].join("\n");
}

export function dailyBriefHasSummary(brief) {
  return Boolean(cleanQaVisibleText(brief?.summaryMarkdown || "", ""));
}
