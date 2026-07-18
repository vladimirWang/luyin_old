import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FastForward,
  FileAudio,
  FileUp,
  FolderPlus,
  Home,
  ImagePlus,
  Keyboard,
  Link,
  ListMusic,
  LoaderCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Send,
  Settings,
  Share2,
  Star,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import {RecordsView} from './RecordsView.jsx'
import {IconButton} from '../../components/IconButton.jsx'
import { RecordCard } from './RecordCard.jsx'
import { UploadingRecordCard } from './UploadingRecordCard.jsx'
import { RecordPreviewOverlay } from './RecordPreviewOverlay.jsx'
import {
  formatDuration,
  formatShortDate,
  formatDate,
  formatTimecode,
  isToday,
  uiText,
  safeFileName,
  safeFileNameWithExtension,
  downloadBlob,
  openDownloadUrl,
  audioExtensionFromMimeType,
  canRequestMicrophone,
  getSupportedMimeType,
  microphoneErrorMessage,
  cleanQaVisibleText,
  cleanAnswerForDisplay,
  answerBlocksForDisplay,
  structuredAnswerFromItem,
  pointLabelForIndex,
  thinkingStepsForMessage,
  stripQaInternalIndexMarkers,
  recordDateToneClass,
  recordVisualClass,
  recordingStatusLabel,
  recordingDetailStatusLabel,
  recordingDurationLabel,
  formatClockTime,
  formatCardDateParts,
  isEnglishLanguage,
  recordTitleSize,
  recordSourceMeta,
  transcriptTextForRecording,
  transcriptPlainTextForRecording,
  transcriptTextFileForRecording,
  recordingListSignature,
  isFreshUploadLikeRecording,
  mergeFreshUploadRecordings,
  isImageFile,
  canvasToBlob,
  blobToDataUrl,
  repairKnownMojibake,
  looksLikeMojibake,
  looksLikeTechnicalAnswerLeak,
  parseStructuredAnswer,
  structuredAnswerToPlainText,
  meetingReportBlocks,
  speakersForRecording,
  speakerDraftsForRecording,
  isTencentMeetingWaitingDownload,
  isTencentMeetingRecorderPen,
  isTencentMeetingNoTranscript,
  isTencentMeetingWaitingTranscript,
  getClientId,
  getStoredAuth,
  clearStoredAuth,
  readStoredJson,
  getLocalProfile,
  saveLocalProfile,
  sharedProfileDefaults,
  getClientName,
  getAccountDisplayName,
  getDetectedWecomName,
  profileStorageKey,
  showToast,
  dailyBriefMeetingCount,
  api,
  fetchWithClient,
  dailyBriefDisplayDate
} from '../../utils/index.js'
import {loadImageSource, compressAvatarImage} from '../../utils/image.js'
import { isInWeCom } from '../../utils/wecom.js'
import {useUploadManager} from '../../hooks/useUploadManager.js'
import { useWecomAuthStore } from '../../stores/useWecomAuthStore.js'
import {QA_ACTIVE_MESSAGE_KEY, DAILY_BRIEF_ACTIVE_KEY, PROFILE_STORAGE_KEY} from '../../constant.js'
import {appendUrlParam} from '../../utils/index.js'

const cardColors = ["coral", "indigo", "violet", "teal", "clay", "ink"];

function getWecomUserId() {
  const profile = getLocalProfile();
  return String(profile.wecomUserId || "").trim();
}

function mergeRequestHeaders(headers = {}) {
  const next = new Headers(headers);
  const clientName = getClientName();
  const wecomName = getDetectedWecomName();
  const auth = getStoredAuth();
  next.set("X-Client-Id", getClientId());
  next.set("X-Client-Name", encodeURIComponent(clientName));
  if (auth?.token) next.set("X-Auth-Token", auth.token);
  const wecomUserId = getWecomUserId();
  if (wecomUserId) next.set("X-Wecom-User-Id", encodeURIComponent(wecomUserId));
  if (wecomName) next.set("X-Wecom-User-Name", encodeURIComponent(wecomName));
  return next;
}

function normalizeDailyBriefTitle(value = "") {
  return cleanQaVisibleText(value, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isDailyBriefRecordingHeading(text = "") {
  return /^\d+[.、]\s*/.test(cleanQaVisibleText(text, ""));
}

function isDailyBriefSectionHeading(text = "") {
  const value = cleanQaVisibleText(text, "");
  return /^(今日会议简报|[一二三四五六七八九十]+、|\d+[.、]\s*)/.test(value);
}

function matchDailyBriefRecordingState(text = "", recordingStates = []) {
  if (!isDailyBriefRecordingHeading(text)) return null;
  const title = normalizeDailyBriefTitle(text);
  if (!title) return null;
  return recordingStates.find((state) => {
    const name = normalizeDailyBriefTitle(state?.name || state?.title || "");
    return name && (title.includes(name) || name.includes(title));
  }) || null;
}

function dailyBriefOutlineWaitingText(state) {
  if (!state || state.hasMeetingOutline || state.meetingOutlineStatus === "ready") return "";
  if (!state.transcriptReady || ["uploaded", "uploading", "processing", "transcribing"].includes(state.status)) {
    return "这条录音还在转写，今日简报先保留位置。转写和会议提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "generating") {
    return "这条录音的会议提纲正在生成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
  }
  if (state.meetingOutlineStatus === "failed") {
    return "这条录音的会议提纲暂未生成成功，今日简报先保留位置。请先重新转写或生成提纲后再更新。";
  }
  return "这条录音的会议提纲还没有生成完成，今日简报先保留位置。提纲完成后，可在标题旁更新这一条。";
}

function canRefreshDailyBriefRecording(state) {
  return Boolean(state?.canRefreshDailyBriefItem || state?.hasMeetingOutline || state?.meetingOutlineStatus === "ready");
}

function renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading }) {
  if (onSpeakLine) {
    return (
      <button
        className={`${className} daily-brief-line-button ${active ? "active" : ""}`.trim()}
        key={`daily-brief-line-${index}`}
        type="button"
        onClick={(event) => onSpeakLine({ event, text: visibleText, index, itemId, label: heading ? "朗读标题" : "朗读段落" })}
      >
        {visibleText}
      </button>
    );
  }
  return (
    <p className={className} key={`daily-brief-line-${index}`}>
      {visibleText || text}
    </p>
  );
}

