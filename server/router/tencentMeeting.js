import express from "express";
import logger from "../utils/log.js";
import { parseJsonObject } from "../utils/common.mjs";
import {
  importTencentMeetingStsTokenPayload,
  isTencentMeetingTranscriptReadyEvent,
  requestTencentMeetingStsTokenIfNeeded,
  tencentMeetingVerifiedPlaintext,
  tencentMeetingWebhookStatus,
} from "../utils/tencentMeeting.mjs";

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
    if (!result.requested) {
      const missingOperator = result.reason === "missing_operator_id";
      response.status(missingOperator ? 503 : 502).json({
        ok: false,
        requested: false,
        error: missingOperator
          ? "未配置腾讯会议 STS Operator ID"
          : "腾讯会议 STS Token 申请失败",
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
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback");
  }
});

router.post("/webhook", async (request, response) => {
  const {
    appendTencentMeetingWebhookEvent,
    importTencentMeetingWebhookPayload,
    queueTencentMeetingCloudDiscovery,
    queueTencentMeetingPendingImports,
  } = dependencies;
  try {
    const plaintext = tencentMeetingVerifiedPlaintext(request, request.body?.data);
    logger.info("listen /webhook tencentmeeting webhook plaintext: ", {message: plaintext})
    const payload = parseJsonObject(plaintext);
    logger.info("listen /webhook tencentmeeting webhook payload: ", {message: JSON.stringify(payload)})
    // 记录腾讯会议webhhook日志
    await appendTencentMeetingWebhookEvent({
      receivedAt: new Date().toISOString(),
      event: payload?.event || "",
      uniqueSequence: payload?.unique_sequence || payload?.uniqueSequence || "",
      payload: payload || plaintext,
    });
    response.status(200).type("text/plain").send("successfully received callback");
    logger.debug("listen /webhook 成功响应腾讯会议webhook: ", {message: '继续后续逻辑'})
    if (payload) {
      void Promise.resolve()
        .then(async () => {
          // recording.started 云录制开始
          // recording.started 云录制停止
          // recording.completed 云录制完成
          // recording.audio-completed 录音笔上传完成
          // common.sts-token token签发
          if (payload.event === "common.sts-token") {
            // 保存 STS Token；只有实际保存成功后才恢复此前挂起的同步任务。
            const saved = await importTencentMeetingStsTokenPayload(payload);
            logger.info("listen /webhook call importTencentMeetingStsTokenPayload success: ", {message: `saved: ${saved}`})
            if (saved) await queueTencentMeetingPendingImports();
          } else if (payload.event === 'recording.completed') {
            // 处理录音相关 Webhook：从回调中提取录音文件和会议信息，
            // 创建或更新本地录音记录，并按事件内容调度后续的音频、转写同步流程。
            await importTencentMeetingWebhookPayload(payload);
          } else if (payload.event === 'recording.audio-completed') {
            await importTencentMeetingWebhookPayload(payload);
          } else if (isTencentMeetingTranscriptReadyEvent(payload)) {
            // 腾讯会议确认完整转写已经生成后，才读取转写详情。
            await importTencentMeetingWebhookPayload(payload);
          }
          logger.info("listen /webhook call importTencentMeetingWebhookPayload success: ", {message: ''})

          // Webhook 只代表单次事件，可能缺少完整录制信息或存在漏推；
          // 因此额外触发一次云录制发现，用腾讯会议 API 对近期录制列表进行补充和状态校准。
          queueTencentMeetingCloudDiscovery();
        })
        .catch((error) => {
          console.warn("[Tencent Meeting] webhook background import failed:", error instanceof Error ? error.message : error)
        });
    } else {
      console.warn("[Tencent Meeting] webhook decrypted but did not contain JSON payload.");
    }
  } catch (error) {
    logger.error("tencentmeeting webhook failed: ", {message: error.message})
    console.warn("[Tencent Meeting] webhook POST rejected:", error instanceof Error ? error.message : error);
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback");
  }
});

export default router;
