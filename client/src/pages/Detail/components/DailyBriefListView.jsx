import { DailyBriefListItem } from "./DailyBriefListItem.jsx";
export { dailyBriefHasSummary, renderDailyBriefLines } from "./dailyBriefPresentation.jsx";

export function DailyBriefListView({
  briefs,
  expandedDates,
  generatingDates,
  ttsState,
  onToggle,
  onGenerate,
  onSpeak,
  onSpeakLine,
  onShare,
}) {
  if (!briefs.length) {
    return (
      <div className="grid min-h-[38svh] place-items-center gap-2 text-center text-slate-400/70">
        <strong className="text-lg font-black text-slate-700/70">还没有会议简报</strong>
        <span className="max-w-65 text-[13px] leading-relaxed text-slate-500/70">
          上传录音后，会按日期生成每天一张简报卡。
        </span>
      </div>
    );
  }

  return (
    <div className="grid w-full gap-2.5" aria-label="会议简报列表">
      {briefs.map((brief) => {
        const date = brief.date || "";
        return (
          <DailyBriefListItem
            key={date || brief.id}
            brief={brief}
            expanded={expandedDates.has(date)}
            generating={generatingDates.has(date) || brief.status === "generating"}
            ttsState={ttsState}
            onToggle={onToggle}
            onGenerate={onGenerate}
            onSpeak={onSpeak}
            onSpeakLine={onSpeakLine}
            onShare={onShare}
          />
        );
      })}
    </div>
  );
}
