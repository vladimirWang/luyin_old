import path from "node:path";

const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function iso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function nullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function derivedFileStatus(row = {}) {
  if (row.fileStatus) return row.fileStatus;
  if (row.storageKey || row.storagePath) return "ready";
  return row.status === "failed" ? "failed" : "pending";
}

function derivedTranscriptStatus(row = {}) {
  if (row.transcriptStatus) return row.transcriptStatus;
  if (row.transcribedAt || row.transcriptSource === "tencent-meeting") return "ready";
  if (row.transcriptSource === "tencent-meeting-unavailable") return "unavailable";
  if (row.status === "failed") return "failed";
  if (row.status === "transcribing" || row.status === "processing") return "transcribing";
  return "waiting";
}

export function recordingFromPrisma(row = {}) {
  return {
    id: row.id,
    userId: row.userId || "",
    seq: Number(row.seq || 0),
    name: row.name || "",
    speakerName: row.speakerName || "说话人 1",
    speakerMap: parseJson(row.speakerMapJson, {}),
    ownerClientId: row.ownerClientId || "",
    ownerName: row.ownerName || "",
    shared: row.shared !== false,
    sharedAt: iso(row.sharedAt),
    detectedLanguage: row.detectedLanguage || "",
    translationText: row.translationText || "",
    tag: row.tag || "",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    durationMs: Number(row.durationMs || 0n),
    mimeType: row.mimeType || "audio/mpeg",
    size: Number(row.fileSize || 0n),
    fileName: row.fileName || path.basename(row.storageKey || ""),
    storagePath: row.storageKey || "",
    transcriptPath: row.transcriptPath || "",
    transcriptRawPath: row.transcriptRawPath || "",
    transcriptCorrectedPath: row.transcriptCorrectedPath || "",
    transcriptionMetaPath: row.transcriptionMetaPath || "",
    favorite: Boolean(row.favorite),
    folderId: row.folderId || null,
    deletedAt: iso(row.deletedAt) || null,
    status: row.status || "uploaded",
    fileStatus: derivedFileStatus(row),
    transcriptStatus: derivedTranscriptStatus(row),
    errorMessage: row.errorMessage || "",
    transcriptProvider: row.transcriptProvider || "",
    transcriptSource: row.transcriptSource || "",
    transcriptionStartedAt: iso(row.transcriptionStartedAt),
    transcribedAt: iso(row.transcribedAt),
    meetingOutline: parseJson(row.meetingOutlineJson, null),
    meetingOutlineStatus: row.meetingOutlineStatus || "",
    meetingOutlineError: row.meetingOutlineError || "",
    meetingOutlineStartedAt: iso(row.meetingOutlineStartedAt),
    meetingOutlinedAt: iso(row.meetingOutlinedAt),
    source: row.source || "wecom-h5",
    tencentMeetingCreatorUserid: row.tencentMeetingCreatorUserid || "",
    tencentMeetingMeetingId: row.tencentMeetingMeetingId || "",
    tencentMeetingMeetingCode: row.tencentMeetingMeetingCode || "",
    tencentMeetingMeetingRecordId: row.tencentMeetingMeetingRecordId || "",
    tencentMeetingSourceKind: row.tencentMeetingSourceKind || "",
    userAgent: row.userAgent || "",
    audioUrl: `${process.env.SERVER_URL}/static${row.audioUrl}`,
  };
}

export function transcriptSegmentFromPrisma(row = {}) {
  return {
    id: row.id,
    recordingId: row.recordingId,
    startMs: Number(row.startMs || 0n),
    endMs: Number(row.endMs || 0n),
    text: row.text || "",
    confidence: Number(row.confidence || 0),
    speakerKey: row.speakerLabel || "speaker-1",
    createdAt: iso(row.createdAt),
  };
}

export async function listRecordingsWithPrisma() {
  const rows = await prisma.recording.findMany({ orderBy: { seq: "asc" } });
  return rows.map(recordingFromPrisma);
}

