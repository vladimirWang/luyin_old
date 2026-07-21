const GENERIC_SPEAKER_RE = /^(?:speaker[-_\s]?\d+|说话人\s*\d+)$/i;

const uniq = (items) => [...new Set(items.filter(Boolean))];

export function tagTaxonomy(tag = "") {
  const parts = String(tag).split("/").map((part) => part.trim()).filter(Boolean);
  return {
    project: parts.length > 1 ? parts[0] : "",
    category: parts.length > 1 ? parts.slice(1).join(" / ") : parts[0] || "普通录音",
  };
}

export function projectName(recording, folderMap = new Map()) {
  return folderMap.get(recording.folderId) || recording.projectName || tagTaxonomy(recording.tag).project || "未分类项目";
}

export function recordingCategory(recording) {
  return recording.category || tagTaxonomy(recording.tag).category;
}

export function isGenericSpeakerName(name = "") {
  return !String(name).trim() || GENERIC_SPEAKER_RE.test(String(name).trim());
}

export function inferredMeetingOwner(recording) {
  const match = String(recording.name || "").match(/^([\u4e00-\u9fff]{2,4})(?:的)?(?:快速会议|预定的会议|录制测试会议)/);
  return match?.[1] || "";
}

export function recordingMemberNames(recording) {
  const mappedNames = Object.values(recording.speakerMap || {});
  const speakerNames = recording.speakers?.map((speaker) => speaker.name) || [];
  return uniq([
    recording.uploaderName,
    recording.speakerName,
    ...mappedNames,
    ...speakerNames,
    inferredMeetingOwner(recording),
  ].map((name) => String(name || "").trim()).filter((name) => !isGenericSpeakerName(name)));
}

export function recordingUploaderName(recording) {
  return String(recording.uploaderName || "").trim()
    || inferredMeetingOwner(recording)
    || recordingMemberNames(recording)[0]
    || "未识别上传人";
}

export function recordingDepartment(recording) {
  return String(recording.uploaderDepartment || "").trim() || "部门未配置";
}
