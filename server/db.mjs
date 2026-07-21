import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "./utils/log.js";
import { tencentMeetingWebhookDir } from "./config.js";
import {
  listRecordingsWithPrisma,
  listTranscriptSegmentsWithPrisma,
  persistRecordingChangesWithPrisma,
} from "./repositories/recordings.mjs";
console.log("-------------tencentMeetingWebhookDir: ", tencentMeetingWebhookDir)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = path.join(__dirname, "data");
export const audioDir = path.join(__dirname, "storage", "audio");
export const accountDir = path.join(__dirname, "storage", "accounts");
export const attachmentDir = path.join(__dirname, "storage", "attachments");
export const transcriptDir = path.join(__dirname, "storage", "transcripts");
export const ttsDir = path.join(__dirname, "storage", "tts");
export const tempDir = path.join(__dirname, "storage", "tmp");
export const dbFile = path.join(dataDir, "db.json");

const defaultDb = {
  counters: {
    recordingSeq: 0,
  },
  profile: {
    name: "未设置姓名",
    company: "企业微信团队",
    department: "产品与会议",
    phone: "",
    language: "中文",
    recordsTitle: "我的录音",
  },
  recordings: [],
  folders: [],
  transcriptSegments: [],
  qaMessages: [],
  clientProfiles: {},
  accounts: [],
  dailyMeetingBriefs: [],
};

let writeQueue = Promise.resolve();
let mysqlPool;

function mysqlEnabled() {
  return Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);
}

function mysqlDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

function iso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function accountFileName(account = {}) {
  return `account-${String(account.id || account.username || "unknown").replace(/[^a-z0-9._-]/gi, "_")}.json`;
}

