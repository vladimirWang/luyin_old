import assert from "node:assert/strict";
import test from "node:test";
import { tencentMeetingTranscriptSegmentsFromPayload } from "./tencentMeeting.mjs";

test("Tencent Meeting payload parser extracts text from nested values", () => {
  const result = tencentMeetingTranscriptSegmentsFromPayload({
    minutes: {
      paragraphs: [
        {
          start_time: 2_000,
          text: [{ text: "validated. " }, { content: "transcript ready." }],
        },
      ],
    },
  });

  assert.deepEqual(result.segments.map((segment) => segment.text), ["validated.transcript ready."]);
});
