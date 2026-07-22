import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTencentMeetingStsToken,
  startTencentMeetingStsTokenCron,
  stopTencentMeetingStsTokenCron,
} from "./tencentMeeting.js";

test("STS token cron delegates validity checks to the token service", async () => {
  let calls = 0;
  const result = await checkTencentMeetingStsToken(async () => {
    calls += 1;
    return { requested: false, reason: "token_fresh" };
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { requested: false, reason: "token_fresh" });
});

test("STS token cron runs once immediately when started", async () => {
  let resolveCheck;
  const checked = new Promise((resolve) => {
    resolveCheck = resolve;
  });

  startTencentMeetingStsTokenCron({
    requestToken: async () => {
      resolveCheck();
      return { requested: false, reason: "token_fresh" };
    },
  });

  await checked;
  stopTencentMeetingStsTokenCron();
});
