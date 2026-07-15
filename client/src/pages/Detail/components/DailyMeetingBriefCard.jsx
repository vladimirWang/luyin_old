import {dailyBriefDisplayDate} from '../../../utils/index.js'
export function DailyMeetingBriefCard({ brief, loading, meetingCount, onOpen }) {



  const displayDate = dailyBriefDisplayDate(brief);
  const countText = meetingCount > 0 ? `${meetingCount}场会议` : "暂无会议";
  const hint = meetingCount > 0 ? "点击查看今日核心内容" : "今天还没有可总结的录音";
  return (
    <div className="daily-brief-wrapper">
      <button className="daily-brief-card" type="button" onClick={onOpen} disabled={loading && !brief}>
        <span className="daily-brief-title">今日会议简报</span>
        <span className="daily-brief-subtitle">
          {displayDate} ｜ {countText}
        </span>
        <span className="daily-brief-hint">{loading ? "正在读取今日简报" : hint}</span>
      </button>
    </div>
  );
}