export async function listTranscriptSegmentsWithPrisma() {
  const rows = await prisma.transcriptSegment.findMany({ orderBy: [{ recordingId: "asc" }, { startMs: "asc" }] });
  return rows.map(transcriptSegmentFromPrisma);
}

function recordingQuestionReferencesRecording(question = {}, recordingId = "") {
  if (question.recordingId === recordingId) return true;
  try {
    const recordingIds = JSON.parse(question.recordingIdsJson || "[]");
    return Array.isArray(recordingIds) && recordingIds.includes(recordingId);
  } catch {
    return false;
  }
}

export async function permanentlyDeleteRecordingDataWithPrisma(recordingId) {
  return prisma.$transaction(async (tx) => {
    const questionCandidates = await tx.recordingQuestion.findMany({
      where: {
        OR: [
          { recordingId },
          { recordingIdsJson: { contains: recordingId } },
        ],
      },
      select: {
        id: true,
        recordingId: true,
        recordingIdsJson: true,
      },
    });
    const questionIds = questionCandidates
      .filter((question) => recordingQuestionReferencesRecording(question, recordingId))
      .map((question) => question.id);

    const deletedQuestions = questionIds.length
      ? await tx.recordingQuestion.deleteMany({ where: { id: { in: questionIds } } })
      : { count: 0 };
    const deletedSegments = await tx.transcriptSegment.deleteMany({ where: { recordingId } });
    const deletedRecording = await tx.recording.deleteMany({ where: { id: recordingId } });
    if (deletedRecording.count !== 1) {
      throw new Error(`Recording ${recordingId} disappeared during permanent deletion.`);
    }

    return {
      recordings: deletedRecording.count,
      transcriptSegments: deletedSegments.count,
      recordingQuestions: deletedQuestions.count,
    };
  });
}

function recordingPrismaScalarData(recording = {}) {
  return {
    seq: Number(recording.seq || 0),
    name: recording.name || "",
    speakerName: recording.speakerName || "说话人 1",
    speakerMapJson: JSON.stringify(recording.speakerMap || {}),
    ownerClientId: recording.ownerClientId || "",
    ownerName: recording.ownerName || "",
    shared: recording.shared !== false,
    sharedAt: nullableDate(recording.sharedAt),
    detectedLanguage: recording.detectedLanguage || "",
    translationText: recording.translationText || "",
    tag: recording.tag || "",
    durationMs: BigInt(Math.max(0, Math.round(Number(recording.durationMs || 0)))),
    mimeType: recording.mimeType || "audio/mpeg",
    fileSize: BigInt(Math.max(0, Math.round(Number(recording.size || 0)))),
    fileName: recording.fileName || path.basename(recording.storagePath || ""),
    storageProvider: "local",
    storageKey: recording.storagePath || "",
    transcriptPath: recording.transcriptPath || "",
    transcriptRawPath: recording.transcriptRawPath || "",
    transcriptCorrectedPath: recording.transcriptCorrectedPath || "",
    transcriptionMetaPath: recording.transcriptionMetaPath || "",
    status: recording.status || "uploaded",
    fileStatus: recording.fileStatus || derivedFileStatus(recording),
    transcriptStatus: recording.transcriptStatus || derivedTranscriptStatus(recording),
    favorite: Boolean(recording.favorite),
    deletedAt: nullableDate(recording.deletedAt),
    transcriptProvider: recording.transcriptProvider || "",
    transcriptSource: recording.transcriptSource || "",
    transcriptionStartedAt: nullableDate(recording.transcriptionStartedAt),
    transcribedAt: nullableDate(recording.transcribedAt),
    meetingOutlineJson: recording.meetingOutline ? JSON.stringify(recording.meetingOutline) : null,
    meetingOutlineStatus: recording.meetingOutlineStatus || "",
    meetingOutlineError: recording.meetingOutlineError || "",
    meetingOutlineStartedAt: nullableDate(recording.meetingOutlineStartedAt),
    meetingOutlinedAt: nullableDate(recording.meetingOutlinedAt),
    source: recording.source || "wecom-h5",
    tencentMeetingCreatorUserid: recording.tencentMeetingCreatorUserid || "",
    tencentMeetingMeetingId: recording.tencentMeetingMeetingId || "",
    tencentMeetingMeetingCode: recording.tencentMeetingMeetingCode || "",
    tencentMeetingMeetingRecordId: recording.tencentMeetingMeetingRecordId || "",
    tencentMeetingSourceKind: recording.tencentMeetingSourceKind || "",
    errorMessage: recording.errorMessage || "",
    userAgent: recording.userAgent || "",
    updatedAt: nullableDate(recording.updatedAt) || new Date(),
  };
}

