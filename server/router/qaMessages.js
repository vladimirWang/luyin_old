import express from "express";
import { requestClientIdBetter } from "../utils/recordings.js";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

function qaMessageRecordingIds(message) {
  return Array.isArray(message?.recordingIds)
    ? message.recordingIds.filter(Boolean)
    : message?.recordingId
      ? [message.recordingId]
      : [];
}

function hasActiveRecordingReference(message, recordingMap) {
  const recordingIds = qaMessageRecordingIds(message);
  if (!recordingIds.length) return true;
  return recordingIds.some((recordingId) => {
    const recording = recordingMap.get(recordingId);
    return recording && !recording.deletedAt;
  });
}

router.get("/", async (request, response) => {
  const { loadDb, canReadQaMessage, qaMessageCache, schedulePendingQaMessages, publicQaMessage } = dependencies;
  const clientId = requestClientIdBetter(request);
  const limit = Math.min(100, Math.max(1, Number(request.query.limit || 50)));
  const favoriteOnly = request.query.favorite === "true";
  const db = await loadDb();
  const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
  const messagesById = new Map();
  for (const message of db.qaMessages || []) {
    if (message?.id) messagesById.set(message.id, message);
  }
  for (const message of qaMessageCache.values()) {
    if (message?.id) messagesById.set(message.id, message);
  }
  const messages = [...messagesById.values()]
    .filter((message) => !message.deletedAt)
    .filter((message) => canReadQaMessage(message, clientId))
    .filter((message) => hasActiveRecordingReference(message, recordingMap))
    .filter((message) => !favoriteOnly || message.favorite)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
  schedulePendingQaMessages(messages);

  response.json({ messages: messages.map((message) => publicQaMessage(message, recordingMap)) });
});

router.get("/:id", async (request, response) => {
  const { cachedQaMessage, canReadQaMessage, scheduleQaJob, loadDb, findQaMessage, publicQaMessage } = dependencies;
  const clientId = requestClientIdBetter(request);
  const db = await loadDb();
  const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
  const cached = cachedQaMessage(request.params.id);
  if (
    cached &&
    !cached.deletedAt &&
    canReadQaMessage(cached, clientId) &&
    hasActiveRecordingReference(cached, recordingMap)
  ) {
    if (cached.pending || cached.status === "pending") scheduleQaJob(cached.id);
    response.json({ message: publicQaMessage(cached, recordingMap) });
    return;
  }

  const message = findQaMessage(db, request.params.id);
  if (
    !message ||
    message.deletedAt ||
    !canReadQaMessage(message, clientId) ||
    !hasActiveRecordingReference(message, recordingMap)
  ) {
    response.status(404).json({ error: "问答记录不存在" });
    return;
  }

  if (message.pending || message.status === "pending") scheduleQaJob(message.id);
  response.json({ message: publicQaMessage(message, recordingMap) });
});

router.patch("/:id", async (request, response) => {
  const { updateDb, findQaMessage, canReadQaMessage, publicQaMessage } = dependencies;
  const clientId = requestClientIdBetter(request);
  const updated = await updateDb((db) => {
    const message = findQaMessage(db, request.params.id);
    if (!message || message.deletedAt) return null;
    if (!canReadQaMessage(message, clientId)) return null;

    const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
    if (!hasActiveRecordingReference(message, recordingMap)) return null;

    if (typeof request.body.favorite === "boolean") {
      message.favorite = request.body.favorite;
    }
    message.updatedAt = new Date().toISOString();

    return publicQaMessage(message, recordingMap);
  });

  if (!updated) {
    response.status(404).json({ error: "问答记录不存在" });
    return;
  }

  response.json({ message: updated });
});

router.delete("/:id", async (request, response) => {
  const { updateDb, findQaMessage, canReadQaMessage } = dependencies;
  const clientId = requestClientIdBetter(request);
  const deleted = await updateDb((db) => {
    const message = findQaMessage(db, request.params.id);
    if (!message) return false;
    if (!canReadQaMessage(message, clientId)) return false;
    message.deletedAt = new Date().toISOString();
    message.updatedAt = new Date().toISOString();
    return true;
  });

  if (!deleted) {
    response.status(404).json({ error: "问答记录不存在" });
    return;
  }

  response.json({ ok: true });
});

router.get("/:id/share.pdf", async (request, response, next) => {
  const { loadDb, findQaMessage, canReadQaMessage, publicQaMessage, renderQaMessagePdf, safeDownloadName } = dependencies;
  try {
    const db = await loadDb();
    const clientId = requestClientIdBetter(request);
    const message = findQaMessage(db, request.params.id);
    const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
    if (
      !message ||
      message.deletedAt ||
      !canReadQaMessage(message, clientId) ||
      !hasActiveRecordingReference(message, recordingMap)
    ) {
      response.status(404).json({ error: "问答记录不存在" });
      return;
    }

    const pdfBuffer = await renderQaMessagePdf(message, recordingMap);
    const fileName = `${safeDownloadName(message.question)}.pdf`;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/attachments/:attachmentId", async (request, response) => {
  const { loadDb, findQaMessage, canReadQaMessage, existsSync } = dependencies;
  const db = await loadDb();
  const clientId = requestClientIdBetter(request);
  const message = findQaMessage(db, request.params.id);
  const recordingMap = new Map(db.recordings.map((item) => [item.id, item]));
  if (
    !message ||
    message.deletedAt ||
    !canReadQaMessage(message, clientId) ||
    !hasActiveRecordingReference(message, recordingMap)
  ) {
    response.status(404).json({ error: "附件不存在" });
    return;
  }

  const attachment = (message.attachments || []).find(
    (item) => item.fileId === request.params.attachmentId || item.id === request.params.attachmentId,
  );
  if (!attachment?.storagePath || !existsSync(attachment.storagePath)) {
    response.status(404).json({ error: "附件不存在" });
    return;
  }

  response.sendFile(attachment.storagePath, {
    headers: {
      "Content-Type": attachment.type || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.name || "attachment")}`,
    },
  });
});

export default router;
