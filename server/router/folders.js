import express from "express";
import { canDeleteAllRecordings, canReadRecording } from "../utils/common.mjs";
import { requestClientIdBetter } from "../utils/recordings.js";
import { recordingFromPrisma } from "../repositories/recordings.mjs";

const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/", async (request, response) => {
  const { canReadFolder, publicFolder } = dependencies;
  const clientId = requestClientIdBetter(request);
  const canDeleteAll = canDeleteAllRecordings();

  const [folderRows, recordingRows] = await prisma.$transaction([
    prisma.recordingFolder.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.recording.findMany(),
  ]);
  const recordings = recordingRows.map(recordingFromPrisma);
  const readableRecordings = canDeleteAll
    ? recordings
    : recordings.filter((recording) => canReadRecording(recording, clientId));
  const folders = folderRows
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      ownerClientId: folder.ownerClientId || "",
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }))
    .filter((folder) => canReadFolder(folder, clientId))
    .map((folder) => publicFolder(folder, readableRecordings));
  const activeRecordings = readableRecordings.filter((recording) => !recording.deletedAt);
  const uncategorizedCount = activeRecordings.filter((recording) => !recording.folderId).length;
  const favoriteCount = activeRecordings.filter((recording) => recording.favorite).length;
  const trashCount = recordings.filter((recording) => recording.deletedAt).length;

  response.json({ folders, uncategorizedCount, favoriteCount, trashCount, totalCount: activeRecordings.length });
});

router.post("/", async (request, response) => {
  const { updateDb, crypto, publicFolder } = dependencies;
  const name = String(request.body?.name || "").trim();
  const clientId = requestClientIdBetter(request);
  if (!name) {
    response.status(400).json({ error: "文件夹名称不能为空" });
    return;
  }

  const folder = await updateDb((db) => {
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      name,
      ownerClientId: clientId,
      createdAt: now,
      updatedAt: now,
    };

    db.folders.push(item);
    return publicFolder(item, db.recordings);
  });

  response.status(201).json({ folder });
});

router.patch("/:id", async (request, response) => {
  const { updateDb, canReadFolder, publicFolder } = dependencies;
  const clientId = requestClientIdBetter(request);
  const updated = await updateDb((db) => {
    const folder = db.folders.find((item) => item.id === request.params.id);
    if (!folder || !canReadFolder(folder, clientId)) return null;

    if (typeof request.body.name === "string") {
      folder.name = request.body.name.trim() || folder.name;
    }
    folder.updatedAt = new Date().toISOString();
    return publicFolder(folder, db.recordings);
  });

  if (!updated) {
    response.status(404).json({ error: "文件夹不存在" });
    return;
  }

  response.json({ folder: updated });
});

router.delete("/:id", async (request, response) => {
  const { updateDb, canReadFolder } = dependencies;
  const clientId = requestClientIdBetter(request);
  const deleted = await updateDb((db) => {
    const exists = db.folders.some((folder) => folder.id === request.params.id && canReadFolder(folder, clientId));
    if (!exists) return false;

    db.folders = db.folders.filter((folder) => folder.id !== request.params.id);
    db.recordings = db.recordings.map((recording) =>
      recording.folderId === request.params.id ? { ...recording, folderId: null, updatedAt: new Date().toISOString() } : recording,
    );
    return true;
  });

  if (!deleted) {
    response.status(404).json({ error: "文件夹不存在" });
    return;
  }

  response.json({ ok: true });
});

export default router;
