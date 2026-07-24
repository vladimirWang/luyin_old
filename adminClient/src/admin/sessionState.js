export const LEGACY_SESSION_ID = "legacy-session";

export const messageSessionId = (message) => message?.sessionId || LEGACY_SESSION_ID;

export const normalizeIds = (ids) => [
  ...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean)),
];

export function upsertQaSession(sessions, session) {
  const next = [{ ...session, updatedAt: session.updatedAt || new Date().toISOString() }, ...sessions.filter(item => item.id !== session.id)];
  return next.slice(0, 120);
}

export function patchQaSession(sessions, id, patch = {}) {
  const now = new Date().toISOString();
  const existing = sessions.find(item => item.id === id);
  return upsertQaSession(sessions, {
    id,
    title: "新建问答",
    preview: "输入问题后保存",
    count: 0,
    createdAt: now,
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt || now,
  });
}

export function recordingIdsForSession(sessionId, sessions = [], messages = []) {
  const session = sessions.find(item => item.id === sessionId);
  const sessionScope = typeof session?.scope === "string" ? session.scope : session?.scope?.key;
  if (sessionScope) {
    if (sessionScope !== "selected") return [];
    const selectedIds = normalizeIds(session.recordingIds);
    const sessionMessages = messages.filter(message => messageSessionId(message) === sessionId && !message?.scopeChange && !message?.pending);
    const latestSelectedIndex = sessionMessages.findLastIndex(message => message?.scope === "selected");
    const previousAuto = sessionMessages.slice(0, latestSelectedIndex).findLast(message => message?.scope && message.scope !== "selected");
    const previousAutoIds = normalizeIds(previousAuto?.recordingIds);
    const isLegacyAutoLock = previousAutoIds.length === selectedIds.length
      && previousAutoIds.every(id => selectedIds.includes(id));
    return isLegacyAutoLock ? [] : selectedIds;
  }
  if (Array.isArray(session?.recordingIds)) return normalizeIds(session.recordingIds);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (messageSessionId(message) === sessionId && message?.scope === "selected") return normalizeIds(message.recordingIds);
  }
  return [];
}

export function keepKnownRecordingIds(ids, recordings = []) {
  const known = new Set(recordings.map(recording => recording.id));
  return normalizeIds(ids).filter(id => known.has(id));
}

export function recordingIdsAfterAsk(submittedIds = [], responseIds = [], recordings = []) {
  const submitted = normalizeIds(submittedIds);
  if (!submitted.length) return [];
  const confirmed = normalizeIds(responseIds);
  return keepKnownRecordingIds(confirmed.length ? confirmed : submitted, recordings);
}

export function latestResolvedAutoScope(messages = [], recordings = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.scopeChange || message.pending || message.scope === "selected") continue;
    if (!message.scopeLabel && !Array.isArray(message.recordingIds)) continue;
    const recordingIds = keepKnownRecordingIds(message.recordingIds, recordings);
    return {
      scope: message.scope || "",
      label: message.scopeLabel || "智能范围",
      recordingIds,
    };
  }
  return null;
}

export function buildRecentWindows(allMessages, currentMessages, currentSessionId, qaSessions = []) {
  const groups = new Map();
  for (const session of qaSessions) {
    if (!session?.id) continue;
    groups.set(session.id, {
      id: session.id,
      title: session.title || "新建问答",
      titleSource: session.titleSource || "system",
      status: session.status || "active",
      count: 0,
      storedCount: Number(session.count || 0),
      preview: session.preview || "新的问答窗口",
      lastAt: new Date(session.updatedAt || session.createdAt || 0).getTime() || 0,
    });
  }

  const seen = new Set();
  for (const message of [...allMessages, ...currentMessages]) {
    if (!message || message.scopeChange || message.pending || seen.has(message.id)) continue;
    seen.add(message.id);
    const id = messageSessionId(message);
    const current = groups.get(id) || { id, title: "历史问答窗口", status: "active", count: 0, preview: "", lastAt: 0 };
    current.count += 1;
    current.title = ["新建分析", "新建问答", "历史问答窗口"].includes(current.title) ? (message.question || current.title) : current.title;
    current.preview = message.question || current.preview || "未命名问答";
    current.lastAt = Math.max(current.lastAt, new Date(message.createdAt || 0).getTime() || 0);
    groups.set(id, current);
  }

  return [...groups.values()]
    .map(({ storedCount, ...window }) => ({ ...window, count: window.count || storedCount || 0 }))
    .sort((a, b) => (b.id === currentSessionId) - (a.id === currentSessionId) || b.lastAt - a.lastAt);
}