function recordingPrismaCreateData(recording = {}) {
  return {
    ...recordingPrismaScalarData(recording),
    createdAt: nullableDate(recording.createdAt) || new Date(),
    ...(recording.userId ? { user: { connect: { id: recording.userId } } } : {}),
    ...(recording.folderId ? { folder: { connect: { id: recording.folderId } } } : {}),
  };
}

function recordingPrismaUpdateData(recording = {}) {
  return {
    ...recordingPrismaScalarData(recording),
    user: recording.userId ? { connect: { id: recording.userId } } : { disconnect: true },
    folder: recording.folderId ? { connect: { id: recording.folderId } } : { disconnect: true },
  };
}

function transcriptSegmentPrismaData(segment = {}) {
  return {
    recordingId: segment.recordingId,
    startMs: BigInt(Math.max(0, Math.round(Number(segment.startMs || 0)))),
    endMs: BigInt(Math.max(0, Math.round(Number(segment.endMs || 0)))),
    text: segment.text || "",
    confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
    speakerLabel: segment.speakerKey || "speaker-1",
    createdAt: nullableDate(segment.createdAt) || new Date(),
  };
}

function comparable(value) {
  return JSON.stringify(value);
}

export async function persistRecordingChangesWithPrisma(beforeRecordings = [], afterRecordings = [], beforeSegments = [], afterSegments = []) {
  const beforeRecordingMap = new Map(beforeRecordings.map((recording) => [recording.id, recording]));
  const afterRecordingMap = new Map(afterRecordings.map((recording) => [recording.id, recording]));
  const beforeSegmentMap = new Map(beforeSegments.map((segment) => [segment.id, segment]));
  const afterSegmentMap = new Map(afterSegments.map((segment) => [segment.id, segment]));

  await prisma.$transaction(async (tx) => {
    const removedSegmentIds = [...beforeSegmentMap.keys()].filter((id) => !afterSegmentMap.has(id));
    if (removedSegmentIds.length) await tx.transcriptSegment.deleteMany({ where: { id: { in: removedSegmentIds } } });

    for (const recording of afterRecordings) {
      const before = beforeRecordingMap.get(recording.id);
      if (before && comparable(before) === comparable(recording)) continue;
      await tx.recording.upsert({
        where: { id: recording.id },
        create: { id: recording.id, ...recordingPrismaCreateData(recording) },
        update: recordingPrismaUpdateData(recording),
      });
    }

    for (const segment of afterSegments) {
      const before = beforeSegmentMap.get(segment.id);
      if (before && comparable(before) === comparable(segment)) continue;
      const data = transcriptSegmentPrismaData(segment);
      await tx.transcriptSegment.upsert({
        where: { id: segment.id },
        create: { id: segment.id, ...data },
        update: data,
      });
    }

    const removedRecordingIds = [...beforeRecordingMap.keys()].filter((id) => !afterRecordingMap.has(id));
    if (removedRecordingIds.length) {
      await tx.transcriptSegment.deleteMany({ where: { recordingId: { in: removedRecordingIds } } });
      await tx.recording.deleteMany({ where: { id: { in: removedRecordingIds } } });
    }
  });
}
