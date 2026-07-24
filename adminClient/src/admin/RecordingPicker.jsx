import React, { useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { ArrowLeft, Check, CheckCircle2, FileAudio, LayoutGrid, List, LoaderCircle, Search, SlidersHorizontal, X } from "lucide-react";
import { projectName, recordingCategory, recordingMemberNames, recordingUploaderName } from "./recordingTaxonomy.js";

const EMPTY_FILTERS = { project: "", category: "", uploader: "", status: "", dateFrom: "", dateTo: "" };
const FILTER_LABELS = { project: "项目", category: "分类", uploader: "上传人", status: "状态", dateFrom: "开始日期", dateTo: "结束日期" };
const uniq = (items) => [...new Set(items.filter(Boolean))];
const duration = (ms = 0) => { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
const dateText = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "未知时间";
const statusText = (r) => r.status === "failed" ? "处理失败" : !r.transcript?.length ? "等待转写" : r.summaryStatus === "ready" ? "分析完成" : ["queued", "generating"].includes(r.summaryStatus) ? "正在总结" : "已转写";

export default function RecordingPicker({ recordings, folders, committedIds, activeId, setActiveId, onCancel, onConfirm, loading, initialFilters = EMPTY_FILTERS, initialQuery = "" }) {
  const rootRef = useRef(null), drawerRef = useRef(null), resultsRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState(() => [...committedIds]);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...initialFilters })), [draftFilters, setDraftFilters] = useState(() => ({ ...EMPTY_FILTERS, ...initialFilters })), [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("admin-picker-view") || "list");
  const reduceMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders]);
  const options = useMemo(() => ({
    project: uniq(recordings.map((r) => projectName(r, folderMap))),
    category: uniq(recordings.map(recordingCategory)),
    uploader: uniq(recordings.flatMap(recordingMemberNames)),
    status: uniq(recordings.map(statusText)),
  }), [recordings, folderMap]);
  const shown = useMemo(() => recordings.filter((r) => {
    const text = [r.name, r.tag, r.uploaderName, r.uploaderDepartment, r.speakerName, r.transcriptText, ...recordingMemberNames(r)].join(" ").toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filters.project && projectName(r, folderMap) !== filters.project) return false;
    if (filters.category && recordingCategory(r) !== filters.category) return false;
    if (filters.uploader && !recordingMemberNames(r).includes(filters.uploader)) return false;
    if (filters.status && statusText(r) !== filters.status) return false;
    const created = new Date(r.createdAt || 0);
    if (filters.dateFrom && created < new Date(`${filters.dateFrom}T00:00:00`)) return false;
    if (filters.dateTo && created > new Date(`${filters.dateTo}T23:59:59`)) return false;
    return true;
  }), [recordings, folderMap, query, filters]);
  const activeFilters = Object.entries(filters).filter(([, value]) => value);

  useEffect(() => { const next = { ...EMPTY_FILTERS, ...initialFilters }; setFilters(next); setDraftFilters(next); setQuery(initialQuery || ''); }, [JSON.stringify(initialFilters), initialQuery]);
  useEffect(() => { localStorage.setItem("admin-picker-view", viewMode); }, [viewMode]);
  useEffect(() => { if (reduceMotion || !rootRef.current) return; const motion = animate(rootRef.current, { opacity: [0, 1], translateY: [6, 0], duration: 210, ease: "out(3)" }); return () => motion.cancel(); }, [reduceMotion]);
  useEffect(() => { if (reduceMotion || !filterOpen || !drawerRef.current) return; const motion = animate(drawerRef.current, { opacity: [0, 1], translateX: [24, 0], duration: 190, ease: "out(3)" }); return () => motion.cancel(); }, [filterOpen, reduceMotion]);
  useEffect(() => { if (reduceMotion || !resultsRef.current) return; const motion = animate(resultsRef.current.querySelectorAll(".picker-record"), { opacity: [.55, 1], translateY: [4, 0], delay: stagger(12, { start: 20 }), duration: 180, ease: "out(2)" }); return () => motion.cancel(); }, [shown.length, viewMode, reduceMotion]);

  function leave(commit) {
    const finish = () => commit ? onConfirm(selectedIds) : onCancel();
    if (reduceMotion || !rootRef.current) return finish();
    animate(rootRef.current, { opacity: [1, 0], translateY: [0, 5], duration: 150, ease: "in(2)", onComplete: finish });
  }
  function toggle(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setActiveId(id);
    if (!reduceMotion) requestAnimationFrame(() => animate(`[data-recording-id="${id}"] .picker-checkbox`, { scale: [.82, 1], duration: 180, ease: "out(4)" }));
  }
  function selectAll() {
    const ids = shown.map((r) => r.id);
    setSelectedIds((current) => ids.every((id) => current.includes(id)) ? current.filter((id) => !ids.includes(id)) : uniq([...current, ...ids]));
  }
  function clearFilter(key) { setFilters((current) => ({ ...current, [key]: "" })); setDraftFilters((current) => ({ ...current, [key]: "" })); }

  return <section ref={rootRef} className="recording-picker">
    <div className="picker-toolbar">
      <button className="picker-back" onClick={() => leave(false)}><ArrowLeft/>返回问答</button>
      <label className="picker-search"><Search/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索录音、发言人或转写内容"/></label>
      <button className={`filter-trigger ${filterOpen || activeFilters.length ? "active" : ""}`} onClick={() => { setDraftFilters(filters); setFilterOpen((open) => !open); }}><SlidersHorizontal/>筛选{activeFilters.length > 0 && <em>{activeFilters.length}</em>}</button>
      <div className="view-switch"><button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="列表视图"><List/></button><button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="卡片视图"><LayoutGrid/></button></div>
    </div>
    {activeFilters.length > 0 && <div className="filter-chips">{activeFilters.map(([key, value]) => <button key={key} onClick={() => clearFilter(key)}><span>{FILTER_LABELS[key]}</span>{value}<X/></button>)}<button className="clear-filters" onClick={() => { setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); }}>清除全部</button></div>}
    <div className="picker-actions"><span>显示 {shown.length} 条录音 · 已选 {selectedIds.length} 条</span><div><button onClick={selectAll}><CheckCircle2/>全选当前结果</button><button onClick={() => setSelectedIds([])}>清空选择</button></div></div>
    <div ref={resultsRef} className={`picker-results ${viewMode}`}>
      {viewMode === "list" && shown.length > 0 && <div className="picker-list-head"><span>录音</span><span>项目 / 分类</span><span>上传人</span><span>时间</span><span>时长</span><span>状态</span></div>}
      {loading ? <div className="picker-empty"><LoaderCircle/>正在读取录音</div> : shown.length ? shown.map((r) => <RecordingOption key={r.id} recording={r} selected={selectedIds.includes(r.id)} focused={activeId === r.id} folderMap={folderMap} viewMode={viewMode} onClick={() => toggle(r.id)}/>) : <div className="picker-empty">没有符合条件的录音</div>}
    </div>
    <div className="picker-selection-bar"><div><span className="selection-stack"><FileAudio/><b>{selectedIds.length}</b></span><p><strong>已选择 {selectedIds.length} 条录音</strong><small>确认后将作为后续问答的分析范围</small></p></div><div><button onClick={() => leave(false)}>取消</button><button className="primary" onClick={() => leave(true)}>{selectedIds.length ? `确定使用 ${selectedIds.length} 条录音` : "使用智能范围"}</button></div></div>
    {filterOpen && <div className="filter-drawer-layer"><button className="drawer-scrim" aria-label="关闭筛选" onClick={() => setFilterOpen(false)}/><aside ref={drawerRef} className="filter-drawer"><header><div><small>录音范围</small><strong>筛选录音</strong></div><button className="icon-button" onClick={() => setFilterOpen(false)}><X/></button></header><div className="filter-form"><FilterSelect label="项目分类" value={draftFilters.project} options={options.project} onChange={(value) => setDraftFilters((current) => ({ ...current, project: value }))}/><FilterSelect label="录音分类" value={draftFilters.category} options={options.category} onChange={(value) => setDraftFilters((current) => ({ ...current, category: value }))}/><FilterSelect label="上传人" value={draftFilters.uploader} options={options.uploader} onChange={(value) => setDraftFilters((current) => ({ ...current, uploader: value }))}/><FilterSelect label="处理状态" value={draftFilters.status} options={options.status} onChange={(value) => setDraftFilters((current) => ({ ...current, status: value }))}/><fieldset><legend>录音日期</legend><div className="date-range"><label>开始<input type="date" value={draftFilters.dateFrom} onChange={(e) => setDraftFilters((current) => ({ ...current, dateFrom: e.target.value }))}/></label><label>结束<input type="date" value={draftFilters.dateTo} onChange={(e) => setDraftFilters((current) => ({ ...current, dateTo: e.target.value }))}/></label></div></fieldset></div><footer><button onClick={() => setDraftFilters(EMPTY_FILTERS)}>重置</button><button className="primary" onClick={() => { setFilters(draftFilters); setFilterOpen(false); }}>应用筛选</button></footer></aside></div>}
  </section>;
}

function RecordingOption({ recording, selected, focused, folderMap, viewMode, onClick }) {
  const uploader = recordingUploaderName(recording);
  return <button data-recording-id={recording.id} className={`picker-record ${selected ? "selected" : ""} ${focused ? "focused" : ""}`} onClick={onClick}><span className="picker-main"><span className="picker-checkbox">{selected && <Check/>}</span><span className="picker-file"><FileAudio/></span><span><strong>{recording.name}</strong>{viewMode === "grid" && <small>{dateText(recording.createdAt)} · {duration(recording.durationMs)}</small>}</span></span><span className="picker-project"><strong>{projectName(recording, folderMap)}</strong><small>{recordingCategory(recording)}</small></span><span>{uploader}</span><span>{dateText(recording.createdAt)}</span><span>{duration(recording.durationMs)}</span><em>{statusText(recording)}</em></button>;
}
function FilterSelect({ label, value, options, onChange }) { return <label className="filter-field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">全部</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
