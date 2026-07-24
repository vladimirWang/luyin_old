import { useState, useEffect, useRef, useMemo } from "react";
import {
  Check,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  uiText,
  formatDuration,
  formatShortDate,
  formatDate,
  formatTimecode,
  isToday,
  safeFileName,
  audioExtensionFromMimeType,
  canRequestMicrophone,
  getSupportedMimeType,
  microphoneErrorMessage,
  cleanQaVisibleText,
  cleanAnswerForDisplay,
  pointLabelForIndex,
  thinkingStepsForMessage,
  dailyBriefMeetingCount,
  showToast
} from "../../utils/index.js";
import {
  createQuestion,
  deleteQaMessage,
  generateMeetingBrief,
  generateTodayMeetingBrief,
  getDetailRecordings,
  getMeetingBrief,
  getMeetingBriefs,
  getQaMessage,
  getQaMessages,
  getTodayMeetingBrief,
  transcribeVoiceInput,
  updateQaMessage,
} from "../../api/detail.js";
import { todayDisplayDateFallback, displayDateFromDateKey } from '../../utils/date.js'
import { DailyMeetingBriefCard } from './components/DailyMeetingBriefCard.jsx'
import { requestMicrophoneStream, getAudioFileDuration } from '../../utils/audio.js'
import { sharePdf } from '../../utils/pdf.js'
import {DailyMeetingBriefMessage} from './components/DailyMeetingBriefMessage.jsx'
import { ChatHistoryPanel } from "./components/ChatHistoryPanel.jsx";
import {
  DailyBriefListView,
  dailyBriefHasSummary,
} from "./components/DailyBriefListView.jsx";
import {todayDateKey} from '../../utils/date.js'
import { useDetailRoute } from './hooks/useDetailRoute.js'
import { DetailHeader } from './components/DetailHeader.jsx'
import { RecordingScopePanel } from './components/RecordingScopePanel.jsx'
import {
  AttachmentPreviewDialog,
  attachmentPreviewType,
} from './components/AttachmentPreviewDialog.jsx'
import { QuestionComposer } from "./components/QuestionComposer.jsx";
import { QaMessage } from "./components/QaMessage.jsx";
import {
  clearActiveDailyBriefRef,
  clearActiveQaMessageRef,
  readActiveDailyBriefRef,
  readActiveQaMessageRef,
  saveActiveDailyBriefRef,
  saveActiveQaMessageRef as persistActiveQaMessageRef,
} from "./utils/activeConversationStorage.js";
import {
  isSameRecordingScope,
  mergeQaMessages,
  messageRecordingIds,
  normalizeRecordingIds,
  sortMessagesAscending,
} from "./utils/qaMessageScope.js";
import { useTtsPlayer } from "./hooks/useTtsPlayer.js";
import { useCitationPlayer } from "./hooks/useCitationPlayer.js";
import {
  compactSpeechText,
  speechSegmentsForAnswerItem,
  structuredSpeechSegments,
} from "./utils/speechSegments.js";

