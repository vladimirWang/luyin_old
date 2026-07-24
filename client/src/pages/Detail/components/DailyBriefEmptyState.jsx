import { CalendarX2 } from "lucide-react";

export function DailyBriefEmptyState() {
  return (
    <div className="grid min-h-[38svh] place-items-center px-6 text-center">
      <div className="grid max-w-70 justify-items-center gap-3 text-slate-500">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-white/70 text-slate-400 shadow-[0_14px_32px_rgba(31,38,52,0.06),inset_0_0_0_1px_rgba(135,144,160,0.1)]">
          <CalendarX2 size={24} />
        </span>
        <strong className="text-lg font-black text-slate-700/75">今日暂无会议简报</strong>
        <span className="text-[13px] leading-relaxed text-slate-500/75">
          今天还没有可生成简报的录音，服务端会在定时任务执行后自动更新。
        </span>
      </div>
    </div>
  );
}
