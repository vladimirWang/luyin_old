import logger from "../utils/log.js";
import { requestTMToken } from "../utils/token.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

let timer = null;
let checkInFlight = null;

export async function checkTencentMeetingStsToken(requestToken = requestTMToken) {
  if (checkInFlight) return checkInFlight;

  checkInFlight = Promise.resolve()
    .then(() => requestToken())
    .then((result) => {
      if (result.requested) {
        logger.info("tencent_meeting.sts_token.cron_requested", {
          message: "Tencent Meeting STS token refresh requested; waiting for webhook callback.",
        });
      } else if (!["token_fresh", "request_pending"].includes(result.reason)) {
        logger.warn("tencent_meeting.sts_token.cron_skipped", {
          message: `reason: ${result.reason || "unknown"}`,
        });
      }
      return result;
    })
    .catch((error) => {
      logger.error("tencent_meeting.sts_token.cron_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { requested: false, reason: "cron_failed" };
    })
    .finally(() => {
      checkInFlight = null;
    });

  return checkInFlight;
}

export function startTencentMeetingStsTokenCron(options = {}) {
  if (timer) return timer;

  const intervalMs = Math.max(60 * 1000, Number(options.intervalMs || FIVE_MINUTES_MS));
  const requestToken = options.requestToken || requestTMToken;
  const run = () => void checkTencentMeetingStsToken(requestToken);

  run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopTencentMeetingStsTokenCron() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
