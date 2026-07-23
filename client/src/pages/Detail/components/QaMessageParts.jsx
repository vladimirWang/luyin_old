import { ChevronDown, ChevronUp, LoaderCircle, Pause, Play } from "lucide-react";
import { pointLabelForIndex, thinkingStepsForMessage } from "../../../utils/index.js";
import { attachmentPreviewType } from "./AttachmentPreviewDialog.jsx";

export function QaMessageAttachments({ messageId, attachments = [], onOpen }) {
  if (attachments.length === 0) return null;

  return (
    <div className="chat-message-attachments" aria-label="已上传附件">
      {attachments.map((attachment, index) => {
        const previewType = attachmentPreviewType(attachment);
        return (
          <button
            key={attachment.id || attachment.fileId || `${messageId}-attachment-${index}`}
            type="button"
            onClick={() => onOpen(attachment, previewType)}
          >
            <span>{previewType === "image" ? "图片" : previewType === "audio" ? "录音" : previewType === "location" ? "地址" : "文件"}</span>
            <strong>{attachment.name || "附件"}</strong>
          </button>
        );
      })}
    </div>
  );
}

export function QaPendingState({ item }) {
  return (
    <div className="chat-thinking pending-thinking">
      <div className="pending-thinking-title">
        <LoaderCircle className="spin-icon" size={16} />
        <span>正在深度思考并核对原文证据</span>
      </div>
      <ol>
        {thinkingStepsForMessage(item).map((step, index) => (
          <li key={`${item.id}-pending-thinking-${index}`}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

export function CitationBarList({
  blockIndex,
  citations,
  expanded,
  activeKey,
  getKey,
  getDuration,
  getProgress,
  getStart,
  getTimeLabel,
  onToggle,
  onPlay,
  onSeek,
}) {
  if (citations.length === 0) return null;

  return (
    <div className="chat-citation-panel" aria-label={`${pointLabelForIndex(blockIndex)}依据`}>
      <button className="citation-fold-button" type="button" onClick={onToggle}>
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {expanded ? "收起" : "展开"} {citations.length} 个时间点
      </button>
      {expanded ? (
        <div className="citation-bar-list">
          {citations.map((citation, citationIndex) => {
            const absoluteIndex = citation._citationIndex ?? citationIndex;
            const key = getKey(citation, absoluteIndex);
            return (
              <div className="citation-bar" key={key}>
                <button
                  className={activeKey === key ? "active" : ""}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onPlay(citation, key);
                  }}
                  title={getTimeLabel(citation)}
                  aria-label={`播放依据 ${absoluteIndex + 1}：${getTimeLabel(citation)}`}
                >
                  {activeKey === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </button>
                <div>
                  <strong>{getTimeLabel(citation)}</strong>
                  <em>{citation.recordingName || `依据 ${absoluteIndex + 1}`}</em>
                </div>
                <input
                  type="range"
                  min="0"
                  max={getDuration(citation)}
                  step="1000"
                  value={getProgress(citation, key)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onChange={(event) => {
                    event.preventDefault();
                    onSeek(citation, key, getStart(citation) + Number(event.target.value));
                  }}
                  aria-label={`拖动依据 ${absoluteIndex + 1} 播放进度`}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
