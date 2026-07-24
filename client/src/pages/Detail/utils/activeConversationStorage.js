import { DAILY_BRIEF_ACTIVE_KEY, QA_ACTIVE_MESSAGE_KEY } from "../../../constant.js";

function readJson(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function removeIfCurrent(key, id, field) {
  try {
    const current = readJson(key);
    if (!id || current?.[field] === id) window.localStorage?.removeItem(key);
  } catch {}
}

export function readActiveQaMessageRef() {
  const parsed = readJson(QA_ACTIVE_MESSAGE_KEY);
  return parsed?.id ? parsed : null;
}

export function saveActiveQaMessageRef(message, recordingIds) {
  if (!message?.id) return;
  try {
    window.localStorage?.setItem(
      QA_ACTIVE_MESSAGE_KEY,
      JSON.stringify({
        id: message.id,
        recordingIds,
        createdAt: message.createdAt || new Date().toISOString(),
        pending: Boolean(message.pending),
      }),
    );
  } catch {}
}

export function clearActiveQaMessageRef(id) {
  removeIfCurrent(QA_ACTIVE_MESSAGE_KEY, id, "id");
}

export function readActiveDailyBriefRef() {
  const parsed = readJson(DAILY_BRIEF_ACTIVE_KEY);
  return parsed?.date ? parsed : null;
}

export function saveActiveDailyBriefRef(brief) {
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

export function clearActiveDailyBriefRef(date) {
  removeIfCurrent(DAILY_BRIEF_ACTIVE_KEY, date, "date");
}
