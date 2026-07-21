import { Share2 } from "lucide-react";
import { cleanQaVisibleText, dailyBriefDisplayDate } from '../../../utils/index.js'
import { renderDailyBriefLines } from "./DailyBriefListView.jsx";

function dailyBriefFallbackContent(brief, meetingCount) {
  const displayDate = dailyBriefDisplayDate(brief);
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  if (brief?.status === "generating" || brief?.dirty) {
    return [
      `今日会议简报｜${displayDate}｜正在生成`,
      "",
      "正在生成今日会议简报",
      "系统正在汇总今天上传的录音和会议提纲，生成完成后会自动显示在这里。",
    ].join("\n");
  }
  if (!meetingCount) {
    return [
      `今日会议简报｜${displayDate}｜共 0 场会议`,
      "",
      "一、今日总体结论",
      "今天还没有可总结的录音。",
      "",
      "二、会议列表",
      "暂无会议。",
      "",
      "三、今日重点待办",
      "暂无明确内容。",
    ].join("\n");
  }
  return [
    `今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
    "",
    "一、今日总体结论",
    "今日会议简报正在生成中，生成完成后会自动展示。",
    "",
    "二、会议列表",
    "暂无可展示的会议详情。",
    "",
    "三、今日重点待办",
    "暂无明确内容。",
  ].join("\n");
}

export function DailyMeetingBriefMessage({ message, ttsState, onSpeakLine, onShare }) {
  const content = cleanQaVisibleText(message.content || message.answer || "", "") || dailyBriefFallbackContent(null, 0);
  const canShare = message.briefDate && message.status !== "generating";
  const speechIdPrefix = `daily-brief-${message.briefDate || message.id || "message"}`;
  return (
    <article className="daily-brief-message">
      <div className="daily-brief-message-kicker">今日会议简报</div>
      <div className="daily-brief-message-body">
        {renderDailyBriefLines(content, {
          speechIdPrefix,
          ttsState,
          recordingStates: message.recordingStates || [],
          briefDate: message.briefDate,
          onSpeakLine: (line) => onSpeakLine?.(message, line),
        })}
      </div>
      {canShare ? (
        <div className="daily-brief-actions">
          <button type="button" onClick={(event) => onShare?.(message, event)}>
            <Share2 size={13} />
            <span>分享 PDF</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}
