import prisma from "../plugins/prisma.cjs";

function feedbackFromPrisma(row) {
  if (!row) return null;
  return {
    recordingId: row.recordingId,
    contentType: row.contentType,
    satisfied: row.satisfied,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findRecordingFeedback(recordingId, userId, contentType) {
  const row = await prisma.recordingFeedback.findUnique({
    where: {
      recordingId_userId_contentType: {
        recordingId,
        userId,
        contentType,
      },
    },
  });
  return feedbackFromPrisma(row);
}

export async function createRecordingFeedback({ recordingId, userId, contentType, satisfied }) {
  const row = await prisma.recordingFeedback.create({
    data: {
      recordingId,
      userId,
      contentType,
      satisfied,
    },
  });
  return feedbackFromPrisma(row);
}
