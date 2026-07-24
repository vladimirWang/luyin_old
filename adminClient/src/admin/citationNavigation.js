export function citationJumpMs(citation = {}) {
  const candidates = [citation.startMs, citation.jumpToMs, citation.beginMs, citation.start_ms];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.round(number));
  }
  return 0;
}

export function findNearestTranscriptSegment(segments = [], jumpMs = 0) {
  const target = Math.max(0, Number(jumpMs) || 0);
  return segments
    .filter((segment) => Number.isFinite(Number(segment.startMs)))
    .map((segment) => {
      const startMs = Number(segment.startMs);
      const endMs = Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : startMs;
      const distance = target >= startMs && target <= endMs
        ? 0
        : Math.min(Math.abs(target - startMs), Math.abs(target - endMs));
      return { segment, distance, startMs };
    })
    .sort((a, b) => a.distance - b.distance || a.startMs - b.startMs)[0]?.segment || null;
}

export function findCitationSegment(segments = [], citation = {}) {
  const segmentId = String(citation.segmentId || "").trim();
  if (segmentId) {
    const direct = segments.find((segment) => segment.id === segmentId);
    if (direct) return direct;
  }
  return findNearestTranscriptSegment(segments, citationJumpMs(citation));
}

export function segmentDomKey(segment = {}) {
  const id = segment?.id;
  if (id !== undefined && id !== null && String(id).trim()) return String(id);
  const startMs = segment?.startMs;
  if (startMs !== undefined && startMs !== null && Number.isFinite(Number(startMs))) return String(Math.max(0, Math.round(Number(startMs))));
  return "";
}
