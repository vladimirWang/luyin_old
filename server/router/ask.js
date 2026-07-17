import express from "express";
import { canReadRecording } from "../utils/common.mjs";
import { requestClientIdBetter } from "../utils/recordings.js";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.post("/", async (request, response) => {
  const {
    loadDb,
    findReusableQaMessage,
    publicQaMessage,
    scheduleQaJob,
    crypto,
    persistQaAttachments,
    cacheQaMessage,
    persistQaMessageSnapshot,
  } = dependencies;

  const clientId = requestClientIdBetter(request);
  const rawQuestion = String(request.body?.question || "").trim();
  const recordingId = String(request.body?.recordingId || "").trim();
  const recordingIds = Array.isArray(request.body?.recordingIds)
    ? [...new Set(request.body.recordingIds.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
  const images = Array.isArray(request.body?.images) ? request.body.images.slice(0, 3) : [];
  const attachments = Array.isArray(request.body?.attachments)
    ? request.body.attachments.slice(0, 6).map((item) => ({
        kind: String(item?.kind || "file").slice(0, 24),
        name: String(item?.name || "附件").slice(0, 120),
        type: String(item?.type || "").slice(0, 120),
        text: String(item?.text || "").slice(0, 6000),
        url: String(item?.url || "").slice(0, 500),
        dataUrl: String(item?.dataUrl || ""),
      }))
    : [];
  const question =
    rawQuestion ||
    (images.length > 0 || attachments.length > 0
      ? `请结合录音内容分析这些附件：${[
          ...images.map((item) => `图片：${String(item?.name || "未命名图片")}`),
          ...attachments.map((item) => `${item.kind === "audio" ? "录音" : item.kind === "location" ? "地址" : "文件"}：${item.name}`),
        ].join("、")}`
      : "");

  if (!question) {
    response.status(400).json({ error: "问题不能为空" });
    return;
  }

  const db = await loadDb();
  const activeRecordings = db.recordings.filter((item) => !item.deletedAt && canReadRecording(item, clientId));
  const selectedIds = recordingIds.length > 0 ? recordingIds : recordingId ? [recordingId] : [];
  const targetRecordings =
    selectedIds.length > 0 ? activeRecordings.filter((item) => selectedIds.includes(item.id)) : activeRecordings;
  const visibleSelectedIds = selectedIds.length > 0 ? targetRecordings.map((item) => item.id) : [];

  if (selectedIds.length > 0 && targetRecordings.length === 0) {
    response.status(404).json({ error: "录音不存在" });
    return;
  }

  const canReuseQa = images.length === 0 && attachments.length === 0 && request.body?.force !== true && request.body?.regenerate !== true;
  if (canReuseQa) {
    const reusable = findReusableQaMessage(db, {
      clientId,
      recordingIds: visibleSelectedIds,
      question,
    });
    if (reusable) {
      const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
      if (reusable.pending || reusable.status === "pending") scheduleQaJob(reusable.id);
      response.json({ message: publicQaMessage(reusable, recordingMap), reused: true });
      return;
    }
  }

  const messageId = crypto.randomUUID();
  const storedAttachments = await persistQaAttachments(messageId, images, attachments);
  const createdAt = new Date().toISOString();

  const result = cacheQaMessage({
    id: messageId,
    recordingId: visibleSelectedIds.length === 1 ? visibleSelectedIds[0] : null,
    recordingIds: visibleSelectedIds,
    recordingNames: targetRecordings.map((item) => item.name).filter(Boolean),
    clientId,
    question,
    answer: "",
    structuredAnswer: null,
    jumpToMs: 0,
    citations: [],
    provider: "",
    model: "",
    reasoningContent: "",
    thinking: [],
    attachments: storedAttachments,
    favorite: false,
    deletedAt: null,
    pending: true,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  });
  persistQaMessageSnapshot(result, { removeReadyCache: false });

  const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
  scheduleQaJob(messageId);
  response.json({ message: publicQaMessage(result, recordingMap) });
});

export default router;
