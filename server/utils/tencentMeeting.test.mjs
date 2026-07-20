import test from "node:test";
import assert from "node:assert/strict";

import {
  tencentMeetingTranscriptSegmentsFromPayload,
  tencentMeetingTranscriptSegmentsFromText,
} from "./tencentMeeting.mjs";

test("Tencent Meeting payload parser returns the transcript result shape used by sync jobs", () => {
  const result = tencentMeetingTranscriptSegmentsFromPayload(
    {
      minutes: {
        paragraphs: [
          {
            pid: "0",
            start_time: 1200,
            end_time: 4500,
            speaker_id: "user-1",
            speaker_name: "张三",
            text: "项目按计划推进。",
          },
          {
            pid: "1",
            speaker_id: "user-1",
            speaker_name: "张三",
            text: "下一步继续跟进。",
          },
        ],
      },
    },
    10_000,
  );

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].startMs, 1200);
  assert.equal(result.segments[0].endMs, 4500);
  assert.equal(result.segments[0].text, "项目按计划推进。");
  assert.equal(result.segments[1].startMs, 4500);
  assert.equal(result.speakerMap[result.segments[0].speakerKey], "张三");
});

test("Tencent Meeting summary parser returns segments with normalized millisecond fields", () => {
  const result = tencentMeetingTranscriptSegmentsFromText("【李四】第一项结论\n第二项结论", 8_000);

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].startMs, 0);
  assert.equal(result.segments[0].endMs, 8_000);
  assert.match(result.rawText, /第一项结论/);
});
