import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRecordingSseEvent,
  publishRecordingEvent,
  recordingEventSubscriberCount,
  subscribeRecordingEvents,
} from "./recordingEvents.mjs";

test("publishes a compact recording status event and unsubscribes cleanly", () => {
  const received = [];
  const unsubscribe = subscribeRecordingEvents((event) => received.push(event));

  publishRecordingEvent("recording.updated", {
    id: "recording-1",
    name: "Meeting",
    fileStatus: "processing",
    transcriptStatus: "waiting",
    ownerClientId: "private-owner",
  });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].data, {
    id: "recording-1",
    name: "Meeting",
    status: "",
    fileStatus: "processing",
    transcriptStatus: "waiting",
    errorMessage: "",
    updatedAt: "",
  });
  assert.equal("ownerClientId" in received[0].data, false);
  assert.match(formatRecordingSseEvent(received[0]), /event: recording\.updated/);

  unsubscribe();
  assert.equal(recordingEventSubscriberCount(), 0);
});
