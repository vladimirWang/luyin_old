import prisma from "../plugins/prisma.cjs";

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function qaMessageFromPrisma(row) {
  return {
    id: row.id,
    recordingId: row.recordingId || null,
    recordingIds: parseJson(
      row.recordingIdsJson,
      row.recordingId ? [row.recordingId] : [],
    ),
    clientId: row.clientId || "",
    question: row.question || "",
    answer: row.answer || "",
    structuredAnswer: parseJson(row.structuredAnswerJson, null),
    status: row.qaStatus || "",
    pending: row.qaStatus === "pending",
    jumpToMs: Number(row.jumpToMs || 0),
    citations: parseJson(row.citationsJson, []),
    attachments: parseJson(row.attachmentsJson, []),
    provider: row.provider || "",
    model: row.model || "",
    reasoningContent: row.reasoningContent || "",
    thinking: parseJson(row.thinkingJson, []),
    favorite: Boolean(row.favorite),
    deletedAt: row.deletedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listQaMessagesByClientId({
  clientId,
  favoriteOnly = false,
  limit = 50,
}) {
  const rows = await prisma.recordingQuestion.findMany({
    where: {
      clientId,
      deletedAt: null,
      ...(favoriteOnly ? { favorite: true } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.min(200, Math.max(1, Number(limit || 50))),
  });
  return rows.map(qaMessageFromPrisma);
}

