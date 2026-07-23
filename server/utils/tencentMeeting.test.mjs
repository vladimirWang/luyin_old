import test from "node:test";
import assert from "node:assert/strict";

import {
  isTencentMeetingRecorderTranscriptEvent,
  isTencentMeetingTranscriptReadyEvent,
  isTencentMeetingTranscriptSyncEvent,
  tencentMeetingTranscriptErrorKind,
  tencentMeetingTranscriptSyncMaxAttempts,
  tencentMeetingSummaryDownloadUrlsFromPayload,
  tencentMeetingWebhookEventAction,
  tencentMeetingTranscriptSegmentsFromPayload,
  tencentMeetingTranscriptSegmentsFromText,
} from "./tencentMeeting.mjs";

test("only the canonical smart.transcripts event marks a transcript as ready", () => {
  assert.equal(isTencentMeetingTranscriptReadyEvent({ event: "smart.transcripts" }), true);
  assert.equal(isTencentMeetingTranscriptReadyEvent({ event: "recording.completed" }), false);
  assert.equal(isTencentMeetingTranscriptReadyEvent({ event_type: "smart.transcripts" }), false);
  assert.equal(isTencentMeetingTranscriptReadyEvent({ Event: "smart.transcripts" }), false);
});

test("canonical recorder completion events can start recorder transcript synchronization", () => {
  assert.equal(isTencentMeetingRecorderTranscriptEvent({ event: "recording.audio-completed" }), true);
  assert.equal(isTencentMeetingRecorderTranscriptEvent({ event_type: "recording.audio-completed" }), false);
  assert.equal(isTencentMeetingTranscriptSyncEvent({ event: "recording.audio-completed" }), true);
  assert.equal(isTencentMeetingTranscriptSyncEvent({ event: "smart.transcripts" }), true);
  assert.equal(isTencentMeetingTranscriptSyncEvent({ event: "recording.completed" }), false);
});

test("recorder transcript synchronization retries content-generation responses", () => {
  const previous = process.env.TENCENT_MEETING_RECORDER_TRANSCRIPT_MAX_ATTEMPTS;
  process.env.TENCENT_MEETING_RECORDER_TRANSCRIPT_MAX_ATTEMPTS = "4";
  try {
    assert.equal(tencentMeetingTranscriptSyncMaxAttempts({ event: "recording.audio-completed" }), 4);
    assert.equal(tencentMeetingTranscriptSyncMaxAttempts({ event: "smart.transcripts" }), 1);
    assert.equal(tencentMeetingTranscriptErrorKind(new Error("Tencent Meeting API failed: 500 30003 content generating")), "pending");
    assert.equal(tencentMeetingTranscriptErrorKind(new Error("Tencent Meeting API failed: 500 30002 transcript empty")), "empty");
  } finally {
    if (previous === undefined) delete process.env.TENCENT_MEETING_RECORDER_TRANSCRIPT_MAX_ATTEMPTS;
    else process.env.TENCENT_MEETING_RECORDER_TRANSCRIPT_MAX_ATTEMPTS = previous;
  }
});

test("recorder detail payload exposes intelligent transcript text downloads", () => {
  assert.deepEqual(
    tencentMeetingSummaryDownloadUrlsFromPayload({
      ai_meeting_transcripts: [
        { file_type: "txt", download_address: "https://example.test/recorder-transcript.txt" },
        { file_type: "pdf", download_address: "https://example.test/recorder-transcript.pdf" },
      ],
    }),
    ["https://example.test/recorder-transcript.txt"],
  );
});

test("Tencent Meeting webhook events map to separate canonical actions", () => {
  assert.equal(tencentMeetingWebhookEventAction({ event: "common.sts-token" }), "sts-token");
  assert.equal(tencentMeetingWebhookEventAction({ event: "recording.started" }), "recording-started");
  assert.equal(tencentMeetingWebhookEventAction({ event: "recording.completed" }), "recording-completed");
  assert.equal(tencentMeetingWebhookEventAction({ event: "recording.audio-completed" }), "audio-completed");
  assert.equal(tencentMeetingWebhookEventAction({ event: "smart.transcripts" }), "transcript-ready");
  assert.equal(tencentMeetingWebhookEventAction({ event_type: "recording.audio-completed" }), "ignored");
  assert.equal(tencentMeetingWebhookEventAction({ event: "unknown.event" }), "ignored");
});

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
