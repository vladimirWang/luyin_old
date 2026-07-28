import test from "node:test";
import assert from "node:assert/strict";

import { canonicalTencentMeetingWebhookRecordFileIds } from "./tencentMeetingWebhookPayload.mjs";

test("extracts and deduplicates canonical webhook record_file_id values", () => {
  assert.deepEqual(
    canonicalTencentMeetingWebhookRecordFileIds({
      payload: [
        {
          recording_files: [
            { record_file_id: "file-1" },
            { record_file_id: " file-2 " },
          ],
        },
        {
          recording_files: [{ record_file_id: "file-1" }],
        },
      ],
    }),
    ["file-1", "file-2"],
  );
});

test("does not infer record file IDs from undocumented aliases or containers", () => {
  assert.deepEqual(
    canonicalTencentMeetingWebhookRecordFileIds({
      payload: [
        {
          recordingFiles: [{ recordFileId: "alias-1" }],
          recording_files: [
            { recordFileId: "alias-2" },
            { record_file_id: 123 },
            null,
          ],
        },
      ],
      recording_files: [{ record_file_id: "wrong-level" }],
    }),
    [],
  );
});

test("returns an empty list for non-array canonical payload fields", () => {
  assert.deepEqual(
    canonicalTencentMeetingWebhookRecordFileIds({
      payload: {
        recording_files: [{ record_file_id: "file-1" }],
      },
    }),
    [],
  );
});
