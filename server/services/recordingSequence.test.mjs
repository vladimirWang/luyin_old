import assert from "node:assert/strict";
import test from "node:test";
import {
  initializeRecordingSequence,
  nextRecordingSequence,
  RECORDING_CURRENT_SEQ_KEY,
} from "./recordingSequence.js";

test("recording sequence initializes from the largest persisted seq", async () => {
  const writes = [];
  const currentSeq = await initializeRecordingSequence({
    prismaClient: {
      recording: {
        aggregate: async () => ({ _max: { seq: 27 } }),
      },
    },
    redis: {
      set: async (...args) => writes.push(args),
    },
  });

  assert.equal(currentSeq, 27);
  assert.deepEqual(writes, [[RECORDING_CURRENT_SEQ_KEY, "27"]]);
});

test("recording sequence initializes to zero when recordings is empty", async () => {
  const writes = [];
  const currentSeq = await initializeRecordingSequence({
    prismaClient: {
      recording: {
        aggregate: async () => ({ _max: { seq: null } }),
      },
    },
    redis: {
      set: async (...args) => writes.push(args),
    },
  });

  assert.equal(currentSeq, 0);
  assert.deepEqual(writes, [[RECORDING_CURRENT_SEQ_KEY, "0"]]);
});

test("next recording sequence uses Redis atomic increment", async () => {
  const keys = [];
  const seq = await nextRecordingSequence({
    redis: {
      incr: async (key) => {
        keys.push(key);
        return 28;
      },
    },
  });

  assert.equal(seq, 28);
  assert.deepEqual(keys, [RECORDING_CURRENT_SEQ_KEY]);
});
