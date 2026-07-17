import express from "express";
import { requestClientIdBetter, requestClientNameAndDecode } from "../utils/recordings.js";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/today", async (request, response, next) => {
  const {
    dailyBriefDateParts,
    loadDb,
    recordingsForBriefDate,
    findDailyBrief,
    emptyDailyBrief,
    updateDb,
    upsertDailyBriefInDb,
    publicDailyBrief,
    isOrphanDailyBriefGenerating,
    queueDailyBriefGeneration,
    shouldGenerateDailyBrief,
  } = dependencies;
  try {
    const parts = dailyBriefDateParts();
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const db = await loadDb();
    const recordings = recordingsForBriefDate(db, parts.date, clientId, clientName);
    const existing = findDailyBrief(db, parts.date, clientId);

    if (!recordings.length) {
      const empty = emptyDailyBrief(parts, recordings, clientId);
      if (!existing || existing.status !== "empty") {
        await updateDb((nextDb) => upsertDailyBriefInDb(nextDb, empty));
      }
      response.json(publicDailyBrief(empty, parts, recordings, clientId, db));
      return;
    }

    if (isOrphanDailyBriefGenerating(existing, parts.date, clientId)) {
      const queued = await queueDailyBriefGeneration(parts.date, clientId, clientName);
      response.json(publicDailyBrief(queued, parts, recordings, clientId, db));
      return;
    }

    const needsGeneration = shouldGenerateDailyBrief(parts, existing, recordings);
    if (needsGeneration && (!existing || existing.status !== "ready")) {
      const queued = await queueDailyBriefGeneration(parts.date, clientId, clientName);
      response.json(publicDailyBrief(queued, parts, recordings, clientId, db));
      return;
    }

    if (needsGeneration) {
      queueDailyBriefGeneration(parts.date, clientId, clientName).catch((error) =>
        console.warn("[Daily brief] background refresh failed:", error instanceof Error ? error.message : error),
      );
    }

    response.json(publicDailyBrief(existing, parts, recordings, clientId, db));
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
    dailyBriefDateKeysForRecordings,
    dailyBriefOwnerKey,
    dailyBriefPartsFromDateKey,
    recordingsForBriefDate,
    findDailyBrief,
    publicDailyBrief,
    dailyBriefPlaceholder,
  } = dependencies;
  try {
    const clientId = requestClientIdBetter(request);
    const clientName = requestClientNameAndDecode(request);
    const limit = Math.min(60, Math.max(1, Number(request.query.limit || 30)));
    const db = await loadDb();
    const dateKeys = new Set(dailyBriefDateKeysForRecordings(db, clientId, clientName));
    (db.dailyMeetingBriefs || [])
      .filter((brief) => dailyBriefOwnerKey(brief.clientId) === dailyBriefOwnerKey(clientId))
      .forEach((brief) => {
        if (brief?.date) dateKeys.add(brief.date);
      });

    const briefs = [...dateKeys]
      .sort((a, b) => String(b || "").localeCompare(String(a || "")))
      .slice(0, limit)
      .map((dateKey) => {
        const parts = dailyBriefPartsFromDateKey(dateKey);
        const recordings = recordingsForBriefDate(db, dateKey, clientId, clientName);
        const existing = findDailyBrief(db, dateKey, clientId);
        return publicDailyBrief(existing || dailyBriefPlaceholder(parts, recordings, clientId), parts, recordings, clientId, db);
      })
      .filter((brief) => brief.status !== "empty" || brief.meetingCount > 0);
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
