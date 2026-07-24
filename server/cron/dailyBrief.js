import cron from "node-cron";
import logger from "../utils/log.js";
import {
  dailyBriefCronExpression,
  dailyBriefTimezone,
} from "../config.js";

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
  const expression = options.expression || dailyBriefCronExpression;
  const timezone = options.timezone || dailyBriefTimezone;
  const schedule = options.schedule || cron.schedule;

  if (typeof run !== "function") throw new TypeError("Daily brief cron requires a run function.");

  scheduledTask = schedule(expression, () => void runDailyBriefCron(() => run(new Date())), {
    timezone,
    noOverlap: true,
    name: "daily-meeting-brief",
  });

  // The startup check uses the latest completed time slot to compensate for downtime.
  if (options.runOnStart !== false) void runDailyBriefCron(() => run(new Date()));
  return scheduledTask;
}

export function stopDailyBriefCron() {
  scheduledTask?.stop?.();
  scheduledTask = null;
}
