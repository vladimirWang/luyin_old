import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
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
  Mic,
  Pencil,
  Plus,
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
  api,
  fetchWithClient
} from '../../utils/index.js'
import {loadImageSource, compressAvatarImage} from '../../utils/image.js'
import {isUploadableMediaFile, getAudioFileDuration} from '../../utils/audio.js'
import { isInWeCom } from '../../utils/wecom.js'
import {useUploadManager} from '../../hooks/useUploadManager.js'
import { useWecomAuthStore } from '../../stores/useWecomAuthStore.js'
import {QA_ACTIVE_MESSAGE_KEY, DAILY_BRIEF_ACTIVE_KEY, PROFILE_STORAGE_KEY} from '../../constant.js'
import {appendUrlParam} from '../../utils/index.js'
import {getRecordings} from '../../api/recordings.js'

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

export default function Records() {
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

  async function uploadRecording(blob, durationMs, options = {}) {
    const loadingMsg = options.uploadMessage || "正在上传录音并准备转写";
    const uploadId = options.uploadId || (options.showUploadCard === false || options.silent
      ? ""
      : createUploadCard({
          name: options.name || "新录音",
          durationMs,
          message: loadingMsg,
        }));

    updateUploadCard(uploadId, {
      name: options.name || "新录音",
      durationMs,
      message: loadingMsg,
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
      if (options.toastMessage) {
        showToast(options.toastMessage);
      } else if (!options.silent) {
        showToast("录音已上传服务器，可在记录里查看");
      }
      window.setTimeout(() => {
        refreshRecordings("", selectedFolderId).catch(() => {});
        refreshFolders().catch(() => {});
      }, 2600);
      return payload.recording;
    } catch (error) {
      failUploadCard(uploadId);
      throw error;
    }
  }

  async function uploadFiles(filesInput) {
    const files = Array.from(filesInput || []);
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
          toastMessage: "录音已上传并开始转写",
        });
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
    } catch (error) {
      console.error("upload files failed:", error);
      failUploadCard(uploadId);
      showToast(error instanceof Error ? `上传失败：${error.message}` : "上传失败，请稍后重试", 4000);
    }
  }

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

  async function loadRecordings(params) {
    console.log("recordings request: ", params)
    const res = await getRecordings(params)
    // console.log("recordings: ", res)
    setRecordings(res.recordings)
  }

  useEffect(() => {
    loadRecordings({folderId: selectedFolderId})
  }, [selectedFolderId])

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
      // releaseOptimisticRecordingRemovalLater(recording.id);
      refreshFolders().catch(() => {});
      loadRecordings()
      console.log("delete recording success")
      // refreshRecordings("", selectedFolderId, { silent: true }).catch(() => {});
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
        recordings={recordsForView}
        folders={folders}
        folderStats={folderStats}
        recordsTitle={profile.recordsTitle || "我的录音"}
        selectedFolderId={selectedFolderId}
        loading={loading}
        uploadBusy={uploadBusy}
        onOpenSettings={() => setSettingsOpen(true)}
        user={wecomUser}
        onLogout={logoutWecom}
        onStartRecording={() => routerNavigate("/recorder")}
        onUploadFiles={uploadFiles}
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
