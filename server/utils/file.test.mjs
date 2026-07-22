import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeStagedFileDeletions,
  findRecordingTemporaryArtifacts,
  restoreStagedFiles,
  stageFilesForDeletion,
} from "./file.js";

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("staged deletion can restore files after a database rollback", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recording-delete-rollback-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const originalPath = path.join(directory, "audio.mp3");
  await writeFile(originalPath, "audio");

  const stagedFiles = await stageFilesForDeletion([originalPath], "rollback-test");
  assert.equal(await pathExists(originalPath), false);
  assert.equal(await pathExists(stagedFiles[0].stagedPath), true);

  await restoreStagedFiles(stagedFiles);
  assert.equal(await readFile(originalPath, "utf8"), "audio");
  assert.equal(await pathExists(stagedFiles[0].stagedPath), false);
});

test("recording temporary artifacts include named files and upload sessions", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recording-delete-temp-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const recordingId = "recording-123";
  const namedTemporaryFile = path.join(directory, `converted-${recordingId}.mp3`);
  const uploadSession = path.join(directory, "upload-sessions", "session-abc");
  const unrelatedSession = path.join(directory, "upload-sessions", "session-other");
  await mkdir(uploadSession, { recursive: true });
  await mkdir(unrelatedSession, { recursive: true });
  await writeFile(namedTemporaryFile, "temporary audio");
  await writeFile(path.join(uploadSession, "meta.json"), JSON.stringify({ recordingId }));
  await writeFile(path.join(unrelatedSession, "meta.json"), JSON.stringify({ recordingId: "other" }));

  const artifacts = await findRecordingTemporaryArtifacts(directory, recordingId);
  assert.deepEqual(new Set(artifacts), new Set([namedTemporaryFile, uploadSession]));

  const stagedFiles = await stageFilesForDeletion(artifacts, "temp-artifacts");
  assert.equal(await pathExists(namedTemporaryFile), false);
  assert.equal(await pathExists(uploadSession), false);
  assert.deepEqual(await finalizeStagedFileDeletions(stagedFiles), []);
});

test("staged deletion permanently removes files after a database commit", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recording-delete-commit-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const originalPath = path.join(directory, "transcript.txt");
  await writeFile(originalPath, "transcript");

  const stagedFiles = await stageFilesForDeletion([originalPath], "commit-test");
  const failures = await finalizeStagedFileDeletions(stagedFiles);

  assert.deepEqual(failures, []);
  assert.equal(await pathExists(originalPath), false);
  assert.equal(await pathExists(stagedFiles[0].stagedPath), false);
});
