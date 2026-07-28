const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);
import { TENCENT_MEETING_WEBHOOK_EVENTS } from "../constant.js";
import { canonicalTencentMeetingWebhookRecordFileIds } from "../utils/tencentMeetingWebhookPayload.mjs";

function webhookReceivedAt(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function webhookPayload(value) {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
}

export async function appendTencentMeetingWebhookEvent(entry = {}) {
  const eventType = String(entry.event || "").trim().slice(0, 120);
  const uniqueSequence = String(entry.uniqueSequence || "").trim().slice(0, 160);

  if (uniqueSequence) {
    const existing = await prisma.tencentMeetingWebhookEvent.findFirst({
      where: { uniqueSequence, eventType },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { event: existing, duplicate: true };
  }

  const event = await prisma.tencentMeetingWebhookEvent.create({
    data: {
      uniqueSequence: uniqueSequence || null,
      eventType: eventType || null,
      payload: webhookPayload(entry.payload),
      status: "pending",
      receivedAt: webhookReceivedAt(entry.receivedAt),
    },
  });
  return { event, duplicate: false };
}

export async function markTencentMeetingWebhookEventProcessing(id) {
  if (!id) return null;
  return prisma.tencentMeetingWebhookEvent.update({
    where: { id },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markTencentMeetingWebhookEventProcessed(id) {
  if (!id) return null;
  return prisma.tencentMeetingWebhookEvent.update({
    where: { id },
    data: {
      status: "processed",
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markTencentMeetingWebhookEventFailed(id, error) {
  if (!id) return null;
  return prisma.tencentMeetingWebhookEvent.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error || "Unknown webhook processing error"),
    },
  });
}

export async function listTencentMeetingWebhookPayloadHistory({ limit = 500 } = {}) {
  const events = await prisma.tencentMeetingWebhookEvent.findMany({
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(2000, Math.round(Number(limit) || 500))),
    select: { payload: true },
  });
  return events
    .map((event) => event.payload)
    .filter((payload) => payload && typeof payload === "object")
    .reverse();
}

async function scanPersistedSmartTranscriptRecordFileIds(recordFileIds) {
  const requested = recordFileIds
    ? new Set(recordFileIds.map((value) => String(value || "").trim()).filter(Boolean))
    : null;
  const matched = new Set();
  const batchSize = 500;
  let offset = 0;

  while (!requested || requested.size > 0) {
    const events = await prisma.tencentMeetingWebhookEvent.findMany({
      where: { eventType: TENCENT_MEETING_WEBHOOK_EVENTS["SMART.TRANSCRIPTS"] },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: batchSize,
      select: { payload: true },
    });

    for (const event of events) {
      for (const recordFileId of canonicalTencentMeetingWebhookRecordFileIds(event.payload)) {
        if (requested && !requested.has(recordFileId)) continue;
        requested?.delete(recordFileId);
        matched.add(recordFileId);
      }
    }

    if (events.length < batchSize) break;
    offset += events.length;
  }

  return [...matched];
}

export async function listPersistedSmartTranscriptRecordFileIds(recordFileIds = []) {
  if (!recordFileIds.length) return [];
  return scanPersistedSmartTranscriptRecordFileIds(recordFileIds);
}

export async function listAllPersistedSmartTranscriptRecordFileIds() {
  return scanPersistedSmartTranscriptRecordFileIds(null);
}
