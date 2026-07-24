import cron from "node-cron";
import logger from "../utils/log.js";

const DAILY_BRIEF_CRON_EXPRESSION = "0 19 * * *";
const DAILY_BRIEF_TIMEZONE = "Asia/Shanghai";

let scheduledTask = null;
let runInFlight = null;

export function runDailyBriefCron(run) {
  if (runInFlight) return runInFlight;
  runInFlight = Promise.resolve()
    .then(run)
    .catch((error) => {
      logger.error("daily_brief.cron_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
    .finally(() => {
      runInFlight = null;
    });
  return runInFlight;
}

export function startDailyBriefCron(options = {}) {
  if (scheduledTask) return scheduledTask;

  const run = options.run;
  const expression = options.expression || DAILY_BRIEF_CRON_EXPRESSION;
  const timezone = options.timezone || DAILY_BRIEF_TIMEZONE;
  const schedule = options.schedule || cron.schedule;

  if (typeof run !== "function") throw new TypeError("Daily brief cron requires a run function.");

  scheduledTask = schedule(expression, () => void runDailyBriefCron(run), {
    timezone,
    noOverlap: true,
    name: "daily-meeting-brief",
  });

  // A startup check compensates for a service that was unavailable at 19:00.
  if (options.runOnStart !== false) void runDailyBriefCron(run);
  return scheduledTask;
}

export function stopDailyBriefCron() {
  scheduledTask?.stop?.();
  scheduledTask = null;
}
