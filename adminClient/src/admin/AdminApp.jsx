import React, { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle, Archive, ArchiveRestore, AudioLines, Bot, CalendarPlus, CheckCircle2,
  ChevronRight, CircleUserRound, ClipboardList, Clock3, FileAudio, FileText, FolderKanban,
  GripVertical, LayoutDashboard, ListChecks, LoaderCircle, LogOut, MessageSquareText, PanelLeftClose,
  PanelLeftOpen, Moon, MoreHorizontal, PanelRightOpen, Play, Plus, RotateCcw, Send, Sparkles, Sun, Tag,
  ShieldCheck, Timer, Trash2, UsersRound, X,
} from "lucide-react";
import { citationJumpMs, findCitationSegment, segmentDomKey } from "./citationNavigation.js";
import { apiErrorMessage, isAdminAuthConfigError, isAdminAuthError } from "./apiErrors.js";
import RecordingPicker from "./RecordingPicker.jsx";
import { projectName, recordingCategory, recordingDepartment, recordingMemberNames } from "./recordingTaxonomy.js";
import {
  buildRecentWindows,
  keepKnownRecordingIds,
  latestResolvedAutoScope,
  messageSessionId,
  patchQaSession,
  recordingIdsAfterAsk,
  recordingIdsForSession,
  upsertQaSession,
} from "./sessionState.js";
import "./admin.css";

