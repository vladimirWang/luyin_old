import { ChevronDown, ChevronUp, LoaderCircle, Pause, Play, RefreshCw, Share2 } from "lucide-react";
import dayjs from "dayjs";
import { dailyBriefDisplayDate, dailyBriefMeetingCount } from "../../../utils/index.js";
import {
  dailyBriefHasSummary,
  dailyBriefListContent,
  renderDailyBriefLines,
} from "./dailyBriefPresentation.jsx";

const actionClass = "inline-flex min-h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-white/75 px-3 text-xs font-black text-slate-600 shadow-[0_10px_22px_rgba(20,24,34,0.05),inset_0_0_0_1px_rgba(134,144,162,0.12)] disabled:cursor-default disabled:opacity-50";

export function DailyBriefListItem({
  brief,
  expanded,
  generating,
  ttsState,
  onGenerate,
  onSpeak,
  onSpeakLine,
  onShare,
  onToggle,
}) {
  const date = brief.date || "";
  const meetingCount = dailyBriefMeetingCount(brief, 0);
  const hasSummary = dailyBriefHasSummary(brief);
  const content = dailyBriefListContent(brief, meetingCount, generating);
  const speechId = `daily-brief-${date}`;
  const speaking = ttsState.itemId === speechId && ttsState.playing;
  const speechLoading = ttsState.itemId === speechId && ttsState.loading;
  const generatedAt = brief.generatedAt && dayjs(brief.generatedAt).isValid()
    ? dayjs(brief.generatedAt).format("MM月DD日 HH:mm")
    : "";

  return (
    <article
      className={[
        "overflow-hidden rounded-3xl border border-slate-200/70 bg-white/75",
        "shadow-[0_18px_42px_rgba(28,32,43,0.055),inset_0_1px_0_rgba(255,255,255,0.84)]",
        "backdrop-blur-xl",
        expanded ? "border-slate-300/30 bg-white/85" : "",
      ].join(" ")}
    >
      <div className="w-full px-3.5 py-3">
        <button
          className="grid w-full min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 border-0 bg-transparent p-0 text-left text-slate-950"
          type="button"
          onClick={() => onToggle(brief)}
        >
          <span className="inline-flex min-h-8.5 min-w-13.5 items-center justify-center rounded-2xl bg-white/65 text-[13px] font-black text-slate-600 shadow-[inset_0_0_0_1px_rgba(135,144,160,0.12)]">
            {dailyBriefDisplayDate(brief)}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[15px] font-black">{brief.title || "会议简报"}</strong>
            <em className="truncate text-[11px] font-extrabold not-italic text-slate-400">
              {meetingCount ? `${meetingCount} 场会议` : "暂无录音"}
              {generatedAt ? ` · 生成于 ${generatedAt}` : ""}
            </em>
          </span>
          <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-black ${generating ? "bg-rose-100/70 text-rose-500" : "bg-indigo-100/60 text-indigo-600"}`}>
            {generating ? "生成中" : hasSummary ? "已生成" : "待生成"}
          </span>
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-white/55 text-slate-600 shadow-[0_12px_24px_rgba(26,31,45,0.045),inset_0_0_0_1px_rgba(136,145,164,0.1)]" aria-hidden="true">
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </span>
        </button>
      </div>

      {expanded ? (
        <div className="grid gap-3 px-3.5 pb-3.5">
          <div className="grid gap-1 rounded-[20px] bg-white/60 px-3.5 py-3 text-[13px] leading-[1.7] text-slate-700 shadow-[inset_0_0_0_1px_rgba(140,149,166,0.09)]">
            {renderDailyBriefLines(content, {
              speechIdPrefix: speechId,
              ttsState,
              recordingStates: brief.recordingStates || [],
              briefDate: date,
              onSpeakLine: (line) => onSpeakLine?.(brief, line),
            })}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {meetingCount > 0 ? (
              <button className={actionClass} type="button" onClick={(event) => onGenerate(brief, event)} disabled={generating}>
                {generating ? <LoaderCircle className="spin-icon" size={14} /> : <RefreshCw size={14} />}
                <span>{hasSummary ? "重新生成" : "生成简报"}</span>
              </button>
            ) : null}
            <button className={actionClass} type="button" onClick={(event) => onSpeak(brief, event)} disabled={!content.trim()}>
              {speechLoading ? <LoaderCircle className="spin-icon" size={14} /> : speaking ? <Pause size={14} /> : <Play size={14} />}
              <span>{speaking ? "停止朗读" : "朗读内容"}</span>
            </button>
            <button className={actionClass} type="button" onClick={(event) => onShare(brief, event)} disabled={!hasSummary || generating}>
              <Share2 size={14} />
              <span>分享 PDF</span>
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
