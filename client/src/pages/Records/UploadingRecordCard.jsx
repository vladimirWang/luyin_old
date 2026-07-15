import { LoaderCircle } from "lucide-react";
import { formatCardDateParts, formatClockTime, formatDuration } from "../../utils/index.js";

export function UploadingRecordCard({ item }) {
  const dateParts = formatCardDateParts(item.createdAt);

  return (
    <article className="record-card upload-card is-uploading" aria-label={`${item.name}正在上传`}>
      <div className="record-card-top">
        <span className="record-date-tile date-processing">
          <em>{dateParts.month}</em>
          <span>{dateParts.day}</span>
        </span>
        <span className="status-dot uploaded">上传中1</span>
      </div>
      <div className="upload-card-title">{item.name || "新录音"}</div>
      <div className="record-meta upload-card-meta">
        <span>上传时间 {formatClockTime(item.createdAt)}</span>
        <span>录音时长 {formatDuration(item.durationMs)}</span>
      </div>
      <div className="upload-card-progress">
        <LoaderCircle className="spin-icon" size={20} />
        <span>{item.message || "正在上传服务器，请不要重复选择"}</span>
      </div>
    </article>
  );
}