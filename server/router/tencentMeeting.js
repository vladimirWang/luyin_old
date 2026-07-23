import express from "express";
import logger from "../utils/log.js";
import { parseJsonObject } from "../utils/common.mjs";
import {
  importTencentMeetingStsTokenPayload,
  requestTencentMeetingStsTokenIfNeeded,
  TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER,
  TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_START_MARKER,
  tencentMeetingWebhookEventAction,
  tencentMeetingVerifiedPlaintext,
  tencentMeetingWebhookStatus,
} from "../utils/tencentMeeting.mjs";
import {
  appendTencentMeetingWebhookEvent,
  markTencentMeetingWebhookEventFailed,
  markTencentMeetingWebhookEventProcessed,
  markTencentMeetingWebhookEventProcessing,
} from "../repositories/tencentMeetingWebhookEvents.mjs";

const router = express.Router();

let dependencies = {};

function logTencentMeetingWebhookTrace(stage, details = {}) {
  const metadata = { stage, ...details };
  logger.info(`tencent_meeting.webhook.${stage}`, {
    message: Object.entries(details)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
    ...metadata,
  });
  console.info(`[Tencent Meeting][Webhook] ${stage}`, metadata);
}

function emitTencentMeetingTranscriptDiagnosticStart(payload, eventId) {
  const diagnosticDetails = {
    event: payload?.event || "",
    eventId,
  };
  logger.info("tencent_meeting.transcript.diagnostic_start", {
    message: TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_START_MARKER,
    ...diagnosticDetails,
  });
  console.info(TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_START_MARKER, diagnosticDetails);
}

export function configure(deps) {
  dependencies = deps;
}

router.get("/webhook/status", (_request, response) => {
  response.json({
    ok: true,
    tencentMeetingWebhook: tencentMeetingWebhookStatus(),
  });
});

router.post("/cloud-recordings/sync", async (request, response, next) => {
  const { queueTencentMeetingCloudDiscovery, importTencentMeetingCloudRecordingsFromApi } = dependencies;
  try {
    logger.info("tencent_meeting.sync.request", {message: `wait: ${String(request.query?.wait || "") === "1"}, ip: ${request.ip}`, wait: String(request.query?.wait || "") === "1", ip: request.ip});
    if (String(request.query?.wait || "") !== "1") {
      const queued = queueTencentMeetingCloudDiscovery();
      response.json({ ok: true, queued });
      return;
    }
    const imported = await importTencentMeetingCloudRecordingsFromApi();
    logger.info("tencent_meeting.sync.completed", {message: `imported: ${imported}`, imported});
    response.json({ ok: true, imported });
  } catch (error) {
    logger.error("tencent_meeting.sync.failed ", {message: `error: ${error.message}, ip: ${request.ip}`});
    next(error);
  }
});

