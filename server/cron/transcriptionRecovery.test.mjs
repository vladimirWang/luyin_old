import assert from "node:assert/strict";
import test from "node:test";
import {
  runTranscriptionRecovery,
  startTranscriptionRecoveryCron,
  stopTranscriptionRecoveryCron,
} from "./transcriptionRecovery.js";

test("transcription recovery runs every minute", async () => {
  let captured = null;
  let reason = "";
  const task = { stop() {} };
  const returned = startTranscriptionRecoveryCron({
    run: async (value) => {
      reason = value;
    },
    runOnStart: false,
    schedule(expression, callback, options) {
      captured = { expression, callback, options };
      return task;
    },
  });

  assert.equal(returned, task);
  assert.equal(captured.expression, "* * * * *");
  assert.equal(captured.options.noOverlap, true);
  await captured.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reason, "cron");
  stopTranscriptionRecoveryCron();
});

test("transcription recovery coalesces overlapping runs", async () => {
  let release;
  let runs = 0;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const run = async () => {
    runs += 1;
    await pending;
  };

  const first = runTranscriptionRecovery(run);
  const second = runTranscriptionRecovery(run);
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  release();
  await first;
});
