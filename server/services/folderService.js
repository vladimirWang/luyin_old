import { canDeleteAllRecordings, canReadRecording } from "../utils/common.mjs";
import { recordingFromPrisma } from "../repositories/recordings.mjs";

const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);

function folderFromPrisma(folder) {
  return {
    id: folder.id,
    name: folder.name,
    ownerClientId: folder.ownerClientId || "",
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

export function createFolderService({ crypto, canReadFolder, publicFolder }) {
  return {
    async list(clientId) {
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
        .map(folderFromPrisma)
        .filter((folder) => canReadFolder(folder, clientId))
        .map((folder) => publicFolder(folder, readableRecordings));
      const activeRecordings = readableRecordings.filter((recording) => !recording.deletedAt);
      return {
        folders,
        uncategorizedCount: activeRecordings.filter((recording) => !recording.folderId).length,
        favoriteCount: activeRecordings.filter((recording) => recording.favorite).length,
        trashCount: recordings.filter((recording) => recording.deletedAt).length,
        totalCount: activeRecordings.length,
      };
    },

    async create({ clientId, name }) {
      const folder = await prisma.recordingFolder.create({
        data: {
          id: crypto.randomUUID(),
          name,
          ownerClientId: clientId,
        },
      });
      return publicFolder(folderFromPrisma(folder), []);
    },

    async update({ id, clientId, name }) {
      const current = await prisma.recordingFolder.findUnique({ where: { id } });
      const normalizedCurrent = current ? folderFromPrisma(current) : null;
      if (!normalizedCurrent || !canReadFolder(normalizedCurrent, clientId)) return null;
      const folder = await prisma.recordingFolder.update({
        where: { id },
        data: typeof name === "string" && name.trim() ? { name: name.trim() } : {},
      });
      const recordings = (await prisma.recording.findMany({ where: { folderId: id } })).map(recordingFromPrisma);
      return publicFolder(folderFromPrisma(folder), recordings);
    },

    async remove({ id, clientId }) {
      const current = await prisma.recordingFolder.findUnique({ where: { id } });
      const folder = current ? folderFromPrisma(current) : null;
      if (!folder || !canReadFolder(folder, clientId)) return false;
      await prisma.$transaction([
        prisma.recording.updateMany({ where: { folderId: id }, data: { folderId: null } }),
        prisma.recordingFolder.delete({ where: { id } }),
      ]);
      return true;
    },
  };
}
