import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import logger from "./log.js";

export async function removeFileIfExists(filePath) {
  if (!filePath) return;
  await rm(filePath, { force: true }).catch((err) => {
    logger.error('failed to remove file: ', {message: `Failed to remove file: ${filePath}, err: ${err.message}`});
  });
}

function uniqueFilePaths(filePaths = []) {
  return [...new Set(filePaths.map((filePath) => String(filePath || "").trim()).filter(Boolean))];
}

export async function stageFilesForDeletion(filePaths = [], transactionId = "") {
  const suffix = String(transactionId || Date.now()).replace(/[^a-zA-Z0-9-]/g, "");
  const stagedFiles = [];
  try {
    for (const originalPath of uniqueFilePaths(filePaths)) {
      const stagedPath = `${originalPath}.deleting-${suffix}`;
      try {
        await rename(originalPath, stagedPath);
        stagedFiles.push({ originalPath, stagedPath });
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
    }
    return stagedFiles;
  } catch (error) {
    await restoreStagedFiles(stagedFiles);
    throw error;
  }
}

export async function restoreStagedFiles(stagedFiles = []) {
  const failures = [];
  for (const file of [...stagedFiles].reverse()) {
    try {
      await rename(file.stagedPath, file.originalPath);
    } catch (error) {
      if (error?.code !== "ENOENT") failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Failed to restore files after database transaction rollback.");
  }
}

export async function finalizeStagedFileDeletions(stagedFiles = []) {
  const failures = [];
  for (const file of stagedFiles) {
    try {
      await rm(file.stagedPath, { recursive: true, force: true });
    } catch (error) {
      failures.push({ path: file.stagedPath, error });
    }
  }
  return failures;
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function findRecordingTemporaryArtifacts(tempRoot, recordingId) {
  const root = String(tempRoot || "").trim();
  const id = String(recordingId || "").trim();
  if (!root || !id) return [];

  const artifacts = [];
  const rootEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.name.includes(id)) artifacts.push(path.join(root, entry.name));
  }

  for (const sessionRootName of ["upload-sessions", "recording-upload-sessions"]) {
    const sessionRoot = path.join(root, sessionRootName);
    const sessionEntries = await readdir(sessionRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(sessionRoot, entry.name);
      const meta = await readJsonFile(path.join(sessionPath, "meta.json"));
      if (String(meta?.recordingId || "").trim() === id) artifacts.push(sessionPath);
    }
  }

  return uniqueFilePaths(artifacts);
}
