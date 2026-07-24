import test from "node:test";
import assert from "node:assert/strict";

import {
  inferredMeetingOwner,
  projectName,
  recordingCategory,
  recordingMemberNames,
  recordingUploaderName,
  tagTaxonomy,
} from "./recordingTaxonomy.js";

test("tag taxonomy provides a project fallback and a narrower category", () => {
  assert.deepEqual(tagTaxonomy("户型优化 / 产品力"), { project: "户型优化", category: "产品力" });
  assert.equal(projectName({ tag: "户型优化 / 产品力" }), "户型优化");
  assert.equal(recordingCategory({ tag: "户型优化 / 产品力" }), "产品力");
});

test("folder remains the preferred project source", () => {
  const folders = new Map([["folder-1", "中企财富世纪大厦"]]);
  assert.equal(projectName({ folderId: "folder-1", tag: "录音笔 / 权限设置" }, folders), "中企财富世纪大厦");
});

test("member names prefer account data and remove generic speaker labels", () => {
  const recording = {
    name: "王晓宇快速会议",
    uploaderName: "王晓宇",
    speakerName: "speaker-1",
    speakers: [{ name: "speaker-1" }, { name: "speaker-2" }],
  };
  assert.deepEqual(recordingMemberNames(recording), ["王晓宇"]);
  assert.equal(recordingUploaderName(recording), "王晓宇");
});

test("meeting title inference only accepts explicit organizer patterns", () => {
  assert.equal(inferredMeetingOwner({ name: "董伟强预定的会议" }), "董伟强");
  assert.equal(inferredMeetingOwner({ name: "接口地址修改与数据同步验证" }), "");
});