export default function Detail() {
  const { recording, language, selectRecording } = useDetailRoute();
  const onToast = showToast;
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voicePointerRef = useRef(null);
  const chatThreadRef = useRef(null);
  const chatEndRef = useRef(null);
  const [availableRecordings, setAvailableRecordings] = useState([]);
  const [scopeIds, setScopeIds] = useState(recording?.id ? [recording.id] : []);
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);
  const [dailyBrief, setDailyBrief] = useState(null);
  const [dailyBriefHistory, setDailyBriefHistory] = useState([]);
  const [dailyBriefLoading, setDailyBriefLoading] = useState(false);
  const [dailyBriefExpanded, setDailyBriefExpanded] = useState(Boolean(recording?.id));
  const [expandedDailyBriefDates, setExpandedDailyBriefDates] = useState(() => new Set());
  const [dailyBriefGeneratingDates, setDailyBriefGeneratingDates] = useState(() => new Set());
  const [qaHistory, setQaHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [images, setImages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [composerMode, setComposerMode] = useState("text");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [expandedCitationGroups, setExpandedCitationGroups] = useState({});
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const qaPollingRef = useRef(new Map());
  const dailyBriefPollingRef = useRef(new Map());
  const qaConversationViewRef = useRef(Boolean(recording?.id));
  const activeScopeIdsRef = useRef([]);
  const citationPlayer = useCitationPlayer({
    recordings: availableRecordings,
    fallbackRecording: recording,
    getEndMs: citationEndMs,
    onBeforePlay: () => stopTtsQueue(),
  });
  const {
    state: ttsState,
    stop: stopTtsQueue,
    toggleQueue: toggleTtsQueue,
    toggleSegment: toggleTtsSegment,
  } = useTtsPlayer({
    onBeforePlay: citationPlayer.pause,
    onToast,
  });
  const activeCitationKey = citationPlayer.activeKey;
  const citationPlayback = citationPlayer.playback;
  const lockedRecordingId = recording?.id || "";
  const activeScopeIds = lockedRecordingId ? [lockedRecordingId] : scopeIds;
  const scopeKey = activeScopeIds.join("|");
  activeScopeIdsRef.current = activeScopeIds;

  function saveActiveQaMessageRef(message) {
    persistActiveQaMessageRef(message, messageRecordingIds(message));
  }

  function enterQaConversationView() {
    qaConversationViewRef.current = true;
  }

  function enterDailyBriefView() {
    qaConversationViewRef.current = false;
    clearActiveQaMessageRef();
  }

  function isDailyBriefViewActive() {
    return !qaConversationViewRef.current;
  }

  useEffect(() => {
    stopTtsQueue();
  }, [recording?.id, scopeKey]);

  useEffect(() => {
    if (lockedRecordingId) {
      enterQaConversationView();
      const nextScope = [lockedRecordingId];
      setScopeIds(nextScope);
      setDailyBriefExpanded(true);
      setAnswers((current) => {
        const history = historyForRecordings(nextScope);
        const known = [...current, ...history, ...qaHistory];
        const visible = current.filter((item) => shouldKeepQaMessageForScope(item, nextScope, known));
        return mergeQaMessages(history, visible).slice(-20);
      });
      const activeRef = readActiveQaMessageRef();
      if (activeRef?.id && !isSameRecordingScope(normalizeRecordingIds(activeRef.recordingIds || []), nextScope)) {
        clearActiveQaMessageRef(activeRef.id);
      }
    } else {
      enterDailyBriefView();
      setDailyBriefExpanded(false);
    }
  }, [lockedRecordingId]);

  useEffect(() => {
    console.log("fetching recordings list");
    let ignored = false;
    setListLoading(true);
    getDetailRecordings()
      .then((payload) => {
        console.log("recordings payload", payload);
        if (!ignored) {
          setAvailableRecordings((payload.recordings || []).filter((item) => !item.deletedAt));
          setListError("");
        }
      })
      .catch((e) => {
        console.error("Failed to fetch recordings list: ", e.message);
        if (!ignored) setListError("录音列表暂时无法刷新");
      })
      .finally(() => {
        if (!ignored) setListLoading(false);
      });

    return () => {
      ignored = true;
      if (voiceRecorderRef.current?.state === "recording") voiceRecorderRef.current.stop();
      const tracks = voiceStreamRef.current?.getTracks()
      if (Array.isArray(tracks)) {
        tracks.forEach((track) => track.stop());
      }
      if (Array.isArray(qaPollingRef.current)) {
        qaPollingRef.current.forEach((timer) => window.clearTimeout(timer));
      }
      qaPollingRef.current.clear();
      if (Array.isArray(dailyBriefPollingRef.current)) {
        dailyBriefPollingRef.current.forEach((timer) => window.clearTimeout(timer));
      }
      if (dailyBriefPollingRef.current && typeof dailyBriefPollingRef.current.clear === 'function') {
        dailyBriefPollingRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    let ignored = false;
    getQaMessages(60)
      .then((payload) => {
        if (!ignored) {
          const messages = payload.messages || [];
          setQaHistory(messages);
          restoreActiveQaConversation(messages);
        }
      })
      .catch(() => {});
    return () => {
      ignored = true;
    };
  }, []);

  useEffect(() => {
    if (recording?.id) return undefined;
    let ignored = false;
    setDailyBriefLoading(true);
    setDailyBriefExpanded(true);

    Promise.allSettled([
      fetchDailyBriefHistory(),
      getTodayMeetingBrief(),
    ])
      .then(([, todayResult]) => {
        if (ignored || todayResult.status !== "fulfilled") return;
        const payload = todayResult.value;
        mergeDailyBriefState(payload);
        if (payload?.status === "generating") {
          saveActiveDailyBriefRef(payload);
          pollDailyBrief(payload.date);
        } else if (payload?.summaryMarkdown) {
          clearActiveDailyBriefRef(payload.date);
        } else if (readActiveDailyBriefRef()?.date === payload?.date) {
          pollDailyBrief(payload.date);
        }
      })
      .catch(() => {
        if (!ignored) setDailyBrief(null);
      })
      .finally(() => {
        if (!ignored) setDailyBriefLoading(false);
      });

    return () => {
      ignored = true;
    };
  }, [recording?.id]);

  const activeRecordings = useMemo(() => {
    return [...availableRecordings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [availableRecordings]);
  const todayBriefRecordings = useMemo(() => activeRecordings.filter((item) => isToday(item.createdAt)), [activeRecordings]);
  const dailyBriefList = useMemo(() => {
    const byDate = new Map();
    const putBrief = (brief) => {
      if (!brief?.date) return;
      byDate.set(brief.date, { ...(byDate.get(brief.date) || {}), ...brief });
    };

    if (Array.isArray(dailyBriefHistory)) {
      dailyBriefHistory.forEach(putBrief);
    }
    putBrief(dailyBrief);

    return [...byDate.values()]
      .filter((brief) => brief?.date && brief.status !== "empty")
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [activeRecordings, dailyBrief, dailyBriefHistory]);
  const scopeRecording = activeScopeIds.length === 1 ? activeRecordings.find((item) => item.id === activeScopeIds[0]) || null : null;
  const scopeLabel = activeScopeIds.length === 0 ? uiText(language, "全部录音", "All recordings") : scopeRecording ? scopeRecording.name : uiText(language, "已选择录音", "Selected recording");
  const selectedScopeRecordings = activeScopeIds.map((id) => activeRecordings.find((item) => item.id === id)).filter(Boolean);
  const scopeSummaryMeta =
    activeScopeIds.length === 0
      ? `${activeRecordings.length} 条录音`
      : selectedScopeRecordings[0]
        ? `${formatShortDate(selectedScopeRecordings[0].createdAt)} · ${formatDuration(selectedScopeRecordings[0].durationMs)}`
        : "";
  const composerRows = Math.min(4, Math.max(1, question.split("\n").length, Math.ceil(question.length / 22)));
  const latestAnswer = answers[answers.length - 1];
  const latestAnswerKey = latestAnswer
    ? `${latestAnswer.id}-${latestAnswer.pending ? "pending" : "ready"}-${String(latestAnswer.answer || "").length}`
    : "";
  const shouldShowDailyBriefCard = !recording?.id && scopeIds.length === 0 && answers.length === 0 && !dailyBriefExpanded;
  const shouldShowDailyBriefList = !recording?.id && scopeIds.length === 0 && answers.length === 0 && dailyBriefExpanded;
  const chatThreadClassName = shouldShowDailyBriefCard ? "chat-thread has-daily-brief" : shouldShowDailyBriefList ? "chat-thread daily-brief-list-thread" : "chat-thread";
  const historyMessages = useMemo(() => {
    const alive = qaHistory.filter((item) => !item.deletedAt);
    const scoped = activeScopeIds.length > 0 ? alive.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, activeScopeIds, alive), activeScopeIds)) : alive;
    return sortMessagesAscending(scoped);
  }, [qaHistory, scopeKey]);
  const historyDailyBriefs = useMemo(() => {
    if (activeScopeIds.length > 0) return [];
    return [...dailyBriefHistory]
      .filter((item) => item?.date && item.status !== "empty")
      .sort((a, b) => {
        const left = new Date(a.updatedAt || a.generatedAt || a.date || 0).getTime();
        const right = new Date(b.updatedAt || b.generatedAt || b.date || 0).getTime();
        return right - left;
      });
  }, [dailyBriefHistory, scopeKey]);

  useEffect(() => {
    if (!lockedRecordingId) return;
    const nextScope = [lockedRecordingId];
    setAnswers((current) => {
      const history = historyForRecordings(nextScope);
      const known = [...current, ...history, ...qaHistory];
      const visible = current.filter((item) => shouldKeepQaMessageForScope(item, nextScope, known));
      return mergeQaMessages(history, visible).slice(-20);
    });
  }, [lockedRecordingId, qaHistory]);

  useEffect(() => {
    if (!latestAnswerKey) return;
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) {
        thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
        return;
      }
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }, [latestAnswerKey]);

  useEffect(() => {
    if (!Array.isArray(answers)) return;
    answers.filter((item) => item.pending).forEach((item) => {
      pollQaMessage(item.id, 0, messageScopeFromKnown(item, activeScopeIdsRef.current, answers));
    });
  }, [answers]);

  function messageScopeFromKnown(message, fallbackIds = [], knownMessages = []) {
    const direct = messageRecordingIds(message);
    if (direct.length > 0) return direct;

    const activeRef = readActiveQaMessageRef();
    if (activeRef?.id === message?.id) {
      const activeScope = normalizeRecordingIds(activeRef.recordingIds || []);
      if (activeScope.length > 0) return activeScope;
    }

    const known = [...knownMessages, ...answers, ...qaHistory].find((item) => item?.id === message?.id && messageRecordingIds(item).length > 0);
    if (known) return messageRecordingIds(known);
    return normalizeRecordingIds(fallbackIds);
  }

  function withQaMessageScope(message, fallbackIds = [], knownMessages = []) {
    if (!message?.id) return message;
    const scope = messageScopeFromKnown(message, fallbackIds, knownMessages);
    return scope.length > 0 ? { ...message, recordingIds: scope } : message;
  }

  function shouldKeepQaMessageForScope(message, scopeIdsForView, knownMessages = []) {
    if (!message?.id || message.deletedAt) return false;
    const targetScope = normalizeRecordingIds(scopeIdsForView);
    if (isSameRecordingScope(messageScopeFromKnown(message, targetScope, knownMessages), targetScope)) return true;

    const activeRef = readActiveQaMessageRef();
    if (activeRef?.id !== message.id) return false;
    const activeScope = normalizeRecordingIds(activeRef.recordingIds || []);
    return activeScope.length === 0 || isSameRecordingScope(activeScope, targetScope);
  }

  function restoreActiveQaConversation(messages = []) {
    const alive = sortMessagesAscending(messages.filter((item) => !item.deletedAt));
    const pendingMessages = alive.filter((item) => item.pending);
    (Array.isArray(pendingMessages) ? pendingMessages : []).forEach((item) => {
      pollQaMessage(item.id, 0, messageScopeFromKnown(item, [], alive))
    });
    if (!qaConversationViewRef.current) return;
    if (answers.length > 0) return;

    const activeRef = readActiveQaMessageRef();
    const refAgeMs = activeRef?.createdAt ? Date.now() - new Date(activeRef.createdAt).getTime() : 0;
    const refFresh = activeRef?.id && (!refAgeMs || refAgeMs < 24 * 60 * 60 * 1000);
    const currentScope = normalizeRecordingIds(activeScopeIdsRef.current);
    const scopeLocked = Boolean(lockedRecordingId);
    const belongsToCurrentScope = (item) => isSameRecordingScope(messageScopeFromKnown(item, scopeLocked ? currentScope : [], alive), currentScope);
    const fromActiveRef = refFresh ? alive.find((item) => item.id === activeRef.id && belongsToCurrentScope(item)) : null;
    const fromCurrentScope = [...pendingMessages].reverse().find((item) => belongsToCurrentScope(item));
    const candidate = fromActiveRef || fromCurrentScope || (scopeLocked ? null : pendingMessages[pendingMessages.length - 1]);
    if (!candidate) return;

    const candidateScope = messageScopeFromKnown(candidate, scopeLocked ? currentScope : [], alive);
    setScopeIds(scopeLocked ? currentScope : candidateScope);
    const scopedHistory = alive.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, candidateScope, alive), candidateScope));
    const restored = scopedHistory.some((item) => item.id === candidate.id) ? scopedHistory : [candidate];
    setAnswers(sortMessagesAscending(restored).slice(-20));
    setDailyBriefExpanded(true);
    if (candidate.pending) pollQaMessage(candidate.id, 0, candidateScope);
  }

  function historyForRecordings(ids) {
    const selected = normalizeRecordingIds(ids);
    return sortMessagesAscending(qaHistory.filter((message) => !message.deletedAt && isSameRecordingScope(messageScopeFromKnown(message, [], qaHistory), selected)));
  }

  function latestLinkedScopeForRecording(id) {
    const message = qaHistory.find((item) => {
      if (item.deletedAt) return false;
      const ids = messageScopeFromKnown(item, [], qaHistory);
      return ids.length > 1 && ids.includes(id);
    });
    return message ? messageScopeFromKnown(message, [], qaHistory) : null;
  }

  function hasHistoryForRecording(id) {
    return qaHistory.some((message) => !message.deletedAt && isSameRecordingScope(messageScopeFromKnown(message, [], qaHistory), [id]));
  }

  function toggleScope(id) {
    enterQaConversationView();
    const next = [id];
    const history = historyForRecordings(next).slice(-20);
    const latest = history[history.length - 1];
    setScopeIds(next);
    setAnswers(history);
    setDailyBriefExpanded(true);
    setScopeExpanded(false);
    if (latest) saveActiveQaMessageRef(latest);
    else clearActiveQaMessageRef();
    (Array.isArray(history) ? history : []).filter((item) => item.pending).forEach((item) => {
      pollQaMessage(item.id, 0, next)
    });
    if (lockedRecordingId && id !== lockedRecordingId) selectRecording(id);
    window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function resetToAllRecordings() {
    selectRecording("");
    enterDailyBriefView();
    stopTtsQueue();
    setScopeIds([]);
    setAnswers([]);
    setQuestion("");
    setImages([]);
    setAttachments([]);
    setAttachmentsOpen(false);
    setDailyBriefExpanded(false);
    setScopeExpanded(false);
    setHistoryOpen(false);
    setActiveCitationKey("");
    setExpandedCitationGroups({});
  }

  function openAttachmentPreview(item, type = "file") {
    setAttachmentPreview({ ...item, previewType: type });
  }

  function closeAttachmentPreview() {
    setAttachmentPreview(null);
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function readDataUrlFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function attachmentsForMessage(currentImages = [], currentAttachments = []) {
    return [
      ...currentImages.map((item) => ({ ...item, kind: "image", previewType: "image" })),
      ...currentAttachments.map((item) => ({ ...item, previewType: attachmentPreviewType(item) })),
    ];
  }

  async function addImageFiles(fileList, sourceLabel = "图片") {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const nextImages = [];
    for (const file of files.slice(0, Math.max(0, 3 - images.length))) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 3 * 1024 * 1024) {
        onToast?.("图片太大，单张请控制在 3MB 内");
        continue;
      }
      const dataUrl = await readImageFile(file);
      nextImages.push({ id: `${file.name}-${Date.now()}`, name: file.name, type: file.type, dataUrl });
    }

    if (nextImages.length > 0) {
      setImages((current) => [...current, ...nextImages].slice(0, 3));
      setAttachmentsOpen(false);
      onToast?.(`${sourceLabel}已加入`);
    }
  }

  async function addImages(event) {
    await addImageFiles(event.target.files, "图片");
    event.target.value = "";
  }

  async function addCameraImage(event) {
    await addImageFiles(event.target.files, "拍照图片");
    event.target.value = "";
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function addQuestionFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onToast?.("文件太大，当前先支持 2MB 内的文字类文件");
      return;
    }

    const textLike =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|log)$/i.test(file.name);
    let text = "";
    if (textLike) {
      text = (await readTextFile(file)).slice(0, 6000);
    }
    const dataUrl = textLike ? "" : await readDataUrlFile(file);
    setAttachments((current) => [
      ...current,
      {
        id: `${file.name}-${Date.now()}`,
        kind: "file",
        name: file.name,
        type: file.type,
        text,
        dataUrl,
      },
    ].slice(0, 6));
    setAttachmentsOpen(false);
    onToast?.(text ? "文件内容已加入提问上下文" : "文件已加入，非文字文件暂作为附件标记");
  }

  async function addQuestionAudio(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      onToast?.("请选择音频文件");
      return;
    }

    try {
      setVoiceBusy(true);
      const durationMs = await getAudioFileDuration(file);
      const dataUrl = file.size <= 8 * 1024 * 1024 ? await readDataUrlFile(file) : "";
      await uploadVoiceQuestion(file, durationMs);
      setAttachments((current) => [
        ...current,
        { id: `${file.name}-${Date.now()}`, kind: "audio", name: file.name, type: file.type, dataUrl, text: "音频已转成文字并放入输入框" },
      ].slice(0, 6));
      setAttachmentsOpen(false);
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "音频转文字失败");
    } finally {
      setVoiceBusy(false);
    }
  }

  function addLocationAttachment() {
    if (!navigator.geolocation) {
      onToast?.("当前环境不支持获取地址");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const url = `https://maps.google.com/?q=${lat},${lng}`;
        const text = `当前位置：${lat}, ${lng} ${url}`;
        setAttachments((current) => [
          ...current,
          { id: `location-${Date.now()}`, kind: "location", name: "当前位置", text, url },
        ].slice(0, 6));
        setQuestion((current) => `${current}${current ? "\n" : ""}${text}`.trim());
        setAttachmentsOpen(false);
        onToast?.("地址已加入");
      },
      () => onToast?.("无法获取地址，请在手机和企业微信里允许位置权限"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function uploadVoiceQuestion(blob, durationMs) {
    const formData = new FormData();
    const ext = audioExtensionFromMimeType(blob.type);
    formData.append("audio", blob, `question-${Date.now()}.${ext}`);
    formData.append("durationMs", String(durationMs));
    const payload = await transcribeVoiceInput(formData);
    const text = String(payload.text || "").trim();
    if (text) setQuestion((current) => `${current} ${text}`.trim());
    else onToast?.("没有识别到语音内容");
  }

  async function startVoiceInput(event) {
    event?.preventDefault?.();
    if (listening || voiceBusy) return;
    if (event?.pointerId !== undefined) voicePointerRef.current = event.pointerId;

    if (!canRequestMicrophone()) {
      onToast?.("手机端语音输入需要通过 HTTPS 打开");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onToast?.("当前环境不支持网页录音，请更新企业微信后再试");
      return;
    }

    try {
      const stream = await requestMicrophoneStream();
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceChunksRef.current = [];
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const durationMs = Math.max(600, Date.now() - voiceStartedAtRef.current);
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setListening(false);
        setVoiceBusy(true);
        const tracks = voiceStreamRef.current?.getTracks() || [];
        tracks.forEach((track) => track.stop());
        voiceStreamRef.current = null;
        try {
          await uploadVoiceQuestion(blob, durationMs);
          setComposerMode("text");
        } catch (error) {
          onToast?.(error instanceof Error ? error.message : "语音转文字失败");
        } finally {
          setVoiceBusy(false);
        }
      };

      recorder.start(250);
      setListening(true);
    } catch (error) {
      setListening(false);
      onToast?.(microphoneErrorMessage(error));
    }
  }

  function stopVoiceInput(event) {
    event?.preventDefault?.();
    if (event?.pointerId !== undefined && voicePointerRef.current !== null && event.pointerId !== voicePointerRef.current) return;
    voicePointerRef.current = null;
    const recorder = voiceRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  function attachmentQuestionText(currentImages = images, currentAttachments = attachments) {
    const names = [
      ...currentImages.map((item) => `图片：${item.name}`),
      ...currentAttachments.map((item) => `${item.kind === "audio" ? "录音" : item.kind === "location" ? "地址" : "文件"}：${item.name}`),
    ];
    return names.length > 0 ? `请结合选中的录音内容，分析我上传的附件：${names.join("、")}` : "";
  }

  async function askRecordings(event) {
    event.preventDefault();
    const trimmed = question.trim();
    const outgoingImages = images;
    const outgoingAttachments = attachments;
    const outgoingQuestion = trimmed || attachmentQuestionText(outgoingImages, outgoingAttachments);
    if (!outgoingQuestion) return;
    enterQaConversationView();
    setDailyBriefExpanded(true);
    const optimisticAttachments = attachmentsForMessage(outgoingImages, outgoingAttachments);
    const targetScopeIds = normalizeRecordingIds(activeScopeIds);

    const optimisticId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage = {
      id: optimisticId,
      question: outgoingQuestion,
      answer: "",
      citations: [],
      recordingIds: targetScopeIds,
      recordingNames: targetScopeIds
        .map((id) => activeRecordings.find((item) => item.id === id)?.name)
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      attachments: optimisticAttachments,
      pending: true,
    };
    saveActiveQaMessageRef(optimisticMessage);
    setAnswers((current) =>
      sortMessagesAscending([...current.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, targetScopeIds, current), targetScopeIds)), optimisticMessage]).slice(-20),
    );
    setQuestion("");
    setImages([]);
    setAttachments([]);
    setAttachmentsOpen(false);
    try {
      const payload = await createQuestion({
        question: outgoingQuestion,
        recordingIds: targetScopeIds,
        images: outgoingImages.map((item) => ({ name: item.name, type: item.type, dataUrl: item.dataUrl })),
        attachments: outgoingAttachments.map((item) => ({
          kind: item.kind,
          name: item.name,
          type: item.type,
          text: item.text,
          url: item.url,
          dataUrl: item.dataUrl,
        })),
      });
      if (!payload.message?.id) throw new Error("问答创建失败");
      const fallbackScope = lockedRecordingId ? [lockedRecordingId] : targetScopeIds;
      const scopedMessage = withQaMessageScope(payload.message, fallbackScope, [optimisticMessage]);
      saveActiveQaMessageRef(scopedMessage);
      const messageScope = messageScopeFromKnown(scopedMessage, fallbackScope, [optimisticMessage]);
      const nextScope = lockedRecordingId ? [lockedRecordingId] : messageScope;
      setScopeIds(nextScope);
      setAnswers((current) => {
        const known = [...historyForRecordings(nextScope), ...current, scopedMessage];
        const scopedCurrent = current.filter(
          (item) =>
            item.id !== optimisticId &&
            item.id !== scopedMessage.id &&
            isSameRecordingScope(messageScopeFromKnown(item, nextScope, known), nextScope),
        );
        const scopedHistory = historyForRecordings(nextScope).filter((item) => item.id !== optimisticId && item.id !== scopedMessage.id);
        return mergeQaMessages(scopedHistory, scopedCurrent, [scopedMessage]).slice(-20);
      });
      setQaHistory((current) => [scopedMessage, ...current.filter((item) => item.id !== scopedMessage.id)].slice(0, 60));
      if (scopedMessage.pending) pollQaMessage(scopedMessage.id, 0, nextScope);
    } catch (error) {
      setAnswers((current) => current.filter((item) => item.id !== optimisticId));
      onToast?.(error instanceof Error ? error.message : "提问失败");
    }
  }

  function citationDisplayLabel(index) {
    return pointLabelForIndex(index);
  }

  function citationKey(citation, index = 0) {
    return `${citation.recordingId || "recording"}-${citation.evidenceId || citation.segmentId || index}-${citation.startMs || 0}`;
  }

  function citationTimeLabel(citation) {
    const start = formatTimecode(citation.startMs || 0);
    const end = citation.endMs ? `-${formatTimecode(citation.endMs)}` : "";
    return `${start}${end}`;
  }

  function sortCitationsByTimeline(citations = []) {
    return [...citations].sort(
      (a, b) =>
        (a.recordingSeq || 0) - (b.recordingSeq || 0) ||
        String(a.recordingName || "").localeCompare(String(b.recordingName || ""), "zh-CN") ||
        (a.startMs || 0) - (b.startMs || 0),
    );
  }

  function citationRecordingDurationMs(citation) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    return Math.max(target?.durationMs || 0, citation.endMs || 0, (citation.startMs || 0) + 120000, 1000);
  }

  function citationStartMs(citation) {
    return Math.max(0, citation.startMs || 0);
  }

  function citationEndMs(citation) {
    const start = citationStartMs(citation);
    const recordingDuration = citationRecordingDurationMs(citation);
    const requestedEnd = Math.max(start + 1000, citation.endMs || start + 60000);
    return Math.min(recordingDuration, start + 120000, requestedEnd);
  }

  function citationSegmentDurationMs(citation) {
    return Math.max(1000, citationEndMs(citation) - citationStartMs(citation));
  }

  function citationProgressOffsetMs(citation, key) {
    if (activeCitationKey === key && citationPlayback.key === key) {
      return Math.min(Math.max(0, citationPlayback.currentMs - citationStartMs(citation)), citationSegmentDurationMs(citation));
    }
    return 0;
  }

  function textSignalSet(text = "") {
    const compact = String(text || "")
      .replace(/[^\p{Script=Han}a-z0-9]/giu, "")
      .toLowerCase();
    return new Set([...compact].filter(Boolean));
  }

  function scoreCitationForBlock(block, citation) {
    const blockSignals = textSignalSet(block);
    const citationSignals = textSignalSet(citation?.text || "");
    if (blockSignals.size === 0 || citationSignals.size === 0) return 0;

    let overlap = 0;
    citationSignals.forEach((char) => {
      if (blockSignals.has(char)) overlap += 1;
    });
    return overlap / Math.max(8, Math.min(blockSignals.size, citationSignals.size));
  }

  function citationsForBlock(block, blockIndex, allBlocks, citations) {
    if (!citations.length) return [];
    const scored = citations
      .map((citation, index) => ({
        citation,
        index,
        score: scoreCitationForBlock(block, citation),
      }))
      .sort((a, b) => b.score - a.score || (a.citation.startMs || 0) - (b.citation.startMs || 0));

    const matched = scored.filter((item) => item.score >= 0.12);
    if (matched.length > 0) return dedupeCitations(matched.map((item) => ({ ...item.citation, _citationIndex: item.index })));

    const chunkSize = Math.max(1, Math.ceil(citations.length / Math.max(1, allBlocks.length)));
    return dedupeCitations(
      citations.slice(blockIndex * chunkSize, blockIndex * chunkSize + chunkSize).map((citation, index) => ({
        ...citation,
        _citationIndex: blockIndex * chunkSize + index,
      })),
    );
  }

  function compactCitationText(value = "") {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[^\p{Script=Han}a-z0-9]/giu, "")
      .toLowerCase()
      .slice(0, 80);
  }

  function dedupeCitations(citations = []) {
    const kept = [];
    for (const citation of sortCitationsByTimeline(citations)) {
      const start = citationStartMs(citation);
      const end = citationEndMs(citation);
      const textKey = compactCitationText(citation.text);
      const duplicate = kept.some((item) => {
        const sameRecording = (item.recordingId || "") === (citation.recordingId || "");
        if (!sameRecording) return false;
        const itemStart = citationStartMs(item);
        const itemEnd = citationEndMs(item);
        const overlaps = start <= itemEnd && end >= itemStart;
        const close = Math.abs(start - itemStart) < 45000;
        const sameText = textKey && compactCitationText(item.text) === textKey;
        return overlaps || close || sameText;
      });
      if (!duplicate) kept.push(citation);
      if (kept.length >= 8) break;
    }
    return kept;
  }

  function toggleCitationGroup(key) {
    setExpandedCitationGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  const playCitation = citationPlayer.play;
  const seekCitation = citationPlayer.seek;

  function openHistoryItem(item) {
    enterQaConversationView();
    const ids = lockedRecordingId ? [lockedRecordingId] : messageScopeFromKnown(item, [], qaHistory);
    const scopedItem = withQaMessageScope(item, ids, qaHistory);
    if (lockedRecordingId && !isSameRecordingScope(messageScopeFromKnown(scopedItem, ids, qaHistory), ids)) return;
    saveActiveQaMessageRef(scopedItem);
    setScopeIds(ids);
    setAnswers(sortMessagesAscending([scopedItem]));
    setDailyBriefExpanded(true);
    if (scopedItem.pending) pollQaMessage(scopedItem.id, 0, ids);
    setHistoryOpen(false);
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function updateHistoryMessage(message) {
    setQaHistory((current) => current.map((item) => (item.id === message.id ? withQaMessageScope({ ...item, ...message }, messageRecordingIds(item), current) : item)));
    setAnswers((current) => current.map((item) => (item.id === message.id ? withQaMessageScope({ ...item, ...message }, messageRecordingIds(item), current) : item)));
  }

  function upsertQaMessage(message, fallbackScopeIds = activeScopeIdsRef.current) {
    if (!message?.id) return;
    const fallbackScope = normalizeRecordingIds(fallbackScopeIds);
    const seededMessage = withQaMessageScope(message, fallbackScope, [...answers, ...qaHistory]);
    if (readActiveQaMessageRef()?.id === seededMessage.id) saveActiveQaMessageRef(seededMessage);
    setQaHistory((current) => {
      const storedScope = messageScopeFromKnown(seededMessage, fallbackScope, [...current, ...answers]);
      const scopedMessage = withQaMessageScope(seededMessage, storedScope, current);
      return [scopedMessage, ...current.filter((item) => item.id !== scopedMessage.id)].slice(0, 60);
    });
    setAnswers((current) => {
      if (!qaConversationViewRef.current) return current;
      const currentScope = normalizeRecordingIds(activeScopeIdsRef.current);
      const scopedMessage = withQaMessageScope(seededMessage, currentScope, current);
      const messageScope = messageScopeFromKnown(scopedMessage, currentScope, current);
      const known = [...current, scopedMessage, ...qaHistory];
      const scopedCurrent = current.filter((item) => shouldKeepQaMessageForScope(item, currentScope, known) && item.id !== scopedMessage.id);
      if (!isSameRecordingScope(messageScope, currentScope)) return mergeQaMessages(scopedCurrent).slice(-20);
      return mergeQaMessages(scopedCurrent, [scopedMessage]).slice(-20);
    });
  }

  function pollQaMessage(id, attempt = 0, fallbackScopeIds = activeScopeIdsRef.current) {
    if (!id || qaPollingRef.current.has(id)) return;
    const pollScopeIds = normalizeRecordingIds(fallbackScopeIds);
    const timer = window.setTimeout(async () => {
      qaPollingRef.current.delete(id);
      try {
        const payload = await getQaMessage(id);
        if (payload.message) {
          upsertQaMessage(payload.message, pollScopeIds);
          if (payload.message.pending && attempt < 180) pollQaMessage(id, attempt + 1, pollScopeIds);
        }
      } catch {
        if (attempt < 30) pollQaMessage(id, attempt + 1, pollScopeIds);
      }
    }, attempt === 0 ? 900 : 1800);
    qaPollingRef.current.set(id, timer);
  }

  function openCurrentScopeConversation() {
    enterQaConversationView();
    const history = historyForRecordings(activeScopeIdsRef.current).slice(-20);
    const latest = history[history.length - 1];
    setAnswers(history);
    setDailyBriefExpanded(true);
    if (latest) saveActiveQaMessageRef(latest);
    else clearActiveQaMessageRef();
    (Array.isArray(history) ? history : []).filter((item) => item.pending).forEach((item) => pollQaMessage(item.id, 0, activeScopeIdsRef.current));
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function dailyBriefMessageFromBrief(brief = dailyBrief, options = {}) {
    const meetingCount = dailyBriefMeetingCount(brief, todayBriefRecordings.length);
    const loadingBrief = options.loading
      ? {
          ...(brief || {}),
          summaryMarkdown: "",
          status: "generating",
          dirty: true,
        }
      : brief;
    const content = dailyBriefFallbackContent(loadingBrief, meetingCount);
    const recordingIds = Array.isArray(brief?.recordingIds)
      ? brief.recordingIds
      : todayBriefRecordings.map((item) => item.id).filter(Boolean);
    const recordingStates = Array.isArray(brief?.recordingStates) ? brief.recordingStates : [];
    const message = {
      id: `daily-brief-${brief?.date || Date.now()}`,
      type: "daily-brief",
      briefDate: brief?.date || "",
      status: options.loading ? "generating" : brief?.status || "",
      role: "assistant",
      question: "今日会议简报",
      answer: content,
      content,
      citations: [],
      recordingIds,
      recordingStates,
      recordingNames: recordingStates.length ? recordingStates.map((item) => item.name).filter(Boolean) : todayBriefRecordings.map((item) => item.name).filter(Boolean),
      createdAt: brief?.updatedAt || brief?.generatedAt || new Date().toISOString(),
    };
    return message;
  }

  function mergeDailyBriefState(brief) {
    if (!brief?.date) return;
    if (brief.date === todayDateKey()) {
      setDailyBrief((current) => ({ ...(current || {}), ...brief }));
    }
    setDailyBriefHistory((current) =>
      [brief, ...current.filter((item) => item?.date !== brief.date)].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    );
  }

  async function fetchDailyBriefHistory() {
    const payload = await getMeetingBriefs(30);
    const briefs = payload.briefs || [];
    setDailyBriefHistory(briefs);
    return briefs;
  }

  function showDailyBriefMessage(brief = dailyBrief, options = {}) {
    enterDailyBriefView();
    const message = dailyBriefMessageFromBrief(brief, options);
    setAnswers([message]);
    setDailyBriefExpanded(true);
    setScopeExpanded(false);
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function updateDailyBriefAnswerMessage(brief = dailyBrief, options = {}) {
    if (!brief?.date) return;
    const nextMessage = dailyBriefMessageFromBrief(brief, options);
    setAnswers((current) =>
      current.map((item) =>
        item.type === "daily-brief" && (item.briefDate || "") === brief.date
          ? { ...nextMessage, id: item.id || nextMessage.id }
          : item,
      ),
    );
  }

  function openDailyBriefCard() {
    enterDailyBriefView();
    selectRecording("");
    setScopeIds([]);
    setAnswers([]);
    setDailyBriefExpanded(true);
    setHistoryOpen(false);
    setScopeExpanded(false);
    fetchDailyBriefHistory().catch(() => {});
    window.requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openDailyBriefHistoryItem(brief) {
    enterDailyBriefView();
    mergeDailyBriefState(brief);
    setScopeIds([]);
    setAnswers([]);
    setDailyBriefExpanded(true);
    setExpandedDailyBriefDates((current) => new Set([...current, brief.date].filter(Boolean)));
    setHistoryOpen(false);
    if (brief.status === "generating") pollDailyBrief(brief.date);
    else if (!dailyBriefHasSummary(brief) && dailyBriefMeetingCount(brief, 0) > 0) generateDailyBriefForDate(brief);
  }

  function pollDailyBrief(date, attempt = 0, recoveryAttempt = 0) {
    if (!date || dailyBriefPollingRef.current.has(date)) return;
    const timer = window.setTimeout(async () => {
      dailyBriefPollingRef.current.delete(date);
      try {
        const payload = await getMeetingBrief(date);
        mergeDailyBriefState(payload);
        if (payload?.date === date && isDailyBriefViewActive()) {
          updateDailyBriefAnswerMessage(payload, { loading: payload.status === "generating" && !dailyBriefHasSummary(payload) });
        }
        fetchDailyBriefHistory().catch(() => {});
        if (payload?.date === date) {
          const hasSummary = Boolean(String(payload.summaryMarkdown || "").trim());
          if (payload.status === "generating" && attempt < 180) {
            pollDailyBrief(date, attempt + 1, recoveryAttempt);
            return;
          }
          if (hasSummary) {
            clearActiveDailyBriefRef(date);
            setDailyBriefGeneratingDates((current) => {
              const next = new Set(current);
              next.delete(date);
              return next;
            });
            return;
          }
          if ((payload.status === "ready" || payload.status === "failed") && recoveryAttempt < 1 && attempt < 180) {
            const queued = await generateMeetingBrief(date);
            mergeDailyBriefState(queued);
            saveActiveDailyBriefRef(queued);
            pollDailyBrief(date, attempt + 1, recoveryAttempt + 1);
            return;
          }
          setDailyBriefGeneratingDates((current) => {
            const next = new Set(current);
            next.delete(date);
            return next;
          });
        }
      } catch {
        if (attempt < 30) pollDailyBrief(date, attempt + 1, recoveryAttempt);
      }
    }, attempt === 0 ? 1400 : 2200);
    dailyBriefPollingRef.current.set(date, timer);
  }

  async function generateDailyBriefForDate(brief, event) {
    event?.stopPropagation?.();
    const date = brief?.date || todayDateKey();
    if (!date || dailyBriefGeneratingDates.has(date)) return;
    const meetingCount = dailyBriefMeetingCount(brief, 0);
    if (!meetingCount) {
      onToast?.("当天没有可总结的录音");
      return;
    }

    let keepGenerating = false;
    const pendingBrief = {
      ...(brief || {}),
      date,
      displayDate: brief?.displayDate || displayDateFromDateKey(date),
      meetingCount,
      status: "generating",
      summaryMarkdown: "",
      dirty: true,
      updatedAt: new Date().toISOString(),
    };

    setDailyBriefGeneratingDates((current) => new Set([...current, date]));
    mergeDailyBriefState(pendingBrief);
    saveActiveDailyBriefRef(pendingBrief);

    try {
      const payload = await generateMeetingBrief(date);
      mergeDailyBriefState(payload);
      fetchDailyBriefHistory().catch(() => {});
      if (payload.status === "generating") {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(date);
      } else if (dailyBriefHasSummary(payload)) {
        clearActiveDailyBriefRef(date);
      } else if ((payload.status === "ready" || payload.status === "failed") && payload.date) {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(date);
      } else {
        clearActiveDailyBriefRef(date);
      }
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "会议简报生成失败");
    } finally {
      if (!keepGenerating) {
        setDailyBriefGeneratingDates((current) => {
          const next = new Set(current);
          next.delete(date);
          return next;
        });
      }
    }
  }

  function toggleDailyBriefDate(brief) {
    const date = brief?.date;
    if (!date) return;
    const willExpand = !expandedDailyBriefDates.has(date);
    setExpandedDailyBriefDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    if (willExpand && dailyBriefMeetingCount(brief, 0) > 0 && !dailyBriefHasSummary(brief) && brief.status !== "generating") {
      generateDailyBriefForDate(brief);
    }
  }

  function speakDailyBrief(brief, event) {
    event?.stopPropagation?.();
    const date = brief?.date || todayDateKey();
    const generating = dailyBriefGeneratingDates.has(date) || brief?.status === "generating";
    const content = dailyBriefListContent(brief, dailyBriefMeetingCount(brief, 0), generating);
    const segments = speechSegmentsFromText(content, "content", "朗读内容");
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    toggleTtsQueue(`daily-brief-${date}`, segments);
  }

  function speakDailyBriefLine(brief, line) {
    line?.event?.preventDefault?.();
    line?.event?.stopPropagation?.();
    const itemId = line?.itemId || `daily-brief-${brief?.date || brief?.briefDate || todayDateKey()}-line-${line?.index || 0}`;
    if (ttsState.playing || ttsState.loading) {
      stopTtsQueue();
      return;
    }

    const date = brief?.date || brief?.briefDate || todayDateKey();
    const meetingCount = dailyBriefMeetingCount(brief, 0);
    const generating = dailyBriefGeneratingDates.has(date) || brief?.status === "generating";
    const content =
      cleanQaVisibleText(brief?.content || brief?.answer || brief?.summaryMarkdown || "", "") ||
      dailyBriefListContent(brief, meetingCount, generating);
    const startIndex = Math.max(0, Number(line?.index || 0));
    const speechText = String(content || "")
      .split(/\r?\n/)
      .slice(startIndex)
      .map((rawLine) => {
        const text = cleanQaVisibleText(rawLine, "");
        return text.replace(/^[-*]\s*/, "• ");
      })
      .filter(Boolean)
      .join("\n");
    const segments = speechSegmentsFromText(speechText || line?.text || "", `line-${line?.index || 0}`, line?.label || "朗读段落");
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    startTtsQueue(itemId, segments);
  }

  async function shareDailyBriefPdf(item, event) {
    event?.stopPropagation?.();
    const date = item?.briefDate || item?.date;
    if (!date) return;
    const title = item?.question || item?.title || "今日会议简报";
    const fileName = `${safeFileName(title)}-${date}.pdf`;
    try {
      await sharePdf({
        url: `/api/meeting-briefs/${encodeURIComponent(date)}/share.pdf`,
        fileName,
        title,
        text: "今日会议简报 PDF",
        onDownloaded: () => onToast?.("PDF 已生成，可在下载文件中分享"),
      });
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "分享失败");
    }
  }

  async function generateTodayBrief(event) {
    event?.stopPropagation?.();
    if (dailyBriefLoading) return;
    enterDailyBriefView();
    const pendingBrief = {
      ...(dailyBrief || {}),
      date: dailyBrief?.date || todayDateKey(),
      displayDate: dailyBrief?.displayDate || todayDisplayDateFallback(),
      meetingCount: dailyBriefMeetingCount(dailyBrief, todayBriefRecordings.length),
      recordingIds: todayBriefRecordings.map((item) => item.id).filter(Boolean),
      status: "generating",
      summaryMarkdown: "",
      dirty: true,
      updatedAt: new Date().toISOString(),
    };
    selectRecording("");
    setScopeIds([]);
    setDailyBrief(pendingBrief);
    setDailyBriefExpanded(true);
    showDailyBriefMessage(pendingBrief, { loading: true });
    setDailyBriefLoading(true);
    try {
      const active = pendingBrief;
      saveActiveDailyBriefRef(active);
      const payload = await generateTodayMeetingBrief();
      setDailyBrief(payload);
      const hasSummary = Boolean(String(payload?.summaryMarkdown || "").trim());
      if (payload.status === "generating") {
        saveActiveDailyBriefRef(payload);
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload, { loading: true });
        pollDailyBrief(payload.date);
      } else if (hasSummary) {
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload);
        clearActiveDailyBriefRef(payload.date);
      } else if ((payload.status === "ready" || payload.status === "failed") && payload.date) {
        pollDailyBrief(payload.date);
        saveActiveDailyBriefRef(payload);
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload, { loading: true });
      } else {
        if (isDailyBriefViewActive()) showDailyBriefMessage(payload);
        clearActiveDailyBriefRef(payload.date);
      }
      fetchDailyBriefHistory().catch(() => {});
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "今日总结生成失败");
      const active = readActiveDailyBriefRef();
      if (active?.date) pollDailyBrief(active.date);
    } finally {
      setDailyBriefLoading(false);
    }
  }

  async function toggleHistoryFavorite(item, event) {
    event.stopPropagation();
    try {
      const payload = await updateQaMessage(item.id, { favorite: !item.favorite });
      updateHistoryMessage(payload.message);
      onToast?.(payload.message.favorite ? "已收藏到收藏夹" : "已取消收藏");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "收藏失败");
    }
  }

  async function deleteHistoryMessage(item, event) {
    event.stopPropagation();
    if (!window.confirm("删除这条问答记录？")) return;
    try {
      await deleteQaMessage(item.id);
      clearActiveQaMessageRef(item.id);
      setQaHistory((current) => current.filter((message) => message.id !== item.id));
      setAnswers((current) => current.filter((message) => message.id !== item.id));
      onToast?.("问答记录已删除");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function shareHistoryMessage(item, event) {
    event?.stopPropagation?.();
    const url = `/api/qa-messages/${item.id}/share.pdf`;
    const fileName = `${safeFileName(item.question || "问答记录")}.pdf`;

    try {
      await sharePdf({
        url,
        fileName,
        title: item.question || "录音问答",
        text: "录音问答 PDF",
        onDownloaded: () => onToast?.("PDF 已生成，可在下载文件中分享"),
      });
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "分享失败");
    }
  }

  function legacyCompactSpeechText(value) {
    return stripQaInternalIndexMarkers(
      String(value || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  function legacySpeechSegmentsFromText(value, idPrefix = "content", label = "朗读内容", maxLength = 480) {
    const chunks = [];
    const appendChunk = (rawText) => {
      const cleaned = compactSpeechText(rawText);
      if (!cleaned) return;
      if (Array.from(cleaned).length <= maxLength) {
        chunks.push(cleaned);
        return;
      }
      let buffer = "";
      for (const char of Array.from(cleaned)) {
        if (Array.from(buffer).length >= maxLength) {
          chunks.push(buffer);
          buffer = "";
        }
        buffer += char;
      }
      if (buffer) chunks.push(buffer);
    };

    const parts = String(value || "")
      .replace(/([。！？!?；;])/g, "$1\n")
      .split(/\r?\n+/);
    let current = "";

    parts.forEach((part) => {
      const cleaned = compactSpeechText(part);
      if (!cleaned) return;
      const next = current ? `${current} ${cleaned}` : cleaned;
      if (Array.from(next).length <= maxLength) {
        current = next;
        return;
      }
      appendChunk(current);
      current = "";
      appendChunk(cleaned);
    });
    appendChunk(current);

    return chunks.map((text, index) => ({
      id: `${idPrefix}-${index + 1}`,
      label: index === 0 ? label : `${label}${index + 1}`,
      text,
    }));
  }

  function legacyStructuredSpeechSegments(structured) {
    const segments = [];
    const add = (id, label, text) => {
      const cleaned = compactSpeechText(text);
      if (cleaned) segments.push({ id, label, text: cleaned });
    };

    add("overall", "整体判断", structured?.overall_judgement);
    add("judgement-level", "判断等级", structured?.judgement_level ? `判断等级：${structured.judgement_level}` : "");
    if (Array.isArray(structured?.core_basis) && structured.core_basis.length > 0) {
      add("core-basis", "核心依据", `核心依据：${structured.core_basis.join("；")}`);
    }
    (Array.isArray(structured?.analysis) ? structured.analysis : []).forEach((point, index) => {
      const title = compactSpeechText(point?.title) || pointLabelForIndex(index);
      add(`analysis-${index}-conclusion`, `${title}：结论`, `${title}。结论：${point?.conclusion || ""}`);
      add(`analysis-${index}-reason`, `${title}：原因`, `原因：${point?.reason || ""}`);
      add(`analysis-${index}-basis`, `${title}：关键依据`, `关键依据：${point?.basis || ""}`);
    });
    add("final", "最后结论", structured?.final_conclusion);
    return segments;
  }

  function legacySpeechSegmentsForAnswerItem(item, structured) {
    if (structured) {
      const cleanStructuredText = (value, fallback = "") => cleanQaVisibleText(value, fallback);
      const cleanedStructured = {
        ...structured,
        overall_judgement: cleanStructuredText(structured.overall_judgement),
        judgement_level: cleanStructuredText(structured.judgement_level),
        final_conclusion: cleanStructuredText(structured.final_conclusion),
      };
      const analysis = Array.isArray(structured.analysis)
        ? structured.analysis.map((point, index) => ({
            ...point,
            title: cleanStructuredText(point?.title, pointLabelForIndex(index)),
            conclusion: cleanStructuredText(point?.conclusion),
            reason: cleanStructuredText(point?.reason),
            basis: cleanStructuredText(point?.basis),
          }))
        : [];
      const evidences = Array.isArray(structured.evidences)
        ? structured.evidences.map((evidence, index) => ({
            ...evidence,
            evidence_title: cleanStructuredText(evidence?.evidence_title, `证据 ${index + 1}`),
            quote: cleanStructuredText(evidence?.quote),
            evidence_role: cleanStructuredText(evidence?.evidence_role),
          }))
        : [];
      const coreBasis = Array.isArray(structured.core_basis) ? structured.core_basis.map((basis) => cleanStructuredText(basis)).filter(Boolean) : [];
      return structuredSpeechSegments({ ...cleanedStructured, core_basis: coreBasis, analysis, evidences });
    }

    const text = cleanAnswerForDisplay(item?.answer || item?.content || "");
    return speechSegmentsFromText(text, "answer", "朗读结论");
  }

  function citationForEvidence(evidence, citations = [], index = 0) {
    const evidenceId = String(evidence?.id || "").trim();
    const matched =
      citations.find((citation) => String(citation.evidenceId || citation.id || "").trim() === evidenceId) ||
      citations.find((citation) => citationTimeLabel(citation) === `${evidence?.start_time || ""}-${evidence?.end_time || ""}`) ||
      citations[index];
    return matched || null;
  }

  function renderStructuredAnswer(item, structured, citations) {
    const cleanStructuredText = (value, fallback = "") => cleanQaVisibleText(value, fallback);
    const cleanedStructured = {
      ...structured,
      overall_judgement: cleanStructuredText(structured.overall_judgement),
      judgement_level: cleanStructuredText(structured.judgement_level),
      final_conclusion: cleanStructuredText(structured.final_conclusion),
    };
    const analysis = Array.isArray(structured.analysis)
      ? structured.analysis.map((point, index) => ({
          ...point,
          title: cleanStructuredText(point?.title, pointLabelForIndex(index)),
          conclusion: cleanStructuredText(point?.conclusion),
          reason: cleanStructuredText(point?.reason),
          basis: cleanStructuredText(point?.basis),
        }))
      : [];
    const evidences = Array.isArray(structured.evidences)
      ? structured.evidences.map((evidence, index) => ({
          ...evidence,
          analysis_title: cleanStructuredText(evidence?.analysis_title),
          evidence_title: cleanStructuredText(evidence?.evidence_title, `证据 ${index + 1}`),
          quote: cleanStructuredText(evidence?.quote),
          evidence_role: cleanStructuredText(evidence?.evidence_role),
        }))
      : [];
    const evidenceById = new Map(evidences.map((evidence) => [String(evidence.id || ""), evidence]));
    const evidenceGroupKey = `${item.id}-structured-evidence`;
    const evidenceExpanded = Boolean(expandedCitationGroups[evidenceGroupKey]);
    const thinkingGroupKey = `${item.id}-thinking`;
    const thinkingExpanded = Boolean(expandedCitationGroups[thinkingGroupKey]);
    const thinkingSteps = thinkingStepsForMessage(item);
    const coreBasis = Array.isArray(structured.core_basis) ? structured.core_basis.map((basis) => cleanStructuredText(basis)).filter(Boolean) : [];
    const answerTitle = cleanStructuredText(item.question);
    const speakSegments = structuredSpeechSegments({ ...cleanedStructured, core_basis: coreBasis, analysis, evidences });
    const speakIndexById = new Map(speakSegments.map((segment, index) => [segment.id, index]));
    const renderSpeakText = (segmentId, children, className = "") => {
      const index = speakIndexById.get(segmentId);
      const activeKey = `${item.id}:${segmentId}`;
      if (index === undefined) return children;
      return (
        <button
          className={`${className} speakable-text ${ttsState.key === activeKey ? "active" : ""}`.trim()}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTtsSegment(item.id, speakSegments, index);
          }}
        >
          {children}
        </button>
      );
    };

    return (
      <div className="chat-answer structured">
        {answerTitle ? <h2 className="answer-card-title">{answerTitle}</h2> : null}
        <button className={`thinking-summary ${thinkingExpanded ? "expanded" : ""}`} type="button" onClick={() => toggleCitationGroup(thinkingGroupKey)}>
          <Check size={14} />
          <span>{thinkingExpanded ? "收起思考过程" : "已思考，深度分析完成"}</span>
          {thinkingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {thinkingExpanded ? (
          <div className="thinking-detail-panel">
            <strong>思考过程</strong>
            <ol>
              {thinkingSteps.map((step, index) => (
                <li key={`${item.id}-thinking-${index}`}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {cleanedStructured.overall_judgement ? (
          <section className="structured-section">
            <h3>整体判断</h3>
            {renderSpeakText("overall", cleanedStructured.overall_judgement, "structured-paragraph")}
          </section>
        ) : null}

        {cleanedStructured.judgement_level || coreBasis.length > 0 ? (
          <section className="structured-section judgement-section">
            <h3>判断等级 / 核心依据</h3>
            {cleanedStructured.judgement_level ? (
              renderSpeakText("judgement-level", <span className="judgement-level-badge">{cleanedStructured.judgement_level}</span>, "structured-inline-text")
            ) : null}
            {coreBasis.length > 0 ? (
              <ul className="core-basis-list">
                {coreBasis.map((basis, index) => (
                  <li key={`${item.id}-core-basis-${index}`}>
                    {renderSpeakText("core-basis", basis, "structured-inline-text")}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {analysis.length > 0 ? (
          <section className="structured-section">
            <h3>分点分析</h3>
            <div className="analysis-list">
              {analysis.map((point, index) => (
                <article className="analysis-card" key={`${item.id}-analysis-${index}`}>
                  <h4>{point.title || pointLabelForIndex(index)}</h4>
                  <dl>
                    <div>
                      <dt>结论</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-conclusion`,
                          point.conclusion || "原文证据不足",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>原因</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-reason`,
                          point.reason || "原文证据不足，无法进一步判断。",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>关键依据</dt>
                      <dd>
                        {renderSpeakText(
                          `analysis-${index}-basis`,
                          point.basis || "原文证据不足",
                          "structured-inline-text",
                        )}
                      </dd>
                    </div>
                  </dl>
                  {Array.isArray(point.evidence_ids) && point.evidence_ids.length > 0 ? (
                    <div className="analysis-evidence-tags" aria-label="关联证据">
                      {point.evidence_ids.map((id) => {
                        const evidence = evidenceById.get(String(id));
                        return evidence ? <span key={`${point.title}-${id}`}>{evidence.evidence_title || id}</span> : null;
                      })}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {evidences.length > 0 ? (
          <section className="structured-section evidence-section">
            <button className="citation-fold-button" type="button" onClick={() => toggleCitationGroup(evidenceGroupKey)}>
              {evidenceExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {evidenceExpanded ? "收起" : "展开"} {evidences.length} 条原文证据索引
            </button>
            {evidenceExpanded ? (
              <div className="evidence-card-list">
                {evidences.map((evidence, index) => {
                  const citation = citationForEvidence(evidence, citations, index);
                  const key = citation ? citationKey(citation, index) : `${item.id}-evidence-${index}`;
                  const durationMs = citation ? citationSegmentDurationMs(citation) : 0;
                  const progressMs = citation ? citationProgressOffsetMs(citation, key) : 0;
                  return (
                    <article className="evidence-card" key={key}>
                      <header>
                        <strong>{evidence.evidence_title || `证据 ${index + 1}`}</strong>
                        <span>
                          {evidence.start_time || formatTimecode(citation?.startMs || 0)} - {evidence.end_time || formatTimecode(citation?.endMs || 0)}
                        </span>
                      </header>
                      {evidence.quote ? <p className="evidence-quote">{evidence.quote}</p> : null}
                      {evidence.evidence_role ? <p className="evidence-role">{evidence.evidence_role}</p> : null}
                      <div className="evidence-player">
                        <button
                          className={activeCitationKey === key ? "active" : ""}
                          type="button"
                          disabled={!citation}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (citation) playCitation(citation, key);
                          }}
                        >
                          {activeCitationKey === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                          <span>复听</span>
                        </button>
                        {citation ? (
                          <input
                            type="range"
                            min="0"
                            max={durationMs}
                            step="1000"
                            value={progressMs}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => seekCitation(citation, key, citationStartMs(citation) + Number(event.target.value))}
                            aria-label={`拖动证据 ${index + 1} 播放进度`}
                          />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {cleanedStructured.final_conclusion ? (
          <section className="structured-section final-conclusion">
            <h3>最后结论</h3>
            {renderSpeakText("final", cleanedStructured.final_conclusion, "structured-paragraph")}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <section className="screen detail-screen chat-detail-screen" aria-label="录音问答">
      <DetailHeader
        historyOpen={historyOpen}
        scopeLabel={scopeLabel}
        language={language}
        onToggleHistory={() => setHistoryOpen((current) => !current)}
      />

      <ChatHistoryPanel
        open={historyOpen}
        messages={historyMessages}
        dailyBriefs={historyDailyBriefs}
        onClose={() => setHistoryOpen(false)}
        onOpenMessage={openHistoryItem}
        onOpenDailyBrief={openDailyBriefHistoryItem}
        onToggleFavorite={toggleHistoryFavorite}
        onShareMessage={shareHistoryMessage}
        onShareDailyBrief={shareDailyBriefPdf}
        onDeleteMessage={deleteHistoryMessage}
      />

      <RecordingScopePanel
        expanded={scopeExpanded}
        activeRecordingIds={activeScopeIds}
        recordings={activeRecordings}
        loading={listLoading}
        error={listError}
        scopeLabel={scopeLabel}
        scopeSummaryMeta={scopeSummaryMeta}
        language={language}
        hasHistory={hasHistoryForRecording}
        onReset={resetToAllRecordings}
        onOpenCurrent={openCurrentScopeConversation}
        onSelect={toggleScope}
        onExpandedChange={setScopeExpanded}
      />

      <div
        className={chatThreadClassName}
        ref={chatThreadRef}
        aria-label="问答记录"
      >
          {shouldShowDailyBriefCard ? (
            <DailyMeetingBriefCard
              brief={dailyBrief}
              loading={dailyBriefLoading}
              meetingCount={dailyBriefMeetingCount(dailyBrief, todayBriefRecordings.length)}
              onOpen={openDailyBriefCard}
            />
          ) : null}
          {shouldShowDailyBriefList ? (
            <DailyBriefListView
              briefs={dailyBriefList}
              expandedDates={expandedDailyBriefDates}
              generatingDates={dailyBriefGeneratingDates}
              ttsState={ttsState}
              onToggle={toggleDailyBriefDate}
              onGenerate={generateDailyBriefForDate}
              onSpeak={speakDailyBrief}
              onSpeakLine={speakDailyBriefLine}
              onShare={shareDailyBriefPdf}
            />
          ) : answers.length > 0 ? (
            answers.map((item) => {
              return item.type === "daily-brief" ? (
                <DailyMeetingBriefMessage
                  key={item.id}
                  message={item}
                  ttsState={ttsState}
                  onSpeakLine={speakDailyBriefLine}
                  onShare={shareDailyBriefPdf}
                />
              ) : (
                <QaMessage
                  key={item.id}
                  item={item}
                  activeCitationKey={activeCitationKey}
                  expandedCitationGroups={expandedCitationGroups}
                  ttsState={ttsState}
                  citationKey={citationKey}
                  citationSegmentDurationMs={citationSegmentDurationMs}
                  citationProgressOffsetMs={citationProgressOffsetMs}
                  citationStartMs={citationStartMs}
                  citationTimeLabel={citationTimeLabel}
                  citationsForBlock={citationsForBlock}
                  onOpenAttachment={openAttachmentPreview}
                  onPlayCitation={playCitation}
                  onSeekCitation={seekCitation}
                  onShare={shareHistoryMessage}
                  onToggleCitationGroup={toggleCitationGroup}
                  onToggleTts={toggleTtsQueue}
                  renderStructuredAnswer={renderStructuredAnswer}
                  speechSegmentsForAnswer={speechSegmentsForAnswerItem}
                />
              );
            })
          ) : shouldShowDailyBriefCard ? null : (
            <div className="chat-empty">
              <h2>{uiText(language, "开始提问", "Ask a question")}</h2>
            </div>
          )}
        <div ref={chatEndRef} className="chat-thread-end" aria-hidden="true" />
      </div>

      <QuestionComposer
        attachments={attachments}
        attachmentsOpen={attachmentsOpen}
        composerMode={composerMode}
        images={images}
        listening={listening}
        question={question}
        rows={composerRows}
        voiceBusy={voiceBusy}
        onAddLocation={addLocationAttachment}
        onAttachmentsOpenChange={setAttachmentsOpen}
        onCameraImage={addCameraImage}
        onComposerModeChange={setComposerMode}
        onOpenAttachment={openAttachmentPreview}
        onPickAudio={addQuestionAudio}
        onPickFile={addQuestionFile}
        onPickImages={addImages}
        onQuestionChange={setQuestion}
        onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
        onRemoveImage={(id) => setImages((current) => current.filter((item) => item.id !== id))}
        onStartVoice={startVoiceInput}
        onStopVoice={stopVoiceInput}
        onSubmit={askRecordings}
      />

      <AttachmentPreviewDialog attachment={attachmentPreview} onClose={closeAttachmentPreview} />

    </section>
  );
}
