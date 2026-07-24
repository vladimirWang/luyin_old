export function sortMessagesAscending(messages = []) {
  return [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

export function normalizeRecordingIds(ids = []) {
  return [...new Set((ids || []).filter(Boolean))].sort();
}

export function messageRecordingIds(message) {
  return normalizeRecordingIds(
    Array.isArray(message?.recordingIds)
      ? message.recordingIds
      : message?.recordingId
        ? [message.recordingId]
        : [],
  );
}

export function isSameRecordingScope(left = [], right = []) {
  const normalizedLeft = normalizeRecordingIds(left);
  const normalizedRight = normalizeRecordingIds(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

export function mergeQaMessages(...groups) {
  const merged = new Map();
  groups.flat().forEach((message) => {
    if (!message?.id || message.deletedAt) return;
    const previous = merged.get(message.id);
    const scope = messageRecordingIds(message).length
      ? messageRecordingIds(message)
      : messageRecordingIds(previous);
    const next = { ...(previous || {}), ...message };
    merged.set(message.id, scope.length ? { ...next, recordingIds: scope } : next);
  });
  return sortMessagesAscending([...merged.values()]);
}
