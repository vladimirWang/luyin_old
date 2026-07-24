const prisma = await import("../plugins/prisma.cjs").then((module) => module.default || module);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function iso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function nullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dailyMeetingBriefFromPrisma(row = {}) {
  return {
    id: row.id,
    date: row.dateKey,
    clientId: row.clientId || "",
    displayDate: row.displayDate || "",
    timezone: row.timezone || "Asia/Shanghai",
    meetingCount: Number(row.meetingCount || 0),
    recordingIds: parseJson(row.recordingIdsJson, []),
    title: row.title || "今日会议简报",
    summaryMarkdown: row.summaryMarkdown || "",
    status: row.status || "empty",
    generatedAt: iso(row.generatedAt),
    updatedAt: iso(row.updatedAt),
    dirty: Boolean(row.dirty),
  };
}

export async function listDailyMeetingBriefsByDateWithPrisma(dateKey) {
  const rows = await prisma.dailyMeetingBrief.findMany({ where: { dateKey } });
  return rows.map(dailyMeetingBriefFromPrisma);
}

export async function findDailyMeetingBriefWithPrisma(dateKey, clientId) {
  const row = await prisma.dailyMeetingBrief.findFirst({
    where: { dateKey, clientId },
  });
  return row ? dailyMeetingBriefFromPrisma(row) : null;
}

export async function upsertDailyMeetingBriefWithPrisma(brief) {
  const data = {
    displayDate: brief.displayDate || "",
    timezone: brief.timezone || "Asia/Shanghai",
    meetingCount: Number(brief.meetingCount || 0),
    recordingIdsJson: JSON.stringify(brief.recordingIds || []),
    title: brief.title || "",
    summaryMarkdown: brief.summaryMarkdown || "",
    status: brief.status || "empty",
    generatedAt: nullableDate(brief.generatedAt),
    updatedAt: nullableDate(brief.updatedAt) || new Date(),
    dirty: Boolean(brief.dirty),
  };
  const row = await prisma.dailyMeetingBrief.upsert({
    where: {
      dateKey_clientId: {
        dateKey: brief.date,
        clientId: brief.clientId,
      },
    },
    create: {
      id: brief.id,
      dateKey: brief.date,
      clientId: brief.clientId,
      ...data,
    },
    update: data,
  });
  return dailyMeetingBriefFromPrisma(row);
}
