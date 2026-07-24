import cron from "node-cron";
import {
  transcriptionRecoveryCronExpression,
} from "../config.js";
import logger from "../utils/log.js";

let scheduledTask = null;
let runInFlight = null;

export function runTranscriptionRecovery(run, reason = "cron") {
  if (runInFlight) return runInFlight;
  runInFlight = Promise.resolve()
    .then(() => run(reason))
    .catch((error) => {
      logger.error("transcription.recovery_cron_failed", {
        message: error instanceof Error ? error.message : String(error),
        reason,
      });
      return 0;
    })
    .finally(() => {
      runInFlight = null;
    });
  return runInFlight;
}

export function startTranscriptionRecoveryCron(options = {}) {
  if (scheduledTask) return scheduledTask;

  const run = options.run;
  const schedule = options.schedule || cron.schedule;
  const expression = options.expression || transcriptionRecoveryCronExpression;
  if (typeof run !== "function") {
    throw new TypeError("Transcription recovery cron requires a run function.");
  }

  scheduledTask = schedule(
    expression,
    () => void runTranscriptionRecovery(run, "cron"),
    {
      noOverlap: true,
      name: "transcription-recovery",
    },
  );

  if (options.runOnStart !== false) {
    void runTranscriptionRecovery(run, "startup");
  }
  return scheduledTask;
}

export function stopTranscriptionRecoveryCron() {
  scheduledTask?.stop?.();
  scheduledTask = null;
}
