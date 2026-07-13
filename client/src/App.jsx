import { useEffect, useMemo, useRef, useState } from "react";
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
import { RecorderView } from './RecorderView.jsx'
import {RecordsView} from './RecordsView.jsx'
import {DetailView} from './DetailView.jsx'
import {IconButton} from './IconButton.jsx'
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
  isUploadableMediaFile,
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
  saveStoredAuth,
  clearStoredAuth,
  readStoredJson,
  getLocalProfile,
  saveLocalProfile,
  sharedProfileDefaults,
  openRecordingRecoveryDb,
  idbRequest,
  readRecordingSessionManifest,
  normalizeRecordingSessionManifest,
  readRecordingRecoveryQueue,
  writeRecordingRecoveryQueue,
  upsertRecordingRecoveryManifest,
  removeRecordingRecoveryManifest,
  readRecoverableRecordingManifests,
  writeRecordingSessionManifest,
  clearRecordingSessionManifest,
  getClientName,
  getAccountDisplayName,
  getDetectedWecomName,
  showToast,
  dailyBriefMeetingCount,
  api,
  fetchWithClient,
  dailyBriefDisplayDate
} from './utils/index.js'
import {requestMicrophoneStream, getAudioFileDuration} from './utils/audio.js'
import {loadImageSource, compressAvatarImage} from './utils/image.js'

const cardColors = ["coral", "indigo", "violet", "teal", "clay", "ink"];
const RECORDING_DATA_SLICE_MS = 60 * 1000;
const RECORDING_AUTOSAVE_CHUNK_MS = 5 * 60 * 1000;
const RECORDING_ROLLOVER_MS = 10 * 60 * 1000;
const RECORDING_WATCHDOG_MS = 5 * 1000;
const LONG_RECORDING_DIRECT_UPLOAD_LIMIT = 80;
const LONG_RECORDING_UPLOAD_BATCH_SIZE = 48;
const RECORDING_RECOVERY_DB = "wecomRecorderRecordingRecovery";
const RECORDING_RECOVERY_STORE = "segments";
const RECORDING_RECOVERY_VERSION = 1;
const RECORDING_SESSION_STORAGE_KEY = "wecomRecorderActiveRecordingSession";
const RECORDING_SESSION_QUEUE_STORAGE_KEY = "wecomRecorderRecordingRecoveryQueue";
const QA_ACTIVE_MESSAGE_KEY = "wecomRecorderActiveQaMessage";
const DAILY_BRIEF_ACTIVE_KEY = "wecomRecorderActiveDailyBrief";
const AUTH_STORAGE_KEY = "wecomRecorderAccountAuth";
const AVATAR_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const AVATAR_TARGET_BYTES = 360 * 1024;
const AVATAR_HARD_LIMIT_BYTES = 720 * 1024;
const AVATAR_MAX_DIMENSION = 512;

async function putRecordingRecoverySegment(row) {
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).put(row);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write aborted"));
    });
  } finally {
    db.close();
  }
}

async function getRecordingRecoverySegment(id) {
  if (!id) return null;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readonly");
    return (await idbRequest(transaction.objectStore(RECORDING_RECOVERY_STORE).get(id))) || null;
  } finally {
    db.close();
  }
}

async function deleteRecordingRecoverySegment(id) {
  if (!id) return;
  const db = await openRecordingRecoveryDb();
  try {
    const transaction = db.transaction(RECORDING_RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECORDING_RECOVERY_STORE).delete(id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB delete failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB delete aborted"));
    });
  } finally {
    db.close();
  }
}

async function clearRecordingRecoverySession(sessionId) {
  const targetSessionId = sessionId || "";
  const manifests = targetSessionId ? readRecoverableRecordingManifests().filter((item) => item.id === targetSessionId) : readRecoverableRecordingManifests();
  const segmentIds = manifests
    .flatMap((manifest) => manifest.segments || [])
    .filter((segment) => !targetSessionId || segment.sessionId === targetSessionId)
    .map((segment) => segment.id)
    .filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  if (targetSessionId) removeRecordingRecoveryManifest(targetSessionId);
  else writeRecordingRecoveryQueue([]);
  clearRecordingSessionManifest(targetSessionId);
}

async function clearRecordingRecoveryManifest(manifest) {
  const segmentIds = (manifest?.segments || []).map((segment) => segment.id).filter(Boolean);
  await Promise.all(segmentIds.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
  removeRecordingRecoveryManifest(manifest?.id);
  clearRecordingSessionManifest(manifest?.id);
}

// 请求浏览器将站点存储标记为持久化
async function requestPersistentRecordingStorage() {
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    } else {
      console.warn("Browser does not support persistent storage.");
    }
  } catch (e) {
    console.error("Browser fail to support persistent storage: ", e.message);
    // Long recording still works without persistent storage; this only reduces mobile cleanup risk.
  }
}

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

