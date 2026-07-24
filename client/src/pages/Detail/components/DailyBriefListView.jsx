import { DailyBriefListItem } from "./DailyBriefListItem.jsx";
import { DailyBriefEmptyState } from "./DailyBriefEmptyState.jsx";
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
    return <DailyBriefEmptyState />;
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
