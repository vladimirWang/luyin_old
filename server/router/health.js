import express from "express";
import { tencentMeetingWebhookStatus } from "../utils/tencentMeeting.mjs";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/", async (_request, response) => {
  const { getTranscriptionDiagnostics, ttsDiagnostics } = dependencies;
  const diagnostics = getTranscriptionDiagnostics();
  response.json({
    ok: true,
    storage: process.env.DATABASE_URL || process.env.MYSQL_HOST ? "mysql" : "filesystem-json",
    transcribeMode: diagnostics.mode,
    transcribeConfigured: diagnostics.configured,
    transcribeMessage: diagnostics.message,
    tencentMeetingWebhook: tencentMeetingWebhookStatus(),
    tts: ttsDiagnostics(),
    qaMode: process.env.LLM_PROVIDER || process.env.LLM_API_URL || process.env.LLM_API_KEY ? "llm" : "local-transcript",
  });
});

export default router;