const TABS = [["summary", "会议总结", Sparkles], ["outline", "内容提纲", ClipboardList], ["transcript", "转写原文", FileText]];
const uniq = (items) => [...new Set(items.filter(Boolean))];
const ADMIN_API_BASE = String(import.meta.env.VITE_ADMIN_API_BASE || "/admin-api").replace(/\/$/, "");
const duration = (ms = 0) => { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
const durationLabel = (ms = 0) => { const minutes = Math.max(0, Math.round(ms / 60000)); if (minutes < 60) return `${minutes} 分钟`; const hours = Math.floor(minutes / 60), rest = minutes % 60; return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`; };
const dateText = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "未知时间";
const statusText = (r) => r.status === "failed" ? "处理失败" : !r.transcript?.length ? "等待转写" : r.summaryStatus === "ready" ? "分析完成" : ["queued", "generating"].includes(r.summaryStatus) ? "正在总结" : "已转写";
const newSessionId = () => `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function matchesPreset(recording, filters = {}, folderMap = new Map()) {
  if (filters.project && projectName(recording, folderMap) !== filters.project) return false;
  if (filters.uploader && !recordingMemberNames(recording).includes(filters.uploader)) return false;
  if (filters.category && recordingCategory(recording) !== filters.category) return false;
  return true;
}
async function api(path, options = {}) {
  const requestPath = `${ADMIN_API_BASE}${String(path || "").replace(/^\/api/, "")}`;
  const response = await fetch(requestPath, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.code = data.code || "";
    error.status = response.status;
    throw error;
  }
  return data;
}
function storedNumber(key, fallback) { const stored = localStorage.getItem(key); if (stored === null || stored === "") return fallback; const value = Number(stored); return Number.isFinite(value) && value > 0 ? value : fallback; }
function isToday(value, reference = new Date()) { const date = new Date(value || 0); return Number.isFinite(date.getTime()) && date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth() && date.getDate() === reference.getDate(); }
function findSegmentElementByKey(key) {
  if (!key) return null;
  return [...document.querySelectorAll("[data-segment-key]")].find((element) => element.dataset.segmentKey === key) || null;
}

function AdminApp() {
  const shellRef = useRef(null);
  const pickerReturnActiveIdRef = useRef("");
  const [recordings, setRecordings] = useState([]), [folders, setFolders] = useState([]), [messages, setMessages] = useState([]), [allMessages, setAllMessages] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [auth, setAuth] = useState({ checking: true, configured: true, authenticated: false, user: null });
  const [selected, setSelected] = useState([]), [activeId, setActiveId] = useState(""), [tab, setTab] = useState("summary");
  const [citationTarget, setCitationTarget] = useState(null);
  const [question, setQuestion] = useState(""), [asking, setAsking] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState("chat");
  const [currentSessionId, setCurrentSessionId] = useState(() => localStorage.getItem("admin-current-qa-session") || newSessionId());
  const [qaSessions, setQaSessions] = useState([]);
  const [sessionView, setSessionView] = useState("active"), [sessionMenuId, setSessionMenuId] = useState("");
  const [pickerPreset, setPickerPreset] = useState({ filters: {}, query: "", key: "all" });
  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem("admin-left-open") !== "false");
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("admin-right-open") !== "false");
  const [leftWidth, setLeftWidth] = useState(() => storedNumber("admin-left-width", 272));
  const [rightWidth, setRightWidth] = useState(() => storedNumber("admin-right-width", 380));
  const [dragging, setDragging] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("admin-theme") || "dark");

  function clearAdminData() {
    setRecordings([]); setFolders([]); setMessages([]); setAllMessages([]); setSelected([]); setActiveId(""); setWorkspaceMode("chat");
  }
  function handleApiError(error) {
    const message = apiErrorMessage(error);
    if (isAdminAuthError(error)) {
      setAuth(current => ({ ...current, checking: false, authenticated: false, user: null }));
      clearAdminData();
    } else if (isAdminAuthConfigError(error)) {
      setAuth(current => ({ ...current, checking: false, configured: false, authenticated: false, user: null }));
      clearAdminData();
    }
    setError(message);
    return message;
  }
  async function loadAdminData() {
    setLoading(true);
    try {
      const [a,b,c,d,e,f] = await Promise.all([api("/api/recordings"), api("/api/folders"), api("/api/qa-messages?limit=100&surface=admin"), api("/api/qa-sessions?status=active"), api("/api/qa-sessions?status=archived"), api("/api/qa-sessions?status=deleted")]);
      const loadedMessages = (c.messages || []).reverse();
      const storedSession = localStorage.getItem("admin-current-qa-session") || "";
      const storedSessions = [...(d.sessions || []), ...(e.sessions || []), ...(f.sessions || [])];
      const activeSessions = storedSessions.filter(session => session.status === "active");
      const messageSessionIds = new Set(loadedMessages.map(messageSessionId));
      const sessionIds = new Set([...activeSessions.map(s => s.id), ...messageSessionIds]);
      const loadedRecordings = a.recordings || [];
      const nextSession = sessionIds.has(storedSession) ? storedSession : activeSessions[0]?.id || newSessionId();
      const nextSelected = keepKnownRecordingIds(recordingIdsForSession(nextSession, storedSessions, loadedMessages), loadedRecordings);
      setRecordings(loadedRecordings); setFolders(b.folders || []); setAllMessages(loadedMessages); setQaSessions(storedSessions); setCurrentSessionId(nextSession); setMessages(loadedMessages.filter(m => messageSessionId(m) === nextSession)); setSelected(nextSelected); setActiveId(nextSelected[0] || loadedRecordings[0]?.id || "");
    } catch (e) { handleApiError(e); }
    finally { setLoading(false); }
  }
  useEffect(() => { api("/api/admin/session").then((session) => { setAuth({ checking: false, configured: session.configured !== false, authenticated: !!session.authenticated, user: session.user || null }); if (session.authenticated) loadAdminData(); else setLoading(false); }).catch(e => { setAuth(current => ({ ...current, checking: false, authenticated: false })); handleApiError(e); setLoading(false); }); }, []);
  useEffect(() => { localStorage.setItem("admin-left-open", String(leftOpen)); }, [leftOpen]);
  useEffect(() => { localStorage.setItem("admin-right-open", String(rightOpen)); }, [rightOpen]);
  useEffect(() => { localStorage.setItem("admin-left-width", String(Math.round(leftWidth))); }, [leftWidth]);
  useEffect(() => { localStorage.setItem("admin-right-width", String(Math.round(rightWidth))); }, [rightWidth]);
  useEffect(() => { localStorage.setItem("admin-theme", theme); document.documentElement.dataset.adminTheme = theme; return () => delete document.documentElement.dataset.adminTheme; }, [theme]);
  useEffect(() => { localStorage.setItem("admin-current-qa-session", currentSessionId); }, [currentSessionId]);

  const folderMap = useMemo(() => new Map(folders.map(f => [f.id, f.name])), [folders]);
  const active = recordings.find(r => r.id === activeId) || recordings.find(r => selected.includes(r.id)) || recordings[0];
  const selectedRecordings = recordings.filter(r => selected.includes(r.id));
  const selectedProjectCount = uniq(selectedRecordings.map(r => projectName(r, folderMap))).length;
  const latestAutoScope = useMemo(() => selected.length ? null : latestResolvedAutoScope(messages, recordings), [selected.length, messages, recordings]);
  const scopeSummary = selected.length ? `已选择 ${selected.length} 场会议` : latestAutoScope ? `${latestAutoScope.label} · ${latestAutoScope.recordingIds.length} 场` : "基于会议原文与纪要回答";
  const contextSummary = selected.length ? `已选择 ${selected.length} 条 · ${selectedProjectCount} 个项目` : latestAutoScope ? `${latestAutoScope.label} · ${latestAutoScope.recordingIds.length} 条` : "默认今天，未手动锁定";
  const pickerRecordings = useMemo(() => recordings.filter(r => matchesPreset(r, pickerPreset.filters, folderMap)), [recordings, pickerPreset.filters, folderMap]);
  const recentWindows = useMemo(() => buildRecentWindows(allMessages, messages, currentSessionId, qaSessions).filter(window => sessionView === "active" ? ["active", "draft"].includes(window.status) : window.status === sessionView), [allMessages, messages, currentSessionId, qaSessions, sessionView]);
  const highlightedSegment = useMemo(() => citationTarget && active ? findCitationSegment(active.transcript || [], citationTarget) : null, [active, citationTarget]);
  const highlightedSegmentKey = segmentDomKey(highlightedSegment);
  const gridStyle = { gridTemplateColumns: `${leftOpen ? `${leftWidth}px 5px` : ""} minmax(420px, 1fr) ${rightOpen ? `5px ${rightWidth}px` : ""}`.trim() };

  useEffect(() => {
    if (!citationTarget || !rightOpen || tab !== "transcript" || !highlightedSegment) return;
    if (citationTarget.recordingId && active?.id !== citationTarget.recordingId) return;
    const timer = window.setTimeout(() => {
      findSegmentElementByKey(highlightedSegmentKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [active?.id, citationTarget, highlightedSegment, highlightedSegmentKey, rightOpen, tab]);

  useEffect(() => {
    if (!citationTarget) return;
    const timer = window.setTimeout(() => setCitationTarget(null), 2400);
    return () => window.clearTimeout(timer);
  }, [citationTarget]);

  function openPicker(preset = {}) { const filters = preset.filters || {}; const query = preset.query || ""; pickerReturnActiveIdRef.current = activeId; setPickerPreset({ filters, query, key: `${Date.now()}-${JSON.stringify(filters)}-${query}` }); setWorkspaceMode("recording-picker"); }
  function cancelPicker() { setActiveId(pickerReturnActiveIdRef.current); setWorkspaceMode("chat"); }
  function startResize(side, event) {
    event.preventDefault();
    const startX = event.clientX, startWidth = side === "left" ? leftWidth : rightWidth;
    setDragging(side); document.body.classList.add("admin-is-resizing");
    const move = (moveEvent) => {
      const shellWidth = shellRef.current?.getBoundingClientRect().width || window.innerWidth;
      const delta = moveEvent.clientX - startX;
      if (side === "left") setLeftWidth(Math.min(Math.min(430, shellWidth * .38), Math.max(210, startWidth + delta)));
      else setRightWidth(Math.min(Math.min(620, shellWidth * .48), Math.max(300, startWidth - delta)));
    };
    const stop = () => { setDragging(""); document.body.classList.remove("admin-is-resizing"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true });
  }
  function resizeByKeyboard(side, event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); const delta = event.key === "ArrowRight" ? 16 : -16;
    if (side === "left") setLeftWidth(v => Math.min(430, Math.max(210, v + delta)));
    else setRightWidth(v => Math.min(620, Math.max(300, v - delta)));
  }
  function newQuestion() { const id = newSessionId(); setCurrentSessionId(id); setMessages([]); setSelected([]); setActiveId(recordings[0]?.id || ""); setQuestion(""); setSessionView("active"); setSessionMenuId(""); setWorkspaceMode("chat"); }
  function openSession(id) { const ids = keepKnownRecordingIds(recordingIdsForSession(id, qaSessions, allMessages), recordings); setCurrentSessionId(id); setMessages(allMessages.filter(m => messageSessionId(m) === id)); setSelected(ids); setActiveId(ids[0] || recordings[0]?.id || ""); setQuestion(""); setSessionMenuId(""); setWorkspaceMode("chat"); }
  async function changeSessionStatus(id, status) {
    try {
      const data = await api(`/api/qa-sessions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setQaSessions(current => upsertQaSession(current, data.session));
      setSessionMenuId("");
      if (id === currentSessionId && status !== "active") newQuestion();
    } catch (e) { handleApiError(e); }
  }
  async function deleteSession(id) {
    if (!window.confirm("删除后问答窗口将进入回收站，是否继续？")) return;
    try {
      await api(`/api/qa-sessions/${id}`, { method: "DELETE" });
      setQaSessions(current => current.map(session => session.id === id ? { ...session, status: "deleted", deletedAt: new Date().toISOString() } : session));
      setSessionMenuId("");
      if (id === currentSessionId) newQuestion();
    } catch (e) { handleApiError(e); }
  }
  async function permanentlyDeleteSession(id) {
    if (!window.confirm("永久删除后无法恢复，相关问答消息也会一并删除。是否继续？")) return;
    try {
      await api(`/api/qa-sessions/${id}?permanent=true`, { method: "DELETE" });
      setQaSessions(current => current.filter(session => session.id !== id));
      setAllMessages(current => current.filter(message => messageSessionId(message) !== id));
      setSessionMenuId("");
    } catch (e) { handleApiError(e); }
  }
  function commitSelection(ids) { const nextIds = keepKnownRecordingIds(ids, recordings); const oldCount = selected.length, changed = oldCount !== nextIds.length || selected.some(id => !nextIds.includes(id)); setSelected(nextIds); setQaSessions(current => current.some(session => session.id === currentSessionId) ? patchQaSession(current, currentSessionId, { recordingIds: nextIds }) : current); if (nextIds[0] && !nextIds.includes(activeId)) setActiveId(nextIds[0]); if (!nextIds.length) setActiveId(recordings[0]?.id || ""); if (changed && messages.length) setMessages(current => [...current, { id: `scope-${Date.now()}`, sessionId: currentSessionId, question: "分析范围已变更", answer: `本窗口分析范围已由 ${oldCount} 条录音调整为 ${nextIds.length} 条录音`, scopeChange: true }]); setWorkspaceMode("chat"); }
  async function ask(event) {
    event?.preventDefault();
    const text = question.trim(), ids = selected;
    const scope = ids.length ? "selected" : "auto";
    if (!text || asking) return;
    const pending = { id: `pending-${Date.now()}`, sessionId: currentSessionId, question: text, pending: true };
    setMessages(m => [...m, pending]); setQuestion(""); setAsking(true);
    try {
      const data = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: text, recordingIds: ids, scope, sessionId: currentSessionId, surface: "admin" }) });
      const confirmedIds = recordingIdsAfterAsk(ids, data.message?.recordingIds, recordings);
      const responseIds = keepKnownRecordingIds(data.message?.recordingIds, recordings);
      setMessages(m => m.map(x => x.id === pending.id ? data.message : x));
      setAllMessages(m => [...m.filter(x => x.id !== data.message.id), data.message]);
      setSelected(confirmedIds);
      if (confirmedIds[0] && !confirmedIds.includes(activeId)) setActiveId(confirmedIds[0]);
      if (!confirmedIds.length) setActiveId(responseIds[0] || recordings[0]?.id || "");
      if (data.session) setQaSessions(current => upsertQaSession(current, data.session));
    }
    catch (e) { setMessages(m => m.filter(x => x.id !== pending.id)); setQuestion(text); handleApiError(e); }
    finally { setAsking(false); }
  }
  function cite(c) { const target = { ...c, startMs: citationJumpMs(c), recordingId: c.recordingId || "" }; setCitationTarget({ ...target, key: `${target.recordingId}-${target.segmentId || target.startMs}-${Date.now()}` }); if (c.recordingId) setActiveId(c.recordingId); setTab("transcript"); setRightOpen(true); }
  async function login(credentials) { try { const data = await api("/api/admin/login", { method: "POST", body: JSON.stringify(credentials) }); setError(""); setAuth({ checking: false, configured: true, authenticated: true, user: data.user || null }); await loadAdminData(); } catch (e) { if (isAdminAuthConfigError(e)) setAuth(current => ({ ...current, configured: false, authenticated: false, user: null })); throw e; } }
  async function logout() { await api("/api/admin/logout", { method: "POST" }).catch(() => {}); setError(""); setAuth({ checking: false, configured: true, authenticated: false, user: null }); clearAdminData(); }

  if (auth.checking) return <main className={`admin-shell theme-${theme}`}><div className="admin-auth-loading"><LoaderCircle/>正在校验管理员身份…</div></main>;
  if (!auth.authenticated) return <AdminLogin theme={theme} configured={auth.configured} onLogin={login} notice={error}/>;

  return <main ref={shellRef} className={`admin-shell theme-${theme} ${dragging ? "is-dragging" : ""}`} style={gridStyle}>
    {leftOpen && <aside className="left-panel">
      <header className="left-header"><div className="product-mark"><AudioLines size={18}/></div><strong>录音中台</strong><button className="icon-button" onClick={() => setLeftOpen(false)} title="收起导航"><PanelLeftClose/></button></header>
      <div className="section-label">工作区</div><nav className="primary-nav workspace-nav"><button className={workspaceMode === "dashboard" ? "active" : ""} onClick={() => setWorkspaceMode("dashboard")}><LayoutDashboard/><span>工作台</span></button></nav><button className="new-session" onClick={newQuestion} title="创建新的会议问答窗口"><Plus/><span>新建问答</span></button>
      <div className="section-label">数据管理</div><nav className="primary-nav data-nav"><button className={workspaceMode === "recording-picker" ? "active" : ""} onClick={() => openPicker()}><Archive/><span>全部录音</span><em>{recordings.length}</em></button><button className={workspaceMode === "projects" ? "active" : ""} onClick={() => setWorkspaceMode("projects")}><FolderKanban/><span>项目与分类</span></button><button className={workspaceMode === "members" ? "active" : ""} onClick={() => setWorkspaceMode("members")}><UsersRound/><span>成员与部门</span></button></nav>
      <div className="section-label">当前窗口</div><nav className="context-nav"><button className={workspaceMode === "recording-picker" ? "active" : ""} onClick={() => openPicker()}><span className="context-icon"><FileAudio/></span><span><strong>录音范围</strong><small>{contextSummary}</small></span><span className="context-count">{selected.length || latestAutoScope?.recordingIds.length || 0}</span></button></nav>
      <div className="section-label recent-label session-heading"><span>{sessionView === "active" ? "最近问答" : sessionView === "archived" ? "已归档" : "回收站"}</span><span className="session-view-actions"><button className={sessionView === "active" ? "active" : ""} title="最近问答" onClick={() => { setSessionView("active"); setSessionMenuId(""); }}><MessageSquareText/></button><button className={sessionView === "archived" ? "active" : ""} title="已归档" onClick={() => { setSessionView("archived"); setSessionMenuId(""); }}><Archive/></button><button className={sessionView === "deleted" ? "active" : ""} title="回收站" onClick={() => { setSessionView("deleted"); setSessionMenuId(""); }}><Trash2/></button></span></div>
      <div className="recent-list">{recentWindows.length ? recentWindows.map(window => <div className="qa-window-row" key={window.id}><button className={`qa-window-card ${window.id === currentSessionId ? "active" : ""}`} onClick={() => openSession(window.id)}><span className="qa-window-icon"><MessageSquareText/></span><span className="qa-window-meta"><strong>{window.title}</strong><small>{window.count ? `${window.count} 个问题 · ${window.preview}` : window.preview}</small></span></button>{window.status !== "draft" && <button className="qa-window-menu-button" title="问答窗口操作" onClick={() => setSessionMenuId(current => current === window.id ? "" : window.id)}><MoreHorizontal/></button>}{sessionMenuId === window.id && <div className="qa-window-menu">{window.status !== "active" && <button onClick={() => changeSessionStatus(window.id, "active")}><RotateCcw/>恢复到最近问答</button>}{window.status === "active" && <button onClick={() => changeSessionStatus(window.id, "archived")}><ArchiveRestore/>归档</button>}{window.status !== "deleted" && <button className="danger" onClick={() => deleteSession(window.id)}><Trash2/>删除</button>}{window.status === "deleted" && <button className="danger" onClick={() => permanentlyDeleteSession(window.id)}><Trash2/>永久删除</button>}</div>}</div>) : <div className="recent-empty">{sessionView === "active" ? "暂无最近问答" : sessionView === "archived" ? "暂无已归档问答" : "回收站为空"}</div>}</div>
      <footer className="admin-user"><CircleUserRound/><div><strong>{auth.user?.username || "领导账号"}</strong><small>管理员 · 查看全部组织录音</small></div><button className="logout-button" onClick={logout} title="退出登录"><LogOut/></button></footer>
    </aside>}
    {leftOpen && <div className={`panel-resizer left-resizer ${dragging === "left" ? "active" : ""}`} role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" tabIndex="0" onPointerDown={e => startResize("left", e)} onKeyDown={e => resizeByKeyboard("left", e)} onDoubleClick={() => setLeftWidth(272)}><GripVertical/></div>}

    <section className="center-panel">
      <header className="center-header"><div className="center-title">{!leftOpen && <button className="icon-button panel-opener" onClick={() => setLeftOpen(true)} title="显示导航"><PanelLeftOpen/></button>}<div><strong>{centerTitle(workspaceMode)}</strong><span>{centerSubtitle(workspaceMode, scopeSummary)}</span></div></div><div className="center-actions"><button className="icon-button theme-toggle" title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun/> : <Moon/>}</button>{!rightOpen && <button className="icon-button panel-opener" onClick={() => setRightOpen(true)} title="显示详细信息"><PanelRightOpen/></button>}</div></header>
      {workspaceMode === "dashboard" && <DashboardWorkspace recordings={recordings} folderMap={folderMap} onOpenPicker={openPicker} onOpenChat={newQuestion}/>}
      {workspaceMode === "recording-picker" && <RecordingPicker key={pickerPreset.key} recordings={pickerRecordings} folders={folders} committedIds={selected} activeId={activeId} setActiveId={setActiveId} loading={loading} onCancel={cancelPicker} onConfirm={commitSelection} initialFilters={pickerPreset.filters} initialQuery={pickerPreset.query}/>}
      {workspaceMode === "projects" && <ManagementWorkspace type="projects" recordings={recordings} folderMap={folderMap} onOpenPicker={openPicker}/>}
      {workspaceMode === "members" && <ManagementWorkspace type="members" recordings={recordings} folderMap={folderMap} onOpenPicker={openPicker}/>}
      {workspaceMode === "chat" && <ChatWorkspace messages={messages} selectedRecordings={selectedRecordings} allRecordings={recordings.filter(r => !r.deletedAt)} latestAutoScope={latestAutoScope} question={question} setQuestion={setQuestion} ask={ask} asking={asking} cite={cite} openPicker={openPicker}/>}
    </section>

    {rightOpen && <div className={`panel-resizer right-resizer ${dragging === "right" ? "active" : ""}`} role="separator" aria-label="调整详细信息栏宽度" aria-orientation="vertical" tabIndex="0" onPointerDown={e => startResize("right", e)} onKeyDown={e => resizeByKeyboard("right", e)} onDoubleClick={() => setRightWidth(380)}><GripVertical/></div>}
    {rightOpen && <Inspector active={active} tab={tab} setTab={setTab} setRightOpen={setRightOpen} highlightedSegmentKey={highlightedSegmentKey}/>}
    {error && <div className="toast"><X/>{error}<button onClick={() => setError("")}>关闭</button></div>}
  </main>;
}


function centerTitle(mode) { return mode === "dashboard" ? "工作台" : mode === "recording-picker" ? "选择录音" : mode === "projects" ? "项目与分类" : mode === "members" ? "成员与部门" : "智能问答"; }
function centerSubtitle(mode, scopeSummary) { return mode === "dashboard" ? "组织会议数据与近期变化" : mode === "chat" ? scopeSummary : "按条件查看和管理会议数据"; }

function ChatWorkspace({ messages, selectedRecordings, allRecordings = [], latestAutoScope = null, question, setQuestion, ask, asking, cite, openPicker }) {
  const implicitAuto = selectedRecordings.length === 0;
  const hasMessages = messages.length > 0;
  const todayRecordings = allRecordings.filter((recording) => isToday(recording.createdAt));
  const inferredRecordings = latestAutoScope?.recordingIds?.length ? allRecordings.filter(recording => latestAutoScope.recordingIds.includes(recording.id)) : [];
  const effectiveRecordings = implicitAuto ? (latestAutoScope ? inferredRecordings : todayRecordings) : selectedRecordings;
  const totalDurationMs = effectiveRecordings.reduce((sum, recording) => sum + Number(recording.durationMs || 0), 0);
  const speakerCount = uniq(effectiveRecordings.flatMap(recording => [recording.speakerName, ...(recording.speakers?.map(speaker => speaker.name) || [])])).length;
  const briefTitle = implicitAuto ? (latestAutoScope ? latestAutoScope.label.replace("（默认）", "") : "今天") : `已选 ${selectedRecordings.length} 场`;
  const briefText = implicitAuto ? (latestAutoScope ? "未手动锁定；下一问会继续按问题线索判断范围" : "未手动选择时先看今天；写明全部、项目、录音名或说话人会按线索调整") : "问题只会基于已选录音、转写、纪要和引用回答";
  const starters = ["今天开了什么会？帮我总结一下", "上周客户反馈里有哪些风险？", "全部会议有哪些待办还没有负责人？", "不同项目的客户反馈有什么差异？"];
  const renderComposer = (placement) => <form className={`composer-wrap ${placement === "start" ? "composer-start" : "composer-docked"}`} onSubmit={ask}>
    {selectedRecordings.length > 0 && <div className="selected-files">{selectedRecordings.slice(0,4).map(r => <button type="button" key={r.id} onClick={() => openPicker()}><FileAudio/>{r.name}</button>)}{selectedRecordings.length > 4 && <span>+{selectedRecordings.length-4}</span>}<button type="button" className="edit-scope" onClick={() => openPicker()}>调整范围</button></div>}
    <div className="composer">
      <textarea rows="1" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => {if(e.key === "Enter" && !e.shiftKey){e.preventDefault(); ask();}}} placeholder={implicitAuto ? "询问会议、项目、成员或日期" : "询问这些会议中的任何问题"}/>
      <div className="composer-toolbar">
        <button className="composer-icon-button" type="button" title="选择录音范围" onClick={() => openPicker()}><Plus/></button>
        <button className="composer-scope-button" type="button" onClick={() => openPicker()} title={briefText}><FileAudio/><span>{briefTitle}</span></button>
        <span className="composer-context-stat" title="当前回答范围内的会议数、总时长和参会者数"><span><FileAudio/>{effectiveRecordings.length} 场</span><span><Clock3/>{durationLabel(totalDurationMs)}</span><span><UsersRound/>{speakerCount || "—"} 人</span></span>
        <button className="send" disabled={!question.trim() || asking} aria-label="发送问题"><Send/></button>
      </div>
    </div>
    {placement !== "start" && <small>{implicitAuto ? "无明确线索时默认只分析今天；输入“全部会议”、具体项目、成员或日期可改变范围。" : "回答由所选会议转写和纪要生成，请结合右侧原文引用核对。"}</small>}
  </form>;
  return <section className={`chat-workspace ${hasMessages ? "has-messages" : "is-empty"}`}>
    <div className="chat-scroll">{hasMessages ? <div className="messages">{messages.map(m => <article className={m.scopeChange ? "scope-change" : ""} key={m.id}><div className="question">{m.question}</div><div className="answer"><span><Bot/></span>{m.pending ? <p className="thinking"><LoaderCircle/>正在分析所选会议…</p> : <div>{m.scopeLabel && <div className="answer-scope">本次范围：{m.scopeLabel} · {(m.recordingIds || []).length} 场会议</div>}<MarkdownAnswer text={m.answer}/>{m.warning && <div className="answer-warning">{m.warning}</div>}{m.citations?.length > 0 && <div className="citations">{m.citations.map((c,i) => <button key={`${c.segmentId || c.recordingId}-${i}`} onClick={() => cite(c)} title={c.text || "查看原文"}><Play/> {c.recordingName || c.name || `录音来源 ${i+1}`} {Number.isFinite(c.startMs) && `· ${duration(c.startMs)}`}</button>)}</div>}</div>}</div></article>)}</div> : <div className="empty-chat"><div className="chat-start-shell"><div className="chat-start-card"><h1>要从哪段会议开始？</h1>{renderComposer("start")}<div className="starter-list">{starters.map(x => <button key={x} onClick={() => setQuestion(x)}><MessageSquareText/>{x}</button>)}<button className="empty-picker-button" onClick={() => openPicker()}><Plus/>手动选择录音</button></div></div></div></div>}</div>
    {hasMessages && renderComposer("docked")}
  </section>;
}
function MarkdownAnswer({ text = "" }) {
  const blocks = [];
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let list = null;
  const flush = () => { if (list?.items.length) blocks.push(list); list = null; };
  const tableCells = (raw = "") => {
    const line = raw.trim();
    if (!line.includes("|")) return [];
    return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const header = tableCells(line);
    const divider = tableCells(lines[lineIndex + 1] || "");
    const tableStart = header.length >= 2 && divider.length === header.length && divider.every(cell => /^:?-{3,}:?$/.test(cell));
    if (tableStart) {
      flush();
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const cells = tableCells(lines[lineIndex]);
        if (cells.length !== header.length) break;
        rows.push(cells);
        lineIndex += 1;
      }
      lineIndex -= 1;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.、]\s+(.+)$/);
    if (heading) { flush(); blocks.push({ type: "heading", text: heading[2] }); }
    else if (bullet || ordered) { const type = bullet ? "ul" : "ol"; if (!list || list.type !== type) { flush(); list = { type, items: [] }; } list.items.push((bullet || ordered)[1]); }
    else { flush(); blocks.push({ type: "p", text: line }); }
  }
  flush();
  return <div className="markdown-answer">{blocks.map((block, index) => block.type === "heading" ? <h3 key={index}>{inlineText(block.text)}</h3> : block.type === "ul" ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{inlineText(item)}</li>)}</ul> : block.type === "ol" ? <ol key={index}>{block.items.map((item, i) => <li key={i}>{inlineText(item)}</li>)}</ol> : block.type === "table" ? <div className="markdown-table-scroll" key={index}><table><thead><tr>{block.header.map((cell, i) => <th key={i}>{inlineText(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineText(cell)}</td>)}</tr>)}</tbody></table></div> : <p key={index}>{inlineText(block.text)}</p>)}</div>;
}
function inlineText(text) { return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>); }

function DashboardWorkspace({ recordings, folderMap, onOpenPicker, onOpenChat }) {
  const available = recordings.filter(recording => !recording.deletedAt);
  const today = available.filter(recording => isToday(recording.createdAt));
  const transcribed = available.filter(recording => recording.transcript?.length);
  const summarized = available.filter(recording => recording.summary);
  const totalDurationMs = available.reduce((sum, recording) => sum + Number(recording.durationMs || 0), 0);
  const actionItems = available.flatMap(recording => (recording.summary?.actionItems || []).map(item => ({ ...item, recording })));
  const unassignedActions = actionItems.filter(item => !String(item.owner || "").trim() || item.owner === "待认领");
  const projects = projectGroups(available, folderMap);
  const recent = [...available].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 6);
  const riskPattern = /风险|消防|质量|安全|整改|延期|渗漏/;
  const attention = recent.filter(recording => riskPattern.test(`${recording.tag || ""} ${recording.name || ""} ${recording.summary?.overview || ""}`)).slice(0, 3);
  const dayBuckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const count = available.filter(recording => isToday(recording.createdAt, date)).length;
    return { key: date.toISOString(), label: index === 6 ? "今天" : `${date.getMonth() + 1}/${date.getDate()}`, count };
  });
  const maxDaily = Math.max(1, ...dayBuckets.map(day => day.count));
  const maxProject = Math.max(1, ...projects.map(project => project.count));
  const metrics = [
    { label: "全部录音", value: available.length, unit: "场", Icon: AudioLines, tone: "neutral" },
    { label: "今日新增", value: today.length, unit: "场", Icon: CalendarPlus, tone: "blue" },
    { label: "已转写", value: available.length ? Math.round(transcribed.length / available.length * 100) : 0, unit: "%", Icon: CheckCircle2, tone: "green" },
    { label: "累计时长", value: durationLabel(totalDurationMs), unit: "", Icon: Timer, tone: "amber" },
    { label: "会议待办", value: actionItems.length, unit: "项", Icon: ListChecks, tone: unassignedActions.length ? "red" : "neutral" },
  ];
  return <section className="dashboard-workspace">
    <header className="dashboard-head"><div><small>数据总览</small><h1>会议工作台</h1><p>{available.length} 场会议 · {projects.length} 个项目 · {summarized.length} 场已有纪要</p></div><button onClick={onOpenChat}><MessageSquareText/>进入智能问答</button></header>
    <div className="dashboard-metrics">{metrics.map(({ label, value, unit, Icon, tone }) => <div className={`dashboard-metric tone-${tone}`} key={label}><span><Icon/></span><div><small>{label}</small><strong>{value}<em>{unit}</em></strong></div></div>)}</div>
    <div className="dashboard-layout">
      <section className="dashboard-section activity-section"><header><div><small>会议变化</small><h2>近 7 天新增</h2></div><strong>{dayBuckets.reduce((sum, day) => sum + day.count, 0)} 场</strong></header><div className="activity-chart" aria-label="近七天新增会议柱状图">{dayBuckets.map(day => <div className="activity-day" key={day.key} title={`${day.label}新增 ${day.count} 场会议`}><span>{day.count || ""}</span><i style={{ height: `${Math.max(day.count ? 14 : 3, day.count / maxDaily * 88)}%` }}/><small>{day.label}</small></div>)}</div></section>
      <section className="dashboard-section action-section"><header><div><small>执行情况</small><h2>待办概况</h2></div><ListChecks/></header><dl><div><dt>全部待办</dt><dd>{actionItems.length}</dd></div><div><dt>待认领</dt><dd className={unassignedActions.length ? "warn" : ""}>{unassignedActions.length}</dd></div><div><dt>已明确负责人</dt><dd>{Math.max(0, actionItems.length - unassignedActions.length)}</dd></div></dl>{attention.length > 0 && <div className="attention-list"><strong><AlertTriangle/>近期重点</strong>{attention.map(recording => <button key={recording.id} onClick={() => onOpenPicker({ query: recording.name })}><span>{recording.name}</span><ChevronRight/></button>)}</div>}</section>
      <section className="dashboard-section project-section"><header><div><small>会议分布</small><h2>项目概览</h2></div><button onClick={() => onOpenPicker()}>查看全部</button></header><div className="project-ranking">{projects.slice(0, 6).map(project => <button key={project.key} onClick={() => onOpenPicker({ filters: { project: project.name } })}><div><strong>{project.name}</strong><span>{project.meta}</span></div><em>{project.count} 场</em><i><b style={{ width: `${project.count / maxProject * 100}%` }}/></i></button>)}</div></section>
      <section className="dashboard-section recent-section"><header><div><small>最近更新</small><h2>最近会议</h2></div><Clock3/></header><div className="dashboard-recent-list">{recent.map(recording => <button key={recording.id} onClick={() => onOpenPicker({ query: recording.name })}><span className="recent-status"><FileAudio/></span><div><strong>{recording.name}</strong><small>{dateText(recording.createdAt)} · {recording.tag || "未分类"}</small></div><em>{statusText(recording)}</em><ChevronRight/></button>)}</div></section>
    </div>
  </section>;
}

function ManagementWorkspace({ type, recordings, folderMap, onOpenPicker }) {
  const groups = useMemo(() => type === "projects" ? projectGroups(recordings, folderMap) : memberGroups(recordings), [type, recordings, folderMap]);
  return <section className="management-workspace"><div className="management-head"><small>数据管理</small><h2>{type === "projects" ? "项目与分类" : "成员与部门"}</h2><p>{type === "projects" ? "按项目和录音分类查看会议范围，点击卡片即可进入录音选择器。" : "按上传人/发言人聚合会议，点击成员即可筛选相关录音。"}</p></div><div className="management-grid">{groups.map(group => <button key={group.key} className="management-card" onClick={() => onOpenPicker(type === "projects" ? { filters: { project: group.name } } : { filters: { uploader: group.name } })}><span>{type === "projects" ? <FolderKanban/> : <UsersRound/>}</span><div><strong>{group.name}</strong><small>{group.meta}</small></div><em>{group.count} 条录音</em></button>)}</div>{!groups.length && <div className="picker-empty">暂无可管理的数据</div>}</section>;
}
function projectGroups(recordings, folderMap) { const map = new Map(); for (const r of recordings) { const name = projectName(r, folderMap); const current = map.get(name) || { key: name, name, count: 0, tags: new Set() }; current.count += 1; current.tags.add(recordingCategory(r)); map.set(name, current); } return [...map.values()].map(g => ({ ...g, meta: `${g.tags.size} 个分类 · ${[...g.tags].slice(0, 3).join("、")}` })).sort((a,b) => b.count - a.count); }
function memberGroups(recordings) { const map = new Map(); for (const r of recordings) { const names = recordingMemberNames(r); for (const name of names.length ? names : ["未识别成员"]) { const current = map.get(name) || { key: name, name, count: 0, departments: new Set(), meetings: new Set() }; current.count += 1; current.departments.add(r.uploaderName === name ? recordingDepartment(r) : "部门未配置"); current.meetings.add(r.name); map.set(name, current); } } return [...map.values()].map(g => ({ ...g, meta: `${[...g.departments].join("、")} · ${g.meetings.size} 场会议` })).sort((a,b) => b.count - a.count); }

function Inspector({ active, tab, setTab, setRightOpen, highlightedSegmentKey = "" }) {
  return <aside className="right-panel"><header className="inspector-header"><div><small>上下文</small><strong>{active?.name || "详细信息"}</strong></div><button className="icon-button" onClick={() => setRightOpen(false)} title="关闭详细信息"><X/></button></header>{active ? <><div className="audio-card"><button onClick={() => new Audio(active.audioUrl).play().catch(()=>{})}><Play/></button><div><strong>{active.name}</strong><span>{duration(active.durationMs)} · {active.speakers?.length || 1} 位发言人</span></div></div><div className="meta"><span><Clock3/>{dateText(active.createdAt)}</span><span><Tag/>{active.tag || "未分类"}</span><span>{statusText(active)}</span></div><nav className="tabs">{TABS.map(([id,label,Icon]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}><Icon/>{label}</button>)}</nav><div className="inspector">
    {tab === "summary" && (active.summary ? <div className="summary"><section><h3>会议概览</h3><p>{active.summary.overview || "暂无概览"}</p></section><section><h3>关键结论</h3><ul>{active.summary.keyPoints?.map((x,i)=><li key={i}>{x.title || x.text || String(x)}</li>)}</ul></section><section><h3>待办事项</h3>{active.summary.actionItems?.length ? active.summary.actionItems.map((x,i)=><div className="todo" key={i}><span>{i+1}</span><p>{x.task || x.text}<small>{x.owner || "待认领"}</small></p></div>) : <p>暂无待办事项</p>}</section></div> : <Empty icon={Sparkles} title="尚未生成会议总结" text="可在录音详情中发起智能总结"/>)}
    {tab === "outline" && (active.summary?.chapters?.length ? <div className="outline">{active.summary.chapters.map((x,i)=><button key={i}><span>{duration(x.startMs)}</span><div><strong>{x.title}</strong><p>{x.summary}</p></div></button>)}</div> : <Empty icon={ClipboardList} title="暂无内容提纲" text="总结生成后将在这里显示章节"/>)}
    {tab === "transcript" && (active.transcript?.length ? <div className="transcript">{active.transcript.map(x => { const key = segmentDomKey(x); return <button key={key} className={highlightedSegmentKey === key ? "active-citation" : ""} data-segment-key={key} data-start-ms={x.startMs} onClick={() => {const a = new Audio(active.audioUrl); a.currentTime=x.startMs/1000; a.play().catch(()=>{});}}><span>{duration(x.startMs)}</span><div><strong>{x.speakerName}</strong><p>{x.text}</p></div></button>; })}</div> : <Empty icon={FileText} title="暂无转写原文" text="请等待转写任务完成"/>)}
  </div></> : <Empty icon={FileAudio} title="未选择录音" text="从录音范围选择一条录音查看详情"/>}</aside>;
}
function Empty({icon:Icon,title,text}) { return <div className="inspector-empty"><Icon/><strong>{title}</strong><span>{text}</span></div>; }
function AdminLogin({ theme, configured, onLogin, notice = "" }) {
  const [username, setUsername] = useState("admin"), [password, setPassword] = useState(""), [submitting, setSubmitting] = useState(false), [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); if (!configured || submitting) return; setSubmitting(true); setError(""); try { await onLogin({ username, password }); } catch (e) { setError(apiErrorMessage(e)); } finally { setSubmitting(false); } }
  return <main className={`admin-shell theme-${theme} admin-login-shell`}><section className="admin-login-card"><span className="login-mark"><ShieldCheck/></span><p>Admin Access</p><h1>登录录音中台</h1><span>管理员可查看公司录音、原文、纪要，并向会议知识库提问。</span>{!configured && <div className="login-alert">管理员密码尚未配置。请在服务器 .env 中设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256。</div>}{notice && !error && <div className="login-error">{notice}</div>}<form onSubmit={submit}><label>账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"/></label><label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label>{error && <div className="login-error">{error}</div>}<button disabled={!configured || submitting || !username.trim() || !password}>{submitting ? "登录中…" : "进入中台"}</button></form></section></main>;
}
const rootElement = document.getElementById("root");
const appRoot = rootElement.__adminReactRoot || (rootElement.__adminReactRoot = createRoot(rootElement));
appRoot.render(<StrictMode><AdminApp/></StrictMode>);
