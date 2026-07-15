import { useState, useEffect, useRef, useMemo } from "react";
import {
  Check,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  LoaderCircle,
  Share2,
  Star,
  RefreshCw,
  Keyboard,
  Mic,
  Plus,
  Send,
  ImagePlus,
  Camera,
  FileAudio,
  FileUp,
  Link,
  X
} from "lucide-react";
import {
  uiText,
  formatDuration,
  formatShortDate,
  formatDate,
  formatTimecode,
  isToday,
  safeFileName,
  downloadBlob,
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
  dailyBriefMeetingCount,
  api,
  fetchWithClient
} from "../../utils/index.js";
import { dateKeyFromRecording, todayDisplayDateFallback, displayDateFromDateKey } from '../../utils/date.js'
import { DailyMeetingBriefCard } from './components/DailyMeetingBriefCard.jsx'
import { requestMicrophoneStream, getAudioFileDuration } from '../../utils/audio.js'
import {DailyMeetingBriefMessage} from './components/DailyMeetingBriefMessage.jsx'

export function DetailView({ recording, recordings = [], onBack, onToast, language, onSelectRecording }) {
  const audioRef = useRef(null);
  const audioSourceRef = useRef("");
  const imageInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const audioQuestionInputRef = useRef(null);
  const fileQuestionInputRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voicePointerRef = useRef(null);
  const chatThreadRef = useRef(null);
  const chatEndRef = useRef(null);
  const [availableRecordings, setAvailableRecordings] = useState(() => recordings.filter((item) => !item.deletedAt));
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
  const [dailyBriefRefreshingRecordingIds, setDailyBriefRefreshingRecordingIds] = useState(() => new Set());
  const [qaHistory, setQaHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState("history");
  const [images, setImages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [composerMode, setComposerMode] = useState("text");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [activeCitationKey, setActiveCitationKey] = useState("");
  const activeCitationRef = useRef({ key: "", startMs: 0, endMs: 0 });
  const [citationPlayback, setCitationPlayback] = useState({ key: "", currentMs: 0, durationMs: 0 });
  const [expandedCitationGroups, setExpandedCitationGroups] = useState({});
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const qaPollingRef = useRef(new Map());
  const dailyBriefPollingRef = useRef(new Map());
  const qaConversationViewRef = useRef(Boolean(recording?.id));
  const activeScopeIdsRef = useRef([]);
  const ttsAudioRef = useRef(null);
  const ttsQueueRef = useRef({ itemId: "", segments: [], index: 0 });
  const [ttsState, setTtsState] = useState({ key: "", itemId: "", index: -1, loading: false, playing: false });
  const lockedRecordingId = recording?.id || "";
  const activeScopeIds = lockedRecordingId ? [lockedRecordingId] : scopeIds;
  const scopeKey = activeScopeIds.join("|");
  activeScopeIdsRef.current = activeScopeIds;

  function readActiveQaMessageRef() {
    try {
      const raw = window.localStorage?.getItem(QA_ACTIVE_MESSAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.id ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveActiveQaMessageRef(message) {
    if (!message?.id) return;
    try {
      window.localStorage?.setItem(
        QA_ACTIVE_MESSAGE_KEY,
        JSON.stringify({
          id: message.id,
          recordingIds: messageRecordingIds(message),
          createdAt: message.createdAt || new Date().toISOString(),
          pending: Boolean(message.pending),
        }),
      );
    } catch {}
  }

  function clearActiveQaMessageRef(id) {
    try {
      const current = readActiveQaMessageRef();
      if (!id || current?.id === id) window.localStorage?.removeItem(QA_ACTIVE_MESSAGE_KEY);
    } catch {}
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

  function readActiveDailyBriefRef() {
    try {
      const raw = window.localStorage?.getItem(DAILY_BRIEF_ACTIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.date ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveActiveDailyBriefRef(brief) {
    if (!brief?.date) return;
    try {
      window.localStorage?.setItem(
        DAILY_BRIEF_ACTIVE_KEY,
        JSON.stringify({
          date: brief.date,
          updatedAt: brief.updatedAt || new Date().toISOString(),
          status: brief.status || "",
        }),
      );
    } catch {}
  }

  function clearActiveDailyBriefRef(date) {
    try {
      const current = readActiveDailyBriefRef();
      if (!date || current?.date === date) window.localStorage?.removeItem(DAILY_BRIEF_ACTIVE_KEY);
    } catch {}
  }

  function stopTtsQueue() {
    const audio = ttsAudioRef.current;
    ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setCitationPlayback((current) => ({ ...current, durationMs: Math.round((audio.duration || 0) * 1000) }));
    };
    const handleTimeUpdate = () => {
      const currentMs = Math.round((audio.currentTime || 0) * 1000);
      setCitationPlayback((current) => ({ ...current, currentMs }));
      const active = activeCitationRef.current;
      if (active.key && active.endMs && currentMs >= active.endMs) {
        audio.pause();
        setActiveCitationKey("");
        activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
      }
    };
    const handleEnded = () => {
      setActiveCitationKey("");
      activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
    };
    const handlePause = () => {
      if (!activeCitationRef.current.key) setActiveCitationKey("");
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
      audioSourceRef.current = "";
    };
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    ttsAudioRef.current = audio;

    const handlePlay = () => setTtsState((current) => ({ ...current, playing: true, loading: false }));
    const handlePause = () => setTtsState((current) => ({ ...current, playing: false, loading: false }));
    const handleEnded = () => {
      const queue = ttsQueueRef.current;
      if (queue.itemId && queue.segments.length > queue.index + 1) {
        playTtsSegment(queue.itemId, queue.segments, queue.index + 1, true);
        return;
      }
      ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
      setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeAttribute("src");
      audio.load();
      ttsAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    stopTtsQueue();
  }, [recording?.id, scopeKey]);

  useEffect(() => {
    setAvailableRecordings(recordings.filter((item) => !item.deletedAt));
  }, [recordings]);

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
    api("/api/recordings?folderId=all&q=")
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
    api("/api/qa-messages?limit=60")
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
    fetchDailyBriefHistory().catch(() => {});
    api("/api/meeting-briefs/today")
      .then((payload) => {
        if (!ignored) {
          mergeDailyBriefState(payload);
          if (payload?.status === "generating") {
            saveActiveDailyBriefRef(payload);
            pollDailyBrief(payload.date);
          } else if (payload?.summaryMarkdown) {
            clearActiveDailyBriefRef(payload.date);
          } else if (readActiveDailyBriefRef()?.date === payload?.date) {
            pollDailyBrief(payload.date);
          }
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
  }, [recording?.id, availableRecordings.length]);

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

    const recordingsByDate = new Map();
    Array.isArray(activeRecordings) && activeRecordings.forEach((item) => {
      const date = dateKeyFromRecording(item);
      recordingsByDate.set(date, [...(recordingsByDate.get(date) || []), item]);
    });

    Array.isArray(recordingsByDate) && recordingsByDate.forEach((items, date) => {
      const existing = byDate.get(date) || {};
      byDate.set(date, {
        id: existing.id || `daily-brief-${date}`,
        date,
        displayDate: existing.displayDate || displayDateFromDateKey(date),
        title: existing.title || "会议简报",
        meetingCount: Number.isFinite(Number(existing.meetingCount)) ? Number(existing.meetingCount) : items.length,
        recordingIds: Array.isArray(existing.recordingIds) && existing.recordingIds.length ? existing.recordingIds : items.map((item) => item.id).filter(Boolean),
        summaryMarkdown: existing.summaryMarkdown || "",
        status: existing.status || (items.length ? "idle" : "empty"),
        generatedAt: existing.generatedAt || "",
        updatedAt: existing.updatedAt || items[0]?.createdAt || date,
        dirty: Boolean(existing.dirty || (!existing.summaryMarkdown && items.length > 0)),
      });
    });

    return [...byDate.values()]
      .filter((brief) => brief?.date && (brief.status !== "empty" || dailyBriefMeetingCount(brief, 0) > 0))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [activeRecordings, dailyBrief, dailyBriefHistory]);
  const sortMessagesAscending = (messages = []) =>
    [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const scopeRecording = activeScopeIds.length === 1 ? activeRecordings.find((item) => item.id === activeScopeIds[0]) || null : null;
  const scopedRecordingsForPicker = activeRecordings;
  const visibleRecordings = scopeExpanded ? scopedRecordingsForPicker : scopedRecordingsForPicker.slice(0, 3);
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
  const visibleHistoryMessages = useMemo(() => {
    const alive = qaHistory.filter((item) => !item.deletedAt);
    const base = historyMode === "favorites" ? alive.filter((item) => item.favorite) : alive;
    const scoped = activeScopeIds.length > 0 ? base.filter((item) => isSameRecordingScope(messageScopeFromKnown(item, activeScopeIds, alive), activeScopeIds)) : base;
    return sortMessagesAscending(scoped);
  }, [answers, historyMode, qaHistory, scopeKey]);
  const visibleDailyBriefHistory = useMemo(() => {
    if (historyMode !== "history" || activeScopeIds.length > 0) return [];
    return [...dailyBriefHistory]
      .filter((item) => item?.date && item.status !== "empty")
      .sort((a, b) => {
        const left = new Date(a.updatedAt || a.generatedAt || a.date || 0).getTime();
        const right = new Date(b.updatedAt || b.generatedAt || b.date || 0).getTime();
        return right - left;
      });
  }, [dailyBriefHistory, historyMode, scopeKey]);
  const visibleHistoryCount = visibleHistoryMessages.length + visibleDailyBriefHistory.length;

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
    if (Array.isArray(answers)) {
      return
    }
    answers.filter((item) => item.pending).forEach((item) => {
      pollQaMessage(item.id, 0, messageScopeFromKnown(item, activeScopeIdsRef.current, answers))
    });
  }, [answers]);

  function normalizeRecordingIds(ids = []) {
    return [...new Set((ids || []).filter(Boolean))].sort();
  }

  function messageRecordingIds(message) {
    return normalizeRecordingIds(Array.isArray(message.recordingIds) ? message.recordingIds : message.recordingId ? [message.recordingId] : []);
  }

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

  function isSameRecordingScope(left = [], right = []) {
    const normalizedLeft = normalizeRecordingIds(left);
    const normalizedRight = normalizeRecordingIds(right);
    return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
  }

  function mergeQaMessages(...groups) {
    const merged = new Map();
    const flatted = groups.flat()
    if (!Array.isArray(flatted)) return []
    flatted.forEach((message) => {
      if (!message?.id || message.deletedAt) return;
      const previous = merged.get(message.id);
      const scope = messageRecordingIds(message).length > 0 ? messageRecordingIds(message) : messageRecordingIds(previous || {});
      const next = { ...(previous || {}), ...message };
      merged.set(message.id, scope.length > 0 ? { ...next, recordingIds: scope } : next);
    });
    return sortMessagesAscending([...merged.values()]);
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
    if (lockedRecordingId && id !== lockedRecordingId) onSelectRecording?.(id);
    window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function resetToAllRecordings() {
    onSelectRecording?.("");
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

  function switchHistoryMode(mode, event) {
    event.stopPropagation();
    setHistoryMode(mode);
    setHistoryOpen(true);
  }

  function openAttachmentPreview(item, type = "file") {
    setAttachmentPreview({ ...item, previewType: type });
  }

  function authenticatedResourceUrl(url = "") {
    if (!url || /^data:/i.test(url)) return url;
    let parsed;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      return url;
    }
    if (parsed.origin !== window.location.origin) return url;
    if (!parsed.searchParams.get("clientId")) parsed.searchParams.set("clientId", getClientId());
    const auth = getStoredAuth();
    if (auth?.token && !parsed.searchParams.get("authToken")) parsed.searchParams.set("authToken", auth.token);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function attachmentPreviewUrl(item = {}) {
    return item.dataUrl || authenticatedResourceUrl(item.url || "");
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

  function attachmentPreviewType(item = {}) {
    const kind = String(item.kind || item.previewType || "").toLowerCase();
    const type = String(item.type || "").toLowerCase();
    if (kind === "image" || type.startsWith("image/") || item.dataUrl?.startsWith("data:image/")) return "image";
    if (kind === "audio" || type.startsWith("audio/") || item.dataUrl?.startsWith("data:audio/")) return "audio";
    if (kind === "location") return "location";
    return "file";
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
    const payload = await api("/api/voice-input", {
      method: "POST",
      body: formData,
    });
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
      const payload = await api("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
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

  function playCitation(citation, key, nextMs = citation.startMs || 0) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    const audio = audioRef.current;
    if (!target || !audio) return;
    stopTtsQueue();

    if (activeCitationKey === key) {
      if (audio.paused) audio.play().catch(() => setActiveCitationKey(""));
      else {
        audio.pause();
        setActiveCitationKey("");
        activeCitationRef.current = { key: "", startMs: 0, endMs: 0 };
      }
      return;
    }

    seekCitation(citation, key, nextMs);
  }

  function seekCitation(citation, key, nextMs) {
    const target = activeRecordings.find((item) => item.id === citation.recordingId) || scopeRecording;
    const audio = audioRef.current;
    if (!target || !audio) return;

    const startMs = citationStartMs(citation);
    const endMs = citationEndMs(citation);
    const targetMs = Math.min(endMs, Math.max(startMs, nextMs));
    setActiveCitationKey(key);
    activeCitationRef.current = { key, startMs, endMs };
    setCitationPlayback({ key, currentMs: targetMs, durationMs: citationSegmentDurationMs(citation) });
    const nextSrc = new URL(mediaRequestUrl(target.audioUrl, target.updatedAt || target.createdAt || ""), window.location.href).href;
    const jump = () => {
      audio.currentTime = Math.max(0, targetMs / 1000);
      audio.play().catch(() => setActiveCitationKey(""));
    };
    if (audioSourceRef.current !== nextSrc) {
      audio.src = nextSrc;
      audioSourceRef.current = nextSrc;
      audio.addEventListener("loadedmetadata", jump, { once: true });
      audio.load();
    } else {
      jump();
    }
  }

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
        const payload = await api(`/api/qa-messages/${encodeURIComponent(id)}`);
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
    const payload = await api("/api/meeting-briefs?limit=30");
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
    onSelectRecording?.("");
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
        const payload = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`);
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
            const queued = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`, { method: "POST" });
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

  async function refreshDailyBriefRecordingItem(recordingState, date, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const recordingId = recordingState?.id || "";
    const targetDate = date || todayDateKey();
    if (!recordingId || !targetDate) return;
    if (!canRefreshDailyBriefRecording(recordingState)) {
      onToast?.("会议提纲完成后，才能更新这一条简报。");
      return;
    }
    if (dailyBriefGeneratingDates.has(targetDate)) {
      onToast?.("今日简报正在生成，请稍等完成后再更新这一条。");
      return;
    }

    let keepGenerating = false;
    setDailyBriefRefreshingRecordingIds((current) => new Set([...current, recordingId]));
    setDailyBriefGeneratingDates((current) => new Set([...current, targetDate]));
    try {
      const payload = await api(`/api/meeting-briefs/${encodeURIComponent(targetDate)}`, { method: "POST" });
      mergeDailyBriefState(payload);
      updateDailyBriefAnswerMessage(payload);
      fetchDailyBriefHistory().catch(() => {});
      if (payload.status === "generating") {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(targetDate);
      } else if (dailyBriefHasSummary(payload)) {
        clearActiveDailyBriefRef(targetDate);
        onToast?.("已开始更新这一条简报内容。");
      } else {
        keepGenerating = true;
        saveActiveDailyBriefRef(payload);
        pollDailyBrief(targetDate);
      }
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "这一条简报更新失败");
    } finally {
      setDailyBriefRefreshingRecordingIds((current) => {
        const next = new Set(current);
        next.delete(recordingId);
        return next;
      });
      if (!keepGenerating) {
        setDailyBriefGeneratingDates((current) => {
          const next = new Set(current);
          next.delete(targetDate);
          return next;
        });
      }
    }
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
      const payload = await api(`/api/meeting-briefs/${encodeURIComponent(date)}`, { method: "POST" });
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
    const fileName = `${safeFileName(item?.question || item?.title || "今日会议简报")}-${date}.pdf`;
    try {
      const response = await fetchWithClient(`/api/meeting-briefs/${encodeURIComponent(date)}/share.pdf`);
      if (!response.ok) throw new Error("PDF 生成失败");
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: item?.question || item?.title || "今日会议简报",
          text: "今日会议简报 PDF",
          files: [file],
        });
        return;
      }
      downloadBlob(blob, fileName);
      onToast?.("PDF 已生成，可在下载文件中分享");
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
    onSelectRecording?.("");
    setScopeIds([]);
    setDailyBrief(pendingBrief);
    setDailyBriefExpanded(true);
    showDailyBriefMessage(pendingBrief, { loading: true });
    setDailyBriefLoading(true);
    try {
      const active = pendingBrief;
      saveActiveDailyBriefRef(active);
      const payload = await api("/api/meeting-briefs/today", { method: "POST" });
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
      const payload = await api(`/api/qa-messages/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !item.favorite }),
      });
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
      await api(`/api/qa-messages/${item.id}`, { method: "DELETE" });
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
      const response = await fetchWithClient(url);
      if (!response.ok) throw new Error("PDF 生成失败");
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: item.question || "录音问答",
          text: "录音问答 PDF",
          files: [file],
        });
        return;
      }

      downloadBlob(blob, fileName);
      onToast?.("PDF 已生成，可在下载文件中分享");
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "分享失败");
    }
  }

  async function regenerateQaMessage(item, event) {
    event?.stopPropagation?.();
    const question = String(item?.question || "").trim();
    if (!question) return;
    enterQaConversationView();
    try {
      const targetScopeIds = lockedRecordingId ? [lockedRecordingId] : messageScopeFromKnown(item, activeScopeIdsRef.current, answers);
      const payload = await api("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          recordingIds: targetScopeIds,
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
        }),
      });
      if (!payload.message?.id) throw new Error("问答创建失败");
      const scopedMessage = withQaMessageScope(payload.message, targetScopeIds, [item]);
      saveActiveQaMessageRef(scopedMessage);
      setAnswers((current) => current.map((message) => (message.id === item.id ? scopedMessage : message)));
      setQaHistory((current) => [scopedMessage, ...current.filter((message) => message.id !== item.id && message.id !== scopedMessage.id)]);
      pollQaMessage(scopedMessage.id, 0, targetScopeIds);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : "重新生成失败");
    }
  }

  function compactSpeechText(value) {
    return stripQaInternalIndexMarkers(
      String(value || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  function speechSegmentsFromText(value, idPrefix = "content", label = "朗读内容", maxLength = 480) {
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

  function structuredSpeechSegments(structured) {
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

  function speechSegmentsForAnswerItem(item, structured) {
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

  async function playTtsSegment(itemId, segments, index = 0, auto = false) {
    const segment = segments[index];
    const audio = ttsAudioRef.current;
    if (!segment || !audio) return;

    const key = `${itemId}:${segment.id}`;
    ttsQueueRef.current = { itemId, segments, index };
    setTtsState({ key, itemId, index, loading: true, playing: false });

    try {
      audioRef.current?.pause();
      setActiveCitationKey("");
      const payload = await api("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: segment.text }),
      });

      if (ttsQueueRef.current.itemId !== itemId || ttsQueueRef.current.index !== index) return;
      audio.src = mediaRequestUrl(payload.url, payload.id || Date.now());
      audio.load();
      await audio.play();
      setTtsState({ key, itemId, index, loading: false, playing: true });
    } catch (error) {
      if (!auto) onToast?.(error instanceof Error ? error.message : "朗读生成失败");
      ttsQueueRef.current = { itemId: "", segments: [], index: 0 };
      setTtsState({ key: "", itemId: "", index: -1, loading: false, playing: false });
    }
  }

  function startTtsQueue(itemId, segments, index = 0) {
    if (!segments.length) {
      onToast?.("没有可朗读的内容");
      return;
    }
    playTtsSegment(itemId, segments, index);
  }

  function toggleTtsSegment(itemId, segments, index = 0) {
    const segment = segments[index];
    if (!segment) return;
    const key = `${itemId}:${segment.id}`;
    if (ttsState.key === key && (ttsState.playing || ttsState.loading)) {
      stopTtsQueue();
      return;
    }
    startTtsQueue(itemId, segments, index);
  }

  function toggleTtsQueue(itemId, segments) {
    const audio = ttsAudioRef.current;
    if (!audio) return;
    if (ttsState.itemId === itemId && ttsState.loading) {
      stopTtsQueue();
      return;
    }
    if (ttsState.itemId === itemId && ttsState.key && !ttsState.loading) {
      if (ttsState.playing) {
        stopTtsQueue();
      } else {
        audio.play().catch(() => startTtsQueue(itemId, segments, Math.max(0, ttsState.index)));
      }
      return;
    }
    startTtsQueue(itemId, segments, 0);
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
      <header className="chat-page-header compact">
        <button
          className={historyOpen ? "chat-history-title-button active" : "chat-history-title-button"}
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-label={historyOpen ? "关闭历史聊天记录" : "打开历史聊天记录"}
        >
          <span className="history-bars" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
        <h1>{uiText(language, "问答", "QA")}</h1>
        <span>{scopeLabel}</span>
      </header>

      <aside
        className={historyOpen ? "chat-history-panel open" : "chat-history-panel"}
        aria-label="历史聊天记录"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{historyMode === "favorites" ? "收藏夹" : "历史聊天记录"}</strong>
            <span>{historyMode === "favorites" ? `${visibleHistoryMessages.length} 条收藏` : `${visibleHistoryCount} 条记录`}</span>
          </div>
          <button type="button" onClick={() => setHistoryOpen(false)}>
            <X size={16} />
          </button>
        </header>

        <div className="chat-history-tabs" role="tablist" aria-label="历史类型">
          <button
            className={historyMode === "history" ? "active" : ""}
            type="button"
            onPointerDown={(event) => switchHistoryMode("history", event)}
            onClick={(event) => switchHistoryMode("history", event)}
          >
            历史
          </button>
          <button
            className={historyMode === "favorites" ? "active" : ""}
            type="button"
            onPointerDown={(event) => switchHistoryMode("favorites", event)}
            onClick={(event) => switchHistoryMode("favorites", event)}
          >
            收藏夹
          </button>
        </div>

        <div className="chat-history-list">
          {visibleHistoryCount > 0 ? (
            <>
              {visibleDailyBriefHistory.map((brief) => (
                <article
                  className="chat-history-item daily-brief-history-item"
                  key={brief.id || brief.date}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDailyBriefHistoryItem(brief)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDailyBriefHistoryItem(brief);
                    }
                  }}
                >
                  <button
                    className="chat-history-main"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDailyBriefHistoryItem(brief);
                    }}
                  >
                    <span>{brief.displayDate || brief.date}</span>
                    <strong>{brief.title || "今日会议简报"}</strong>
                    <em>
                      {Number(brief.meetingCount || 0)} 场会议 · {brief.status === "generating" ? "生成中" : brief.summaryMarkdown ? "已生成" : "暂无内容"}
                    </em>
                  </button>
                  <div className="chat-history-actions" aria-label="今日总结操作">
                    <button
                      className="history-share-button"
                      type="button"
                      aria-label="分享 PDF"
                      disabled={brief.status === "generating" || !brief.summaryMarkdown}
                      onClick={(event) => shareDailyBriefPdf(brief, event)}
                    >
                      {brief.status === "generating" ? <LoaderCircle className="spin-icon" size={14} /> : <Share2 size={14} />}
                    </button>
                  </div>
                </article>
              ))}
              {visibleHistoryMessages.map((item) => (
                <article
                className={item.favorite ? "chat-history-item favorite" : "chat-history-item"}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openHistoryItem(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openHistoryItem(item);
                  }
                }}
              >
                <button
                  className="chat-history-main"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openHistoryItem(item);
                  }}
                >
                  <span>{formatDate(item.createdAt)}</span>
                  <strong>{item.question}</strong>
                  {item.recordingNames?.length ? <em>{item.recordingNames.slice(0, 2).join("、")}</em> : null}
                </button>
                <div className="chat-history-actions" aria-label="问答操作">
                  <button
                    className="history-favorite-button"
                    type="button"
                    aria-label={item.favorite ? "取消收藏" : "收藏"}
                    onClick={(event) => toggleHistoryFavorite(item, event)}
                  >
                    <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
                  </button>
                  <button className="history-share-button" type="button" aria-label="分享 PDF" onClick={(event) => shareHistoryMessage(item, event)}>
                    <Share2 size={14} />
                  </button>
                  <button className="history-delete-button" type="button" aria-label="删除问答" onClick={(event) => deleteHistoryMessage(item, event)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
              ))}
            </>
          ) : (
            <p>{historyMode === "favorites" ? "还没有收藏的问答" : "还没有历史提问"}</p>
          )}
        </div>
      </aside>

      <section className={scopeExpanded ? "recording-scope-panel expanded" : "recording-scope-panel collapsed"} aria-label="选择录音">
        <div className="scope-toolbar">
          <button
            className={activeScopeIds.length === 0 ? "scope-all active" : "scope-all"}
            type="button"
            onClick={resetToAllRecordings}
          >
            {uiText(language, "全部录音", "All")}
          </button>
          <button
            className="scope-single"
            type="button"
            onClick={() => setScopeExpanded(true)}
            disabled={listLoading || activeRecordings.length === 0}
          >
            {listLoading ? uiText(language, "刷新中", "Refreshing") : uiText(language, "单选", "Single select")}
          </button>
          {activeRecordings.length > 0 ? (
            <button className="scope-toggle" type="button" onClick={() => setScopeExpanded((current) => !current)}>
              {scopeExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {scopeExpanded ? uiText(language, "收起", "Collapse") : uiText(language, "展开", "Expand")}
            </button>
          ) : null}
        </div>

        {listError ? <div className="scope-alert">{listError}</div> : null}

        {!scopeExpanded && activeRecordings.length > 0 ? (
          <button className="recording-scope-summary" type="button" onClick={openCurrentScopeConversation}>
            <span>{activeScopeIds.length === 0 ? "当前范围" : "正在询问"}</span>
            <strong>{scopeLabel}</strong>
            <em>{scopeSummaryMeta}</em>
          </button>
        ) : visibleRecordings.length > 0 ? (
          <div className="recording-scope-grid">
            {visibleRecordings.map((item) => {
              const selected = activeScopeIds.includes(item.id);
              const classes = [
                "scope-recording",
                selected ? "active" : "",
                isToday(item.createdAt) ? "is-today" : "is-past",
                hasHistoryForRecording(item.id) ? "has-history" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button className={classes} key={item.id} type="button" onClick={() => toggleScope(item.id)}>
                  <strong>{formatShortDate(item.createdAt)}</strong>
                  <span>{item.name}</span>
                  <em>{formatDuration(item.durationMs)}</em>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="scope-empty">暂无可提问的录音</div>
        )}
      </section>

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
              refreshingRecordingIds={dailyBriefRefreshingRecordingIds}
              onToggle={toggleDailyBriefDate}
              onGenerate={generateDailyBriefForDate}
              onSpeak={speakDailyBrief}
              onSpeakLine={speakDailyBriefLine}
              onShare={shareDailyBriefPdf}
              onRefreshRecording={refreshDailyBriefRecordingItem}
            />
          ) : answers.length > 0 ? (
            answers.map((item) => {
            if (item.type === "daily-brief") {
              return (
                <DailyMeetingBriefMessage
                  key={item.id}
                  message={item}
                  ttsState={ttsState}
                  refreshingRecordingIds={dailyBriefRefreshingRecordingIds}
                  onSpeakLine={speakDailyBriefLine}
                  onShare={shareDailyBriefPdf}
                  onRefreshRecording={refreshDailyBriefRecordingItem}
                />
              );
            }
            const blocks = answerBlocksForDisplay(item.answer);
            const displayBlocks = blocks.length > 0 ? blocks : [cleanAnswerForDisplay(item.answer) || "暂无可展示的回答内容，请重新生成。"];
            const citations = Array.isArray(item.citations) ? item.citations : [];
            const structuredAnswer = structuredAnswerFromItem(item);
            const answerSpeakSegments = item.pending ? [] : speechSegmentsForAnswerItem(item, structuredAnswer);
            const answerTtsActive = ttsState.itemId === item.id;
            const answerTtsRunning = answerTtsActive && (ttsState.playing || ttsState.loading);
            const messageAttachments = Array.isArray(item.attachments) ? item.attachments : [];
            return (
              <article className="chat-message" key={item.id}>
                <div className="chat-question">{item.question}</div>
                <time className="chat-message-time">{formatDate(item.createdAt)}</time>
                {messageAttachments.length > 0 ? (
                  <div className="chat-message-attachments" aria-label="已上传附件">
                    {messageAttachments.map((attachment, attachmentIndex) => {
                      const previewType = attachmentPreviewType(attachment);
                      return (
                        <button
                          key={attachment.id || attachment.fileId || `${item.id}-attachment-${attachmentIndex}`}
                          type="button"
                          onClick={() => openAttachmentPreview(attachment, previewType)}
                        >
                          <span>{previewType === "image" ? "图片" : previewType === "audio" ? "录音" : previewType === "location" ? "地址" : "文件"}</span>
                          <strong>{attachment.name || "附件"}</strong>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {item.pending ? (
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
                ) : structuredAnswer ? (
                  renderStructuredAnswer(item, structuredAnswer, citations)
                ) : (
                  <div className="chat-answer">
                    {displayBlocks.map((block, index) => {
                      const blockCitations = citationsForBlock(block, index, displayBlocks, citations);
                      const groupKey = `${item.id}-point-${index}`;
                      const expanded = Boolean(expandedCitationGroups[groupKey]);
                      return (
                        <section className="chat-answer-point" key={groupKey}>
                          <p>{block}</p>
                          {blockCitations.length > 0 ? (
                            <div className="chat-citation-panel" aria-label={`${pointLabelForIndex(index)}依据`}>
                              <button className="citation-fold-button" type="button" onClick={() => toggleCitationGroup(groupKey)}>
                                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                {expanded ? "收起" : "展开"} {blockCitations.length} 个时间点
                              </button>
                              {expanded ? (
                                <div className="citation-bar-list">
                                  {blockCitations.map((citation, citationIndex) => {
                                    const absoluteIndex = citation._citationIndex ?? citationIndex;
                                    const key = citationKey(citation, absoluteIndex);
                                    const durationMs = citationSegmentDurationMs(citation);
                                    const progressMs = citationProgressOffsetMs(citation, key);
                                    return (
                                      <div className="citation-bar" key={key}>
                                        <button
                                          className={activeCitationKey === key ? "active" : ""}
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            playCitation(citation, key);
                                          }}
                                          title={citationTimeLabel(citation)}
                                          aria-label={`播放依据 ${absoluteIndex + 1}：${citationTimeLabel(citation)}`}
                                        >
                                          {activeCitationKey === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                                        </button>
                                        <div>
                                          <strong>{citationTimeLabel(citation)}</strong>
                                          <em>{citation.recordingName || `依据 ${absoluteIndex + 1}`}</em>
                                        </div>
                                        <input
                                          type="range"
                                          min="0"
                                          max={durationMs}
                                          step="1000"
                                          value={progressMs}
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                          }}
                                          onChange={(event) => {
                                            event.preventDefault();
                                            seekCitation(citation, key, citationStartMs(citation) + Number(event.target.value));
                                          }}
                                          aria-label={`拖动依据 ${absoluteIndex + 1} 播放进度`}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}
                {!item.pending ? (
                  <div className="chat-message-actions" aria-label="问答操作">
                    <button type="button" onClick={(event) => regenerateQaMessage(item, event)}>
                      <RefreshCw size={14} />
                      <span>重新生成</span>
                    </button>
                    {answerSpeakSegments.length > 0 ? (
                      <button
                        className={answerTtsRunning ? "playing" : ""}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleTtsQueue(item.id, answerSpeakSegments);
                        }}
                      >
                        {answerTtsRunning ? (
                          <Pause size={14} fill="currentColor" />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                        <span>{answerTtsRunning ? "朗读停止" : "朗读播放"}</span>
                      </button>
                    ) : null}
                    <button type="button" onClick={(event) => shareHistoryMessage(item, event)}>
                      <Share2 size={14} />
                      <span>分享 PDF</span>
                    </button>
                  </div>
                ) : null}
              </article>
            );
            })
          ) : shouldShowDailyBriefCard ? null : (
            <div className="chat-empty">
              <h2>{uiText(language, "开始提问", "Ask a question")}</h2>
            </div>
          )}
        <div ref={chatEndRef} className="chat-thread-end" aria-hidden="true" />
      </div>

      <form className={attachmentsOpen ? "chat-dock attachments-open" : "chat-dock"} onSubmit={askRecordings}>
        {images.length > 0 || attachments.length > 0 ? (
          <div className="chat-attachment-chips">
            {images.map((item) => (
              <span key={item.id}>
                <button className="attachment-chip-main" type="button" onClick={() => openAttachmentPreview(item, "image")}>
                  <em>{item.name}</em>
                </button>
                <button type="button" aria-label="移除图片" onClick={() => setImages((current) => current.filter((image) => image.id !== item.id))}>
                  <X size={13} />
                </button>
              </span>
            ))}
            {attachments.map((item) => (
              <span key={item.id}>
                <button className="attachment-chip-main" type="button" onClick={() => openAttachmentPreview(item, item.kind || "file")}>
                  <em>{item.name}</em>
                </button>
                <button type="button" aria-label="移除附件" onClick={() => setAttachments((current) => current.filter((attachment) => attachment.id !== item.id))}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-mode-button"
            aria-label={composerMode === "voice" ? "切换文字输入" : "切换语音输入"}
            onClick={() => setComposerMode((current) => (current === "voice" ? "text" : "voice"))}
          >
            {composerMode === "voice" ? <Keyboard size={20} /> : <Mic size={20} />}
          </button>

          {composerMode === "voice" ? (
            <button
              className={listening ? "hold-talk-button recording" : "hold-talk-button"}
              type="button"
              disabled={voiceBusy}
              onPointerDown={startVoiceInput}
              onPointerUp={stopVoiceInput}
              onPointerCancel={stopVoiceInput}
              onPointerLeave={stopVoiceInput}
              onContextMenu={(event) => event.preventDefault()}
            >
              {listening ? (
                <span className="voice-input-wave" aria-hidden="true">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <i key={index} style={{ "--i": index }} />
                  ))}
                </span>
              ) : null}
              <span>{voiceBusy ? "正在转文字..." : listening ? "松开转文字" : "按住说话"}</span>
            </button>
          ) : (
            <textarea
              value={question}
              rows={composerRows}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder=""
              aria-label="输入问题"
            />
          )}

          <button
            type="button"
            className={attachmentsOpen ? "chat-plus-button active" : "chat-plus-button"}
            aria-label={attachmentsOpen ? "收起上传菜单" : "添加内容"}
            onClick={() => setAttachmentsOpen((current) => !current)}
          >
            <Plus size={22} />
          </button>

          {composerMode === "text" ? (
            <button className="chat-send-button" type="submit" aria-label="发送问题" disabled={!question.trim() && images.length === 0 && attachments.length === 0}>
              <Send size={19} />
            </button>
          ) : null}
        </div>

        {attachmentsOpen ? (
          <div className="chat-attach-panel" aria-label="添加内容">
            <button type="button" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus size={22} />
              图片
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()}>
              <Camera size={22} />
              拍照
            </button>
            <button type="button" onClick={() => audioQuestionInputRef.current?.click()}>
              <FileAudio size={22} />
              录音
            </button>
            <button type="button" onClick={() => fileQuestionInputRef.current?.click()}>
              <FileUp size={22} />
              文件
            </button>
            <button type="button" onClick={addLocationAttachment}>
              <Link size={22} />
              地址
            </button>
          </div>
        ) : null}

        <input ref={imageInputRef} className="upload-input" type="file" accept="image/*" multiple onChange={addImages} />
        <input ref={cameraInputRef} className="upload-input" type="file" accept="image/*" capture="environment" onChange={addCameraImage} />
        <input ref={audioQuestionInputRef} className="upload-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.webm,.aac" onChange={addQuestionAudio} />
        <input ref={fileQuestionInputRef} className="upload-input" type="file" accept=".txt,.md,.csv,.json,.log,text/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={addQuestionFile} />
      </form>

      {attachmentPreview ? (
        <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label="附件预览" onClick={closeAttachmentPreview}>
          <section className="attachment-preview-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>{attachmentPreview.name || "附件"}</strong>
                <span>{attachmentPreviewType(attachmentPreview) === "image" ? "图片" : attachmentPreviewType(attachmentPreview) === "location" ? "地址" : attachmentPreviewType(attachmentPreview) === "audio" ? "录音" : "文件"}</span>
              </div>
              <button type="button" onClick={closeAttachmentPreview} aria-label="关闭附件预览">
                <X size={16} />
              </button>
            </header>
            {attachmentPreviewType(attachmentPreview) === "image" && attachmentPreviewUrl(attachmentPreview) ? (
              <img src={attachmentPreviewUrl(attachmentPreview)} alt={attachmentPreview.name || "上传图片"} />
            ) : attachmentPreviewType(attachmentPreview) === "audio" && attachmentPreviewUrl(attachmentPreview) ? (
              <audio controls src={attachmentPreviewUrl(attachmentPreview)} />
            ) : attachmentPreview.url ? (
              <a href={attachmentPreviewUrl(attachmentPreview)} target="_blank" rel="noreferrer">
                打开附件：{attachmentPreview.name || attachmentPreview.url}
              </a>
            ) : attachmentPreview.text ? (
              <pre>{attachmentPreview.text}</pre>
            ) : attachmentPreview.dataUrl ? (
              <a href={attachmentPreview.dataUrl} target="_blank" rel="noreferrer" download={attachmentPreview.name || "attachment"}>
                打开附件：{attachmentPreview.name || "附件"}
              </a>
            ) : (
              <p>这个附件目前只有文件名信息，发送后会作为提问上下文的一部分；如需查看完整内容，请选择文本类文件或图片。</p>
            )}
          </section>
        </div>
      ) : null}

    </section>
  );
}
