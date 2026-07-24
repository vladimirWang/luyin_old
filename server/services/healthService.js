import { tencentMeetingWebhookStatus } from "../utils/tencentMeeting.mjs";

export function createHealthService({ getTranscriptionDiagnostics, ttsDiagnostics }) {
  return {
    getHealth(info) {
      const diagnostics = getTranscriptionDiagnostics();
      return {
        ok: true,
        info,
        storage: process.env.DATABASE_URL || process.env.MYSQL_HOST ? "mysql" : "filesystem-json",
        transcribeMode: diagnostics.mode,
        transcribeConfigured: diagnostics.configured,
        transcribeMessage: diagnostics.message,
        tencentMeetingWebhook: tencentMeetingWebhookStatus(),
        tts: ttsDiagnostics(),
        qaMode: process.env.LLM_PROVIDER || process.env.LLM_API_URL || process.env.LLM_API_KEY
          ? "llm"
          : "local-transcript",
      };
    },
  };
}
