import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecentWindows,
  keepKnownRecordingIds,
  latestResolvedAutoScope,
  patchQaSession,
  recordingIdsAfterAsk,
  recordingIdsForSession,
} from "./sessionState.js";

test("recordingIdsForSession restores explicit manual session scope", () => {
  const ids = recordingIdsForSession(
    "s1",
    [{ id: "s1", scope: { key: "selected" }, recordingIds: ["r-meta", "r-meta", ""] }],
    [{ id: "m1", sessionId: "s1", scope: "selected", recordingIds: ["r-message"] }],
  );
  assert.deepEqual(ids, ["r-meta"]);
});

test("recordingIdsForSession does not turn the latest automatic scope into a manual lock", () => {
  const ids = recordingIdsForSession(
    "s1",
    [{ id: "s1", scope: { key: "today" }, recordingIds: ["today-1", "today-2"] }],
    [{ id: "m1", sessionId: "s1", scope: "selected", recordingIds: ["old-manual"] }],
  );
  assert.deepEqual(ids, []);
});

test("recordingIdsForSession unlocks legacy sessions that repeated the previous automatic ids", () => {
  const ids = recordingIdsForSession(
    "s1",
    [{ id: "s1", scope: { key: "selected" }, recordingIds: ["today-1", "today-2"] }],
    [
      { id: "m1", sessionId: "s1", scope: "today", recordingIds: ["today-1", "today-2"] },
      { id: "m2", sessionId: "s1", scope: "selected", recordingIds: ["today-1", "today-2"] },
    ],
  );
  assert.deepEqual(ids, []);
});

test("recordingIdsForSession preserves a genuinely changed manual range", () => {
  const ids = recordingIdsForSession(
    "s1",
    [{ id: "s1", scope: { key: "selected" }, recordingIds: ["manual-1"] }],
    [
      { id: "m1", sessionId: "s1", scope: "today", recordingIds: ["today-1", "today-2"] },
      { id: "m2", sessionId: "s1", scope: "selected", recordingIds: ["manual-1"] },
    ],
  );
  assert.deepEqual(ids, ["manual-1"]);
});

test("recordingIdsForSession falls back to latest selected message in a window", () => {
  const ids = recordingIdsForSession("s1", [], [
    { id: "m1", sessionId: "s1", scope: "selected", recordingIds: ["r-old"] },
    { id: "m2", sessionId: "s1", scope: "today", recordingIds: ["today"] },
    { id: "m3", sessionId: "s1", scope: "selected", recordingIds: ["r-new", "r-new", " "] },
  ]);
  assert.deepEqual(ids, ["r-new"]);
});

test("keepKnownRecordingIds drops deleted or unavailable recordings", () => {
  assert.deepEqual(keepKnownRecordingIds(["r1", "missing", "r2"], [{ id: "r1" }, { id: "r2" }]), ["r1", "r2"]);
});

test("recordingIdsAfterAsk keeps automatic scopes automatic", () => {
  const ids = recordingIdsAfterAsk([], ["today-1", "today-2"], [{ id: "today-1" }, { id: "today-2" }]);
  assert.deepEqual(ids, []);
});

test("recordingIdsAfterAsk trusts confirmed manual scope and drops unavailable ids", () => {
  const recordings = [{ id: "r1" }, { id: "r2" }];
  assert.deepEqual(recordingIdsAfterAsk(["r1", "stale"], ["r1"], recordings), ["r1"]);
  assert.deepEqual(recordingIdsAfterAsk(["r1", "r2"], [], recordings), ["r1", "r2"]);
});

test("latestResolvedAutoScope reports the latest inferred range without locking selection", () => {
  const scope = latestResolvedAutoScope(
    [
      { id: "m1", scope: "today", scopeLabel: "今天（默认）", recordingIds: ["today"] },
      { id: "m2", scope: "last-week+metadata", scopeLabel: "上周 + 项目：Alpha", recordingIds: ["alpha", "missing"] },
    ],
    [{ id: "today" }, { id: "alpha" }],
  );

  assert.deepEqual(scope, {
    scope: "last-week+metadata",
    label: "上周 + 项目：Alpha",
    recordingIds: ["alpha"],
  });
});

test("latestResolvedAutoScope ignores manual selection and local UI placeholders", () => {
  const scope = latestResolvedAutoScope(
    [
      { id: "m1", scope: "all", scopeLabel: "全部录音", recordingIds: ["all"] },
      { id: "scope-change", scopeChange: true, recordingIds: ["ignored"] },
      { id: "pending", pending: true, recordingIds: ["ignored"] },
      { id: "m2", scope: "selected", scopeLabel: "已手动选择", recordingIds: ["manual"] },
    ],
    [{ id: "all" }, { id: "manual" }],
  );

  assert.deepEqual(scope, {
    scope: "all",
    label: "全部录音",
    recordingIds: ["all"],
  });
});

test("patchQaSession preserves existing metadata and updates scope", () => {
  const [updated] = patchQaSession(
    [{ id: "s1", title: "客户复盘", createdAt: "2026-06-01T00:00:00.000Z", recordingIds: ["old"] }],
    "s1",
    { recordingIds: ["new"] },
  );
  assert.equal(updated.title, "客户复盘");
  assert.equal(updated.createdAt, "2026-06-01T00:00:00.000Z");
  assert.deepEqual(updated.recordingIds, ["new"]);
});

test("buildRecentWindows does not double count stored metadata and loaded messages", () => {
  const windows = buildRecentWindows(
    [{ id: "m1", sessionId: "s1", question: "今天有什么会", createdAt: "2026-06-30T09:00:00.000Z" }],
    [{ id: "m1", sessionId: "s1", question: "今天有什么会", createdAt: "2026-06-30T09:00:00.000Z" }],
    "s1",
    [{ id: "s1", title: "今天有什么会", count: 1, preview: "今天有什么会", updatedAt: "2026-06-30T09:00:00.000Z" }],
  );
  assert.equal(windows[0].count, 1);
  assert.equal(windows[0].id, "s1");
});

test("buildRecentWindows does not list an unsent draft", () => {
  const windows = buildRecentWindows([], [], "draft-session", []);
  assert.deepEqual(windows, []);
});
