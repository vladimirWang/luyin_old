import express from "express";
import logger from "../utils/log.js";
import { parseJsonObject } from "../utils/common.mjs";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/webhook/status", (_request, response) => {
  const { tencentMeetingWebhookStatus } = dependencies;
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

router.get("/webhook", (request, response) => {
  const { tencentMeetingVerifiedPlaintext } = dependencies;
  try {
    const plaintext = tencentMeetingVerifiedPlaintext(request, request.query.check_str);
    response.status(200).type("text/plain").send(plaintext);
  } catch (error) {
    console.warn("[Tencent Meeting] webhook GET rejected:", error instanceof Error ? error.message : error);
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback");
  }
});

router.post("/webhook", async (request, response) => {
  const { tencentMeetingVerifiedPlaintext, appendTencentMeetingWebhookEvent, importTencentMeetingStsTokenPayload, importTencentMeetingWebhookPayload, queueTencentMeetingCloudDiscovery } = dependencies;
  try {
    const plaintext = tencentMeetingVerifiedPlaintext(request, request.body?.data);
    const payload = parseJsonObject(plaintext);
    await appendTencentMeetingWebhookEvent({
      receivedAt: new Date().toISOString(),
      event: payload?.event || payload?.Event || payload?.event_type || "",
      uniqueSequence: payload?.unique_sequence || payload?.uniqueSequence || "",
      payload: payload || plaintext,
    });
    response.status(200).type("text/plain").send("successfully received callback");
    if (payload) {
      Promise.resolve()
        .then(async () => {
          await importTencentMeetingStsTokenPayload(payload);
          await importTencentMeetingWebhookPayload(payload);
          queueTencentMeetingCloudDiscovery();
        })
        .catch((error) => console.warn("[Tencent Meeting] webhook background import failed:", error instanceof Error ? error.message : error));
    } else {
      console.warn("[Tencent Meeting] webhook decrypted but did not contain JSON payload.");
    }
  } catch (error) {
    console.warn("[Tencent Meeting] webhook POST rejected:", error instanceof Error ? error.message : error);
    response.status(error.statusCode || 400).type("text/plain").send("invalid callback");
  }
});

export default router;