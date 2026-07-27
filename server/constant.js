export const TENCENT_MEETING_SOURCE_PREFIX = "tencent-meeting";

export const RECORDING_FEEDBACK_CONTENT_TYPES = Object.freeze({
  MEETING_OUTLINE: "meeting_outline",
  TRANSCRIPT: "transcript",
});

export const TENCENT_MEETING_WEBHOOK_EVENTS = Object.freeze({
  "COMMON.STS-TOKEN": "common.sts-token",
  "RECORDING.STARTED": "recording.started",
  "RECORDING.COMPLETED": "recording.completed",
  "RECORDING.AUDIO-COMPLETED": "recording.audio-completed",
  "SMART.TRANSCRIPTS": "smart.transcripts",
});
