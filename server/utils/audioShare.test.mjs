import assert from "node:assert/strict";
import test from "node:test";
import { createAudioDownloadToken, hasValidAudioDownloadToken } from "./audioShare.js";

test("audio share tokens only authorize the intended recording", () => {
  const token = createAudioDownloadToken("recording-1", 60_000);

  assert.equal(hasValidAudioDownloadToken(token, "recording-1"), true);
  assert.equal(hasValidAudioDownloadToken(token, "recording-2"), false);
  assert.equal(hasValidAudioDownloadToken(`${token}tampered`, "recording-1"), false);
});

test("expired audio share tokens are rejected", () => {
  const token = createAudioDownloadToken("recording-1", -1);

  assert.equal(hasValidAudioDownloadToken(token, "recording-1"), false);
});