router.post("/sts-token/request", async (_request, response, next) => {
  try {
    const result = await requestTencentMeetingStsTokenIfNeeded();
    console.log("/sts-token/request: ", result)
    if (!result.requested) {
      const missingOperator = result.reason === "missing_operator_id";
      const redisUnavailable = result.reason === "redis_unavailable";
      const accepted = result.reason === "token_fresh" || result.reason === "request_pending";
      response.status(accepted ? 200 : missingOperator || redisUnavailable ? 503 : 502).json({
        ok: accepted,
        requested: false,
        reason: result.reason,
        ...(accepted
          ? { message: result.reason === "token_fresh" ? "STS Token 仍然有效" : "STS Token 申请已在处理中" }
          : {
              error: missingOperator
                ? "未配置腾讯会议 STS Operator ID"
                : redisUnavailable
                  ? "Redis 不可用，无法读写 STS Token"
                  : "腾讯会议 STS Token 申请失败",
            }),
      });
      return;
    }
    response.json({
      ok: true,
      requested: true,
      message: "STS Token 申请已提交，请等待腾讯会议回调",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/webhook", (request, response) => {
  logger.debug("get /webhook: ", {message: "step 1"})
  try {
    const plaintext = tencentMeetingVerifiedPlaintext(request, request.query.check_str);
    logger.debug("get /webhook plaintext: ", {message: plaintext})
    response.status(200).type("text/plain").send(plaintext);
  } catch (error) {
    console.warn("[Tencent Meeting] webhook GET rejected:", error instanceof Error ? error.message : error);
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback 3");
  }
});

router.post("/webhook", async (request, response) => {
  const {
    importTencentMeetingAudioCompletedPayload,
    importTencentMeetingRecordingCompletedPayload,
    importTencentMeetingTranscriptReadyPayload,
    queueTencentMeetingPendingImports,
  } = dependencies;
  try {
    const plaintext = tencentMeetingVerifiedPlaintext(request, request.body?.data);
    logger.info("logger.info listen /webhook tencentmeeting webhook plaintext: ", {message: plaintext})
    console.log("console.log listen /webhook tencentmeeting webhook plaintext: ", {message: plaintext})
    const payload = parseJsonObject(plaintext);
    logger.info("logger.info listen /webhook tencentmeeting webhook payload: ", {message: JSON.stringify(payload)})
    console.log("console.log listen /webhook tencentmeeting webhook payload: ", {message: JSON.stringify(payload)})
    const action = tencentMeetingWebhookEventAction(payload);
    logTencentMeetingWebhookTrace("received", {
      event: payload?.event || "",
      action,
      uniqueSequence: payload?.unique_sequence || "",
      payloadItemCount: Array.isArray(payload?.payload) ? payload.payload.length : payload?.payload ? 1 : 0,
    });
    // 记录腾讯会议webhhook日志
    const persisted = await appendTencentMeetingWebhookEvent({
      receivedAt: new Date().toISOString(),
      event: payload?.event || "",
      uniqueSequence: payload?.unique_sequence || "",
      payload: payload || plaintext,
    });
    logTencentMeetingWebhookTrace("persisted", {
      event: payload?.event || "",
      action,
      eventId: persisted.event.id,
      duplicate: persisted.duplicate,
      previousStatus: persisted.event.status,
    });
    response.status(200).type("text/plain").send("successfully received callback");
    logger.debug("listen /webhook 成功响应腾讯会议webhook: ", {message: '继续后续逻辑'})
    if (payload) {
      const eventId = persisted.event.id;
      const duplicateAlreadyHandled = persisted.duplicate && ["processing", "processed"].includes(persisted.event.status);
      if (duplicateAlreadyHandled) {
        logger.info("tencent_meeting.webhook.duplicate_skipped", {
          message: `event: ${payload.event || ""}, eventId: ${eventId}`,
          event: payload.event || "",
          eventId,
        });
        return;
      }
      void Promise.resolve()
        .then(async () => {
          await markTencentMeetingWebhookEventProcessing(eventId);
          logTencentMeetingWebhookTrace("dispatch_started", {
            event: payload.event || "",
            action,
            eventId,
          });
          switch (action) {
            case "sts-token": {
              const saved = await importTencentMeetingStsTokenPayload(payload);
              if (saved) await queueTencentMeetingPendingImports();
              break;
            }
            case "recording-started":
              // The persisted event is later used to resolve recorder ownership.
              break;
            case "recording-completed":
              await importTencentMeetingRecordingCompletedPayload(payload);
              break;
            case "audio-completed":
              emitTencentMeetingTranscriptDiagnosticStart(payload, eventId);
              await importTencentMeetingAudioCompletedPayload(payload);
              break;
            case "transcript-ready": {
              emitTencentMeetingTranscriptDiagnosticStart(payload, eventId);
              await importTencentMeetingTranscriptReadyPayload(payload);
              break;
            }
            default:
              logger.info("tencent_meeting.webhook.ignored", {
                message: `event: ${payload.event || ""}`,
                event: payload.event || "",
              });
          }
          await markTencentMeetingWebhookEventProcessed(eventId);
          logTencentMeetingWebhookTrace("dispatch_completed", {
            event: payload.event || "",
            action,
            eventId,
          });
        })
        .catch(async (error) => {
          logTencentMeetingWebhookTrace("dispatch_failed", {
            event: payload?.event || "",
            action,
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
          try {
            await markTencentMeetingWebhookEventFailed(eventId, error);
          } catch (persistError) {
            console.warn(
              "[Tencent Meeting] webhook failure status persistence failed:",
              persistError instanceof Error ? persistError.message : persistError,
            );
          }
          console.warn("[Tencent Meeting] webhook background import failed:", error instanceof Error ? error.message : error);
          if (action === "audio-completed" || action === "transcript-ready") {
            const diagnosticDetails = {
              event: payload?.event || "",
              eventId,
              outcome: "dispatch_failed",
            };
            logger.info("tencent_meeting.transcript.diagnostic_end", {
              message: TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER,
              ...diagnosticDetails,
            });
            console.info(TENCENT_MEETING_TRANSCRIPT_DIAGNOSTIC_END_MARKER, diagnosticDetails);
          }
        });
    } else {
      console.warn("[Tencent Meeting] webhook decrypted but did not contain JSON payload.");
    }
  } catch (error) {
    logger.error("tencentmeeting webhook failed: ", {message: error.message})
    console.warn("[Tencent Meeting] webhook POST rejected:", error instanceof Error ? error.message : error);
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback 2");
  }
});

export default router;