function renderDailyBriefLines(markdown = "", options = {}) {
  const {
    speechIdPrefix = "daily-brief-line",
    ttsState,
    onSpeakLine,
    recordingStates = [],
    refreshingRecordingIds,
    briefDate,
    onRefreshRecording,
  } = options;
  const lines = String(markdown || "").split(/\r?\n/);
  let waitingRecordingState = null;

  return lines.flatMap((line, index) => {
    const text = cleanQaVisibleText(line, "");
    const recordingState = matchDailyBriefRecordingState(text, recordingStates);
    const waitingText = dailyBriefOutlineWaitingText(recordingState);

    if (!text) return waitingRecordingState ? [] : [<div className="daily-brief-gap" key={`daily-brief-gap-${index}`} />];
    if (isDailyBriefSectionHeading(text)) waitingRecordingState = waitingText ? recordingState : null;
    else if (waitingRecordingState) return [];

    const heading = isDailyBriefSectionHeading(text);
    const bullet = /^[-*]\s*/.test(text);
    const visibleText = text.replace(/^[-*]\s*/, bullet ? "• " : "");
    const className = heading ? "daily-brief-line heading" : bullet ? "daily-brief-line bullet" : "daily-brief-line";
    const itemId = `${speechIdPrefix}-line-${index}`;
    const active = ttsState?.itemId === itemId && (ttsState.playing || ttsState.loading);
    const lineElement = renderDailyBriefLineElement({ text, visibleText, className, index, itemId, active, onSpeakLine, heading });

    if (!recordingState) return [lineElement];

    const refreshing = Boolean(refreshingRecordingIds?.has?.(recordingState.id));
    const canRefresh = canRefreshDailyBriefRecording(recordingState) && typeof onRefreshRecording === "function";
    return [
      <div className="daily-brief-recording-heading-row" key={`daily-brief-recording-heading-${index}`}>
        <div className="daily-brief-recording-heading-text">{lineElement}</div>
        {canRefresh ? (
          <button
            className="daily-brief-recording-refresh"
            type="button"
            disabled={refreshing}
            onClick={(event) => onRefreshRecording(recordingState, briefDate, event)}
          >
            {refreshing ? <LoaderCircle className="spin-icon" size={13} /> : <RefreshCw size={13} />}
            <span>{refreshing ? "更新中" : "重新生成此条"}</span>
          </button>
        ) : null}
      </div>,
      waitingText ? (
        <div className="daily-brief-outline-waiting" key={`daily-brief-outline-waiting-${index}`}>
          {waitingText}
        </div>
      ) : null,
    ].filter(Boolean);
  });
}

