export function canonicalTencentMeetingWebhookRecordFileIds(payload = {}) {
  const recordFileIds = [];
  const seen = new Set();
  const items = Array.isArray(payload?.payload) ? payload.payload : [];

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const recordingFiles = Array.isArray(item.recording_files) ? item.recording_files : [];
    for (const file of recordingFiles) {
      if (!file || typeof file !== "object" || Array.isArray(file)) continue;
      const recordFileId = typeof file.record_file_id === "string" ? file.record_file_id.trim() : "";
      if (!recordFileId || seen.has(recordFileId)) continue;
      seen.add(recordFileId);
      recordFileIds.push(recordFileId);
    }
  }

  return recordFileIds;
}
