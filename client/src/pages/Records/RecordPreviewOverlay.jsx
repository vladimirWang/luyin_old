import { useState, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, RefreshCw, Pause, Play, Share2, Volume2 } from "lucide-react";
import {
  formatTimecode,
  formatDuration,
  isTencentMeetingWaitingTranscript,
  isTencentMeetingNoTranscript,
  meetingReportBlocks,
  api,
  mediaRequestUrl,
} from "../../utils/index.js";

export function RecordPreviewOverlay({ recording, onClose, onAsk, onShare, onRetranscribe }) {
  const audioRef = useRef(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareBusyMode, setShareBusyMode] = useState("");
  const [openSection, setOpenSection] = useState("");
  const [meetingOutline, setMeetingOutline] = useState(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCurrent, setPreviewCurrent] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(recording?.durationMs ? recording.durationMs / 1000 : 0);

  useEffect(() => {
    setOpenSection("");
    setPreviewPlaying(false);
    setPreviewCurrent(0);
    setPreviewDuration(recording?.durationMs ? recording.durationMs / 1000 : 0);
  }, [recording?.id, recording?.durationMs]);

  useEffect(() => {
    setMeetingOutline(recording?.meetingOutline || null);
    setOutlineError(recording?.meetingOutlineError || "");
    setOutlineLoading(recording?.meetingOutlineStatus === "generating");
  }, [
    recording?.id,
    recording?.meetingOutline,
    recording?.meetingOutlineStatus,
    recording?.meetingOutlineError,
  ]);

  const transcriptLines = recording?.transcript || [];
  const transcriptStatus = String(recording?.status || "");
  const isTranscribing =
    ["uploading", "uploaded", "queued", "pending", "processing", "transcribing"].includes(transcriptStatus) ||
    isTencentMeetingWaitingTranscript(recording);
  const isTranscriptGenerating =
    transcriptLines.length === 0 &&
    isTranscribing &&
    recording?.status !== "failed" &&
    !recording?.transcriptHealth?.isFallback &&
    !isTencentMeetingNoTranscript(recording);
  const transcriptionApiEnabled = recording?.transcriptHealth?.apiEnabled !== false;
  const canUseTranscribeAction = transcriptionApiEnabled || recording?.tencentMeeting?.imported;
  const canRetranscribe =
    canUseTranscribeAction &&
    recording?.canManage !== false &&
    typeof onRetranscribe === "function" &&
    (recording?.status === "failed" ||
      recording?.transcriptHealth?.isFallback ||
      (transcriptLines.length === 0 && !isTranscriptGenerating));
  const outlineCount = meetingOutline
    ? (meetingOutline.sections?.length || 0) +
      (meetingOutline.mainPoints?.length || 0) +
      (meetingOutline.keyPoints?.length || 0) +
      (meetingOutline.decisions?.length || 0) +
      (meetingOutline.actionItems?.length || 0) +
      (meetingOutline.risks?.length || 0)
    : 0;

  function seekTo(ms) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, ms / 1000);
    audio.play().catch(() => {});
  }

  function togglePreviewPlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function handlePreviewSeek(event) {
    const audio = audioRef.current;
    const next = Number(event.target.value || 0);
    setPreviewCurrent(next);
    if (audio) audio.currentTime = next;
  }

  async function loadMeetingOutline(forceRefresh = false) {
    if (!recording || outlineLoading || transcriptLines.length === 0) return;
    if (!forceRefresh && meetingOutline) return;
    setOutlineLoading(true);
    setOutlineError("");
    try {
      const payload = await api(`/api/recordings/${encodeURIComponent(recording.id)}/meeting-outline`, {
        method: forceRefresh ? "POST" : "GET",
      });
      if (payload.status === "generating" && !payload.outline) {
        setOutlineLoading(true);
        return;
      }
      setMeetingOutline(payload.outline || null);
      setOutlineLoading(false);
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : "会议提纲生成失败");
      setOutlineLoading(false);
    }
  }

  useEffect(() => {
    if (recording?.status === "ready" && transcriptLines.length > 0) {
      setOpenSection("outline");
    }
  }, [recording?.id, recording?.status, transcriptLines.length]);

  useEffect(() => {
    if (!recording?.id || recording.meetingOutlineStatus !== "generating") return undefined;
    setOutlineLoading(true);
    const interval = window.setInterval(async () => {
      try {
        const payload = await api(`/api/recordings/${encodeURIComponent(recording.id)}`);
        const nextRecording = payload.recording;
        if (!nextRecording) return;
        if (nextRecording.meetingOutline) setMeetingOutline(nextRecording.meetingOutline);
        setOutlineError(nextRecording.meetingOutlineError || "");
        setOutlineLoading(nextRecording.meetingOutlineStatus === "generating");
      } catch {
        // The list-level poll will try again.
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [recording?.id, recording?.meetingOutlineStatus]);

  if (!recording) return null;

  function toggleSection(section) {
    const next = openSection === section ? "" : section;
    setOpenSection(next);
    if (next === "outline" && !meetingOutline && recording?.meetingOutlineStatus !== "generating") {
      loadMeetingOutline();
    }
  }

  function renderMeetingGroup(title, items = [], emptyText = "") {
    if (!items.length) return emptyText ? <p className="record-preview-empty">{emptyText}</p> : null;
    return (
      <div className="meeting-outline-group">
        <h3>{title}</h3>
        {items.map((item, index) => (
          <button
            className="meeting-outline-item"
            key={`${title}-${item.title}-${index}`}
            type="button"
            onClick={() => seekTo(item.startMs || 0)}
          >
            <span>{formatTimecode(item.startMs || 0)}</span>
            <strong>{item.title}</strong>
            <p>
              {item.summary}
              {item.owner ? ` 负责人：${item.owner}` : ""}
              {item.due ? ` 截止：${item.due}` : ""}
            </p>
            {item.evidence ? <small>{item.evidence}</small> : null}
          </button>
        ))}
      </div>
    );
  }

  async function handleShare(mode, event) {
    event.preventDefault();
    event.stopPropagation();
    if (shareBusyMode) return;
    setShareBusyMode(mode);
    try {
      await onShare(mode);
    } finally {
      setShareBusyMode("");
    }
  }

  function handleRetranscribe(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!canRetranscribe) return;
    onRetranscribe();
  }

  return (
    <div className="record-preview-layer" role="dialog" aria-modal="true" aria-label={`${recording.name}转写预览`} onClick={onClose}>
      <section className="record-preview-panel" onClick={(event) => event.stopPropagation()}>
        <header className="record-preview-head">
          <div>
            <span>录音 {String(recording.seq).padStart(3, "0")}</span>
            <h2>{recording.name}</h2>
          </div>
          <button type="button" onClick={onClose}>
            收起
          </button>
        </header>

        <div className="record-preview-body" aria-label="录音内容预览">
          <section className={`preview-section${openSection === "outline" ? " open" : ""}`}>
            <button
              className="preview-section-toggle"
              type="button"
              onClick={() => toggleSection("outline")}
            >
              <span>
                <strong>会议提纲</strong>
                <em>
                  {outlineLoading
                    ? "AI 正在整理"
                    : meetingOutline
                      ? `${outlineCount || 1} 项办公纪要`
                      : transcriptLines.length > 0
                        ? "转写完成后自动生成"
                        : isTranscriptGenerating
                          ? "转写正在生成"
                          : "等待转写后生成"}
                </em>
              </span>
              {openSection === "outline" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {openSection === "outline" ? (
              <div className="meeting-outline-list">
                <div className="meeting-outline-actions">
                  <button type="button" onClick={() => loadMeetingOutline(true)} disabled={outlineLoading || transcriptLines.length === 0}>
                    <RefreshCw size={15} />
                    重新生成会议提纲
                  </button>
                </div>
                {outlineLoading ? (
                  <p className="record-preview-empty">AI 正在分析完整转写，生成会议提纲、主要内容、关键点和待办项。</p>
                ) : outlineError ? (
                  <p className="record-preview-empty">{outlineError}</p>
                ) : meetingOutline ? (
                  <>
                    {meetingOutline.reportMarkdown ? (
                      <article className="meeting-report">
                        {meetingReportBlocks(meetingOutline.reportMarkdown).map((block) => {
                          if (block.type === "heading") return <h3 key={block.id}>{block.text}</h3>;
                          if (block.type === "bullet") return <p className="meeting-report-bullet" key={block.id}>{block.text}</p>;
                          if (block.type === "table") return <p className="meeting-report-table" key={block.id}>{block.text}</p>;
                          return <p key={block.id}>{block.text}</p>;
                        })}
                      </article>
                    ) : (
                      <>
                        <div className="meeting-summary-card">
                          <strong>{meetingOutline.title || "会议纪要"}</strong>
                          <p>{meetingOutline.summary || "AI 已完成会议内容整理。"}</p>
                          <em>{meetingOutline.provider === "local-fallback" ? "本地提纲" : "AI 分析：" + (meetingOutline.model || meetingOutline.provider || "")}</em>
                        </div>
                        {renderMeetingGroup("会议提纲", meetingOutline.sections)}
                        {renderMeetingGroup("主要内容", meetingOutline.mainPoints)}
                        {renderMeetingGroup("关键点", meetingOutline.keyPoints)}
                        {renderMeetingGroup("决议", meetingOutline.decisions)}
                        {renderMeetingGroup("待办项", meetingOutline.actionItems)}
                        {renderMeetingGroup("风险与问题", meetingOutline.risks)}
                      </>
                    )}
                  </>
                ) : isTranscriptGenerating ? (
                  <p className="record-preview-empty">转写正在生成，会议提纲会在逐字稿完成后自动整理。</p>
                ) : (
                  <p className="record-preview-empty">这条录音还没有可用于生成会议提纲的转写内容。</p>
                )}
              </div>
            ) : null}
          </section>

          <section className={`preview-section${openSection === "transcript" ? " open" : ""}`}>
            <button
              className="preview-section-toggle"
              type="button"
              onClick={() => setOpenSection((current) => (current === "transcript" ? "" : "transcript"))}
            >
              <span>
                <strong>逐字转写</strong>
                <em>{transcriptLines.length > 0 ? `${transcriptLines.length} 段文字` : isTranscriptGenerating ? "正在生成" : "暂无文字"}</em>
              </span>
              {openSection === "transcript" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {openSection === "transcript" ? (
              <div className="record-preview-transcript" aria-label="详细文字转写">
                {transcriptLines.length > 0 ? (
                  transcriptLines.map((line) => (
                    <button className="record-preview-line" key={line.id} type="button" onClick={() => seekTo(line.startMs)}>
                      <span>{formatTimecode(line.startMs)}</span>
                      <strong>
                        <em>{line.speakerName || recording.speakerName || "说话人"}</em>
                        {line.text}
                      </strong>
                    </button>
                  ))
                ) : isTranscriptGenerating ? (
                  <div className="record-preview-empty-state">
                    <p className="record-preview-empty">正在生成逐字稿，请稍候，完成后会自动显示。</p>
                  </div>
                ) : (
                  <div className="record-preview-empty-state">
                    <p className="record-preview-empty">这条录音还没有可用的文字转写。</p>
                    {canRetranscribe ? (
                      <button className="record-preview-retry" type="button" onClick={handleRetranscribe}>
                        <RefreshCw size={15} />
                        重新转写
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {recording.translationText ? (
            <section className={`preview-section${openSection === "translation" ? " open" : ""}`}>
              <button
                className="preview-section-toggle"
                type="button"
                onClick={() => setOpenSection((current) => (current === "translation" ? "" : "translation"))}
              >
                <span>
                  <strong>中文翻译</strong>
                  <em>英文录音自动翻译</em>
                </span>
                {openSection === "translation" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {openSection === "translation" ? (
                <div className="record-preview-translation">{recording.translationText}</div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="record-preview-player">
          <audio
            ref={audioRef}
            className="hidden-audio"
            preload="metadata"
            src={mediaRequestUrl(recording.audioUrl, recording.updatedAt || recording.createdAt)}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              setPreviewDuration(Number.isFinite(duration) ? duration : recording.durationMs / 1000 || 0);
            }}
            onTimeUpdate={(event) => setPreviewCurrent(event.currentTarget.currentTime || 0)}
            onPlay={() => setPreviewPlaying(true)}
            onPause={() => setPreviewPlaying(false)}
            onEnded={() => setPreviewPlaying(false)}
          />
          <div className="preview-audio-bar" aria-label="录音播放器">
            <button type="button" onClick={togglePreviewPlay} aria-label={previewPlaying ? "暂停播放" : "播放录音"}>
              {previewPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <span>{formatDuration(previewCurrent * 1000)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, previewDuration)}
              step="0.1"
              value={Math.min(previewCurrent, Math.max(1, previewDuration))}
              onChange={handlePreviewSeek}
              aria-label="播放进度"
            />
            <span>{formatDuration((previewDuration || recording.durationMs / 1000 || 0) * 1000)}</span>
            <Volume2 size={16} />
          </div>
          <div className="record-preview-actions">
            <button className="record-share-main" type="button" onClick={() => setShareMenuOpen((current) => !current)}>
              <Share2 size={15} />
              分享
            </button>
            <button type="button" onClick={onAsk}>
              问答
            </button>
          </div>
          {shareMenuOpen ? (
            <div className="record-share-options" aria-label="分享内容选择" onClick={(event) => event.stopPropagation()}>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("outline", event)}>
                {shareBusyMode === "outline" ? "准备中" : "会议提纲 PDF"}
              </button>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("text", event)}>
                {shareBusyMode === "text" ? "准备中" : "文字 TXT"}
              </button>
              <button type="button" disabled={Boolean(shareBusyMode)} onClick={(event) => handleShare("audio", event)}>
                {shareBusyMode === "audio" ? "准备中" : "录音 MP3"}
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