function dailyBriefListContent(brief, meetingCount = 0, loading = false) {
  const saved = cleanQaVisibleText(brief?.summaryMarkdown || "", "");
  if (saved) return saved;
  const displayDate = dailyBriefDisplayDate(brief);
  if (loading || brief?.status === "generating") {
    return [
      `今日会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
      "",
      "正在生成",
      "系统正在汇总当天录音的会议提纲，完成后会自动展示在这张卡片里。",
    ].join("\n");
  }
  if (!meetingCount) {
    return [`会议简报｜${displayDate}`, "", "当天暂无可总结的录音。"].join("\n");
  }
  return [
    `会议简报｜${displayDate}｜共 ${meetingCount} 场会议`,
    "",
    "展开后会生成并展示当天录音的核心内容。",
    "你可以朗读内容，也可以在生成完成后分享 PDF。",
  ].join("\n");
}

function dailyBriefHasSummary(brief) {
  return Boolean(cleanQaVisibleText(brief?.summaryMarkdown || "", ""));
}

function DailyBriefListView({
  briefs,
  expandedDates,
  generatingDates,
  ttsState,
  refreshingRecordingIds,
  onToggle,
  onGenerate,
  onSpeak,
  onSpeakLine,
  onShare,
  onRefreshRecording,
}) {
  if (!briefs.length) {
    return (
      <div className="daily-brief-list-empty">
        <strong>还没有会议简报</strong>
        <span>上传录音后，会按日期生成每天一张简报卡。</span>
      </div>
    );
  }

  return (
    <div className="daily-brief-list" aria-label="会议简报列表">
      {briefs.map((brief) => {
        const date = brief.date || "";
        const expanded = expandedDates.has(date);
        const meetingCount = dailyBriefMeetingCount(brief, 0);
        const generating = generatingDates.has(date) || brief.status === "generating";
        const hasSummary = dailyBriefHasSummary(brief);
        const content = dailyBriefListContent(brief, meetingCount, generating);
        const speechId = `daily-brief-${date}`;
        const speaking = ttsState.itemId === speechId && ttsState.playing;
        const speechLoading = ttsState.itemId === speechId && ttsState.loading;

        return (
          <article className={expanded ? "daily-brief-list-card expanded" : "daily-brief-list-card"} key={date || brief.id}>
            <div className="daily-brief-list-header">
              <button className="daily-brief-list-toggle" type="button" onClick={() => onToggle(brief)}>
                <span className="daily-brief-list-date">{dailyBriefDisplayDate(brief)}</span>
                <span className="daily-brief-list-main">
                  <strong>{brief.title || "会议简报"}</strong>
                  <em>{meetingCount ? `${meetingCount} 场会议` : "暂无录音"}</em>
                </span>
                <span className={generating ? "daily-brief-list-status generating" : "daily-brief-list-status"}>
                  {generating ? "生成中" : hasSummary ? "已生成" : "待生成"}
                </span>
                <span className="daily-brief-list-chevron" aria-hidden="true">
                  {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
              </button>
            </div>

            {expanded ? (
              <div className="daily-brief-list-content">
                <div className="daily-brief-list-body">
                  {renderDailyBriefLines(content, {
                    speechIdPrefix: speechId,
                    ttsState,
                    recordingStates: brief.recordingStates || [],
                    refreshingRecordingIds,
                    briefDate: date,
                    onRefreshRecording,
                    onSpeakLine: (line) => onSpeakLine?.(brief, line),
                  })}
                </div>
                <div className="daily-brief-list-actions">
                  {meetingCount > 0 ? (
                    <button type="button" onClick={(event) => onGenerate(brief, event)} disabled={generating}>
                      {generating ? <LoaderCircle className="spin-icon" size={14} /> : <RefreshCw size={14} />}
                      <span>{hasSummary ? "重新生成" : "生成简报"}</span>
                    </button>
                  ) : null}
                  <button type="button" onClick={(event) => onSpeak(brief, event)} disabled={!content.trim()}>
                    {speechLoading ? <LoaderCircle className="spin-icon" size={14} /> : speaking ? <Pause size={14} /> : <Play size={14} />}
                    <span>{speaking ? "停止朗读" : "朗读内容"}</span>
                  </button>
                  <button type="button" onClick={(event) => onShare(brief, event)} disabled={!hasSummary || generating}>
                    <Share2 size={14} />
                    <span>分享 PDF</span>
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

// function LegacyDetailView({ recording, transcriptionStatus, onBack, onRefreshRecording, onRename, onUpdateMeta }) {
//   const audioRef = useRef(null);
//   const [playing, setPlaying] = useState(false);
//   const [current, setCurrent] = useState(0);
//   const [duration, setDuration] = useState(recording?.durationMs ? recording.durationMs / 1000 : 0);
//   const [question, setQuestion] = useState("");
//   const [answers, setAnswers] = useState([]);
//   const [asking, setAsking] = useState(false);
//   const detailQaPollingRef = useRef(new Map());
//   const [draftName, setDraftName] = useState(recording?.name || "");
//   const [nameStatus, setNameStatus] = useState("saved");
//   const [draftTag, setDraftTag] = useState(recording?.tag || "");
//   const [tagStatus, setTagStatus] = useState("saved");
//   const [speakerDrafts, setSpeakerDrafts] = useState(() => speakerDraftsForRecording(recording));
//   const [selectedSpeakerKey, setSelectedSpeakerKey] = useState("");
//   const [transcriptExpanded, setTranscriptExpanded] = useState(false);
//   const speakers = useMemo(() => speakersForRecording(recording), [recording]);

//   useEffect(() => {
//     setPlaying(false);
//     setCurrent(0);
//     setDuration(recording?.durationMs ? recording.durationMs / 1000 : 0);
//     setAnswers([]);
//     setQuestion("");
//     setDraftName(recording?.name || "");
//     setNameStatus("saved");
//     setDraftTag(recording?.tag || "");
//     setTagStatus("saved");
//     setSpeakerDrafts(speakerDraftsForRecording(recording));
//     setSelectedSpeakerKey(speakersForRecording(recording)[0]?.key || "");
//     setTranscriptExpanded(false);
//   }, [recording?.id, recording?.name, recording?.durationMs, recording?.speakerName, recording?.tag, recording?.speakerMap, recording?.speakers]);

//   useEffect(
//     () => () => {
//       detailQaPollingRef.current.forEach((timer) => window.clearTimeout(timer));
//       detailQaPollingRef.current.clear();
//     },
//     [],
//   );

//   if (!recording) {
//     return (
//       <section className="screen detail-screen">
//         <button className="ghost-back" type="button" onClick={onBack}>
//           <ArrowLeft size={20} />
//           返回
//         </button>
//         <div className="empty-state">
//           <div className="empty-icon">
//             <ListMusic size={40} />
//           </div>
//           <h2>还没有可查看的详情</h2>
//           <p>录一段音后，详情页会显示播放、转写和提问。</p>
//         </div>
//       </section>
//     );
//   }

//   function seekTo(ms) {
//     const audio = audioRef.current;
//     if (!audio) return;
//     audio.currentTime = Math.max(0, ms / 1000);
//     setCurrent(audio.currentTime);
//     audio.play().catch(() => {});
//   }

//   function skip(seconds) {
//     const audio = audioRef.current;
//     if (!audio) return;
//     audio.currentTime = Math.max(0, Math.min(audio.duration || duration || 0, audio.currentTime + seconds));
//   }

//   function togglePlay() {
//     const audio = audioRef.current;
//     if (!audio) return;
//     if (audio.paused) audio.play().catch(() => {});
//     else audio.pause();
//   }

//   async function askRecording(event) {
//     event.preventDefault();
//     const trimmed = question.trim();
//     if (!trimmed || asking) return;

//     setAsking(true);
//     try {
//       const payload = await api(`/api/recordings/${recording.id}/ask`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ question: trimmed }),
//       });
//       setAnswers((currentAnswers) => [payload.message, ...currentAnswers]);
//       setQuestion("");
//       if (payload.message?.pending) pollDetailQaMessage(payload.message.id, 0);
//     } finally {
//       setAsking(false);
//     }
//   }

//   function pollDetailQaMessage(id, attempt = 0) {
//     if (!id || detailQaPollingRef.current.has(id)) return;
//     const timer = window.setTimeout(async () => {
//       detailQaPollingRef.current.delete(id);
//       try {
//         const payload = await api(`/api/qa-messages/${encodeURIComponent(id)}`);
//         if (payload.message) {
//           setAnswers((currentAnswers) =>
//             currentAnswers.map((item) => (item.id === payload.message.id ? { ...item, ...payload.message } : item)),
//           );
//           if (payload.message.pending && attempt < 180) pollDetailQaMessage(id, attempt + 1);
//         }
//       } catch {
//         if (attempt < 30) pollDetailQaMessage(id, attempt + 1);
//       }
//     }, attempt === 0 ? 900 : 1800);
//     detailQaPollingRef.current.set(id, timer);
//   }

//   async function transcribeAgain() {
//     if (!canUseTranscribeAction) return;
//     await api(`/api/recordings/${recording.id}/transcribe`, { method: "POST" });
//     onRefreshRecording(recording.id);
//   }

//   async function commitDetailMeta() {
//     const tag = draftTag.trim();
//     setDraftTag(tag);
//     if (tag !== (recording.tag || "")) {
//       setTagStatus("saving");
//       try {
//         await onUpdateMeta(recording.id, { tag });
//         setTagStatus("saved");
//       } catch {
//         setTagStatus("dirty");
//       }
//       return;
//     }
//     setTagStatus("saved");
//   }

//   async function commitDetailName() {
//     const nextName = draftName.trim() || recording.name;
//     setDraftName(nextName);
//     if (nextName !== recording.name) {
//       setNameStatus("saving");
//       try {
//         await onRename(recording.id, nextName);
//         setNameStatus("saved");
//       } catch {
//         setNameStatus("dirty");
//       }
//       return;
//     }
//     setNameStatus("saved");
//   }

//   function updateSpeakerDraft(key, value) {
//     setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: value }));
//   }

//   function commitSpeakerName(key) {
//     const nextName = (speakerDrafts[key] || "").trim() || "说话人";
//     const nextSpeakerMap = {
//       ...(recording.speakerMap || {}),
//       [key]: nextName,
//     };
//     setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: nextName }));
//     onUpdateMeta(recording.id, { speakerMap: nextSpeakerMap, speakerName: speakers[0]?.key === key ? nextName : recording.speakerName });
//   }

//   const transcriptText = recording.transcriptText || recording.transcript.map((line) => line.text).join("\n");
//   const transcriptHealth = recording.transcriptHealth || transcriptionStatus || {};
//   const transcriptionApiEnabled = transcriptHealth.apiEnabled !== false;
//   const canUseTranscribeAction = transcriptionApiEnabled || recording.tencentMeeting?.imported;
//   const isFallbackTranscript = Boolean(transcriptHealth.isFallback);

//   return (
//     <section className="screen detail-screen" aria-label="录音详情">
//       <header className="detail-header">
//         <button className="ghost-back" type="button" onClick={onBack}>
//           <ArrowLeft size={20} />
//           记录
//         </button>
//         <span className={`detail-status ${recording.status}`}>
//           {recordingDetailStatusLabel(recording)}
//         </span>
//       </header>

//       <div className="detail-title-row">
//         <div>
//           <p className="eyebrow">录音 {String(recording.seq).padStart(3, "0")}</p>
//           <input
//             className={`detail-title-input ${nameStatus}`}
//             aria-label="录音名称"
//             value={draftName}
//             onChange={(event) => {
//               setDraftName(event.target.value);
//               setNameStatus("dirty");
//             }}
//             onBlur={commitDetailName}
//             onKeyDown={(event) => {
//               if (event.key === "Enter") event.currentTarget.blur();
//             }}
//           />
//         </div>
//         <span className={`favorite-badge ${recording.favorite ? "on" : ""}`}>
//           <Star size={16} fill={recording.favorite ? "currentColor" : "none"} />
//           {recording.favorite ? "已收藏" : "普通"}
//         </span>
//       </div>

//       <div className="detail-meta-editor">
//         <label>
//           标记
//           <div className={`tag-save-field ${tagStatus}`}>
//             <input
//               value={draftTag}
//               onChange={(event) => {
//                 setDraftTag(event.target.value);
//                 setTagStatus("dirty");
//               }}
//               onBlur={() => {
//                 commitDetailMeta();
//               }}
//               onKeyDown={(event) => {
//                 if (event.key === "Enter") event.currentTarget.blur();
//               }}
//               placeholder="例如：物业、会议、客户"
//             />
//             <button
//               type="button"
//               disabled={tagStatus === "saving"}
//               onMouseDown={(event) => event.preventDefault()}
//               onClick={commitDetailMeta}
//             >
//               {tagStatus === "saving" ? <LoaderCircle className="spin-icon" size={15} /> : <Check size={15} />}
//               <span>{tagStatus === "dirty" ? "保存" : tagStatus === "saving" ? "保存中" : "已保存"}</span>
//             </button>
//           </div>
//         </label>
//       </div>

//       <div className="speaker-editor" aria-label="说话人">
//         {speakers.map((speaker) => (
//           <div className={selectedSpeakerKey === speaker.key ? "speaker-editor-row active" : "speaker-editor-row"} key={speaker.key}>
//             <button type="button" onClick={() => setSelectedSpeakerKey((current) => (current === speaker.key ? "" : speaker.key))}>
//               <UserRound size={15} />
//               <span>{formatDuration(speaker.totalMs)}</span>
//             </button>
//             <input
//               value={speakerDrafts[speaker.key] || speaker.name}
//               onChange={(event) => updateSpeakerDraft(speaker.key, event.target.value)}
//               onBlur={() => commitSpeakerName(speaker.key)}
//               onKeyDown={(event) => {
//                 if (event.key === "Enter") event.currentTarget.blur();
//               }}
//               aria-label={`${speaker.name}名称`}
//             />
//           </div>
//         ))}
//       </div>

//       <div className="player-panel">
//         <audio
//           ref={audioRef}
//             src={mediaRequestUrl(recording.audioUrl, recording.updatedAt || recording.createdAt)}
//           controlsList="nodownload noremoteplayback"
//           disablePictureInPicture
//           disableRemotePlayback
//           onPlay={() => setPlaying(true)}
//           onPause={() => setPlaying(false)}
//           onEnded={() => setPlaying(false)}
//           onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || recording.durationMs / 1000)}
//           onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
//         />
//         <div className="mini-wave">
//           {Array.from({ length: 28 }).map((_, index) => (
//             <span key={index} style={{ "--bar": `${24 + ((index * 37) % 58)}%` }} />
//           ))}
//         </div>
//         <input
//           className="progress"
//           type="range"
//           min="0"
//           max={duration || 1}
//           step="0.1"
//           value={Math.min(current, duration || 1)}
//           onChange={(event) => seekTo(Number(event.target.value) * 1000)}
//           aria-label="播放进度"
//         />
//         <div className="time-row">
//           <span>{formatDuration(current * 1000)}</span>
//           <span>{formatDuration((duration || 0) * 1000)}</span>
//         </div>
//         <div className="player-controls">
//           <IconButton label="后退十秒" onClick={() => skip(-10)}>
//             <Rewind size={23} />
//           </IconButton>
//           <button className="play-button" type="button" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>
//             {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
//           </button>
//           <IconButton label="快进十秒" onClick={() => skip(10)}>
//             <FastForward size={23} />
//           </IconButton>
//         </div>
//       </div>

//       <div className="detail-lower">
//         <div className={transcriptExpanded ? "transcript-panel expanded" : "transcript-panel collapsed"}>
//           <div className="panel-heading">
//             <div>
//               <h2>转写内容</h2>
//               <span className={isFallbackTranscript ? "transcript-health warn" : "transcript-health"}>
//                 {recording.tencentMeeting?.imported && !transcriptionApiEnabled
//                   ? "腾讯会议自带转写"
//                   : !transcriptionApiEnabled
//                   ? "录音 API 转写已停用"
//                   : isFallbackTranscript
//                   ? "模拟转写，需要重新转写"
//                   : transcriptHealth.configured === false
//                     ? "真实转写未配置"
//                     : `转写服务：${recording.transcriptProvider || transcriptionStatus?.mode || "local"}`}
//               </span>
//             </div>
//             <div className="transcript-actions">
//               <button type="button" onClick={() => setTranscriptExpanded((current) => !current)}>
//                 {transcriptExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
//                 {transcriptExpanded ? "收起" : "展开"}
//               </button>
//               {canUseTranscribeAction ? (
//                 <button type="button" onClick={transcribeAgain}>
//                   <RefreshCw size={16} />
//                   {recording.tencentMeeting?.imported && !transcriptionApiEnabled ? "同步转写" : "重新转写"}
//                 </button>
//               ) : null}
//             </div>
//           </div>
//           {transcriptHealth.message ? <p className={isFallbackTranscript ? "transcript-warning" : "transcript-note"}>{transcriptHealth.message}</p> : null}
//           {transcriptText ? (
//             <div className="transcript-full">
//               <h3>全文</h3>
//               <p>{transcriptText}</p>
//             </div>
//           ) : null}
//           <div className="transcript-lines">
//             {recording.transcript.length > 0 ? (
//               recording.transcript.map((line) => (
//                 <button
//                   className={`transcript-line${selectedSpeakerKey && line.speakerKey === selectedSpeakerKey ? " is-highlight" : ""}${
//                     selectedSpeakerKey && line.speakerKey !== selectedSpeakerKey ? " is-dim" : ""
//                   }`}
//                   key={line.id}
//                   type="button"
//                   onClick={() => seekTo(line.startMs)}
//                 >
//                   <span>{formatTimecode(line.startMs)}</span>
//                   <strong>
//                     <em>{line.speakerName || recording.speakerName || "说话人 1"}</em>
//                     {line.text}
//                   </strong>
//                 </button>
//               ))
//             ) : (
//               <p className="muted-copy">服务器正在分析音频，稍后刷新即可查看转写。</p>
//             )}
//           </div>
//         </div>

//         <div className="ask-panel">
//           <form className="ask-form" onSubmit={askRecording}>
//             <Search size={18} />
//             <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="对这条录音提问" />
//             <button type="submit" aria-label="发送问题" disabled={asking}>
//               {asking ? <LoaderCircle className="spin-icon" size={18} /> : <Send className="send-icon" size={18} />}
//             </button>
//           </form>

//           {answers.length > 0 ? (
//             <div className="answer-list">
//               {answers.map((item) => (
//                 <article key={item.id} className="answer-card">
//                   <strong>{item.question}</strong>
//                   <p>{item.pending ? "正在思考，答案生成后会自动显示。" : item.answer}</p>
//                   {!item.pending && Array.isArray(item.citations) && item.citations.length > 0 ? (
//                     <div className="answer-citations" aria-label="回答索引">
//                       {item.citations.map((citation) => (
//                         <button
//                           type="button"
//                           key={`${citation.segmentId}-${citation.startMs}`}
//                           onClick={() => seekTo(citation.startMs)}
//                         >
//                           <span>{formatTimecode(citation.startMs)}</span>
//                           <em>{citation.text}</em>
//                         </button>
//                       ))}
//                     </div>
//                   ) : !item.pending && typeof item.jumpToMs === "number" ? (
//                     <button type="button" onClick={() => seekTo(item.jumpToMs)}>
//                       定位到 {formatTimecode(item.jumpToMs)}
//                     </button>
//                   ) : null}
//                 </article>
//               ))}
//             </div>
//           ) : null}
//         </div>
//       </div>
//     </section>
//   );
// }

function ShareSheet({ share, onCopy, onClose }) {
  if (!share) return null;

  return (
    <div className="share-sheet-layer">
      <button className="share-sheet-scrim" type="button" aria-label="关闭分享面板" onClick={onClose} />
      <section className="share-sheet" aria-label="分享录音">
        <header>
          <div>
            <p className="eyebrow">Share</p>
            <h2>分享录音</h2>
          </div>
          <IconButton label="关闭分享" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <textarea readOnly value={share.text} onFocus={(event) => event.currentTarget.select()} />
        <button className="primary-pill" type="button" onClick={onCopy}>
          <Share2 size={17} />
          复制分享内容
        </button>
      </section>
    </div>
  );
}

function SettingsDrawer({ open, profile, wecomUser, setProfile, onLogout, onClose }) {
  const language = profile.language || "中文";
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const displayName = String(wecomUser?.name || profile.wecomName || profile.name || "").trim() || uiText(language, "未设置姓名", "Name not set");
  const displaySubline = avatarBusy
    ? uiText(language, "正在压缩头像...", "Compressing avatar...")
    : wecomUser?.position || profile.department || profile.company || uiText(language, "企业微信", "WeCom");

  async function handleAvatarChange(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || avatarBusy) return;
    if (!isImageFile(file)) {
      window.alert(uiText(language, "请选择图片文件", "Please choose an image file"));
      return;
    }
    setAvatarBusy(true);
    try {
      const avatarUrl = await compressAvatarImage(file);
      setProfile((current) => {
        const next = { ...current, avatarUrl };
        saveLocalProfile(next);
        return next;
      });
    } catch (error) {
      console.warn("Avatar compression failed:", error);
      window.alert(
        uiText(
          language,
          error instanceof Error ? error.message : "图片太大，请重新上传。",
          "The avatar image is too large or cannot be read. Please upload a smaller image.",
        ),
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className={open ? "drawer-layer open" : "drawer-layer"} aria-hidden={!open}>
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label={uiText(language, "关闭设置遮罩", "Close settings")} tabIndex={open ? 0 : -1} />
      <aside className="settings-drawer settings-drawer-signed-in" inert={open ? undefined : true}>
        <header>
          <div>
            <p className="eyebrow">Settings</p>
            <h2>{uiText(language, "个人信息", "Profile")}</h2>
          </div>
          <IconButton label={uiText(language, "关闭设置面板", "Close settings panel")} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>

        <div className="profile-card">
          <button
            className="avatar-uploader"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarBusy}
            aria-busy={avatarBusy}
            aria-label={uiText(language, "上传头像", "Upload avatar")}
          >
            <span className="avatar">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <UserRound size={34} />}
            </span>
          </button>
          <input ref={avatarInputRef} className="avatar-input" type="file" accept="image/*" onChange={handleAvatarChange} tabIndex={-1} />
          <div>
            <strong>{displayName}</strong>
            <span>{displaySubline}</span>
          </div>
        </div>

        <div className="settings-logout-footer">
          <button className="account-logout-button" type="button" onClick={onLogout}>
            {uiText(language, "退出企业微信登录", "Sign out of WeCom")}
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function RecordsPage() {
  const routerNavigate = useNavigate();
  const wecomUser = useWecomAuthStore((state) => state.user);
  const clearWecomUser = useWecomAuthStore((state) => state.clearUser);
  const [recordings, setRecordings] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderStats, setFolderStats] = useState({ totalCount: 0, favoriteCount: 0, uncategorizedCount: 0, trashCount: 0 });
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareSheet, setShareSheet] = useState(null);
  const [deletingRecordIds, setDeletingRecordIds] = useState([]);
  const {
    uploadingRecords,
    uploadBusy,
    createUploadCard,
    updateUploadCard,
    failUploadCard,
    finishUploadCard,
    // uploadRecording,
    uploadRecordingSegments,
  } = useUploadManager({
    onRecordingCreated: (recording) => {
      setRecordings((current) => [recording, ...current.filter((item) => item.id !== recording.id)]);
    },
    onRefresh: () => {
      refreshRecordings("", selectedFolderId).catch(() => {});
      refreshFolders().catch(() => {});
    },
  });

  const optimisticRemovedRecordIdsRef = useRef(new Set());
  const optimisticRemovalTimersRef = useRef(new Map());

  const recordsForView = useMemo(() => {
    if (selectedFolderId === "trash") return recordings;
    return [...uploadingRecords, ...recordings];
  }, [recordings, selectedFolderId, uploadingRecords]);

  useEffect(
    () => () => {
      optimisticRemovalTimersRef.current.forEach((timer) => clearTimeout(timer));
      optimisticRemovalTimersRef.current.clear();
    },
    [],
  );

  async function refreshFolders() {
    const payload = await api("/api/folders");
    setFolders(payload.folders);
    setFolderStats({
      totalCount: payload.totalCount || 0,
      favoriteCount: payload.favoriteCount || 0,
      uncategorizedCount: payload.uncategorizedCount || 0,
      trashCount: payload.trashCount || 0,
    });
  }

  async function refreshRecordings(nextQuery = "", nextFolderId = selectedFolderId, options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("q", nextQuery);
      params.set("folderId", nextFolderId);
      const payload = await api(`/api/recordings?${params.toString()}`);
      const nextRecordings = (payload.recordings || []).filter((item) => !optimisticRemovedRecordIdsRef.current.has(item.id));
      setRecordings((current) => {
        const mergedRecordings = mergeFreshUploadRecordings(nextRecordings, current, optimisticRemovedRecordIdsRef.current);
        return recordingListSignature(current) === recordingListSignature(mergedRecordings) ? current : mergedRecordings;
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function refreshRecording(id) {
    const payload = await api(`/api/recordings/${id}`);
    setRecordings((current) =>
      current.some((item) => item.id === id)
        ? current.map((item) => (item.id === id ? payload.recording : item))
        : [payload.recording, ...current],
    );
  }

  useEffect(() => {
    const sharedId = new URLSearchParams(window.location.search).get("recording");
    if (sharedId) {
      routerNavigate(`/detail?id=${encodeURIComponent(sharedId)}`, { replace: true });
    }
    refreshRecordings("");
    refreshFolders().catch(() => {});
    api("/api/profile")
      .then((payload) => {
        const serverProfile = payload.profile || {};
        const localProfile = getLocalProfile();
        const serverDefaults = sharedProfileDefaults(serverProfile);
        const serverOwnProfile = serverProfile.clientProfileSaved ? serverProfile : {};
        const mergedProfile = {
          ...serverDefaults,
          ...localProfile,
          ...serverOwnProfile,
          clientId: serverProfile.clientId || localProfile.clientId || getClientId(),
        };
        const accountName = getAccountDisplayName(mergedProfile);
        const normalizedProfile = accountName
          ? {
              ...mergedProfile,
              name: accountName,
              username: accountName,
            }
          : mergedProfile;
        setProfile(normalizedProfile);
        saveLocalProfile(normalizedProfile);
      })
      .catch(() => {
        const localProfile = getLocalProfile();
        const accountName = getAccountDisplayName(localProfile);
        const normalizedProfile = accountName
          ? {
              ...localProfile,
              name: accountName,
              username: accountName,
            }
          : localProfile;
        if (Object.keys(normalizedProfile).length > 0) setProfile(normalizedProfile);
      });

  }, []);

  useEffect(() => {
    if (Object.keys(profile || {}).length > 0) saveLocalProfile(profile);
  }, [profile]);

  async function createFolder(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;

    const optimisticId = `creating-${Date.now()}`;
    const optimisticFolder = {
      id: optimisticId,
      name: trimmed,
      count: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setFolders((current) => [...current, optimisticFolder]);
    showToast("正在创建文件夹");

    try {
      const payload = await api("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      setFolders((current) =>
        current.map((folder) => (folder.id === optimisticId ? payload.folder : folder)),
      );
      setSelectedFolderId(payload.folder.id);
      refreshFolders().catch(() => {});
      showToast("文件夹已创建");
    } catch (error) {
      setFolders((current) => current.filter((folder) => folder.id !== optimisticId));
      showToast(error instanceof Error ? error.message : "文件夹创建失败");
    }
  }

  async function renameFolder(id, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;

    await api(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    await refreshFolders();
    showToast("文件夹已重命名");
  }

  async function deleteFolder(id) {
    await api(`/api/folders/${id}`, { method: "DELETE" });
    if (selectedFolderId === id) setSelectedFolderId("all");
    await refreshFolders();
    await refreshRecordings("", selectedFolderId === id ? "all" : selectedFolderId);
    showToast("文件夹已删除，录音已回到未分类");
  }

  async function moveRecording(id, folderId) {
    const payload = await api(`/api/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });

    setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
    await refreshFolders();
    if (selectedFolderId !== "all") {
      await refreshRecordings("", selectedFolderId);
    }
  }

  async function renameRecording(id, name) {
    const payload = await api(`/api/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
  }

  async function updateRecordingMeta(id, patch) {
    const previous = recordings;
    setRecordings((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    try {
      const payload = await api(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setRecordings((current) => current.map((item) => (item.id === id ? payload.recording : item)));
      if (Object.prototype.hasOwnProperty.call(patch, "shared")) {
        showToast(payload.recording.shared ? "已开启共享" : "已设为仅自己可见");
      }
    } catch (error) {
      setRecordings(previous);
      showToast(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function toggleFavorite(recording) {
    const payload = await api(`/api/recordings/${recording.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !recording.favorite }),
    });
    setRecordings((current) => current.map((item) => (item.id === recording.id ? payload.recording : item)));
    refreshFolders().catch(() => {});
    if (selectedFolderId === "favorites") {
      refreshRecordings("", "favorites").catch(() => {});
    }
  }

  async function retranscribeRecording(recording) {
    if (!recording?.id || recording.status === "transcribing" || recording.status === "processing") return;
    if (recording.transcriptHealth?.apiEnabled === false && !recording.tencentMeeting?.imported) {
      showToast("录音 API 转写已停用");
      return;
    }
    showToast("已开始重新转写");
    setRecordings((current) =>
      current.map((item) =>
        item.id === recording.id
          ? { ...item, status: "transcribing", errorMessage: "", transcriptHealth: { ...(item.transcriptHealth || {}), isFallback: false } }
          : item,
      ),
    );
    try {
      await api(`/api/recordings/${recording.id}/transcribe`, { method: "POST" });
      window.setTimeout(() => refreshRecording(recording.id).catch(() => {}), 900);
    } catch (error) {
      await refreshRecording(recording.id).catch(() => {});
      showToast(error instanceof Error ? error.message : "重新转写失败");
    }
  }

  async function shareRecording(recording, mode = "both") {
    const shareMode = ["text", "audio", "both", "outline"].includes(mode) ? mode : "both";
    if (shareMode === "outline") showToast("正在准备会议提纲 PDF");
    else if (shareMode !== "text") showToast("正在准备 MP3 分享");
    const audioDownloadUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/audio.mp3`;
    const transcriptUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/transcript.txt`;
    const outlineUrl = `${window.location.origin}/api/recordings/${encodeURIComponent(recording.id)}/meeting-outline.pdf`;
    const audioFileName = safeFileNameWithExtension(recording.name, ".mp3");
    const text =
      shareMode === "text"
        ? `${recording.name}\n文字：TXT`
        : shareMode === "audio"
          ? `${recording.name}\n时长：${formatDuration(recording.durationMs)}\n录音：MP3`
          : shareMode === "outline"
            ? `${recording.name}\n会议提纲：PDF`
          : `${recording.name}\n时长：${formatDuration(recording.durationMs)}\n录音：MP3\n文字：TXT`;
    const transcriptFile = transcriptTextFileForRecording(recording);
    let audioFile = null;
    let audioShareInfo = null;
    let outlineFile = null;

    async function getAudioShareInfo() {
      if (audioShareInfo) return audioShareInfo;
      const payload = await api(`/api/recordings/${recording.id}/audio-share-url`, { method: "POST" });
      const downloadUrl = new URL(payload.url || audioDownloadUrl, window.location.origin);
      downloadUrl.searchParams.set("download", "1");
      audioShareInfo = {
        ...payload,
        url: downloadUrl.toString(),
        fileName: safeFileNameWithExtension(payload.fileName || audioFileName, ".mp3"),
        contentType: payload.contentType || "audio/mpeg",
      };
      return audioShareInfo;
    }

    async function getAudioFile() {
      if (audioFile) return audioFile;
      const shareInfo = await getAudioShareInfo();
      const audioResponse = await fetchWithClient(shareInfo.url, { cache: "no-store" });
      if (!audioResponse.ok) throw new Error("MP3 录音读取失败");
      const responseType = audioResponse.headers.get("content-type") || "";
      if (/application\/json|text\/|text\/html/i.test(responseType)) throw new Error("MP3 录音读取失败");
      const audioBlob = await audioResponse.blob();
      if (!audioBlob.size) throw new Error("MP3 录音读取失败");
      const mp3Blob = audioBlob.type === "audio/mpeg" ? audioBlob : audioBlob.slice(0, audioBlob.size, "audio/mpeg");
      audioFile = new File([mp3Blob], safeFileNameWithExtension(shareInfo.fileName || audioFileName, ".mp3"), {
        type: "audio/mpeg",
      });
      return audioFile;
    }

    async function getOutlineFile() {
      if (outlineFile) return outlineFile;
      const outlineResponse = await fetchWithClient(outlineUrl, { cache: "no-store" });
      if (!outlineResponse.ok) throw new Error("会议提纲 PDF 生成失败");
      const outlineBlob = await outlineResponse.blob();
      outlineFile = new File([outlineBlob], `${safeFileName(recording.name)}-会议提纲.pdf`, { type: "application/pdf" });
      return outlineFile;
    }

    function invokeWecom(name, payload) {
      if (!window.wx?.invoke) return Promise.resolve(false);
      return new Promise((resolve, reject) => {
        window.wx.invoke(name, payload, (result) => {
          const message = String(result?.err_msg || result?.errmsg || "");
          if (!message || message.includes(":ok")) resolve(true);
          else reject(new Error(message));
        });
      });
    }

    async function shareWecomAudioFile() {
      if (!isInWeCom() || !window.wx?.invoke) return false;
      const payload = await api(`/api/recordings/${recording.id}/wecom-audio-media`, { method: "POST" });
      const mediaId = payload.mediaId || payload.media_id;
      if (!mediaId) throw new Error("企业微信 MP3 文件素材生成失败");
      await invokeWecom("sendChatMessage", {
        msgtype: "file",
        file: {
          mediaid: mediaId,
        },
      });
      showToast("已打开企业微信 MP3 文件分享");
      return true;
    }

    async function shareFiles(files, shareText = text, options = {}) {
      if (!navigator.share || !navigator.canShare) return false;
      try {
        if (!navigator.canShare({ files })) return false;
      } catch {
        return false;
      }
      const payload = { files };
      if (!options.fileOnly) {
        payload.title = recording.name;
        if (shareText) payload.text = shareText;
      }
      await navigator.share(payload);
      return true;
    }

    async function downloadAudioFileFallback(toastText) {
      const shareInfo = await getAudioShareInfo();
      openDownloadUrl(shareInfo.url, shareInfo.fileName || audioFileName);
      showToast(toastText);
    }

    async function shareUrl(url, shareText = text) {
      if (!navigator.share) return false;
      await navigator.share({ title: recording.name, text: shareText, url });
      return true;
    }

    try {
      if (shareMode === "text") {
        if (await shareFiles([transcriptFile])) return;
        if (await shareUrl(transcriptUrl, `${text}\nTXT：${transcriptUrl}`)) return;
      } else if (shareMode === "audio") {
        try {
          if (await shareWecomAudioFile()) return;
        } catch {
          // Continue with system file sharing or local save.
        }
        const mp3File = await getAudioFile();
        if (await shareFiles([mp3File], "", { fileOnly: true })) {
          showToast("已调起 MP3 文件分享");
          return;
        }
        await downloadAudioFileFallback("已开始下载 MP3 文件，请从企业微信文件里发送");
        return;
      } else if (shareMode === "outline") {
        const pdfFile = await getOutlineFile();
        if (await shareFiles([pdfFile], `${recording.name}\n会议提纲 PDF`)) return;
        if (await shareUrl(outlineUrl, `${text}\nPDF：${outlineUrl}`)) return;
        downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
        showToast("会议提纲 PDF 已下载，请从文件发送");
        return;
      } else {
        try {
          if (await shareWecomAudioFile()) {
            downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
            showToast("已打开企业微信 MP3 文件分享，TXT 已保存到本机");
            return;
          }
        } catch {
          // Continue with system file sharing or local save.
        }
        const mp3File = await getAudioFile();
        if (await shareFiles([transcriptFile, mp3File], "", { fileOnly: true })) {
          showToast("已调起 MP3 和 TXT 文件分享");
          return;
        }
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback("TXT 已保存，已开始下载 MP3 文件，请从企业微信文件里发送");
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (shareMode === "outline") {
        try {
          const pdfFile = await getOutlineFile();
          downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
          showToast("会议提纲 PDF 已下载，请从企业微信文件里发送");
          return;
        } catch {
          showToast(error instanceof Error ? error.message : "会议提纲 PDF 分享失败");
          return;
        }
      }
      if (shareMode === "audio") {
        try {
          await downloadAudioFileFallback("已开始下载 MP3 文件，请从企业微信文件里发送");
          return;
        } catch {
          showToast(error instanceof Error ? error.message : "MP3 分享失败");
          return;
        }
      }
    }

    if (["audio", "both"].includes(shareMode)) {
      try {
        if (shareMode === "both") downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback(
          shareMode === "both" ? "TXT 已保存，已开始下载 MP3 文件，请从企业微信文件里发送" : "已开始下载 MP3 文件，请从企业微信文件里发送",
        );
        return;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "MP3 分享失败");
        return;
      }
    }

    if (!["audio", "both"].includes(shareMode) && window.wx?.invoke) {
      try {
        await new Promise((resolve, reject) => {
          window.wx.invoke(
            "shareAppMessage",
            {
              title: recording.name,
              desc:
                shareMode === "text"
                  ? "TXT 文字稿"
                  : shareMode === "outline"
                    ? "会议提纲 PDF"
                  : shareMode === "audio"
                    ? `MP3 录音，时长 ${formatDuration(recording.durationMs)}`
                    : `TXT 文字稿 + MP3 录音，时长 ${formatDuration(recording.durationMs)}`,
              link: shareMode === "outline" ? outlineUrl : shareMode === "audio" ? audioDownloadUrl : shareMode === "text" ? transcriptUrl : audioDownloadUrl,
              imgUrl: "",
            },
            (result) => {
              const message = String(result?.err_msg || "");
              if (!message || message.includes(":ok")) resolve();
              else reject(new Error(message));
            },
          );
        });
        showToast("已打开企业微信分享");
        return;
      } catch {
        // Fall through to copy/share sheet.
      }
    }

    try {
      const fallbackText =
        shareMode === "text"
          ? `${text}\nTXT：${transcriptUrl}`
          : shareMode === "audio"
            ? `${text}\nMP3 文件已准备，请从本机文件发送。`
            : shareMode === "outline"
              ? `${text}\nPDF：${outlineUrl}`
              : `${text}\nTXT：${transcriptUrl}\nMP3 文件已准备，请从本机文件发送。`;
      await navigator.clipboard.writeText(fallbackText);
      if (shareMode === "text") {
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        showToast("TXT 已下载，文字链接已复制");
      } else if (shareMode === "audio") {
        await downloadAudioFileFallback("已开始下载 MP3 文件，没有复制网页链接");
      } else if (shareMode === "outline") {
        const pdfFile = await getOutlineFile();
        downloadBlob(pdfFile, `${safeFileName(recording.name)}-会议提纲.pdf`);
        showToast("会议提纲 PDF 已下载，链接已复制");
      } else {
        downloadBlob(transcriptFile, `${safeFileName(recording.name)}.txt`);
        await downloadAudioFileFallback("TXT 已保存，已开始下载 MP3 文件，没有复制录音网页链接");
      }
    } catch {
      setShareSheet({
        title: recording.name,
        text:
          shareMode === "text"
            ? `${text}\nTXT：${transcriptUrl}`
            : shareMode === "audio"
              ? `${text}\nMP3 文件已准备，请从本机文件发送。`
              : shareMode === "outline"
                ? `${text}\nPDF：${outlineUrl}`
                : `${text}\nTXT：${transcriptUrl}\nMP3 文件已准备，请从本机文件发送。`,
      });
    }
  }

  async function copyShareSheet() {
    if (!shareSheet?.text) return;
    try {
      await navigator.clipboard.writeText(shareSheet.text);
      showToast("分享内容已复制");
      setShareSheet(null);
    } catch {
      showToast("请长按选择内容复制");
    }
  }

  function markRecordingDeleting(id, deleting) {
    if (!id) return;
    setDeletingRecordIds((current) => {
      if (deleting) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  }

  function adjustFolderStatsAfterRecordingRemoval(recording, { permanent = false } = {}) {
    setFolderStats((current) => {
      const wasInTrash = Boolean(recording.deletedAt);
      const wasActive = !wasInTrash;
      return {
        ...current,
        totalCount: wasActive ? Math.max(0, current.totalCount - 1) : current.totalCount,
        favoriteCount: wasActive && recording.favorite ? Math.max(0, current.favoriteCount - 1) : current.favoriteCount,
        uncategorizedCount: wasActive && !recording.folderId ? Math.max(0, current.uncategorizedCount - 1) : current.uncategorizedCount,
        trashCount: permanent
          ? Math.max(0, current.trashCount - (wasInTrash ? 1 : 0))
          : wasActive
            ? current.trashCount + 1
            : current.trashCount,
      };
    });
  }

  function hideRecordingFromUi(recording, options = {}) {
    optimisticRemovedRecordIdsRef.current.add(recording.id);
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
    adjustFolderStatsAfterRecordingRemoval(recording, options);
  }

  function releaseOptimisticRecordingRemoval(id) {
    const timer = optimisticRemovalTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      optimisticRemovalTimersRef.current.delete(id);
    }
    optimisticRemovedRecordIdsRef.current.delete(id);
  }

  function releaseOptimisticRecordingRemovalLater(id, delayMs = 15000) {
    if (!id) return;
    const existing = optimisticRemovalTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      optimisticRemovedRecordIdsRef.current.delete(id);
      optimisticRemovalTimersRef.current.delete(id);
    }, delayMs);
    optimisticRemovalTimersRef.current.set(id, timer);
  }

  async function runSmoothDelete(recording, { permanent = false } = {}) {
    const endpoint = `/api/recordings/${recording.id}${permanent ? "?permanent=true" : ""}`;
    hideRecordingFromUi(recording, { permanent });

    try {
      await api(endpoint, { method: "DELETE" });
      releaseOptimisticRecordingRemovalLater(recording.id);
      refreshFolders().catch(() => {});
      refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
    } catch (error) {
      releaseOptimisticRecordingRemoval(recording.id);
      refreshFolders().catch(() => {});
      refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
      showToast("删除失败，请稍后重试");
    }
  }

  async function deleteRecording(recording) {
    const confirmed = window.confirm(`把「${recording.name}」移入回收站？`);
    if (!confirmed) return;
    runSmoothDelete(recording).catch(() => {});
  }

  function bulkDeleteRecordings(recordsToDelete = []) {
    recordsToDelete.forEach((recording) => {
      runSmoothDelete(recording).catch(() => {});
    });
  }

  async function restoreRecording(recording) {
    const payload = await api(`/api/recordings/${recording.id}/restore`, { method: "POST" });
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
    refreshFolders().catch(() => {});
    showToast("录音已恢复");
  }

  async function permanentDeleteRecording(recording) {
    const confirmed = window.confirm(`彻底删除「${recording.name}」？删除后不能恢复。`);
    if (!confirmed) return;
    runSmoothDelete(recording, { permanent: true }).catch(() => {});
  }

  function logoutWecom() {
    clearWecomUser();
    clearStoredAuth();
    window.localStorage.removeItem(QA_ACTIVE_MESSAGE_KEY);
    window.localStorage.removeItem(DAILY_BRIEF_ACTIVE_KEY);
    const clientId = getClientId();
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    window.localStorage.removeItem(profileStorageKey(clientId));
    const nextProfile = {
      clientId,
      language: profile.language || "中文",
      recordsTitle: profile.recordsTitle || "我的录音",
      name: "",
      username: "",
      avatarUrl: "",
      company: "",
      department: "",
      phone: "",
    };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
    showToast("已退出企业微信登录");
  }

  async function saveProfile() {
    const clientId = getClientId();
    const profileToSave = { ...profile, clientId };
    setProfile(profileToSave);
    saveLocalProfile(profileToSave);
    try {
      const payload = await api("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileToSave),
      });
      const nextProfile = {
        ...profileToSave,
        ...(payload.profile || {}),
        clientId: (payload.profile || {}).clientId || clientId,
      };
      setProfile(nextProfile);
      saveLocalProfile(nextProfile);
      showToast(uiText(nextProfile.language || profileToSave.language || "中文", "个人信息已保存", "Profile saved"));
      return nextProfile;
    } catch {
      showToast(uiText(profileToSave.language || "中文", "个人信息已保存到本机，服务器同步失败", "Profile saved on this device, server sync failed"));
      return profileToSave;
    }
  }
  async function saveRecordsTitle(recordsTitle) {
    const nextProfile = { ...profile, recordsTitle };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
  }

  function openDetail(id) {
    routerNavigate(`/detail?id=${encodeURIComponent(id)}`);
  }

  return (
    <>
      <RecordsView
        finishUploadCard={finishUploadCard}
        recordings={recordsForView}
        folders={folders}
        folderStats={folderStats}
        recordsTitle={profile.recordsTitle || "我的录音"}
        selectedFolderId={selectedFolderId}
        loading={loading}
        deletingRecordIds={deletingRecordIds}
        uploadBusy={uploadingRecords.length > 0}
        onOpenSettings={() => setSettingsOpen(true)}
        user={wecomUser}
        onLogout={logoutWecom}
        onStartRecording={() => routerNavigate("/recorder")}
        createUploadCard={createUploadCard}
        updateUploadCard={updateUploadCard}
        failUploadCard={failUploadCard}
        uploadRecordingSegments={uploadRecordingSegments}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onSelectFolder={setSelectedFolderId}
        onOpenDetail={openDetail}
        onRename={renameRecording}
        onUpdateMeta={updateRecordingMeta}
        onMove={moveRecording}
        onToggleFavorite={toggleFavorite}
        onRetranscribe={retranscribeRecording}
        onShare={shareRecording}
        onDelete={deleteRecording}
        onBulkDelete={bulkDeleteRecordings}
        onRestore={restoreRecording}
        onPermanentDelete={permanentDeleteRecording}
        onUpdateRecordsTitle={saveRecordsTitle}
        language={profile.language}
        onRefresh={() => {
          refreshRecordings("", selectedFolderId);
          refreshFolders().catch(() => {});
        }}
      />

      <SettingsDrawer
        open={settingsOpen}
        profile={profile}
        wecomUser={wecomUser}
        setProfile={setProfile}
        onSave={saveProfile}
        onLogout={logoutWecom}
        onClose={() => {
          saveProfile().catch(() => {});
          setSettingsOpen(false);
        }}
      />
      <ShareSheet share={shareSheet} onCopy={copyShareSheet} onClose={() => setShareSheet(null)} />
    </>
  );
}
