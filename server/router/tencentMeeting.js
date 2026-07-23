import express from "express";
import logger from "../utils/log.js";
import { parseJsonObject } from "../utils/common.mjs";
import {
  importTencentMeetingStsTokenPayload,
  requestTencentMeetingStsTokenIfNeeded,
  tencentMeetingApiRequest,
  tencentMeetingCandidateOperatorParams,
  tencentMeetingQuery,
  tencentMeetingWebhookEventAction,
  tencentMeetingVerifiedPlaintext,
  tencentMeetingWebhookStatus,
} from "../utils/tencentMeeting.mjs";
import { requestWecomIdentity } from "../utils/wecom.js";
import {
  appendTencentMeetingWebhookEvent,
  markTencentMeetingWebhookEventFailed,
  markTencentMeetingWebhookEventProcessed,
  markTencentMeetingWebhookEventProcessing,
} from "../repositories/tencentMeetingWebhookEvents.mjs";

const router = express.Router();

let dependencies = {};

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

function recentTencentMeetingWindow() {
  const now = Date.now();
  return {
    start_time: Math.floor((now - 8 * 24 * 60 * 60 * 1000) / 1000),
    end_time: Math.floor((now + 24 * 60 * 60 * 1000) / 1000),
  };
}

router.post("/verify-api", async (request, response, next) => {
  if (!requestWecomIdentity(request)) {
    response.status(401).json({ error: "企业微信登录已失效，请重新登录" });
    return;
  }

  const operation = String(request.body?.operation || "").trim();
  const input = request.body?.input && typeof request.body.input === "object" ? request.body.input : {};
  const operatorParams = tencentMeetingCandidateOperatorParams()[0] || {};
  let uri = "";

  switch (operation) {
    case "records":
      uri = tencentMeetingQuery("/v1/records", {
        ...recentTencentMeetingWindow(),
        page_size: 20,
        page: 1,
        ...operatorParams,
      });
      break;
    case "addresses":
      if (!input.meetingRecordId) {
        response.status(400).json({ error: "调用 /v1/addresses 前需要 meeting_record_id" });
        return;
      }
      uri = tencentMeetingQuery("/v1/addresses", {
        meeting_record_id: String(input.meetingRecordId),
        ...operatorParams,
      });
      break;
    case "address-detail":
      if (!input.addressId) {
        response.status(400).json({ error: "调用 /v1/addresses/:id 前需要地址或录制文件 ID" });
        return;
      }
      uri = tencentMeetingQuery(`/v1/addresses/${encodeURIComponent(String(input.addressId))}`, operatorParams);
      break;
    case "transcript-details":
      if (!input.recordFileId) {
        response.status(400).json({ error: "调用转写详情前需要 record_file_id" });
        return;
      }
      uri = tencentMeetingQuery("/v1/records/transcripts/details", {
        record_file_id: String(input.recordFileId),
        meeting_id: String(input.meetingId || ""),
        transcripts_type: Number(input.transcriptsType || process.env.TENCENT_MEETING_TRANSCRIPTS_TYPE || 1),
        ...operatorParams,
      });
      break;
    default:
      response.status(400).json({ error: "不支持的腾讯会议验证操作" });
      return;
  }

  try {
    await requestTencentMeetingStsTokenIfNeeded();
    const payload = await tencentMeetingApiRequest("GET", uri);
    response.json({ ok: true, operation, method: "GET", uri, payload });
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
    // 记录腾讯会议webhhook日志
    const persisted = await appendTencentMeetingWebhookEvent({
      receivedAt: new Date().toISOString(),
      event: payload?.event || "",
      uniqueSequence: payload?.unique_sequence || "",
      payload: payload || plaintext,
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
              await importTencentMeetingAudioCompletedPayload(payload);
              break;
            case "transcript-ready": {
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
        })
        .catch(async (error) => {
          try {
            await markTencentMeetingWebhookEventFailed(eventId, error);
          } catch (persistError) {
            console.warn(
              "[Tencent Meeting] webhook failure status persistence failed:",
              persistError instanceof Error ? persistError.message : persistError,
            );
          }
          console.warn("[Tencent Meeting] webhook background import failed:", error instanceof Error ? error.message : error);
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
