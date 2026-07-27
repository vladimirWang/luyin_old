import prisma from "../plugins/prisma.cjs";

function feedbackFromPrisma(row) {
  if (!row) return null;
  return {
    recordingId: row.recordingId,
    satisfied: row.satisfied,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findMeetingOutlineFeedback(recordingId, userId) {
  const row = await prisma.meetingOutlineFeedback.findUnique({
    where: {
      recordingId_userId: {
        recordingId,
        userId,
      },
    },
  });
  return feedbackFromPrisma(row);
}

export async function createMeetingOutlineFeedback({ recordingId, userId, satisfied }) {
  const row = await prisma.meetingOutlineFeedback.create({
    data: {
      recordingId,
      userId,
      satisfied,
    },
  });
  return feedbackFromPrisma(row);
}
