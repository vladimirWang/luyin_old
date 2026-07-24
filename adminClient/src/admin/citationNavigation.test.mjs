import assert from "node:assert/strict";
import test from "node:test";
import {
  citationJumpMs,
  findCitationSegment,
  findNearestTranscriptSegment,
  segmentDomKey,
} from "./citationNavigation.js";

const segments = [
  { id: "s1", startMs: 0, endMs: 2800 },
  { id: "s2", startMs: 3200, endMs: 5900 },
  { id: "s3", startMs: 6400, endMs: 9000 },
];

test("citationJumpMs accepts common citation time fields", () => {
  assert.equal(citationJumpMs({ startMs: 1200, jumpToMs: 4000 }), 1200);
  assert.equal(citationJumpMs({ jumpToMs: "4300" }), 4300);
  assert.equal(citationJumpMs({ beginMs: 12.6 }), 13);
  assert.equal(citationJumpMs({ start_ms: -10 }), 0);
});

test("findNearestTranscriptSegment returns the containing segment first", () => {
  assert.equal(findNearestTranscriptSegment(segments, 5100).id, "s2");
});

test("findNearestTranscriptSegment tolerates small citation timestamp drift", () => {
  assert.equal(findNearestTranscriptSegment(segments, 6100).id, "s2");
  assert.equal(findNearestTranscriptSegment(segments, 6200).id, "s3");
});

test("findCitationSegment prefers an exact segment id before nearest time", () => {
  assert.equal(findCitationSegment(segments, { segmentId: "s1", startMs: 7000 }).id, "s1");
  assert.equal(findCitationSegment(segments, { segmentId: "missing", startMs: 7000 }).id, "s3");
});

test("segmentDomKey keeps zero timestamps and arbitrary ids stable", () => {
  assert.equal(segmentDomKey({ startMs: 0 }), "0");
  assert.equal(segmentDomKey({ id: "seg:1[quoted]", startMs: 1200 }), "seg:1[quoted]");
  assert.equal(segmentDomKey({ id: " ", startMs: "42.4" }), "42");
});
