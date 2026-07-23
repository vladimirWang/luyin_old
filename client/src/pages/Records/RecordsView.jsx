import { useState, useEffect, useRef, useMemo } from "react";
import {
  Star,
  Trash2,
  RefreshCw,
  Settings,
  LoaderCircle,
  Upload,
  FolderPlus,
  X,
  Pencil,
  Check,
  ChevronUp,
  ChevronDown,
  Mic,
  LogOut,
  UserRound,
} from "lucide-react";
import { recordingCanAsk, recordingCanPlay, uiText } from "../../utils/index.js";
import { IconButton } from "../../components/IconButton.jsx";
import { UploadingRecordCard } from "./UploadingRecordCard.jsx";
import { RecordCard } from "./RecordCard.jsx";
import { RecordPreviewOverlay } from "./RecordPreviewOverlay.jsx";
import { isInWeCom } from "../../utils/wecom.js";

export function RecordsView({
  recordings,
  folders,
  folderStats,
  recordsTitle,
  selectedFolderId,
  loading,
  uploadBusy,
  onOpenSettings,
  user,
  onLogout,
  onStartRecording,
  onUploadFiles,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onSelectFolder,
  onOpenDetail,
  onRename,
  onUpdateMeta,
  onMove,
  onToggleFavorite,
  onRetranscribe,
  onShare,
  onDelete,
  onBulkDelete,
  onRestore,
  onPermanentDelete,
  onRefresh,
  onUpdateRecordsTitle,
  language,
}) {
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recordsTitle || "我的录音");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [expandedRecordingId, setExpandedRecordingId] = useState("");
  const [deleteModeRecordingId, setDeleteModeRecordingId] = useState("");
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeleteSelectedIds, setBulkDeleteSelectedIds] = useState([]);
  const [cardScale, setCardScale] = useState(1);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pinchRef = useRef({ distance: 0, scale: 1 });
  const userMenuRef = useRef(null);


  const uploadInputRef = useRef(null);

  useEffect(() => {
    setTitleDraft(recordsTitle || "我的录音");
  }, [recordsTitle]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function closeUserMenu(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && userMenuRef.current?.contains(event.target)) return;
      setUserMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeUserMenu);
    document.addEventListener("keydown", closeUserMenu);
    return () => {
      document.removeEventListener("pointerdown", closeUserMenu);
      document.removeEventListener("keydown", closeUserMenu);
    };
  }, [userMenuOpen]);

  async function submitFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || creatingBusy) return;

    setFolderName("");
    setCreatingFolder(false);
    setCreatingBusy(true);
    try {
      await onCreateFolder(name);
    } finally {
      setCreatingBusy(false);
    }
  }

  function commitTitle() {
    const next = titleDraft.trim() || "我的录音";
    setTitleDraft(next);
    if (next !== (recordsTitle || "我的录音")) onUpdateRecordsTitle(next);
  }

  async function commitFolderRename(folder) {
    const nextName = folderDraft.trim() || folder.label;
    setFolderDraft(nextName);
    if (nextName !== folder.label) await onRenameFolder(folder.id, nextName);
    setEditingFolderId("");
  }

  async function removeFolder(folder) {
    const confirmed = window.confirm(`删除文件夹「${folder.label}」？里面的录音会回到未分类。`);
    if (!confirmed) return;
    await onDeleteFolder(folder.id);
    if (selectedFolderId === folder.id) onSelectFolder("all");
  }

  const folderItems = [
    { id: "all", label: "全部", count: folderStats.totalCount },
    { id: "favorites", label: "收藏夹", count: folderStats.favoriteCount, icon: <Star size={14} /> },
    { id: "uncategorized", label: "未分类", count: folderStats.uncategorizedCount },
    { id: "trash", label: "回收站", count: folderStats.trashCount, icon: <Trash2 size={14} /> },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.count, editable: true })),
  ];
  const collapsedFolderItems = (() => {
    const visible = [folderItems[0]].filter(Boolean);
    const selectedFolder = folderItems.find((folder) => folder.id === selectedFolderId);
    if (selectedFolder && !visible.some((folder) => folder.id === selectedFolder.id)) visible.push(selectedFolder);
    for (const folder of folderItems) {
      if (visible.length >= 3) break;
      if (!visible.some((item) => item.id === folder.id)) visible.push(folder);
    }
    return visible;
  })();
  const canExpandFolders = folderItems.length > collapsedFolderItems.length || folderItems.length > 3;
  const visibleFolderItems = foldersExpanded && canExpandFolders ? folderItems : collapsedFolderItems;

  const previewRecording = useMemo(() => {
    const recording = recordings.find((item) => item.id === expandedRecordingId);
    return recordingCanPlay(recording) ? recording : null;
  }, [recordings, expandedRecordingId])
  
  const recordColumns = cardScale < 0.62 ? 6 : cardScale < 0.86 ? 4 : 2;
  const compactCards = recordColumns >= 4;
  const denseCards = recordColumns >= 6;
  const bulkDeleteSelectedSet = new Set(bulkDeleteSelectedIds);
  const bulkDeleteSelectionCount = bulkDeleteSelectedIds.length;

  function closeBulkDeleteMode() {
    setBulkDeleteMode(false);
    setBulkDeleteSelectedIds([]);
    setDeleteModeRecordingId("");
  }

  function toggleBulkDeleteMode() {
    setExpandedRecordingId("");
    setDeleteModeRecordingId("");
    setBulkDeleteSelectedIds([]);
    setBulkDeleteMode((current) => !current);
  }

  function toggleBulkDeleteSelection(id) {
    setBulkDeleteSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function confirmBulkDelete() {
    const selectedRecords = recordings.filter(
      (recording) => bulkDeleteSelectedSet.has(recording.id) && !recording.deletedAt && recording.canDelete !== false,
    );
    if (!selectedRecords.length) return;
    const confirmed = window.confirm(`删除选中的 ${selectedRecords.length} 条录音？`);
    if (!confirmed) return;
    closeBulkDeleteMode();
    onBulkDelete?.(selectedRecords);
  }

  function touchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    const [first, second] = touches;
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  }

  function handleRecordsTouchStart(event) {
    if (event.touches.length !== 2) return;
    pinchRef.current = { distance: touchDistance(event.touches), scale: cardScale };
  }

  function handleRecordsTouchMove(event) {
    if (event.touches.length !== 2 || !pinchRef.current.distance) return;
    event.preventDefault();
    const ratio = touchDistance(event.touches) / pinchRef.current.distance;
    const nextScale = Math.min(1.06, Math.max(0.5, pinchRef.current.scale * ratio));
    setCardScale(nextScale);
  }

  function handleRecordsTouchEnd(event) {
    if (event.touches.length < 2) pinchRef.current = { distance: 0, scale: cardScale };
  }

  useEffect(() => {
    if (!canExpandFolders && foldersExpanded) setFoldersExpanded(false);
  }, [canExpandFolders, foldersExpanded]);

  useEffect(() => {
    if (deleteModeRecordingId && !recordings.some((recording) => recording.id === deleteModeRecordingId)) {
      setDeleteModeRecordingId("");
    }
  }, [deleteModeRecordingId, recordings]);

  useEffect(() => {
    if (selectedFolderId === "trash" && bulkDeleteMode) {
      closeBulkDeleteMode();
      return;
    }
    const visibleIds = new Set(recordings.map((recording) => recording.id));
    setBulkDeleteSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [bulkDeleteMode, recordings, selectedFolderId]);

  async function handleUploadFile(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await onUploadFiles?.(files);
  }

  return (
    <section className="screen records-screen" aria-label={uiText(language, "我的录音", "My records")}>
      <header className="records-header">
        <div>
          <p className="eyebrow">My Records</p>
          <input
            className="records-title-input"
            aria-label="记录页标题"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div className="header-tools">
          <IconButton label={uiText(language, "刷新", "Refresh")} onClick={onRefresh}>
            <RefreshCw size={23} />
          </IconButton>
          <IconButton
            className={bulkDeleteMode ? "header-delete-button active" : "header-delete-button"}
            label="批量删除"
            onClick={toggleBulkDeleteMode}
            disabled={selectedFolderId === "trash"}
          >
            <Trash2 size={22} />
          </IconButton>
          <div className="records-user-menu" ref={userMenuRef}>
            <button
              className="records-user-avatar"
              type="button"
              aria-label="打开用户菜单"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((current) => !current)}
            >
              {user?.avatar ? <img src={user.avatar} alt="" /> : user?.name ? <span>{user.name.slice(0, 1)}</span> : <UserRound size={20} />}
            </button>
            {userMenuOpen ? (
              <div className="records-user-dropdown" role="menu">
                <div className="records-user-summary">
                  <strong>{user?.name || "企业微信用户"}</strong>
                  <span>{user?.position || user?.department || "企业微信"}</span>
                </div>
                <button
                  className="records-user-settings"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onOpenSettings?.();
                  }}
                >
                  <Settings size={17} />
                  {/* 个人设置 */}
                </button>
                {
                  !isInWeCom() && <button
                    className="records-user-logout"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onLogout?.();
                    }}
                  >
                    <LogOut size={17} />
                    {/* 退出登录 */}
                  </button>
                }
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="record-actions-row">
        <button type="button" onClick={() => {
          console.log('click upload')
          uploadInputRef.current?.click()
        }} disabled={uploadBusy}>
          {uploadBusy ? <LoaderCircle className="spin-icon" size={18} /> : <Upload size={18} />}
          {uploadBusy ? uiText(language, "上传中", "Uploading") : uiText(language, "上传录音", "Upload")}
        </button>
        <button type="button" onClick={() => setCreatingFolder((current) => !current)}>
          <FolderPlus size={18} />
          {uiText(language, "新建文件夹", "New folder")}
        </button>
      </div>

      {bulkDeleteMode ? (
        <div className="bulk-delete-toolbar" role="group" aria-label="批量删除操作">
          <span>{bulkDeleteSelectionCount ? `已选择 ${bulkDeleteSelectionCount} 条` : "选择要删除的录音"}</span>
          <button type="button" onClick={closeBulkDeleteMode}>
            取消
          </button>
          <button className="confirm" type="button" onClick={confirmBulkDelete} disabled={!bulkDeleteSelectionCount}>
            确认删除
          </button>
        </div>
      ) : null}

      {creatingFolder ? (
        <form className="folder-create-form" onSubmit={submitFolder}>
          <input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="输入文件夹名称"
          />
          <button type="submit" disabled={creatingBusy || !folderName.trim()}>
            {creatingBusy ? "创建中" : "创建"}
          </button>
          <IconButton
            label="取消新建文件夹"
            onClick={() => {
              setFolderName("");
              setCreatingFolder(false);
            }}
          >
            <X size={18} />
          </IconButton>
        </form>
      ) : null}

      <div className="folder-area">
        <div className={foldersExpanded && canExpandFolders ? "folder-strip expanded" : "folder-strip collapsed"} aria-label="录音文件夹">
          {visibleFolderItems.map((folder) => {
            const editing = editingFolderId === folder.id;
            return (
              <div className={["folder-chip", selectedFolderId === folder.id ? "active" : ""].filter(Boolean).join(" ")} key={folder.id}>
                {editing ? (
                  <input
                    autoFocus
                    value={folderDraft}
                    onChange={(event) => setFolderDraft(event.target.value)}
                    onBlur={() => commitFolderRename(folder)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setEditingFolderId("");
                        setFolderDraft("");
                      }
                    }}
                    aria-label={folder.label + "文件夹名称"}
                  />
                ) : (
                  <button className="folder-main-button" type="button" onClick={() => {
                    console.log("folder.id: ", folder.id)
                    onSelectFolder(folder.id)
                  }}>
                    {folder.icon}
                    <span className="folder-label">{folder.label}</span>
                    <span className="folder-count">{folder.count}</span>
                  </button>
                )}
                {folder.editable ? (
                  <span className="folder-chip-tools">
                    <button
                      type="button"
                      aria-label={"重命名 " + folder.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (editing) commitFolderRename(folder);
                        else {
                          setEditingFolderId(folder.id);
                          setFolderDraft(folder.label);
                        }
                      }}
                    >
                      {editing ? <Check size={12} /> : <Pencil size={12} />}
                    </button>
                    <button className="folder-delete-button" type="button" aria-label={"删除 " + folder.label} onClick={() => removeFolder(folder)}>
                      <Trash2 size={12} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {canExpandFolders ? (
          <button
            className="folder-expand-button"
            type="button"
            aria-label={foldersExpanded ? "收起文件夹筛选" : "展开文件夹筛选"}
            title={foldersExpanded ? "收起" : "展开"}
            onClick={() => setFoldersExpanded((current) => !current)}
          >
            {foldersExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        ) : null}
      </div>

      <div
        className={bulkDeleteMode ? "records-content bulk-delete-mode" : "records-content"}
        onTouchStart={handleRecordsTouchStart}
        onTouchMove={handleRecordsTouchMove}
        onTouchEnd={handleRecordsTouchEnd}
        onTouchCancel={handleRecordsTouchEnd}
      >
        {loading ? (
          <div className="loading-state">
            <LoaderCircle size={28} />
            正在读取服务器录音
          </div>
        ) : recordings.length > 0 ? (
          <div
            className={[
              "record-grid",
              compactCards ? "compact" : "",
              denseCards ? "dense" : "",
              deleteModeRecordingId ? "delete-mode-active" : "",
              bulkDeleteMode ? "bulk-delete-mode" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              "--card-scale": cardScale,
              "--record-columns": recordColumns,
            }}
          >
            {recordings.map((recording) =>
              recording.status === "uploading" ? (
                <UploadingRecordCard key={recording.id} item={recording} />
              ) : (
                <RecordCard
                  key={recording.id}
                  recording={recording}
                  folders={folders}
                  isTrashView={selectedFolderId === "trash"}
                  isExpanded={expandedRecordingId === recording.id}
                  bulkDeleteMode={bulkDeleteMode}
                  bulkDeleteSelected={bulkDeleteSelectedSet.has(recording.id)}
                  onBulkDeleteToggle={toggleBulkDeleteSelection}
                  onToggleExpand={() => {
                    if (!recordingCanPlay(recording)) return;
                    console.log("recording toggle: ", recording.id)
                    setExpandedRecordingId((current) => (current === recording.id ? "" : recording.id))
                  }}
                  onAsk={() => {
                    if (recordingCanAsk(recording)) onOpenDetail(recording.id);
                  }}
                  onRename={(name) => onRename(recording.id, name)}
                  onUpdateMeta={(patch) => onUpdateMeta(recording.id, patch)}
                  onMove={(folderId) => onMove(recording.id, folderId)}
                  onToggleFavorite={() => onToggleFavorite(recording)}
                  onRetranscribe={() => onRetranscribe(recording)}
                  onShare={(mode) => onShare(recording, mode)}
                  onDelete={() => onDelete(recording)}
                  onRestore={() => onRestore(recording)}
                  onPermanentDelete={() => onPermanentDelete(recording)}
                  deleteModeActive={deleteModeRecordingId === recording.id}
                  isAnyDeleteMode={Boolean(deleteModeRecordingId)}
                  onDeleteModeChange={setDeleteModeRecordingId}
                />
              ),
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <Mic size={40} />
            </div>
            <h2>还没有录音</h2>
            <p>点击下方录音按钮，完成后会上传服务器并生成卡片。</p>
          </div>
        )}
      </div>

      {previewRecording && selectedFolderId !== "trash" ? (
        <RecordPreviewOverlay
          recording={previewRecording}
          onClose={() => setExpandedRecordingId("")}
          onAsk={() => {
            setExpandedRecordingId("");
            onOpenDetail(previewRecording.id);
          }}
          onShare={(mode) => onShare(previewRecording, mode)}
          onRetranscribe={() => onRetranscribe(previewRecording)}
        />
      ) : null}

      <input
        ref={uploadInputRef}
        className="upload-input"
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.webm,.aac,.mp4,.mov,.m4v"
        multiple
        onChange={handleUploadFile}
      />
    </section>
  );
}
