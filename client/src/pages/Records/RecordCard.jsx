import { useState, useEffect, useRef } from "react";
import { Check, Share2, RefreshCw, LoaderCircle, Trash2 } from "lucide-react";
import {
  formatCardDateParts,
  formatClockTime,
  isToday,
  recordTitleSize,
  recordDateToneClass,
  recordVisualClass,
  recordSourceMeta,
  recordingStatusLabel,
  getClientName,
  cardColors,
} from "../../utils/index.js";
import {IconButton} from '../../components/IconButton.jsx'
import dayjs from 'dayjs'

export function RecordCard({
  recording,
  folders,
  isTrashView,
  isExpanded,
  isDeleting = false,
  bulkDeleteMode = false,
  bulkDeleteSelected = false,
  onBulkDeleteToggle,
  onToggleExpand,
  onAsk,
  onShare,
  onRename,
  onUpdateMeta,
  onMove,
  onToggleFavorite,
  onRetranscribe,
  onDelete,
  onRestore,
  onPermanentDelete,
  deleteModeActive = false,
  isAnyDeleteMode = false,
  onDeleteModeChange,
}) {
  const [draftName, setDraftName] = useState(recording.name);
  const [draftTag, setDraftTag] = useState(recording.tag || "");
  const [tagExpanded, setTagExpanded] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareBusyMode, setShareBusyMode] = useState("");
  const [deleteRevealed, setDeleteRevealed] = useState(false);
  const dragRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const color = cardColors[(recording.seq - 1) % cardColors.length];
  const visualClass = recordVisualClass(recording);
  const transcriptionApiEnabled = recording.transcriptHealth?.apiEnabled !== false;
  const canUseTranscribeAction = transcriptionApiEnabled || recording.tencentMeeting?.imported;
  const canRetranscribe =
    canUseTranscribeAction &&
    !isTrashView &&
    recording.canManage !== false &&
    (recording.status === "failed" || recording.transcriptHealth?.isFallback);
  const canDeleteThisRecording = recording.canDelete !== false;
  const ownerLabel = recording.ownerName && recording.ownerName !== "未设置姓名" ? recording.ownerName : getClientName();

  useEffect(() => {
    setDraftName(recording.name);
    setDraftTag(recording.tag || "");
  }, [recording.name, recording.tag]);

  useEffect(() => {
    setShareMenuOpen(false);
    setDeleteRevealed(false);
    suppressClickRef.current = false;
  }, [recording.id]);

  useEffect(() => {
    if (!deleteModeActive && deleteRevealed) setDeleteRevealed(false);
  }, [deleteModeActive, deleteRevealed]);

  useEffect(() => {
    if (!bulkDeleteMode) return;
    setShareMenuOpen(false);
    setDeleteRevealed(false);
  }, [bulkDeleteMode]);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, []);

  useEffect(() => {
    if (!shareMenuOpen) return undefined;

    function closeShareMenu(event) {
      const target = event.target;
      if (target?.closest?.(".record-card-floating-share-menu, .record-card-share-button")) return;
      setShareMenuOpen(false);
    }

    function closeShareMenuByKey(event) {
      if (event.key === "Escape") setShareMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeShareMenu, true);
    document.addEventListener("keydown", closeShareMenuByKey, true);

    return () => {
      document.removeEventListener("pointerdown", closeShareMenu, true);
      document.removeEventListener("keydown", closeShareMenuByKey, true);
    };
  }, [shareMenuOpen]);

  function commitName() {
    const next = draftName.trim();
    if (next && next !== recording.name) onRename(next);
    else setDraftName(recording.name);
  }

  function commitMeta() {
    const tag = draftTag.trim();
    if (tag !== (recording.tag || "")) {
      onUpdateMeta({ tag });
    }
    setDraftTag(tag);
  }

  function isCardInteractiveTarget(target) {
    return Boolean(target?.closest?.("button, input, textarea, select, label, a"));
  }

  function clearLongPressTimer() {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  async function handleCardShare(mode, event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (shareBusyMode || isDeleting) return;
    setShareBusyMode(mode);
    try {
      await onShare?.(mode);
      setShareMenuOpen(false);
    } finally {
      setShareBusyMode("");
    }
  }

  function handleCardPointerDown(event) {
    if (bulkDeleteMode) return;
    if (isDeleting || isTrashView || isCardInteractiveTarget(event.target)) return;
    const start = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    dragRef.current = start;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      if (dragRef.current !== start || start.moved || !canDeleteThisRecording) return;
      suppressClickRef.current = true;
      setShareMenuOpen(false);
      setDeleteRevealed(true);
      onDeleteModeChange?.(recording.id);
      if (navigator.vibrate) navigator.vibrate(10);
    }, 520);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 部分内嵌浏览器不支持 pointer capture，手势仍可正常降级。
    }
  }

  function handleCardPointerMove(event) {
    const start = dragRef.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) < 9) return;
    start.moved = true;
    clearLongPressTimer();
  }

  function handleCardPointerEnd() {
    clearLongPressTimer();
    dragRef.current = null;
  }

  function handleCardClick(event) {
    if (isDeleting) return;
    if (bulkDeleteMode) {
      if (!isTrashView && canDeleteThisRecording) onBulkDeleteToggle?.(recording.id);
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (isAnyDeleteMode && !deleteModeActive) {
      onDeleteModeChange?.("");
      return;
    }
    if (deleteRevealed && !isCardInteractiveTarget(event.target)) {
      setDeleteRevealed(false);
      onDeleteModeChange?.("");
      return;
    }
    onToggleExpand?.(event);
  }

  const shareOptions = [
    { mode: "outline", label: "会议提纲" },
    { mode: "text", label: "逐字稿" },
    { mode: "audio", label: "录音" },
  ];
  const sourceMeta = recordSourceMeta(recording);
  const dateParts = formatCardDateParts(recording.createdAt);
  const showDeleteUnderlay = !isTrashView && canDeleteThisRecording;
  const canBulkDelete = !isTrashView && canDeleteThisRecording && !isDeleting;
  const cardClassName = `record-card ${color} ${visualClass} ${sourceMeta.className}${isTrashView ? " in-trash" : ""}${
    isExpanded ? " expanded" : ""
  }${isDeleting ? " is-deleting" : ""}${isToday(recording.createdAt) ? " is-today" : ""}`;
  const shellClassName = `record-card-shell${deleteRevealed ? " delete-revealed" : ""}${
    isDeleting ? " is-deleting" : ""
  }${deleteModeActive ? " delete-mode-active" : ""}${shareMenuOpen ? " share-open" : ""}${
    bulkDeleteMode ? " bulk-delete-mode" : ""
  }${bulkDeleteSelected ? " bulk-delete-selected" : ""} ${sourceMeta.className}`;

  return (
    <div className={shellClassName}>
      <article
        className={cardClassName}
        onClick={handleCardClick}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerEnd}
        onPointerCancel={handleCardPointerEnd}
        style={{ "--record-title-size": recordTitleSize(draftName) }}
        aria-busy={isDeleting}
      >
        <div className="record-source-strip" aria-hidden="true">
          <span>{sourceMeta.label}</span>
        </div>
        <div className="record-card-top">
          <span className={`record-date-tile ${recordDateToneClass(recording, isTrashView)}`}>
            <em>{dateParts.month}</em>
            <span>{dateParts.day}</span>
          </span>
          {isTrashView ? (
            <span className={`status-dot ${recording.status}`}>
              {recordingStatusLabel(recording, isTrashView)}
            </span>
          ) : bulkDeleteMode ? (
            <button
              type="button"
              className={bulkDeleteSelected ? "record-select-circle selected" : "record-select-circle"}
              aria-label={bulkDeleteSelected ? "取消选择" : "选择删除"}
              aria-pressed={bulkDeleteSelected}
              disabled={!canBulkDelete}
              onClick={(event) => {
                event.stopPropagation();
                if (canBulkDelete) onBulkDeleteToggle?.(recording.id);
              }}
            >
              {bulkDeleteSelected ? <Check size={14} /> : null}
            </button>
          ) : (
            <div
              className="record-card-share-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                className="record-card-share-button"
                label="分享录音"
                onClick={(event) => {
                  event.stopPropagation();
                  setShareMenuOpen((open) => !open);
                }}
                disabled={isDeleting}
              >
                <Share2 size={15} strokeWidth={2.1} />
              </IconButton>
            </div>
          )}
        </div>

        <textarea
          className="record-title-input"
          aria-label="录音名称"
          rows={2}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          disabled={isDeleting || isTrashView}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onClick={(event) => event.stopPropagation()}
        />
        {/* <div style={{color: 'red', fontSize: 12}}>id{recording.id}</div> */}
        <div className="record-meta">
          <span>{dayjs(recording.createdAt).format("YYYY-MM-DD")}</span>
        </div>

        <div className="card-mark-row" onClick={(event) => event.stopPropagation()}>
          <textarea
            className={tagExpanded ? "expanded" : ""}
            aria-label="录音标签"
            rows={tagExpanded ? 3 : 1}
            value={draftTag}
            onChange={(event) => setDraftTag(event.target.value)}
            onBlur={() => {
              commitMeta();
              setTagExpanded(false);
            }}
            disabled={isDeleting || isTrashView || recording.canManage === false}
            onFocus={() => setTagExpanded(true)}
            onClick={(event) => {
              event.stopPropagation();
              setTagExpanded(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) event.currentTarget.blur();
            }}
            placeholder="点击添加标签"
          />
        </div>

        <div className="record-card-details" onClick={(event) => event.stopPropagation()}>
          <select
            className="folder-select"
            aria-label="录音文件夹"
            value={recording.folderId || ""}
            onChange={(event) => onMove(event.target.value || null)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            disabled={isTrashView || isDeleting || recording.canManage === false}
          >
            <option value="">未分类</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>

          <div className="record-owner-badge" title={ownerLabel}>
            <span>{ownerLabel}</span>
          </div>
        </div>

        {!isTrashView && recording.canManage !== false ? (
          <label className="record-share-toggle" onClick={(event) => event.stopPropagation()}>
            <span>{recording.shared !== false ? "共享录音" : "仅自己"}</span>
            <input
              type="checkbox"
              checked={recording.shared !== false}
              onChange={(event) => onUpdateMeta({ shared: event.target.checked })}
              disabled={isDeleting}
            />
            <i aria-hidden="true" />
          </label>
        ) : null}

        <div
          className={`card-actions${canRetranscribe ? " has-retranscribe" : ""}${
            isTrashView ? " trash-actions" : ""
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          {isTrashView ? (
            <>
              <IconButton label="恢复录音" onClick={onRestore} disabled={isDeleting}>
                <RefreshCw size={18} />
              </IconButton>
              <IconButton label={isDeleting ? "删除中" : "彻底删除"} onClick={isDeleting ? undefined : onPermanentDelete} disabled={isDeleting}>
                {isDeleting ? <LoaderCircle className="spin-icon" size={18} /> : <Trash2 size={18} />}
              </IconButton>
            </>
          ) : (
            <>
              {canRetranscribe ? (
                <IconButton className="card-secondary-action" label="重新转写" onClick={onRetranscribe} disabled={isDeleting}>
                  <RefreshCw size={18} />
                </IconButton>
              ) : null}
              <button className="qa-card-button" type="button" onClick={onAsk} disabled={isDeleting}>
                问答
              </button>
            </>
          )}
        </div>
        {isDeleting ? (
          <div className="record-card-busy" aria-live="polite">
            <LoaderCircle className="spin-icon" size={18} />
            <span>删除中</span>
          </div>
        ) : null}
        {showDeleteUnderlay && deleteRevealed ? (
          <button
            type="button"
            className="record-delete-float"
            onClick={(event) => {
              event.stopPropagation();
              setDeleteRevealed(false);
              onDeleteModeChange?.("");
              onDelete?.();
            }}
            disabled={isDeleting}
          >
            <Trash2 size={18} />
            <span>删除</span>
          </button>
        ) : null}

      </article>
      {!isTrashView && shareMenuOpen ? (
        <div
          className="record-card-share-menu record-card-floating-share-menu"
          onClick={(event) => event.stopPropagation()}
        >
          {shareOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={(event) => handleCardShare(option.mode, event)}
              disabled={Boolean(shareBusyMode)}
            >
              {shareBusyMode === option.mode ? "准备中" : option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