async function syncAccountFiles(db) {
  await mkdir(accountDir, { recursive: true });
  const accounts = Array.isArray(db.accounts) ? db.accounts : [];
  const index = accounts
    .filter((account) => account?.id && account?.username)
    .map((account) => ({
      id: account.id,
      username: account.username,
      file: accountFileName(account),
      updatedAt: account.updatedAt || account.createdAt || "",
    }));

  await writeFile(path.join(accountDir, "accounts-index.json"), `${JSON.stringify({ updatedAt: new Date().toISOString(), accounts: index }, null, 2)}\n`, "utf8");

  for (const account of accounts) {
    if (!account?.id || !account?.username) continue;
    const payload = {
      id: account.id,
      username: account.username,
      passwordCredential: {
        algorithm: "scrypt",
        salt: account.passwordSalt || "",
        hash: account.passwordHash || "",
      },
      profile: account.profile || {},
      createdAt: account.createdAt || "",
      updatedAt: account.updatedAt || "",
    };
    await writeFile(path.join(accountDir, accountFileName(account)), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFileError(error) {
  return ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
}

async function replaceDbFile(tmpFile) {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rename(tmpFile, dbFile);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error)) throw error;
      await delay(Math.min(900, 70 * (attempt + 1)));
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await copyFile(tmpFile, dbFile);
      await rm(tmpFile, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error)) throw error;
      await delay(Math.min(1200, 120 * (attempt + 1)));
    }
  }

  const payload = await readFile(tmpFile, "utf8");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await writeFile(dbFile, payload, "utf8");
      await rm(tmpFile, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error)) throw error;
      await delay(Math.min(1500, 160 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function getMysqlPool() {
  if (mysqlPool) return mysqlPool;
  const mysql = await import("mysql2/promise");
  mysqlPool = process.env.DATABASE_URL
    ? mysql.createPool(process.env.DATABASE_URL)
    : mysql.createPool({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE || "wecom_recorder",
        waitForConnections: true,
        connectionLimit: 10,
      });
  return mysqlPool;
}

export async function ensureStorage() {
  const task1 = mkdir(dataDir, { recursive: true });
  const task2 = mkdir(accountDir, { recursive: true });
  const task3 = mkdir(audioDir, { recursive: true });
  const task4 = mkdir(attachmentDir, { recursive: true });
  const task5 = mkdir(transcriptDir, { recursive: true });
  const task6 = mkdir(ttsDir, { recursive: true });
  const task7 = mkdir(tempDir, { recursive: true });
  const task8 = mkdir(tencentMeetingWebhookDir, {recursive: true})

  return Promise.all([task1, task2, task3, task4, task5, task6, task7, task8]);
  
  // TODO 待删除 多余判断
  // if (mysqlEnabled()) return;

  // try {
  //   await readFile(dbFile, "utf8");
  // } catch {
  //   await saveDb(defaultDb);
  // }
}

export async function loadDb() {
  logger.info("[CALL] loadDb", {message: "start"});
  // TODO 待删除 多余判断, 因为肯定会有mysql
  // if (mysqlEnabled()) {
  //   logger.info("[CALL] loadDb: mysqlEnabled() is true, loading from MySQL database");
  //   return loadMysqlDb();
  // }
  return loadMysqlDb();

  // TODO 待删除 多余判断, 因为肯定会有mysql
  // logger.info("[CALL] loadDb: mysqlEnabled() is false, loading from local file");
  // // await ensureStorage();
  // const raw = await readFile(dbFile, "utf8");
  // logger.info("[CALL] loadDb: ${raw.slice(0, 100)}...");
  // const parsed = JSON.parse(raw);

  // return {
  //   ...defaultDb,
  //   ...parsed,
  //   counters: {
  //     ...defaultDb.counters,
  //     ...(parsed.counters || {}),
  //   },
  //   profile: {
  //     ...defaultDb.profile,
  //     ...(parsed.profile || {}),
  //   },
  //   recordings: (parsed.recordings || []).map((recording) => ({
  //     speakerName: "说话人 1",
  //     speakerMap: {},
  //     ownerClientId: "",
  //     ownerName: "",
  //     shared: true,
  //     sharedAt: "",
  //     detectedLanguage: "",
  //     translationText: "",
  //     tag: "",
  //     deletedAt: null,
  //     transcriptProvider: "",
  //     transcriptSource: "",
  //     transcribedAt: "",
  //     transcriptPath: "",
  //     transcriptRawPath: "",
  //     transcriptCorrectedPath: "",
  //     transcriptionMetaPath: "",
  //     meetingOutline: null,
  //     meetingOutlineStatus: "",
  //     meetingOutlineError: "",
  //     meetingOutlinedAt: "",
  //     ...recording,
  //   })),
  //   folders: (parsed.folders || []).map((folder) => ({
  //     ownerClientId: "",
  //     ...folder,
  //   })),
  //   transcriptSegments: parsed.transcriptSegments || [], // 录音的转写片段（字幕）数组
  //   qaMessages: parsed.qaMessages || [],
  //   dailyMeetingBriefs: Array.isArray(parsed.dailyMeetingBriefs)
  //     ? parsed.dailyMeetingBriefs.map((brief) => ({ clientId: "", ...brief }))
  //     : [],
  //   accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
  //   clientProfiles:
  //     parsed.clientProfiles && typeof parsed.clientProfiles === "object" && !Array.isArray(parsed.clientProfiles)
  //       ? parsed.clientProfiles
  //       : {},
  // };
}

export async function saveDb(db) {
  if (mysqlEnabled()) {
    await saveMysqlDb(db);
    await syncAccountFiles(db);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  const tmpFile = path.join(
    dataDir,
    `db.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.json.tmp`,
  );
  try {
    await writeFile(tmpFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    await replaceDbFile(tmpFile);
    await syncAccountFiles(db);
  } catch (error) {
    try {
      await rm(tmpFile, { force: true });
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

async function loadMysqlDb() {
  // await ensureStorage();
  const pool = await getMysqlPool();
  // await ensureMysqlSchema(pool);
  const [[profileRow]] = await pool.query("SELECT * FROM app_users ORDER BY created_at ASC LIMIT 1");
  const recordingsPromise = listRecordingsWithPrisma();
  const [folderRows] = await pool.query("SELECT * FROM recording_folders ORDER BY created_at ASC");
  const transcriptSegmentsPromise = listTranscriptSegmentsWithPrisma();
  const [qaRows] = await pool.query("SELECT * FROM recording_questions ORDER BY created_at ASC");
  const [briefRows] = await pool.query("SELECT * FROM daily_meeting_briefs ORDER BY date_key DESC");
  const [clientProfileRows] = await pool.query("SELECT * FROM client_profiles ORDER BY updated_at DESC, created_at DESC");
  const [accountRows] = await pool.query("SELECT * FROM app_accounts ORDER BY created_at ASC");
  const [recordings, transcriptSegments] = await Promise.all([recordingsPromise, transcriptSegmentsPromise]);
  const maxSeq = recordings.reduce((max, recording) => Math.max(max, Number(recording.seq || 0)), 0);

  return {
    ...defaultDb,
    counters: { recordingSeq: maxSeq },
    profile: {
      ...defaultDb.profile,
      name: profileRow?.name || defaultDb.profile.name,
      company: profileRow?.company || defaultDb.profile.company,
      department: profileRow?.department || defaultDb.profile.department,
      phone: profileRow?.phone || "",
      language: profileRow?.language || "中文",
      recordsTitle: profileRow?.records_title || defaultDb.profile.recordsTitle,
      updatedAt: iso(profileRow?.updated_at),
    },
    recordings,
    folders: folderRows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerClientId: row.owner_client_id || "",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    transcriptSegments,
    qaMessages: qaRows.map((row) => ({
      id: row.id,
      recordingId: row.recording_id || null,
      recordingIds: row.recording_ids_json ? JSON.parse(row.recording_ids_json) : row.recording_id ? [row.recording_id] : [],
      clientId: row.client_id || "",
      question: row.question,
      answer: row.answer,
      structuredAnswer: parseJson(row.structured_answer_json, null),
      status: row.qa_status || "",
      pending: row.qa_status === "pending",
      jumpToMs: Number(row.jump_to_ms || 0),
      citations: row.citations_json ? JSON.parse(row.citations_json) : [],
      attachments: row.attachments_json ? JSON.parse(row.attachments_json) : [],
      provider: row.provider || "",
      model: row.model || "",
      reasoningContent: row.reasoning_content || "",
      thinking: parseJson(row.thinking_json, []),
      favorite: Boolean(row.favorite),
      deletedAt: iso(row.deleted_at) || null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    dailyMeetingBriefs: briefRows.map((row) => ({
      id: row.id,
      date: row.date_key,
      clientId: row.client_id || "",
      displayDate: row.display_date || "",
      timezone: row.timezone || "Asia/Shanghai",
      meetingCount: Number(row.meeting_count || 0),
      recordingIds: parseJson(row.recording_ids_json, []),
      title: row.title || "今日会议简报",
      summaryMarkdown: row.summary_markdown || "",
      status: row.status || "empty",
      generatedAt: iso(row.generated_at),
      updatedAt: iso(row.updated_at),
      dirty: Boolean(row.dirty),
    })),
    clientProfiles: clientProfileRows.reduce((profiles, row) => {
      const clientId = String(row.client_id || "").trim();
      if (!clientId) {
        return profiles;
      }
      const parsedProfile = parseJson(row.profile_json, {});
      profiles[clientId] = {
        ...parsedProfile,
        clientId,
        updatedAt: iso(row.updated_at) || parsedProfile.updatedAt || iso(row.created_at),
      };
      return profiles;
    }, {}),
    accounts: accountRows.map((row) => ({
      id: row.id,
      username: row.username || "",
      passwordSalt: row.password_salt || "",
      passwordHash: row.password_hash || "",
      profile: parseJson(row.profile_json, {}),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
  };
}

async function saveMysqlDb(db) {
  const pool = await getMysqlPool();
  // await ensureMysqlSchema(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const profile = { ...defaultDb.profile, ...(db.profile || {}) };
    await connection.query(
      `INSERT INTO app_users (id, name, company, department, phone, language, records_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE name=VALUES(name), company=VALUES(company), department=VALUES(department),
       phone=VALUES(phone), language=VALUES(language), records_title=VALUES(records_title), updated_at=NOW()`,
      ["default-user", profile.name, profile.company, profile.department, profile.phone, profile.language, profile.recordsTitle],
    );

    await connection.query("DELETE FROM daily_meeting_briefs");
    await connection.query("DELETE FROM app_accounts");
    await connection.query("DELETE FROM client_profiles");
    await connection.query("DELETE FROM recording_questions");
    await connection.query("DELETE FROM recording_folders");

    const clientProfiles =
      db.clientProfiles && typeof db.clientProfiles === "object" && !Array.isArray(db.clientProfiles)
        ? db.clientProfiles
        : {};
    for (const [clientId, clientProfile] of Object.entries(clientProfiles)) {
      if (!clientId || !clientProfile || typeof clientProfile !== "object") {
        continue;
      }
      const profilePayload = { ...clientProfile, clientId };
      await connection.query(
        `INSERT INTO client_profiles (client_id, profile_json, created_at, updated_at)
         VALUES (?, ?, NOW(), NOW())`,
        [clientId, JSON.stringify(profilePayload)],
      );
    }

    for (const account of db.accounts || []) {
      if (!account?.id || !account?.username) continue;
      await connection.query(
        `INSERT INTO app_accounts (id, username, password_salt, password_hash, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          account.username,
          account.passwordSalt || "",
          account.passwordHash || "",
          JSON.stringify(account.profile || {}),
          mysqlDate(account.createdAt) || mysqlDate(new Date()),
          mysqlDate(account.updatedAt) || mysqlDate(new Date()),
        ],
      );
    }

    for (const folder of db.folders || []) {
      await connection.query(
        `INSERT INTO recording_folders (id, user_id, name, owner_client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          folder.id,
          "default-user",
          folder.name,
          folder.ownerClientId || "",
          mysqlDate(folder.createdAt) || mysqlDate(new Date()),
          mysqlDate(folder.updatedAt) || mysqlDate(new Date()),
        ],
      );
    }

    for (const message of db.qaMessages || []) {
      await connection.query(
        `INSERT INTO recording_questions
         (id, recording_id, recording_ids_json, user_id, client_id, question, answer, structured_answer_json, qa_status, jump_to_ms,
          citations_json, attachments_json, provider, model, reasoning_content, thinking_json, favorite, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.recordingId || null,
          JSON.stringify(message.recordingIds || (message.recordingId ? [message.recordingId] : [])),
          "default-user",
          message.clientId || "",
          message.question || "",
          message.answer || "",
          message.structuredAnswer ? JSON.stringify(message.structuredAnswer) : null,
          message.pending ? "pending" : message.status || "ready",
          message.jumpToMs || 0,
          JSON.stringify(message.citations || []),
          JSON.stringify(message.attachments || []),
          message.provider || "",
          message.model || "",
          message.reasoningContent || "",
          JSON.stringify(message.thinking || []),
          Boolean(message.favorite),
          mysqlDate(message.deletedAt),
          mysqlDate(message.createdAt) || mysqlDate(new Date()),
          mysqlDate(message.updatedAt) || mysqlDate(message.createdAt) || mysqlDate(new Date()),
        ],
      );
    }

    for (const brief of db.dailyMeetingBriefs || []) {
      await connection.query(
        `INSERT INTO daily_meeting_briefs
         (id, date_key, client_id, display_date, timezone, meeting_count, recording_ids_json, title, summary_markdown, status, generated_at, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          brief.id || `daily-brief-${brief.date}`,
          brief.date,
          brief.clientId || "",
          brief.displayDate || "",
          brief.timezone || "Asia/Shanghai",
          Number(brief.meetingCount || 0),
          JSON.stringify(Array.isArray(brief.recordingIds) ? brief.recordingIds : []),
          brief.title || "今日会议简报",
          brief.summaryMarkdown || "",
          brief.status || "empty",
          mysqlDate(brief.generatedAt),
          mysqlDate(brief.updatedAt) || mysqlDate(new Date()),
          Boolean(brief.dirty),
        ],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function updateDb(mutator) {
  const next = writeQueue.then(async () => {
    const db = await loadDb();
    const beforeRecordings = structuredClone(db.recordings || []);
    const beforeTranscriptSegments = structuredClone(db.transcriptSegments || []);
    const result = await mutator(db);
    await saveDb(db);
    await persistRecordingChangesWithPrisma(
      beforeRecordings,
      db.recordings || [],
      beforeTranscriptSegments,
      db.transcriptSegments || [],
    );
    return result;
  });

  writeQueue = next.catch(() => {});
  return next;
}
