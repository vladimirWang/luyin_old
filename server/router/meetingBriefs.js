import express from "express";
import { requestClientIdBetter, requestClientNameAndDecode } from "../utils/recordings.js";
import {
  listActiveRecordingsWithPrisma,
  listTranscriptSegmentsByRecordingIdsWithPrisma,
} from "../repositories/recordings.mjs";
import { findDailyMeetingBriefWithPrisma } from "../repositories/dailyMeetingBriefs.mjs";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/today", async (request, response, next) => {
  const {
    dailyBriefDateParts,
    recordingsForBriefDate,
    dailyBriefOwnerKey,
    emptyDailyBrief,
    publicDailyBrief,
  } = dependencies;
  try {
    const parts = dailyBriefDateParts();
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const allRecordings = await listActiveRecordingsWithPrisma();
    const recordings = recordingsForBriefDate({ recordings: allRecordings }, parts.date, clientId, clientName);
    const [existing, transcriptSegments] = await Promise.all([
      findDailyMeetingBriefWithPrisma(parts.date, dailyBriefOwnerKey(clientId)),
      listTranscriptSegmentsByRecordingIdsWithPrisma(recordings.map((recording) => recording.id)),
    ]);
    const db = { recordings, transcriptSegments };

    const empty = {
      ...emptyDailyBrief(parts, recordings, clientId),
      status: "empty",
      dirty: false,
    };
    response.json(publicDailyBrief(existing || empty, parts, recordings, clientId, db));
  } catch (error) {
    next(error);
  }
});

router.post("/today", async (request, response, next) => {
  const {
    dailyBriefDateParts,
    queueDailyBriefGeneration,
    loadDb,
    recordingsForBriefDate,
    findDailyBrief,
    publicDailyBrief,
  } = dependencies;
  try {
    const parts = dailyBriefDateParts();
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const queued = await queueDailyBriefGeneration(parts.date, clientId, clientName);
    const db = await loadDb();
    const recordings = recordingsForBriefDate(db, parts.date, clientId, clientName);
    const latest = findDailyBrief(db, parts.date, clientId) || queued;
    response.json(publicDailyBrief(latest, parts, recordings, clientId, db));
  } catch (error) {
    next(error);
  }
});

router.get("/", async (request, response, next) => {
  const {
    loadDb,
    dailyBriefOwnerKey,
    dailyBriefPartsFromDateKey,
    recordingsForBriefDate,
    publicDailyBrief,
  } = dependencies;
  try {
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const limit = Math.min(60, Math.max(1, Number(request.query.limit || 30)));
    const db = await loadDb();
    const briefs = (db.dailyMeetingBriefs || [])
      .filter((brief) => dailyBriefOwnerKey(brief.clientId) === dailyBriefOwnerKey(clientId))
      .filter((brief) => brief?.date && brief.status !== "empty")
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, limit)
      .map((brief) => {
        const parts = dailyBriefPartsFromDateKey(brief.date);
        const recordings = recordingsForBriefDate(db, brief.date, clientId, clientName);
        return publicDailyBrief(brief, parts, recordings, clientId, db);
      })
      .filter((brief) => brief.status !== "empty");
    response.json({ briefs });
  } catch (error) {
    next(error);
  }
});

router.get("/:date", async (request, response, next) => {
  const {
    normalizeDailyBriefDateParam,
    dailyBriefPartsFromDateKey,
    loadDb,
    recordingsForBriefDate,
    findDailyBrief,
    isOrphanDailyBriefGenerating,
    queueDailyBriefGeneration,
    publicDailyBrief,
    dailyBriefPlaceholder,
  } = dependencies;
  try {
    const dateKey = normalizeDailyBriefDateParam(request.params.date);
    if (!dateKey) {
      response.status(400).json({ error: "日期格式不正确" });
      return;
    }
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const parts = dailyBriefPartsFromDateKey(dateKey);
    const db = await loadDb();
    const recordings = recordingsForBriefDate(db, dateKey, clientId, clientName);
    const existing = findDailyBrief(db, dateKey, clientId);

    if (isOrphanDailyBriefGenerating(existing, dateKey, clientId)) {
      const queued = await queueDailyBriefGeneration(dateKey, clientId, clientName);
      response.json(publicDailyBrief(queued, parts, recordings, clientId, db));
      return;
    }

    response.json(publicDailyBrief(existing || dailyBriefPlaceholder(parts, recordings, clientId), parts, recordings, clientId, db));
  } catch (error) {
    next(error);
  }
});

router.post("/:date", async (request, response, next) => {
  const {
    normalizeDailyBriefDateParam,
    dailyBriefPartsFromDateKey,
    queueDailyBriefGeneration,
    loadDb,
    recordingsForBriefDate,
    findDailyBrief,
    publicDailyBrief,
  } = dependencies;
  try {
    const dateKey = normalizeDailyBriefDateParam(request.params.date);
    if (!dateKey) {
      response.status(400).json({ error: "日期格式不正确" });
      return;
    }
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const parts = dailyBriefPartsFromDateKey(dateKey);
    const queued = await queueDailyBriefGeneration(dateKey, clientId, clientName);
    const db = await loadDb();
    const recordings = recordingsForBriefDate(db, dateKey, clientId, clientName);
    const latest = findDailyBrief(db, dateKey, clientId) || queued;
    response.json(publicDailyBrief(latest, parts, recordings, clientId, db));
  } catch (error) {
    next(error);
  }
});

router.get("/:date/share.pdf", async (request, response, next) => {
  const {
    normalizeDailyBriefDateParam,
    loadDb,
    findDailyBrief,
    renderDailyBriefPdf,
    safeDownloadName,
  } = dependencies;
  try {
    const clientId = requestClientIdBetter(request);
    const dateKey = normalizeDailyBriefDateParam(request.params.date);
    if (!dateKey) {
      response.status(400).json({ error: "日期格式不正确" });
      return;
    }
    const db = await loadDb();
    const brief = findDailyBrief(db, dateKey, clientId);
    if (!brief || !brief.summaryMarkdown) {
      response.status(404).json({ error: "今日总结还没有生成完成" });
      return;
    }
    const pdfBuffer = await renderDailyBriefPdf(brief);
    const fileName = `${safeDownloadName(brief.title || "今日会议简报")}-${dateKey}.pdf`;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    response.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
