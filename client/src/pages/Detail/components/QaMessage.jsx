import { Pause, Play, Share2 } from "lucide-react";
import {
  answerBlocksForDisplay,
  cleanAnswerForDisplay,
  formatDate,
  structuredAnswerFromItem,
} from "../../../utils/index.js";
import { CitationBarList, QaMessageAttachments, QaPendingState } from "./QaMessageParts.jsx";

export function QaMessage({
  item,
  activeCitationKey,
  expandedCitationGroups,
  ttsState,
  citationKey,
  citationSegmentDurationMs,
  citationProgressOffsetMs,
  citationStartMs,
  citationTimeLabel,
  citationsForBlock,
  onOpenAttachment,
  onPlayCitation,
  onSeekCitation,
  onShare,
  onToggleCitationGroup,
  onToggleTts,
  renderStructuredAnswer,
  speechSegmentsForAnswer,
}) {
  const blocks = answerBlocksForDisplay(item.answer);
  const displayBlocks = blocks.length
    ? blocks
    : [cleanAnswerForDisplay(item.answer) || "暂无可展示的回答内容，请重新生成。"];
  const citations = Array.isArray(item.citations) ? item.citations : [];
  const structuredAnswer = structuredAnswerFromItem(item);
  const speakSegments = item.pending ? [] : speechSegmentsForAnswer(item, structuredAnswer);
  const ttsActive = ttsState.itemId === item.id;
  const ttsRunning = ttsActive && (ttsState.playing || ttsState.loading);

  return (
    <article className="chat-message">
      <div className="chat-question">{item.question}</div>
      <time className="chat-message-time">{formatDate(item.createdAt)}</time>
      <QaMessageAttachments
        messageId={item.id}
        attachments={Array.isArray(item.attachments) ? item.attachments : []}
        onOpen={onOpenAttachment}
      />

      {item.pending ? (
        <QaPendingState item={item} />
      ) : structuredAnswer ? (
        renderStructuredAnswer(item, structuredAnswer, citations)
      ) : (
        <div className="chat-answer">
          {displayBlocks.map((block, index) => {
            const blockCitations = citationsForBlock(block, index, displayBlocks, citations);
            const groupKey = `${item.id}-point-${index}`;
            return (
              <section className="chat-answer-point" key={groupKey}>
                <p>{block}</p>
                <CitationBarList
                  blockIndex={index}
                  citations={blockCitations}
                  expanded={Boolean(expandedCitationGroups[groupKey])}
                  activeKey={activeCitationKey}
                  getKey={citationKey}
                  getDuration={citationSegmentDurationMs}
                  getProgress={citationProgressOffsetMs}
                  getStart={citationStartMs}
                  getTimeLabel={citationTimeLabel}
                  onToggle={() => onToggleCitationGroup(groupKey)}
                  onPlay={onPlayCitation}
                  onSeek={onSeekCitation}
                />
              </section>
            );
          })}
        </div>
      )}

      {!item.pending ? (
        <div className="chat-message-actions" aria-label="问答操作">
          {speakSegments.length ? (
            <button
              className={ttsRunning ? "playing" : ""}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleTts(item.id, speakSegments);
              }}
            >
              {ttsRunning ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              <span>{ttsRunning ? "朗读停止" : "朗读播放"}</span>
            </button>
          ) : null}
          <button type="button" onClick={(event) => onShare(item, event)}>
            <Share2 size={14} />
            <span>分享 PDF</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}