function appendUrlParam(url, key, value) {
  if (!value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function mediaRequestUrl(url, version = "") {
  const auth = getStoredAuth();
  return appendUrlParam(appendUrlParam(appendUrlParam(url, "clientId", getClientId()), "authToken", auth?.token || ""), "v", version);
}

function isWecomWebView() {
  return /wxwork|wecom|micromessenger/i.test(navigator.userAgent);
}

function readWecomNameHintFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return [
    params.get("wecomName"),
    params.get("wwName"),
    params.get("userName"),
    params.get("user_name"),
    params.get("realName"),
    params.get("realname"),
    params.get("memberName"),
    params.get("wxworkName"),
    params.get("nickname"),
    params.get("name"),
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
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

function LegacyDetailView({ recording, transcriptionStatus, onBack, onRefreshRecording, onRename, onUpdateMeta }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(recording?.durationMs ? recording.durationMs / 1000 : 0);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);
  const [asking, setAsking] = useState(false);
  const detailQaPollingRef = useRef(new Map());
  const [draftName, setDraftName] = useState(recording?.name || "");
  const [nameStatus, setNameStatus] = useState("saved");
  const [draftTag, setDraftTag] = useState(recording?.tag || "");
  const [tagStatus, setTagStatus] = useState("saved");
  const [speakerDrafts, setSpeakerDrafts] = useState(() => speakerDraftsForRecording(recording));
  const [selectedSpeakerKey, setSelectedSpeakerKey] = useState("");
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const speakers = useMemo(() => speakersForRecording(recording), [recording]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(recording?.durationMs ? recording.durationMs / 1000 : 0);
    setAnswers([]);
    setQuestion("");
    setDraftName(recording?.name || "");
    setNameStatus("saved");
    setDraftTag(recording?.tag || "");
    setTagStatus("saved");
    setSpeakerDrafts(speakerDraftsForRecording(recording));
    setSelectedSpeakerKey(speakersForRecording(recording)[0]?.key || "");
    setTranscriptExpanded(false);
  }, [recording?.id, recording?.name, recording?.durationMs, recording?.speakerName, recording?.tag, recording?.speakerMap, recording?.speakers]);

  useEffect(
    () => () => {
      detailQaPollingRef.current.forEach((timer) => window.clearTimeout(timer));
      detailQaPollingRef.current.clear();
    },
    [],
  );

  if (!recording) {
    return (
      <section className="screen detail-screen">
        <button className="ghost-back" type="button" onClick={onBack}>
          <ArrowLeft size={20} />
          返回
        </button>
        <div className="empty-state">
          <div className="empty-icon">
            <ListMusic size={40} />
          </div>
          <h2>还没有可查看的详情</h2>
          <p>录一段音后，详情页会显示播放、转写和提问。</p>
        </div>
      </section>
    );
  }

  function seekTo(ms) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, ms / 1000);
    setCurrent(audio.currentTime);
    audio.play().catch(() => {});
  }

  function skip(seconds) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || duration || 0, audio.currentTime + seconds));
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  async function askRecording(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    setAsking(true);
    try {
      const payload = await api(`/api/recordings/${recording.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      setAnswers((currentAnswers) => [payload.message, ...currentAnswers]);
      setQuestion("");
      if (payload.message?.pending) pollDetailQaMessage(payload.message.id, 0);
    } finally {
      setAsking(false);
    }
  }

  function pollDetailQaMessage(id, attempt = 0) {
    if (!id || detailQaPollingRef.current.has(id)) return;
    const timer = window.setTimeout(async () => {
      detailQaPollingRef.current.delete(id);
      try {
        const payload = await api(`/api/qa-messages/${encodeURIComponent(id)}`);
        if (payload.message) {
          setAnswers((currentAnswers) =>
            currentAnswers.map((item) => (item.id === payload.message.id ? { ...item, ...payload.message } : item)),
          );
          if (payload.message.pending && attempt < 180) pollDetailQaMessage(id, attempt + 1);
        }
      } catch {
        if (attempt < 30) pollDetailQaMessage(id, attempt + 1);
      }
    }, attempt === 0 ? 900 : 1800);
    detailQaPollingRef.current.set(id, timer);
  }

  async function transcribeAgain() {
    if (!canUseTranscribeAction) return;
    await api(`/api/recordings/${recording.id}/transcribe`, { method: "POST" });
    onRefreshRecording(recording.id);
  }

  async function commitDetailMeta() {
    const tag = draftTag.trim();
    setDraftTag(tag);
    if (tag !== (recording.tag || "")) {
      setTagStatus("saving");
      try {
        await onUpdateMeta(recording.id, { tag });
        setTagStatus("saved");
      } catch {
        setTagStatus("dirty");
      }
      return;
    }
    setTagStatus("saved");
  }

  async function commitDetailName() {
    const nextName = draftName.trim() || recording.name;
    setDraftName(nextName);
    if (nextName !== recording.name) {
      setNameStatus("saving");
      try {
        await onRename(recording.id, nextName);
        setNameStatus("saved");
      } catch {
        setNameStatus("dirty");
      }
      return;
    }
    setNameStatus("saved");
  }

  function updateSpeakerDraft(key, value) {
    setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: value }));
  }

  function commitSpeakerName(key) {
    const nextName = (speakerDrafts[key] || "").trim() || "说话人";
    const nextSpeakerMap = {
      ...(recording.speakerMap || {}),
      [key]: nextName,
    };
    setSpeakerDrafts((currentDrafts) => ({ ...currentDrafts, [key]: nextName }));
    onUpdateMeta(recording.id, { speakerMap: nextSpeakerMap, speakerName: speakers[0]?.key === key ? nextName : recording.speakerName });
  }

  const transcriptText = recording.transcriptText || recording.transcript.map((line) => line.text).join("\n");
  const transcriptHealth = recording.transcriptHealth || transcriptionStatus || {};
  const transcriptionApiEnabled = transcriptHealth.apiEnabled !== false;
  const canUseTranscribeAction = transcriptionApiEnabled || recording.tencentMeeting?.imported;
  const isFallbackTranscript = Boolean(transcriptHealth.isFallback);

  return (
    <section className="screen detail-screen" aria-label="录音详情">
      <header className="detail-header">
        <button className="ghost-back" type="button" onClick={onBack}>
          <ArrowLeft size={20} />
          记录
        </button>
        <span className={`detail-status ${recording.status}`}>
          {recordingDetailStatusLabel(recording)}
        </span>
      </header>

      <div className="detail-title-row">
        <div>
          <p className="eyebrow">录音 {String(recording.seq).padStart(3, "0")}</p>
          <input
            className={`detail-title-input ${nameStatus}`}
            aria-label="录音名称"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
              setNameStatus("dirty");
            }}
            onBlur={commitDetailName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <span className={`favorite-badge ${recording.favorite ? "on" : ""}`}>
          <Star size={16} fill={recording.favorite ? "currentColor" : "none"} />
          {recording.favorite ? "已收藏" : "普通"}
        </span>
      </div>

      <div className="detail-meta-editor">
        <label>
          标记
          <div className={`tag-save-field ${tagStatus}`}>
            <input
              value={draftTag}
              onChange={(event) => {
                setDraftTag(event.target.value);
                setTagStatus("dirty");
              }}
              onBlur={() => {
                commitDetailMeta();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="例如：物业、会议、客户"
            />
            <button
              type="button"
              disabled={tagStatus === "saving"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={commitDetailMeta}
            >
              {tagStatus === "saving" ? <LoaderCircle className="spin-icon" size={15} /> : <Check size={15} />}
              <span>{tagStatus === "dirty" ? "保存" : tagStatus === "saving" ? "保存中" : "已保存"}</span>
            </button>
          </div>
        </label>
      </div>

      <div className="speaker-editor" aria-label="说话人">
        {speakers.map((speaker) => (
          <div className={selectedSpeakerKey === speaker.key ? "speaker-editor-row active" : "speaker-editor-row"} key={speaker.key}>
            <button type="button" onClick={() => setSelectedSpeakerKey((current) => (current === speaker.key ? "" : speaker.key))}>
              <UserRound size={15} />
              <span>{formatDuration(speaker.totalMs)}</span>
            </button>
            <input
              value={speakerDrafts[speaker.key] || speaker.name}
              onChange={(event) => updateSpeakerDraft(speaker.key, event.target.value)}
              onBlur={() => commitSpeakerName(speaker.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label={`${speaker.name}名称`}
            />
          </div>
        ))}
      </div>

      <div className="player-panel">
        <audio
          ref={audioRef}
            src={mediaRequestUrl(recording.audioUrl, recording.updatedAt || recording.createdAt)}
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || recording.durationMs / 1000)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        />
        <div className="mini-wave">
          {Array.from({ length: 28 }).map((_, index) => (
            <span key={index} style={{ "--bar": `${24 + ((index * 37) % 58)}%` }} />
          ))}
        </div>
        <input
          className="progress"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={Math.min(current, duration || 1)}
          onChange={(event) => seekTo(Number(event.target.value) * 1000)}
          aria-label="播放进度"
        />
        <div className="time-row">
          <span>{formatDuration(current * 1000)}</span>
          <span>{formatDuration((duration || 0) * 1000)}</span>
        </div>
        <div className="player-controls">
          <IconButton label="后退十秒" onClick={() => skip(-10)}>
            <Rewind size={23} />
          </IconButton>
          <button className="play-button" type="button" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <IconButton label="快进十秒" onClick={() => skip(10)}>
            <FastForward size={23} />
          </IconButton>
        </div>
      </div>

      <div className="detail-lower">
        <div className={transcriptExpanded ? "transcript-panel expanded" : "transcript-panel collapsed"}>
          <div className="panel-heading">
            <div>
              <h2>转写内容</h2>
              <span className={isFallbackTranscript ? "transcript-health warn" : "transcript-health"}>
                {recording.tencentMeeting?.imported && !transcriptionApiEnabled
                  ? "腾讯会议自带转写"
                  : !transcriptionApiEnabled
                  ? "录音 API 转写已停用"
                  : isFallbackTranscript
                  ? "模拟转写，需要重新转写"
                  : transcriptHealth.configured === false
                    ? "真实转写未配置"
                    : `转写服务：${recording.transcriptProvider || transcriptionStatus?.mode || "local"}`}
              </span>
            </div>
            <div className="transcript-actions">
              <button type="button" onClick={() => setTranscriptExpanded((current) => !current)}>
                {transcriptExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {transcriptExpanded ? "收起" : "展开"}
              </button>
              {canUseTranscribeAction ? (
                <button type="button" onClick={transcribeAgain}>
                  <RefreshCw size={16} />
                  {recording.tencentMeeting?.imported && !transcriptionApiEnabled ? "同步转写" : "重新转写"}
                </button>
              ) : null}
            </div>
          </div>
          {transcriptHealth.message ? <p className={isFallbackTranscript ? "transcript-warning" : "transcript-note"}>{transcriptHealth.message}</p> : null}
          {transcriptText ? (
            <div className="transcript-full">
              <h3>全文</h3>
              <p>{transcriptText}</p>
            </div>
          ) : null}
          <div className="transcript-lines">
            {recording.transcript.length > 0 ? (
              recording.transcript.map((line) => (
                <button
                  className={`transcript-line${selectedSpeakerKey && line.speakerKey === selectedSpeakerKey ? " is-highlight" : ""}${
                    selectedSpeakerKey && line.speakerKey !== selectedSpeakerKey ? " is-dim" : ""
                  }`}
                  key={line.id}
                  type="button"
                  onClick={() => seekTo(line.startMs)}
                >
                  <span>{formatTimecode(line.startMs)}</span>
                  <strong>
                    <em>{line.speakerName || recording.speakerName || "说话人 1"}</em>
                    {line.text}
                  </strong>
                </button>
              ))
            ) : (
              <p className="muted-copy">服务器正在分析音频，稍后刷新即可查看转写。</p>
            )}
          </div>
        </div>

        <div className="ask-panel">
          <form className="ask-form" onSubmit={askRecording}>
            <Search size={18} />
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="对这条录音提问" />
            <button type="submit" aria-label="发送问题" disabled={asking}>
              {asking ? <LoaderCircle className="spin-icon" size={18} /> : <Send className="send-icon" size={18} />}
            </button>
          </form>

          {answers.length > 0 ? (
            <div className="answer-list">
              {answers.map((item) => (
                <article key={item.id} className="answer-card">
                  <strong>{item.question}</strong>
                  <p>{item.pending ? "正在思考，答案生成后会自动显示。" : item.answer}</p>
                  {!item.pending && Array.isArray(item.citations) && item.citations.length > 0 ? (
                    <div className="answer-citations" aria-label="回答索引">
                      {item.citations.map((citation) => (
                        <button
                          type="button"
                          key={`${citation.segmentId}-${citation.startMs}`}
                          onClick={() => seekTo(citation.startMs)}
                        >
                          <span>{formatTimecode(citation.startMs)}</span>
                          <em>{citation.text}</em>
                        </button>
                      ))}
                    </div>
                  ) : !item.pending && typeof item.jumpToMs === "number" ? (
                    <button type="button" onClick={() => seekTo(item.jumpToMs)}>
                      定位到 {formatTimecode(item.jumpToMs)}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

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

function SettingsDrawer({ open, profile, auth, setProfile, onAccountEnter, onAccountLogout, onClose }) {
  const language = profile.language || "中文";
  const detectedName = String(profile.wecomName || "").trim();
  const loggedIn = Boolean(auth?.account?.username);
  const loggedInName = String(auth?.account?.username || auth?.profile?.username || profile.username || "").trim();
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [accountName, setAccountName] = useState(auth?.account?.username || profile.username || "");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMode, setAccountMode] = useState("register");
  const [accountBusy, setAccountBusy] = useState(false);
  const accountDisplayName = loggedIn ? loggedInName || accountName.trim() : "";
  const displayName = loggedIn
    ? accountDisplayName || detectedName || String(profile.name || "").trim() || uiText(language, "未设置姓名", "Name not set")
    : uiText(language, "未登录", "Signed out");
  const displaySubline = loggedIn
    ? avatarBusy
      ? uiText(language, "正在压缩头像...", "Compressing avatar...")
      : profile.company || uiText(language, "企业微信", "WeCom")
    : uiText(language, "登录账号后同步个人资料", "Sign in to sync profile");

  useEffect(() => {
    if (auth?.account?.username) setAccountName(auth.account.username);
    else if (profile.username) setAccountName(profile.username);
    else setAccountName("");
  }, [auth?.account?.username, profile.username]);

  async function submitAccount() {
    const username = accountName.trim();
    const password = accountPassword;
    if (loggedIn || !username || !password || accountBusy) return;
    setAccountBusy(true);
    try {
      await onAccountEnter?.({ username, password, mode: accountMode });
      setAccountPassword("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : uiText(language, accountMode === "login" ? "登录失败" : "注册账号失败", "Account failed"));
    } finally {
      setAccountBusy(false);
    }
  }

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
      <aside className={loggedIn ? "settings-drawer settings-drawer-signed-in" : "settings-drawer"} inert={open ? undefined : true}>
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

        {loggedIn ? (
          <div className="settings-logout-footer">
            <button className="account-logout-button" type="button" onClick={onAccountLogout}>
              {uiText(language, "退出登录", "Sign out")}
            </button>
          </div>
        ) : (
          <section className="account-card" aria-label={uiText(language, "账号", "Account")}>
            <div className="account-card-header">
              <strong>{uiText(language, "账号管理", "Account")}</strong>
            </div>
            <div className="account-tabs" role="tablist" aria-label={uiText(language, "账号操作", "Account action")}>
              <button className={accountMode === "register" ? "active" : ""} type="button" onClick={() => setAccountMode("register")}>
                {uiText(language, "注册账号", "Register")}
              </button>
              <button className={accountMode === "login" ? "active" : ""} type="button" onClick={() => setAccountMode("login")}>
                {uiText(language, "登录账号", "Login")}
              </button>
            </div>
            <div className="account-form">
              <label>
                {uiText(language, accountMode === "login" ? "账号" : "注册名", "Account name")}
                <input value={accountName} autoComplete="username" onChange={(event) => setAccountName(event.target.value)} />
              </label>
              <label>
                {uiText(language, "密码", "Password")}
                <input
                  value={accountPassword}
                  type="password"
                  autoComplete={accountMode === "login" ? "current-password" : "new-password"}
                  onChange={(event) => setAccountPassword(event.target.value)}
                />
              </label>
              <div className="account-actions">
                <button type="button" onClick={submitAccount} disabled={accountBusy}>
                  {accountBusy
                    ? uiText(language, accountMode === "login" ? "登录中" : "注册中", "Working")
                    : uiText(language, accountMode === "login" ? "登录进入" : "注册并进入", accountMode === "login" ? "Login" : "Register")}
                </button>
              </div>
              <p className="account-note">
                {uiText(
                  language,
                  accountMode === "login"
                    ? "登录后会同步这个账号下的录音、问答和搜索记录。"
                    : "每个注册账号的录音、问答、搜索记录独立保存；共享录音可查看，基于录音的问答只属于当前账号。",
                  "Each account keeps recordings, Q&A, and search history separate.",
                )}
              </p>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function BottomNav({ activeView, onNavigate, language, hidden = false }) {
  return (
    <nav className={hidden ? "bottom-nav hidden" : "bottom-nav"} aria-label={uiText(language, "底部导航", "Bottom navigation")} aria-hidden={hidden}>
      <button className={activeView === "records" ? "active" : ""} type="button" onClick={() => onNavigate("records")}>
        <Home size={21} />
        <span>{uiText(language, "记录", "Records")}</span>
      </button>
      {/* <button className={activeView === "record" ? "active center" : "center"} type="button" onClick={() => onNavigate("record")}>
        <Mic size={24} />
        <span>{uiText(language, "录音", "Record")}</span>
      </button>*/}
      <button className={activeView === "detail" ? "active" : ""} type="button" onClick={() => onNavigate("detail")}>
        <ListMusic size={21} />
        <span>{uiText(language, "问答", "QA")}</span>
      </button>
    </nav>
  );
}

export function App() {
  const [activeView, setActiveView] = useState("record");
  const [recordings, setRecordings] = useState([]);
  const [uploadingRecords, setUploadingRecords] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderStats, setFolderStats] = useState({ totalCount: 0, favoriteCount: 0, uncategorizedCount: 0, trashCount: 0 });
  const [transcriptionStatus, setTranscriptionStatus] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState({});
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareSheet, setShareSheet] = useState(null);
  const [deletingRecordIds, setDeletingRecordIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0.12);
  const [status, setStatus] = useState("点击麦克风开始");
  const [recordingError, setRecordingError] = useState("");
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionSegmentsRef = useRef([]);
  const sessionDurationsRef = useRef([]);
  const uploadInputRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRafRef = useRef(0);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const totalElapsedBeforeSegmentRef = useRef(0);
  const stopReasonRef = useRef("idle");
  const resumeTimerRef = useRef(0);
  const rolloverTimerRef = useRef(0);
  const autosaveTimerRef = useRef(0);
  const recordingWatchdogTimerRef = useRef(0);
  const activeViewRef = useRef(activeView);
  const resumeAvailableRef = useRef(false);
  const isRecordingRef = useRef(false);
  const manualStopRequestedRef = useRef(false);
  const finalizingRecordingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const autosavedSegmentCountRef = useRef(0);
  const autosavedDurationMsRef = useRef(0);
  const keyboardBaseHeightRef = useRef(0);
  const recordingSessionIdRef = useRef("");
  const recordingSessionStartedAtRef = useRef("");
  const recordingSessionPersistedIdsRef = useRef([]);
  const recordingPersistingRef = useRef(false);
  const recordingPersistPromiseRef = useRef(Promise.resolve());
  const recoveryUploadInFlightRef = useRef(false);
  const selectedRecordingCacheRef = useRef(null);
  const optimisticRemovedRecordIdsRef = useRef(new Set());
  const optimisticRemovalTimersRef = useRef(new Map());
  const backgroundUploadSessionIdsRef = useRef(new Set());
  const stoppedRecordingSnapshotsRef = useRef(new WeakMap());
  const hiddenStartedAtRef = useRef(0);
  const lastRecorderDataAtRef = useRef(0);
  const lastRecorderWatchdogActionAtRef = useRef(0);

  const selectedRecording = useMemo(() => {
    if (!selectedId) return null;
    return recordings.find((item) => item.id === selectedId) || (selectedRecordingCacheRef.current?.id === selectedId ? selectedRecordingCacheRef.current : null);
  }, [recordings, selectedId]);
  const recordsForView = useMemo(() => {
    if (selectedFolderId === "trash") return recordings;
    return [...uploadingRecords, ...recordings];
  }, [recordings, selectedFolderId, uploadingRecords]);

  useEffect(() => {
    if (selectedRecording?.id) selectedRecordingCacheRef.current = selectedRecording;
  }, [selectedRecording]);

  useEffect(
    () => () => {
      optimisticRemovalTimersRef.current.forEach((timer) => clearTimeout(timer));
      optimisticRemovalTimersRef.current.clear();
    },
    [],
  );

  function createUploadCard({ name = "新录音", durationMs = 0, message = "正在上传服务器" } = {}) {
    const item = {
      id: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      durationMs,
      status: "uploading",
      message,
    };
    setUploadingRecords((current) => {
      const next = current.filter((existing) => {
        if (existing.id === item.id) return false;
        return existing.name !== item.name || existing.message !== item.message;
      });
      return [item, ...next].slice(0, 6);
    });
    return item.id;
  }

  function finishUploadCard(uploadId, recording) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
    if (recording) {
      setRecordings((current) => [recording, ...current.filter((item) => item.id !== recording.id)]);
    }
  }

  function updateUploadCard(uploadId, patch) {
    if (!uploadId) return;
    setUploadingRecords((current) => current.map((item) => (item.id === uploadId ? { ...item, ...patch } : item)));
  }

  function failUploadCard(uploadId) {
    if (uploadId) setUploadingRecords((current) => current.filter((item) => item.id !== uploadId));
  }

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

  async function refreshTranscriptionStatus() {
    const payload = await api("/api/transcription/status");
    setTranscriptionStatus(payload.transcription);
  }

  async function refreshRecordings(nextQuery = query, nextFolderId = selectedFolderId, options = {}) {
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
      if (options.autoSelect) {
        setSelectedId((current) => {
          if (current) return current;
          if (activeViewRef.current === "detail") return current;
          return nextRecordings[0]?.id || current;
        });
      }
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
      setSelectedId(sharedId);
      setActiveView("detail");
    }
    refreshRecordings("");
    refreshFolders().catch(() => {});
    refreshTranscriptionStatus().catch(() => {});
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

    const applyWecomUser = (user) => {
      if (!user?.name) return;
      setProfile((current) => {
        const accountName = getAccountDisplayName(current);
        const next = {
          ...current,
          name: accountName || user.name,
          username: accountName || current.username || "",
          wecomName: user.name,
          wecomUserId: user.userId || user.openUserId || current.wecomUserId || "",
          wecomConfigured: true,
          department: user.department || current.department || "",
          company: current.company || "企业微信",
        };
        saveLocalProfile(next);
        return next;
      });
    };

    const nameHint = readWecomNameHintFromUrl();
    if (nameHint) {
      applyWecomUser({ name: nameHint });
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      api(`/api/wecom/me?code=${encodeURIComponent(code)}`)
        .then((payload) => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: payload.configured !== false };
            saveLocalProfile(next);
            return next;
          });
          applyWecomUser(payload.user);
          window.sessionStorage.removeItem("wecomOAuthTried");
        })
        .catch(() => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: false };
            saveLocalProfile(next);
            return next;
          });
        });
    } else if (isWecomWebView() && !getLocalProfile().wecomName && !window.sessionStorage.getItem("wecomOAuthTried")) {
      api(`/api/wecom/oauth-url?redirect=${encodeURIComponent(window.location.href)}`)
        .then((payload) => {
          if (payload.configured && payload.url) {
            window.sessionStorage.setItem("wecomOAuthTried", "1");
            window.location.replace(payload.url);
          } else {
            setProfile((current) => {
              const next = { ...current, wecomConfigured: false };
              saveLocalProfile(next);
              return next;
            });
          }
        })
        .catch(() => {
          setProfile((current) => {
            const next = { ...current, wecomConfigured: false };
            saveLocalProfile(next);
            return next;
          });
        });
    }
  }, []);

  useEffect(() => {
    if (Object.keys(profile || {}).length > 0) saveLocalProfile(profile);
  }, [profile]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    const editableInputTypes = new Set(["email", "number", "password", "search", "tel", "text", "url"]);
    const visualViewport = window.visualViewport;

    function isEditableElement(element) {
      if (!element) return false;
      const tagName = element.tagName?.toLowerCase();
      if (tagName === "textarea") return true;
      if (tagName === "input") {
        const inputType = (element.getAttribute("type") || "text").toLowerCase();
        return editableInputTypes.has(inputType);
      }
      return Boolean(element.isContentEditable);
    }

    function viewportHeight() {
      return visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    }

    function updateKeyboardVisibility() {
      const height = viewportHeight();
      const activeElement = document.activeElement;
      const focusedForTyping = isEditableElement(activeElement);

      if (!height) {
        setKeyboardVisible(false);
        return;
      }

      if (!focusedForTyping) {
        keyboardBaseHeightRef.current = Math.max(keyboardBaseHeightRef.current, height);
        setKeyboardVisible(false);
        return;
      }

      keyboardBaseHeightRef.current = Math.max(keyboardBaseHeightRef.current || height, height);
      const baseHeight = keyboardBaseHeightRef.current || height;
      const keyboardInset = Math.max(0, baseHeight - height);
      const visualInset = visualViewport ? Math.max(0, (window.innerHeight || baseHeight) - visualViewport.height) : 0;
      setKeyboardVisible(keyboardInset > 120 || visualInset > 120);
    }

    let updateTimer = 0;
    function queueKeyboardUpdate() {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(updateKeyboardVisibility, 70);
    }

    updateKeyboardVisibility();
    visualViewport?.addEventListener("resize", updateKeyboardVisibility);
    visualViewport?.addEventListener("scroll", updateKeyboardVisibility);
    window.addEventListener("resize", updateKeyboardVisibility);
    document.addEventListener("focusin", queueKeyboardUpdate);
    document.addEventListener("focusout", queueKeyboardUpdate);

    return () => {
      window.clearTimeout(updateTimer);
      visualViewport?.removeEventListener("resize", updateKeyboardVisibility);
      visualViewport?.removeEventListener("scroll", updateKeyboardVisibility);
      window.removeEventListener("resize", updateKeyboardVisibility);
      document.removeEventListener("focusin", queueKeyboardUpdate);
      document.removeEventListener("focusout", queueKeyboardUpdate);
    };
  }, []);
  console.log(`刷新recordings参数 folderId: ${query}, selectedFolderId: ${selectedFolderId}`);

  // TODO 验证时否需要定时刷新录音列表，暂时注释掉
  // useEffect(() => {
  //   const timeout = window.setTimeout(() => {
  //     refreshRecordings(query, selectedFolderId).catch(() => {});
  //   }, 180);
  //   return () => window.clearTimeout(timeout);
  // }, [query, selectedFolderId]);

  // useEffect(() => {
  //   const interval = window.setInterval(() => {
  //     if (document.visibilityState === "hidden") return;
  //     refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
  //   }, 6000);
  //   return () => window.clearInterval(interval);
  // }, [query, selectedFolderId]);

  // useEffect(() => {
  //   const hasProcessing = recordings.some(
  //     (recording) =>
  //       (recording.status !== "ready" && recording.status !== "failed") ||
  //       recording.meetingOutlineStatus === "generating",
  //   );
  //   if (!hasProcessing) return undefined;
  //   const interval = window.setInterval(() => {
  //     refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
  //   }, 1800);
  //   return () => window.clearInterval(interval);
  // }, [recordings, query, selectedFolderId]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    resumeAvailableRef.current = resumeAvailable;
  }, [resumeAvailable]);

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(rolloverTimerRef.current);
      window.clearTimeout(autosaveTimerRef.current);
      window.clearInterval(recordingWatchdogTimerRef.current);
      cancelAnimationFrame(analyserRafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close();
      releaseRecordingWakeLock();
    };
  }, []);

  function cleanupCapture() {
    window.clearInterval(timerRef.current);
    window.clearTimeout(rolloverTimerRef.current);
    window.clearTimeout(autosaveTimerRef.current);
    window.clearInterval(recordingWatchdogTimerRef.current);
    recordingWatchdogTimerRef.current = 0;
    cancelAnimationFrame(analyserRafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevel(0.12);
  }

  async function requestRecordingWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState === "hidden") return;
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) return;
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Wake Lock is a best-effort mobile helper; recording still works without it.
    }
  }

  function releaseRecordingWakeLock() {
    try {
      wakeLockRef.current?.release?.();
    } catch {
      // Ignore unsupported or already released wake locks.
    }
    wakeLockRef.current = null;
  }

  useEffect(() => {
    const tryResume = () => {
      if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
      requestRecordingWakeLock();
      scheduleResumeRecording();
    };

    const saveCurrentChunk = () => {
      const recorder = mediaRecorderRef.current;
      if (!isRecordingRef.current || !recorder) return;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
      }, 180);
    };

    const keepSessionAlive = () => {
      if (isRecordingRef.current || resumeAvailableRef.current) requestRecordingWakeLock();
      tryResume();
    };

    const reconcileAfterBackground = (hiddenMs) => {
      const recorder = mediaRecorderRef.current;
      if (
        hiddenMs < 5000 ||
        manualStopRequestedRef.current ||
        !isRecordingRef.current ||
        !recorder ||
        recorder.state !== "recording" ||
        stopReasonRef.current !== "recording"
      ) {
        return;
      }

      setStatus("已返回前台，正在校验录音状态");
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (
          manualStopRequestedRef.current ||
          mediaRecorderRef.current !== recorder ||
          recorder.state !== "recording" ||
          stopReasonRef.current !== "recording"
        ) {
          return;
        }
        const now = Date.now();
        const lastDataAt = lastRecorderDataAtRef.current || startedAtRef.current || now;
        if (now - lastDataAt > Math.max(RECORDING_DATA_SLICE_MS * 2, 120 * 1000)) {
          handleCaptureInterrupted("录音被系统暂停，已保存已录到的内容，恢复后会继续录音");
          return;
        }

        setStatus("录音中");
      }, 900);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenStartedAtRef.current = Date.now();
        saveCurrentChunk();
        return;
      }
      const hiddenMs = hiddenStartedAtRef.current ? Date.now() - hiddenStartedAtRef.current : 0;
      hiddenStartedAtRef.current = 0;
      keepSessionAlive();
      reconcileAfterBackground(hiddenMs);
    };

    const warnBeforeLeaving = (event) => {
      if (!isRecordingRef.current && !resumeAvailableRef.current) return;
      saveCurrentChunk();
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", keepSessionAlive);
    window.addEventListener("pageshow", keepSessionAlive);
    window.addEventListener("pagehide", saveCurrentChunk);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", keepSessionAlive);
      window.removeEventListener("pageshow", keepSessionAlive);
      window.removeEventListener("pagehide", saveCurrentChunk);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, []);

  function startAnalyser(stream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 5.8));
      analyserRafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  async function uploadRecording(blob, durationMs, options = {}) {
    const loadingMsg = options.uploadMessage || "正在上传录音并准备转写"
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || "新录音",
          durationMs,
          message: loadingMsg + ` call uploadRecording 1`,
        }));
    updateUploadCard(uploadId, {
      name: options.name || "新录音",
      durationMs,
      message: loadingMsg + ` call uploadRecording 2`,
    });
    const formData = new FormData();
    formData.append("audio", blob, options.fileName || `recording-${Date.now()}.webm`);
    formData.append("durationMs", String(durationMs));
    formData.append("mimeType", blob.type || "audio/webm");
    if (options.name) formData.append("name", options.name);
    if (options.folderId) formData.append("folderId", options.folderId);

    try {
      const payload = await api("/api/recordings", {
        method: "POST",
        body: formData,
      });

      finishUploadCard(uploadId, payload.recording);
      if (!options.keepSelection && activeViewRef.current !== "detail") setSelectedId(payload.recording.id);
      if (options.toastMessage) {
        showToast(options.toastMessage);
      } else if (!options.silent) {
        showToast("录音已上传服务器，可在记录里查看");
      }
      window.setTimeout(() => {
        refreshRecordings(query, selectedFolderId).catch(() => {});
        refreshFolders().catch(() => {});
      }, 2600);
    } catch (error) {
      failUploadCard(uploadId);
      throw error;
    }
  }

  async function uploadRecordingSegments(segments, durationMs, options = {}) {
    const loadingMsg = options.uploadMessage || "正在上传录音并准备转写"
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
          durationMs,
          message: loadingMsg + ' call uploadRecordingSegments 1',
        }));
    console.log("[call] uploadRecordingSegments: ", uploadId)
    updateUploadCard(uploadId, {
      name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
      durationMs,
      message: loadingMsg + ' call uploadRecordingSegments 2',
    });
    console.log("[call] uploadRecordingSegments 前端乐观更新结束")
    let longUploadSessionId = "";
    try {
      let payload;
      if (segments.length > LONG_RECORDING_DIRECT_UPLOAD_LIMIT) {
        console.log(`[CALL] uploadRecordingSegments: , segments.length: ${segments.length}, LONG_RECORDING_DIRECT_UPLOAD_LIMIT: ${LONG_RECORDING_DIRECT_UPLOAD_LIMIT}`)
        const session = await api("/api/recording-upload-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: options.name || (segments.length > 1 ? "上传录音" : "新录音"),
            durationMs,
            mimeType: segments[0]?.type || "audio/webm",
            folderId: options.folderId || null,
          }),
        });
        longUploadSessionId = session.sessionId || "";
        const batchSize = Math.max(1, Number(session.batchSize || LONG_RECORDING_UPLOAD_BATCH_SIZE));
        for (let start = 0; start < segments.length; start += batchSize) {
          const batch = segments.slice(start, start + batchSize);
          const batchForm = new FormData();
          batchForm.append("startIndex", String(start));
          batch.forEach((blob, index) => {
            batchForm.append("audio", blob, `recording-${Date.now()}-${start + index + 1}.webm`);
          });
          updateUploadCard(uploadId, {
            message: `正在后台上传 ${Math.min(start + batch.length, segments.length)}/${segments.length} 段`,
          });
          await api(`/api/recording-upload-sessions/${session.sessionId}/segments`, {
            method: "POST",
            body: batchForm,
          });
        }
        updateUploadCard(uploadId, { message: "正在合并录音并准备转写" });
        payload = await api(`/api/recording-upload-sessions/${session.sessionId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationMs }),
        });
      } else {
        const formData = new FormData();
        segments.forEach((blob, index) => {
          formData.append("audio", blob, options.fileName || `recording-${Date.now()}-${index + 1}.webm`);
        });
        formData.append("durationMs", String(durationMs));
        formData.append("mimeType", segments[0]?.type || "audio/webm");
        if (options.name) formData.append("name", options.name);
        if (options.folderId) formData.append("folderId", options.folderId);
        payload = await api("/api/recordings/segments", {
          method: "POST",
          body: formData,
        });
      }

      finishUploadCard(uploadId, payload.recording);
      if (!options.keepSelection && activeViewRef.current !== "detail") setSelectedId(payload.recording.id);
      if (options.toastMessage) {
        showToast(options.toastMessage);
      } else if (!options.silent) {
        showToast("录音已上传服务器，可在记录里查看");
      }
      window.setTimeout(() => {
        refreshRecordings(query, selectedFolderId).catch(() => {});
        refreshFolders().catch(() => {});
      }, 2600);
    } catch (error) {
      if (longUploadSessionId) {
        api(`/api/recording-upload-sessions/${longUploadSessionId}`, { method: "DELETE" }).catch(() => {});
      }
      failUploadCard(uploadId);
      throw error;
    }
  }

  function ensureRecordingSessionManifest() {
    if (recordingSessionIdRef.current) {
      return {
        id: recordingSessionIdRef.current,
        startedAt: recordingSessionStartedAtRef.current || new Date().toISOString(),
      };
    }

    const existing = readRecordingSessionManifest();
    if (existing?.id && (existing.segments || []).length === 0) {
      recordingSessionIdRef.current = existing.id;
      recordingSessionStartedAtRef.current = existing.startedAt || existing.createdAt || new Date().toISOString();
      recordingSessionPersistedIdsRef.current = [];
      return existing;
    }

    const startedAt = new Date().toISOString();
    const session = {
      id: `recording-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt,
      createdAt: startedAt,
      clientId: getClientId(),
      clientName: getClientName(),
      segments: [],
    };
    recordingSessionIdRef.current = session.id;
    recordingSessionStartedAtRef.current = startedAt;
    recordingSessionPersistedIdsRef.current = [];
    writeRecordingSessionManifest(session);
    return session;
  }

  async function persistCurrentRecordingSegment(index, blob, durationMs, mimeType) {
    if (!blob?.size) return "";
    const session = ensureRecordingSessionManifest();
    const id = `${session.id}-${String(index + 1).padStart(4, "0")}`;
    const row = {
      id,
      sessionId: session.id,
      index,
      durationMs,
      size: blob.size,
      mimeType: mimeType || blob.type || "audio/webm",
      createdAt: new Date().toISOString(),
      blob,
    };
    await putRecordingRecoverySegment(row);

    const manifest = readRecordingSessionManifest() || session;
    const segments = (manifest.segments || []).filter((segment) => segment.id !== id);
    segments.push({
      id,
      sessionId: session.id,
      index,
      durationMs,
      size: blob.size,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
    });
    segments.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    writeRecordingSessionManifest({
      ...manifest,
      id: session.id,
      startedAt: session.startedAt || manifest.startedAt || recordingSessionStartedAtRef.current,
      clientId: manifest.clientId || getClientId(),
      clientName: manifest.clientName || getClientName(),
      updatedAt: new Date().toISOString(),
      segments,
    });
    return id;
  }

  async function appendRecordingSessionSegment(blob, durationMs, mimeType) {
    if (!blob?.size) return;
    const segmentIndex = sessionDurationsRef.current.length;
    sessionSegmentsRef.current.push(blob);
    sessionDurationsRef.current.push(durationMs);
    totalElapsedBeforeSegmentRef.current += durationMs;
    try {
      const persistedId = await persistCurrentRecordingSegment(segmentIndex, blob, durationMs, mimeType || blob.type || "audio/webm");
      if (persistedId) {
        recordingSessionPersistedIdsRef.current[segmentIndex] = persistedId;
        sessionSegmentsRef.current[segmentIndex] = null;
      }
    } catch {
      // Keep the in-memory blob if mobile persistent storage is unavailable.
    }
  }

  async function persistBufferedRecordingChunk(mimeType = "") {
    const task = recordingPersistPromiseRef.current
      .catch(() => {})
      .then(async () => {
        const chunks = chunksRef.current;
        if (chunks.length === 0) return;
        recordingPersistingRef.current = true;
        const chunksToPersist = chunks.slice();
        chunks.length = 0;
        try {
          const now = Date.now();
          const durationMs = Math.max(0, now - startedAtRef.current);
          startedAtRef.current = now;
          const blob = new Blob(chunksToPersist, { type: mimeType || "audio/webm" });
          await appendRecordingSessionSegment(blob, durationMs, mimeType || blob.type || "audio/webm");
        } finally {
          recordingPersistingRef.current = false;
        }
      });
    recordingPersistPromiseRef.current = task.catch(() => {});
    return task;
  }

  async function recordingSegmentsForRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    const segments = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const memoryBlob = sessionSegmentsRef.current[index];
      if (memoryBlob?.size > 0) {
        segments.push(memoryBlob);
        continue;
      }

      const persistedId = recordingSessionPersistedIdsRef.current[index];
      if (!persistedId) continue;
      try {
        const row = await getRecordingRecoverySegment(persistedId);
        if (row?.blob?.size > 0) segments.push(row.blob);
      } catch(error) {
        console.error("call recordingSegmentsForRange failed: ", `persistedId: ${persistedId} err: ${error.message}`);
        // If persistent recovery is unavailable, skip missing chunks instead of blocking saved audio.
      }
    }
    return segments;
  }

  async function removePersistedSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    const ids = recordingSessionPersistedIdsRef.current.slice(startIndex, endIndex).filter(Boolean);
    await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));

    const manifest = readRecordingSessionManifest();
    if (!manifest?.id) return;
    const remaining = (manifest.segments || []).filter((segment) => Number(segment.index || 0) < startIndex || Number(segment.index || 0) >= endIndex);
    if (remaining.length === 0) {
      removeRecordingRecoveryManifest(manifest.id);
      clearRecordingSessionManifest(manifest.id);
      return;
    }
    writeRecordingSessionManifest({ ...manifest, segments: remaining, updatedAt: new Date().toISOString() });
  }

  async function clearCurrentRecordingRecovery() {
    const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
    if (!sessionId) return;
    await clearRecordingRecoverySession(sessionId);
  }

  async function recoverSingleRecordingManifest(manifestSnapshot) {
    const manifest = normalizeRecordingSessionManifest(manifestSnapshot);
    const manifestSegments = (manifest?.segments || []).slice().sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    if (!manifest?.id || manifestSegments.length === 0) return true;

    try {
      const rows = [];
      for (const segment of manifestSegments) {
        try {
          const row = await getRecordingRecoverySegment(segment.id);
          if (row?.blob?.size > 0) rows.push(row);
        } catch (err) {
          console.error("reverSignleRecordingManifest failed: ", err.message)
          // Continue with the segments that can still be recovered.
        }
      }

      if (rows.length === 0) {
        await clearRecordingRecoveryManifest(manifest);
        return true;
      }

      const durationMs = Math.max(1000, rows.reduce((total, row) => total + Math.max(0, Number(row.durationMs || 0)), 0));
      const startedAt = manifest.startedAt || rows[0]?.createdAt || new Date().toISOString();
      const uploadId = createUploadCard({
        name: `中断自动保存 ${formatDate(startedAt)}`,
        durationMs,
        message: "正在恢复上次中断前的录音",
      });
      console.log(`[call] recoverSingleRecordingManifest  rows.length: ${rows.length}`)
      await uploadRecordingSegments(
        rows.map((row) => row.blob),
        durationMs,
        {
          uploadId,
          name: `中断自动保存 ${formatDate(startedAt)}`,
          toastMessage: "上次中断前的录音已自动恢复上传",
        },
      );
      await clearRecordingRecoveryManifest(manifest);
      return true;
    } catch (error) {
      console.error("call recoverSingleRecordingManifest failed: "+ error.message)
      showToast(`调用 recoverSingleRecordingManifest failed: ${error.message}`, 4000);
      return false;
    }
  }

  // 恢复中断的录音
  async function recoverInterruptedRecordingSession(manifestSnapshot = null) {
    if (recoveryUploadInFlightRef.current) return false;
    const manifests = manifestSnapshot ? [manifestSnapshot] : readRecoverableRecordingManifests();
    if (manifests.length === 0) return true;
    recoveryUploadInFlightRef.current = true;

    try {
      let ok = true;
      for (const manifest of manifests) {
        if (backgroundUploadSessionIdsRef.current.has(manifest.id)) continue;
        const recovered = await recoverSingleRecordingManifest(manifest);
        if (!recovered) ok = false;
      }
      return ok;
    } finally {
      recoveryUploadInFlightRef.current = false;
    }
  }

  useEffect(() => {
    requestPersistentRecordingStorage();
    recoverInterruptedRecordingSession().catch(() => {});
  }, []);

  function resetRecordingSession(options = {}) {
    const clearPersisted = Boolean(options.clearPersisted);
    const sessionId = recordingSessionIdRef.current;
    sessionSegmentsRef.current = [];
    sessionDurationsRef.current = [];
    totalElapsedBeforeSegmentRef.current = 0;
    autosavedSegmentCountRef.current = 0;
    autosavedDurationMsRef.current = 0;
    recordingSessionIdRef.current = "";
    recordingSessionStartedAtRef.current = "";
    recordingSessionPersistedIdsRef.current = [];
    if (clearPersisted && sessionId) clearRecordingRecoverySession(sessionId).catch(() => {});
    setResumeAvailable(false);
  }

  function preserveCurrentChunk(recorder) {
    try {
      if (recorder?.state === "recording") recorder.requestData();
    } catch {
      // Some mobile WebViews throw when the recorder is already being stopped.
    }
  }

  function durationForSegmentRange(startIndex, endIndex = sessionDurationsRef.current.length) {
    return sessionDurationsRef.current.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
  }

  // TODO 待删除多余方法
  // function stoppedRecordingSnapshot() {
  //   return {
  //     sessionId: recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "",
  //     startedAtMs: startedAtRef.current || Date.now(),
  //     stoppedAtMs: Date.now(),
  //     uploadStartIndex: Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length),
  //     sessionSegments: sessionSegmentsRef.current.slice(),
  //     sessionDurations: sessionDurationsRef.current.slice(),
  //     persistedIds: recordingSessionPersistedIdsRef.current.slice(),
  //     chunks: chunksRef.current,
  //     autosavedSegmentCount: autosavedSegmentCountRef.current,
  //     autosavedDurationMs: autosavedDurationMsRef.current,
  //   };
  // }

  // TODO 待删除多余方法
  // function resetRecorderUiForNext(sessionId = "") {
  //   resetRecordingSession();
  //   releaseRecordingWakeLock();
  //   setElapsedMs(0);
  //   setIsRecording(false);
  //   isRecordingRef.current = false;
  //   setResumeAvailable(false);
  //   resumeAvailableRef.current = false;
  //   stopReasonRef.current = "idle";
  //   manualStopRequestedRef.current = false;
  //   finalizingRecordingRef.current = false;
  //   setLevel(0.12);
  //   setStatus("点击麦克风开始");
  // }

  async function clearRecordingRecoverySnapshot(snapshot) {
    const ids = (snapshot?.persistedIds || []).filter(Boolean);
    await Promise.all(ids.map((id) => deleteRecordingRecoverySegment(id).catch(() => {})));
    removeRecordingRecoveryManifest(snapshot?.sessionId);
    clearRecordingSessionManifest(snapshot?.sessionId);
  }

  async function recordingSegmentsForSnapshot(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
    const segments = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const memoryBlob = snapshot.sessionSegments[index];
      if (memoryBlob?.size > 0) {
        segments.push(memoryBlob);
        continue;
      }

      const persistedId = snapshot.persistedIds[index];
      if (!persistedId) continue;
      try {
        const row = await getRecordingRecoverySegment(persistedId);
        if (row?.blob?.size > 0) segments.push(row.blob);
      } catch {
        // Keep uploading whatever segments are still available.
      }
    }
    return segments;
  }

  function durationForSnapshotRange(snapshot, startIndex, endIndex = snapshot.sessionDurations.length) {
    return snapshot.sessionDurations.slice(startIndex, endIndex).reduce((total, duration) => total + Math.max(0, duration || 0), 0);
  }

  async function uploadStoppedRecordingSnapshot(snapshot, mimeType = "audio/webm") {
    if (!snapshot) return;
    const finalChunks = Array.isArray(snapshot.chunks) ? snapshot.chunks.slice() : [];
    const sessionSegments = snapshot.sessionSegments.slice();
    const sessionDurations = snapshot.sessionDurations.slice();
    const persistedIds = snapshot.persistedIds.slice();
    if (finalChunks.length > 0) {
      const finalBlob = new Blob(finalChunks, { type: mimeType || finalChunks[0]?.type || "audio/webm" });
      const finalDurationMs = Math.max(0, (snapshot.stoppedAtMs || Date.now()) - (snapshot.startedAtMs || Date.now()));
      sessionSegments.push(finalBlob);
      sessionDurations.push(finalDurationMs);
      persistedIds.push("");
    }

    const uploadSnapshot = {
      ...snapshot,
      sessionSegments,
      sessionDurations,
      persistedIds,
    };
    const uploadStartIndex = Math.min(snapshot.uploadStartIndex || 0, sessionSegments.length);
    const segments = await recordingSegmentsForSnapshot(uploadSnapshot, uploadStartIndex);
    const durationMs = Math.max(1000, durationForSnapshotRange(uploadSnapshot, uploadStartIndex));
    const sessionId = snapshot.sessionId || "";

    if (segments.length === 0) {
      if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
      if (uploadStartIndex > 0) showToast("中断前录音已自动保存");
      backgroundUploadSessionIdsRef.current.delete(sessionId);
      return;
    }

    let uploaded = false;
    try {
      await uploadRecordingSegments(segments, durationMs, { keepSelection: true });
      uploaded = true;
      setRecordingError("");
    } catch (error) {
      console.error("call uploadStoppedRecordingSnapshot: ", error.message)
      setRecordingError("");
      showToast(`调用 uploadStoppedRecordingSnapshot failed: ${error.message}`, 4000);
    } finally {
      if (uploaded) {
        await clearRecordingRecoverySnapshot(uploadSnapshot).catch(() => {});
      }
      if (sessionId) {
        backgroundUploadSessionIdsRef.current.delete(sessionId);
      }
    }
  }

  async function autoSaveInterruptedRecording() {
    const startIndex = autosavedSegmentCountRef.current;
    const endIndex = sessionSegmentsRef.current.length;
    const segments = await recordingSegmentsForRange(startIndex, endIndex);
    if (segments.length === 0) return;

    const durationMs = Math.max(1000, durationForSegmentRange(startIndex, endIndex));
    try {
      await uploadRecordingSegments(segments, durationMs, {
        name: `中断自动保存 ${formatDate(new Date().toISOString())}`,
        keepSelection: true,
        silent: true,
        toastMessage: "意外中断前的录音已自动保存",
      });
      await removePersistedSegmentRange(startIndex, endIndex);
      autosavedSegmentCountRef.current = endIndex;
      autosavedDurationMsRef.current += durationMs;
    } catch (error) {
      console.error('call recordingUploadErrorMessage failed: ', error.message)
      setRecordingError("");
      showToast(`调用 autoSaveInterruptedRecording failed: ${error.message}`, 4000);
    }
  }

  function rolloverRecorderSegment() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
    stopReasonRef.current = "rollover";
    try {
      recorder.stop();
    } catch {
      stopReasonRef.current = "recording";
      scheduleResumeRecording();
    }
  }

  function scheduleRecorderRollover() {
    window.clearTimeout(rolloverTimerRef.current);
    rolloverTimerRef.current = window.setTimeout(rolloverRecorderSegment, RECORDING_ROLLOVER_MS);
  }

  function scheduleRecordingAutosave() {
    if (RECORDING_AUTOSAVE_CHUNK_MS <= 0) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording" || stopReasonRef.current !== "recording") return;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm")
          .catch(() => {})
          .finally(() => {
            if (recorder.state === "recording" && stopReasonRef.current === "recording") scheduleRecordingAutosave();
          });
      }, 120);
    }, RECORDING_AUTOSAVE_CHUNK_MS);
  }

  function stopRecordingWatchdog() {
    window.clearInterval(recordingWatchdogTimerRef.current);
    recordingWatchdogTimerRef.current = 0;
  }

  function scheduleRecordingWatchdog() {
    stopRecordingWatchdog();
    recordingWatchdogTimerRef.current = window.setInterval(() => {
      if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
      const recorder = mediaRecorderRef.current;

      if (!recorder) {
        if (isRecordingRef.current || resumeAvailableRef.current) {
          handleCaptureInterrupted("录音器被系统暂停，已保留当前片段并准备自动续录。");
        }
        return;
      }

      if (recorder.state === "paused") {
        try {
          recorder.resume();
          setStatus("录音已自动恢复，正在继续");
          return;
        } catch {
          handleCaptureInterrupted("录音被系统暂停，已保留当前片段并准备自动续录。");
          return;
        }
      }

      if (recorder.state === "inactive") {
        handleCaptureInterrupted("录音器意外停止，已保留当前片段并准备自动续录。");
        return;
      }

      const now = Date.now();
      const lastDataAt = lastRecorderDataAtRef.current || startedAtRef.current || now;
      const staleMs = now - lastDataAt;
      const staleThresholdMs = Math.max(RECORDING_DATA_SLICE_MS * 3, 90 * 1000);
      if (staleMs < staleThresholdMs || now - lastRecorderWatchdogActionAtRef.current < 30 * 1000) return;

      lastRecorderWatchdogActionAtRef.current = now;
      preserveCurrentChunk(recorder);
      window.setTimeout(() => {
        if (mediaRecorderRef.current !== recorder || stopReasonRef.current !== "recording") return;
        persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
      }, 160);
    }, RECORDING_WATCHDOG_MS);
  }

  function handleCaptureInterrupted(reason = "电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。") {
    if (manualStopRequestedRef.current || stopReasonRef.current !== "recording") return;
    const recorder = mediaRecorderRef.current;
    stopReasonRef.current = "interrupted";
    setRecordingError(reason);
    setStatus("麦克风暂时被占用，等待自动续录");
    preserveCurrentChunk(recorder);
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        return;
      }
    } catch {
      // Fall through to the recovery path below.
    }

    window.clearInterval(timerRef.current);
    cleanupCapture();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    isRecordingRef.current = false;
    setResumeAvailable(true);
    resumeAvailableRef.current = true;
    persistBufferedRecordingChunk(recorder?.mimeType || "audio/webm")
      .then(() => autoSaveInterruptedRecording())
      .catch(() => {})
      .finally(() => scheduleResumeRecording());
  }

  function scheduleResumeRecording() {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      if (manualStopRequestedRef.current || !resumeAvailableRef.current || isRecordingRef.current || document.visibilityState === "hidden") return;
      beginRecording({ resume: true, automatic: true }).catch(() => {});
    }, 900);
  }

  async function finishRecordingSession() {
    finalizingRecordingRef.current = true;
    const sessionId = recordingSessionIdRef.current || readRecordingSessionManifest()?.id || "";
    const sessionManifest = readRecordingSessionManifest();
    const uploadStartIndex = Math.min(autosavedSegmentCountRef.current, sessionSegmentsRef.current.length);
    const segments = await recordingSegmentsForRange(uploadStartIndex);
    const durationMs = Math.max(1000, durationForSegmentRange(uploadStartIndex));
    const releaseRecorderUi = () => {
      resetRecordingSession();
      releaseRecordingWakeLock();
      setElapsedMs(0);
      stopReasonRef.current = "idle";
      manualStopRequestedRef.current = false;
      finalizingRecordingRef.current = false;
      setStatus("点击麦克风开始");
    };

    if (segments.length === 0) {
      if (sessionId) await clearRecordingRecoverySession(sessionId).catch(() => {});
      releaseRecorderUi();
      if (uploadStartIndex > 0) showToast("中断前录音已自动保存");
      return;
    }

    if (sessionId) backgroundUploadSessionIdsRef.current.add(sessionId);
    releaseRecorderUi();

    let uploaded = false;
    try {
      await uploadRecordingSegments(segments, durationMs);
      uploaded = true;
      setRecordingError("");
    } catch (error) {
      console.error("call finishRecordingSession failed: ", error.message)
      setRecordingError("");
      showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
    } finally {
      if (uploaded && sessionManifest?.id) {
        await clearRecordingRecoveryManifest(sessionManifest).catch(() => {});
      }
      if (sessionId) {
        backgroundUploadSessionIdsRef.current.delete(sessionId);
      }
    }
  }

  async function beginRecording(options = {}) {
    if (finalizingRecordingRef.current) return;
    const resume = Boolean(options.resume);
    if (!resume) manualStopRequestedRef.current = false;
    setRecordingError("");

    if (!canRequestMicrophone()) {
      setRecordingError("手机端录音必须通过 HTTPS 打开。请部署到 HTTPS 域名后，再从企业微信应用入口访问。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError("当前环境不支持网页录音，请升级企业微信或使用系统浏览器打开。");
      return;
    }

    try {
      if (!resume) {
        const staleManifests = readRecoverableRecordingManifests().filter((manifest) => !backgroundUploadSessionIdsRef.current.has(manifest.id));
        if (staleManifests.length > 0) {
          recoverInterruptedRecordingSession().catch(() => {});
          showToast("正在后台恢复中断前的录音");
        }
        resetRecordingSession();
        ensureRecordingSessionManifest();
        await requestPersistentRecordingStorage();
      }
      const stream = await requestMicrophoneStream();
      await requestRecordingWakeLock();
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      const recorderChunks = [];
      chunksRef.current = recorderChunks;
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      lastRecorderDataAtRef.current = startedAtRef.current;
      lastRecorderWatchdogActionAtRef.current = 0;
      stopReasonRef.current = "recording";

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          lastRecorderDataAtRef.current = Date.now();
          recorderChunks.push(event.data);
          if (stopReasonRef.current === "recording") {
            persistBufferedRecordingChunk(recorder.mimeType || event.data.type || "audio/webm").catch(() => {});
          }
        }
      };

      recorder.onstop = async () => {
        const manualSnapshot = stoppedRecordingSnapshotsRef.current.get(recorder);
        if (manualSnapshot) {
          stoppedRecordingSnapshotsRef.current.delete(recorder);
          await uploadStoppedRecordingSnapshot(manualSnapshot, recorder.mimeType || "audio/webm");
          return;
        }

        const reason = stopReasonRef.current === "recording" ? "interrupted" : stopReasonRef.current;
        await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm");
        if (mediaRecorderRef.current === recorder) {
          cleanupCapture();
          mediaRecorderRef.current = null;
        }

        if (reason === "manual") {
          await finishRecordingSession();
          return;
        }

        if (reason === "rollover") {
          if (manualStopRequestedRef.current) {
            await finishRecordingSession();
            return;
          }
          setIsRecording(false);
          isRecordingRef.current = false;
          setResumeAvailable(true);
          resumeAvailableRef.current = true;
          setStatus("长录音保护分段中，正在继续录音");
          beginRecording({ resume: true, automatic: true }).catch(() => scheduleResumeRecording());
          return;
        }

        if (reason === "interrupted") {
          if (manualStopRequestedRef.current) return;
          await autoSaveInterruptedRecording();
          setIsRecording(false);
          isRecordingRef.current = false;
          setResumeAvailable(true);
          resumeAvailableRef.current = true;
          setStatus("麦克风已被系统暂停，返回后自动续录");
          scheduleResumeRecording();
          return;
        }

        stopReasonRef.current = "idle";
      };

      recorder.onerror = () => handleCaptureInterrupted("录音被系统中断，已保留当前片段，返回页面后会自动续录。");
      stream.oninactive = () => handleCaptureInterrupted("麦克风音频流被系统暂停，已保留当前片段，返回页面后会自动续录。");
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => handleCaptureInterrupted("电话或系统声音占用了麦克风，已保留当前片段，返回页面后会自动续录。");
        track.onmute = () => {
          if (stopReasonRef.current === "recording") setStatus("麦克风暂时被系统占用，正在等待恢复");
        };
        track.onunmute = () => {
          if (stopReasonRef.current === "recording") setStatus("录音中，再点一次停止");
        };
      });

      if (RECORDING_DATA_SLICE_MS > 0) recorder.start(RECORDING_DATA_SLICE_MS);
      else recorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;
      setResumeAvailable(false);
      resumeAvailableRef.current = false;
      setStatus(resume ? "续录中，再点一次停止" : "录音中，再点一次停止");
      scheduleRecorderRollover();
      scheduleRecordingAutosave();
      scheduleRecordingWatchdog();
      startAnalyser(stream);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(totalElapsedBeforeSegmentRef.current + Date.now() - startedAtRef.current);
      }, 80);
    } catch (error) {
      alert("录音失败，请检查麦克风权限或网络连接: ", error.message);
      setRecordingError(microphoneErrorMessage(error));
      cleanupCapture();
      if (resume || sessionSegmentsRef.current.length > 0) {
        setResumeAvailable(true);
        setStatus("麦克风尚未恢复，点击麦克风继续录音");
      }
    }
  }

  async function stopRecording() {
    if (finalizingRecordingRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      manualStopRequestedRef.current = true;
      stopReasonRef.current = "manual";
      finalizingRecordingRef.current = true;
      preserveCurrentChunk(recorder);
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      await Promise.race([
        recordingPersistPromiseRef.current.catch(() => {}),
        new Promise((resolve) => window.setTimeout(resolve, 800)),
      ]);
      window.clearInterval(timerRef.current);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(rolloverTimerRef.current);
      window.clearTimeout(autosaveTimerRef.current);
      setIsRecording(false);
      isRecordingRef.current = false;
      setResumeAvailable(false);
      resumeAvailableRef.current = false;
      setStatus("正在保存录音");
      try {
        recorder.stop();
      } catch {
        await persistBufferedRecordingChunk(recorder.mimeType || "audio/webm").catch(() => {});
        cleanupCapture();
        mediaRecorderRef.current = null;
        await finishRecordingSession().catch((error) => {
          showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
          finalizingRecordingRef.current = false;
        });
      }
      return;
    }

    if (isRecordingRef.current || resumeAvailableRef.current || sessionDurationsRef.current.length > 0 || chunksRef.current.length > 0) {
      manualStopRequestedRef.current = true;
      stopReasonRef.current = "manual";
      finalizingRecordingRef.current = true;
      await persistBufferedRecordingChunk(recorder?.mimeType || "audio/webm").catch(() => {});
      cleanupCapture();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      isRecordingRef.current = false;
      setResumeAvailable(false);
      resumeAvailableRef.current = false;
      await finishRecordingSession().catch((error) => {
        showToast(`调用 finishRecordingSession failed: ${error.message}`, 4000);
        finalizingRecordingRef.current = false;
      });
    }
  }

  function toggleRecording() {
    console.log("toggleRecording");
    const recorder = mediaRecorderRef.current;
    if (isRecordingRef.current || recorder?.state === "recording") stopRecording();
    else beginRecording();
  }

  async function handleUploadFile(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const mediaFiles = files.filter(isUploadableMediaFile);
    if (mediaFiles.length === 0) {
      showToast("请选择音频或视频文件");
      return;
    }
    if (mediaFiles.length !== files.length) {
      showToast("已跳过不支持的文件");
    } else if (mediaFiles.length > 1) {
      showToast(`正在上传 ${mediaFiles.length} 个录音文件`);
    }

    const folderId =
      selectedFolderId !== "all" &&
      selectedFolderId !== "uncategorized" &&
      selectedFolderId !== "favorites" &&
      selectedFolderId !== "trash"
        ? selectedFolderId
        : undefined;

    const firstDisplayName = mediaFiles[0]?.name?.replace(/\.[^.]+$/, "") || "新录音";
    const uploadId = createUploadCard({
      name: mediaFiles.length > 1 ? "上传录音" : firstDisplayName,
      durationMs: 0,
      message: "正在读取文件，准备上传",
    });

    try {
      if (mediaFiles.length === 1) {
        const file = mediaFiles[0];
        const durationMs = await getAudioFileDuration(file);
        const rawName = file.name.replace(/\.[^.]+$/, "");
        await uploadRecording(file, durationMs, {
          name: rawName || undefined,
          fileName: file.name,
          folderId,
          uploadId,
        });
        showToast("录音已上传并开始转写");
        return;
      }

      const durations = await Promise.all(mediaFiles.map((file) => getAudioFileDuration(file)));
      const durationMs = durations.reduce((total, value) => total + Math.max(0, value || 0), 0);
      await uploadRecordingSegments(mediaFiles, durationMs, {
        name: "上传录音",
        folderId,
        uploadId,
        toastMessage: `${mediaFiles.length} 个录音文件已上传并开始转写`,
      });
      refreshRecordings(query, selectedFolderId).catch(() => {});
      refreshFolders().catch(() => {});
    } catch (error) {
      console.error("call handleUploadFile failed: ", error.message)
      failUploadCard(uploadId);
      showToast(`调用 handleUploadFile failed: ${error.message}`, 4000);
    }
  }

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
    await refreshRecordings(query, selectedFolderId === id ? "all" : selectedFolderId);
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
      await refreshRecordings(query, selectedFolderId);
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
      refreshRecordings(query, "favorites").catch(() => {});
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
      refreshTranscriptionStatus().catch(() => {});
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
      if (!isWecomWebView() || !window.wx?.invoke) return false;
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
    setSelectedId((current) => (current === recording.id ? "" : current));
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
      refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
    } catch (error) {
      releaseOptimisticRecordingRemoval(recording.id);
      refreshFolders().catch(() => {});
      refreshRecordings(query, selectedFolderId, { silent: true }).catch(() => {});
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
    setSelectedId(payload.recording.id);
    refreshFolders().catch(() => {});
    showToast("录音已恢复");
  }

  async function permanentDeleteRecording(recording) {
    const confirmed = window.confirm(`彻底删除「${recording.name}」？删除后不能恢复。`);
    if (!confirmed) return;
    runSmoothDelete(recording, { permanent: true }).catch(() => {});
  }

  function applyAuthPayload(payload, message) {
    const accountUsername = String(payload.account?.username || payload.profile?.username || "").trim();
    const nextAuth = {
      token: payload.token,
      expiresAt: payload.expiresAt,
      account: payload.account,
      profile: payload.profile,
    };
    saveStoredAuth(nextAuth);
    setAuth(nextAuth);
    const nextProfile = {
      ...profile,
      ...(payload.profile || {}),
      accountLoggedIn: true,
      name: accountUsername || payload.profile?.name || profile.name || "",
      username: accountUsername,
      clientId: payload.account?.clientId || payload.profile?.clientId || getClientId(),
    };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
    window.localStorage.removeItem(QA_ACTIVE_MESSAGE_KEY);
    setSelectedId("");
    showToast(message);
    refreshFolders().catch(() => {});
    refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
  }

  async function enterAccount({ username, password, mode = "register" }) {
    const isLogin = mode === "login";
    const accountProfile = {
      ...profile,
      name: username,
      username,
    };
    const payload = await api(isLogin ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, profile: accountProfile, mergeLocal: !isLogin }),
    });
    applyAuthPayload(payload, isLogin ? "已登录账号，数据已同步" : "账号已注册，数据已同步");
  }

  function logoutAccount() {
    clearStoredAuth();
    setAuth(null);
    window.localStorage.removeItem(QA_ACTIVE_MESSAGE_KEY);
    window.localStorage.removeItem(DAILY_BRIEF_ACTIVE_KEY);
    const clientId = getClientId();
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    window.localStorage.removeItem(profileStorageKey(clientId));
    const nextProfile = {
      clientId,
      language: profile.language || "中文",
      recordsTitle: profile.recordsTitle || "我的录音",
      accountLoggedIn: false,
      name: "",
      username: "",
      avatarUrl: "",
      company: "",
      department: "",
      phone: "",
    };
    setProfile(nextProfile);
    saveLocalProfile(nextProfile);
    setSelectedId("");
    showToast("已退出登录");
    refreshFolders().catch(() => {});
    refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
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
    setSelectedId(id);
    setActiveView("detail");
  }

  function navigate(view) {
    if (view === "detail") setSelectedId("");
    setActiveView(view);
  }

  return (
    <main className={keyboardVisible ? "app-shell keyboard-visible" : "app-shell"}>
      <div className={`h5-app view-${activeView}`}>
        <div className="view-stack">
          {/* <div style={{fontSize: 30, color: 'red'}}>1232</div> */}

          {activeView === "records" ? (
            <RecordsView
              recordings={recordsForView}
              folders={folders}
              folderStats={folderStats}
              recordsTitle={profile.recordsTitle || "我的录音"}
              selectedFolderId={selectedFolderId}
              query={query}
              setQuery={setQuery}
              loading={loading}
              deletingRecordIds={deletingRecordIds}
              uploadBusy={uploadingRecords.length > 0}
              onOpenSettings={() => setSettingsOpen(true)}
              onStartRecording={() => setActiveView("record")}
              onUploadFile={() => uploadInputRef.current?.click()}
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
                refreshRecordings(query, selectedFolderId);
                refreshFolders().catch(() => {});
                refreshTranscriptionStatus().catch(() => {});
              }}
            />
          ) : null}

          {activeView === "detail" ? (
            <DetailView
              recording={selectedRecording}
              recordings={recordings}
              transcriptionStatus={transcriptionStatus}
              onBack={() => setActiveView("records")}
              onRename={renameRecording}
              onUpdateMeta={updateRecordingMeta}
              onToast={showToast}
              language={profile.language}
              onSelectRecording={(id) => setSelectedId(id)}
              onRefreshRecording={(id) => {
                console.log("DetailView onRefreshRecording", id);
                // TODO 暂时注释掉，避免频繁刷新导致的闪烁
                // window.setTimeout(() => refreshRecording(id).catch(() => {}), 1200)
              }}
            />
          ) : null}
        </div>

        <BottomNav activeView={activeView} onNavigate={navigate} language={profile.language} hidden={keyboardVisible} />
      </div>

      <input
        ref={uploadInputRef}
        className="upload-input"
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.webm,.aac,.mp4,.mov,.m4v"
        multiple
        onChange={handleUploadFile}
      />

      <SettingsDrawer
        open={settingsOpen}
        profile={profile}
        auth={auth}
        setProfile={setProfile}
        onSave={saveProfile}
        onAccountEnter={enterAccount}
        onAccountLogout={logoutAccount}
        onClose={() => {
          saveProfile().catch(() => {});
          setSettingsOpen(false);
        }}
      />
      <ShareSheet share={shareSheet} onCopy={copyShareSheet} onClose={() => setShareSheet(null)} />
    </main>
  );
}
