import assert from "node:assert/strict";
import test from "node:test";
import {
  runDailyBriefCron,
  startDailyBriefCron,
  stopDailyBriefCron,
} from "./dailyBrief.js";

test("daily brief cron schedules 19:00 in Asia/Shanghai", async () => {
  let captured = null;
  let runs = 0;
  const task = { stop() {} };

  const returned = startDailyBriefCron({
    run: async () => {
      runs += 1;
    },
    runOnStart: false,
    schedule(expression, callback, options) {
      captured = { expression, callback, options };
      return task;
    },
  });

  assert.equal(returned, task);
  assert.equal(captured.expression, "0 19 * * *");
  assert.equal(captured.options.timezone, "Asia/Shanghai");
  assert.equal(captured.options.noOverlap, true);

  await captured.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  stopDailyBriefCron();
});

test("daily brief cron coalesces overlapping runs", async () => {
  let release;
  let runs = 0;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const run = async () => {
    runs += 1;
    await pending;
  };

  const first = runDailyBriefCron(run);
  const second = runDailyBriefCron(run);
  assert.equal(first, second);
  assert.equal(runs, 0);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  release();
  await first;
});
