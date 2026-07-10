import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "./utils/log.js";

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
let mysqlSchemaReady = false;

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

async function ensureMysqlSchema(pool) {
  if (mysqlSchemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS app_users (
      id VARCHAR(80) PRIMARY KEY,
      name LONGTEXT,
      company LONGTEXT,
      department LONGTEXT,
      phone VARCHAR(80),
      language VARCHAR(40),
      records_title LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL
    )`,
    `CREATE TABLE IF NOT EXISTS recording_folders (
      id VARCHAR(80) PRIMARY KEY,
      user_id VARCHAR(80),
      name LONGTEXT,
      owner_client_id VARCHAR(160),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL
    )`,
    `CREATE TABLE IF NOT EXISTS recordings (
      id VARCHAR(80) PRIMARY KEY,
      seq INT NOT NULL DEFAULT 0,
      user_id VARCHAR(80),
      folder_id VARCHAR(80),
      name LONGTEXT,
      speaker_name LONGTEXT,
      speaker_map_json LONGTEXT,
      owner_client_id VARCHAR(160),
      owner_name LONGTEXT,
      shared TINYINT(1) DEFAULT 1,
      shared_at TIMESTAMP NULL,
      detected_language VARCHAR(40),
      translation_text LONGTEXT,
      tag LONGTEXT,
      duration_ms BIGINT DEFAULT 0,
      mime_type VARCHAR(120),
      file_size BIGINT DEFAULT 0,
      file_name LONGTEXT,
      storage_provider VARCHAR(80),
      storage_key LONGTEXT,
      transcript_path LONGTEXT,
      transcript_raw_path VARCHAR(500),
      transcript_corrected_path VARCHAR(500),
      transcription_meta_path VARCHAR(500),
      status VARCHAR(32),
      favorite TINYINT(1) DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      transcript_provider VARCHAR(80),
      transcript_source VARCHAR(120),
      transcribed_at TIMESTAMP NULL,
      meeting_outline_json LONGTEXT,
      meeting_outline_status VARCHAR(32),
      meeting_outline_error TEXT,
      meeting_outlined_at TIMESTAMP NULL,
      source VARCHAR(80),
      tencent_meeting_creator_userid VARCHAR(160),
      tencent_meeting_meeting_id VARCHAR(160),
      tencent_meeting_meeting_code VARCHAR(160),
      tencent_meeting_meeting_record_id VARCHAR(160),
      tencent_meeting_source_kind VARCHAR(40),
      error_message LONGTEXT,
      user_agent LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX recordings_seq_index (seq),
      INDEX recordings_owner_index (owner_client_id),
      INDEX recordings_created_index (created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS transcript_segments (
      id VARCHAR(160) PRIMARY KEY,
      recording_id VARCHAR(80) NOT NULL,
      start_ms BIGINT DEFAULT 0,
      end_ms BIGINT DEFAULT 0,
      text LONGTEXT,
      confidence DOUBLE NULL,
      speaker_label VARCHAR(120),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX transcript_segments_recording_index (recording_id),
      INDEX transcript_segments_start_index (recording_id, start_ms)
    )`,
    `CREATE TABLE IF NOT EXISTS recording_questions (
      id VARCHAR(120) PRIMARY KEY,
      recording_id VARCHAR(80),
      recording_ids_json LONGTEXT,
      user_id VARCHAR(80),
      client_id VARCHAR(160),
      question LONGTEXT,
      answer LONGTEXT,
      structured_answer_json LONGTEXT,
      qa_status VARCHAR(32),
      jump_to_ms BIGINT DEFAULT 0,
      citations_json LONGTEXT,
      attachments_json LONGTEXT,
      provider VARCHAR(64),
      model VARCHAR(160),
      reasoning_content LONGTEXT,
      thinking_json LONGTEXT,
      favorite TINYINT(1) DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX recording_questions_recording_index (recording_id),
      INDEX recording_questions_client_index (client_id),
      INDEX recording_questions_created_index (created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS client_profiles (
      client_id VARCHAR(160) PRIMARY KEY,
      profile_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL
    )`,
    `CREATE TABLE IF NOT EXISTS app_accounts (
      id VARCHAR(80) PRIMARY KEY,
      username LONGTEXT NOT NULL,
      password_salt VARCHAR(160),
      password_hash VARCHAR(255),
      profile_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL
    )`,
    `CREATE TABLE IF NOT EXISTS daily_meeting_briefs (
      id VARCHAR(120) PRIMARY KEY,
      date_key VARCHAR(20) NOT NULL,
      client_id VARCHAR(160) NOT NULL DEFAULT 'anonymous',
      display_date VARCHAR(20),
      timezone VARCHAR(64),
      meeting_count INT DEFAULT 0,
      recording_ids_json LONGTEXT,
      title VARCHAR(255),
      summary_markdown LONGTEXT,
      status VARCHAR(32),
      generated_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL,
      dirty TINYINT(1) DEFAULT 0,
      UNIQUE KEY daily_meeting_briefs_date_client_unique (date_key, client_id)
    )`,
    "ALTER TABLE recordings ADD COLUMN meeting_outline_json LONGTEXT",
    "ALTER TABLE recordings ADD COLUMN meeting_outline_status VARCHAR(32)",
    "ALTER TABLE recordings ADD COLUMN meeting_outline_error TEXT",
    "ALTER TABLE recordings ADD COLUMN meeting_outlined_at TIMESTAMP NULL",
    "ALTER TABLE recordings ADD COLUMN transcript_raw_path VARCHAR(500)",
    "ALTER TABLE recordings ADD COLUMN transcript_corrected_path VARCHAR(500)",
    "ALTER TABLE recordings ADD COLUMN transcription_meta_path VARCHAR(500)",
    "ALTER TABLE recordings ADD COLUMN shared_at TIMESTAMP NULL",
    "ALTER TABLE recordings ADD COLUMN tencent_meeting_creator_userid VARCHAR(160)",
    "ALTER TABLE recordings ADD COLUMN tencent_meeting_meeting_id VARCHAR(160)",
    "ALTER TABLE recordings ADD COLUMN tencent_meeting_meeting_code VARCHAR(160)",
    "ALTER TABLE recordings ADD COLUMN tencent_meeting_meeting_record_id VARCHAR(160)",
    "ALTER TABLE recordings ADD COLUMN tencent_meeting_source_kind VARCHAR(40)",
    "ALTER TABLE recording_questions ADD COLUMN qa_status VARCHAR(32)",
    "ALTER TABLE recording_questions ADD COLUMN structured_answer_json LONGTEXT",
    "ALTER TABLE recording_questions ADD COLUMN provider VARCHAR(64)",
    "ALTER TABLE recording_questions ADD COLUMN model VARCHAR(160)",
    "ALTER TABLE recording_questions ADD COLUMN reasoning_content LONGTEXT",
    "ALTER TABLE recording_questions ADD COLUMN thinking_json LONGTEXT",
    "ALTER TABLE recording_folders ADD COLUMN owner_client_id VARCHAR(160)",
    "ALTER TABLE app_accounts DROP INDEX username",
    "ALTER TABLE app_accounts MODIFY COLUMN username LONGTEXT NOT NULL",
    "ALTER TABLE daily_meeting_briefs ADD COLUMN client_id VARCHAR(160) NOT NULL DEFAULT 'anonymous'",
    "UPDATE daily_meeting_briefs SET client_id = 'anonymous' WHERE client_id IS NULL OR client_id = ''",
    "ALTER TABLE daily_meeting_briefs DROP INDEX date_key",
    "ALTER TABLE daily_meeting_briefs ADD UNIQUE INDEX daily_meeting_briefs_date_client_unique (date_key, client_id)",
  ];

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (!["ER_DUP_FIELDNAME", "ER_CANT_DROP_FIELD_OR_KEY", "ER_DUP_KEYNAME"].includes(error?.code)) throw error;
    }
  }
  mysqlSchemaReady = true;
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
  await mkdir(dataDir, { recursive: true });
  await mkdir(accountDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });
  await mkdir(attachmentDir, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });
  await mkdir(ttsDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  if (mysqlEnabled()) return;

  try {
    await readFile(dbFile, "utf8");
  } catch {
    await saveDb(defaultDb);
  }
}

export async function loadDb() {
  logger.info("[CALL] loadDb: ");
  if (mysqlEnabled()) {
    logger.info("[CALL] loadDb: mysqlEnabled() is true, loading from MySQL database");
    return loadMysqlDb();
  }

  logger.info("[CALL] loadDb: mysqlEnabled() is false, loading from local file");
  await ensureStorage();
  const raw = await readFile(dbFile, "utf8");
  logger.info("[CALL] loadDb: ${raw.slice(0, 100)}...");
  const parsed = JSON.parse(raw);

  return {
    ...defaultDb,
    ...parsed,
    counters: {
      ...defaultDb.counters,
      ...(parsed.counters || {}),
    },
    profile: {
      ...defaultDb.profile,
      ...(parsed.profile || {}),
    },
    recordings: (parsed.recordings || []).map((recording) => ({
      speakerName: "说话人 1",
      speakerMap: {},
      ownerClientId: "",
      ownerName: "",
      shared: true,
      sharedAt: "",
      detectedLanguage: "",
      translationText: "",
      tag: "",
      deletedAt: null,
      transcriptProvider: "",
      transcriptSource: "",
      transcribedAt: "",
      transcriptPath: "",
      transcriptRawPath: "",
      transcriptCorrectedPath: "",
      transcriptionMetaPath: "",
      meetingOutline: null,
      meetingOutlineStatus: "",
      meetingOutlineError: "",
      meetingOutlinedAt: "",
      ...recording,
    })),
    folders: (parsed.folders || []).map((folder) => ({
      ownerClientId: "",
      ...folder,
    })),
    transcriptSegments: parsed.transcriptSegments || [], // 录音的转写片段（字幕）数组
    qaMessages: parsed.qaMessages || [],
    dailyMeetingBriefs: Array.isArray(parsed.dailyMeetingBriefs)
      ? parsed.dailyMeetingBriefs.map((brief) => ({ clientId: "", ...brief }))
      : [],
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    clientProfiles:
      parsed.clientProfiles && typeof parsed.clientProfiles === "object" && !Array.isArray(parsed.clientProfiles)
        ? parsed.clientProfiles
        : {},
  };
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
  await ensureStorage();
  const pool = await getMysqlPool();
  await ensureMysqlSchema(pool);
  const [[profileRow]] = await pool.query("SELECT * FROM app_users ORDER BY created_at ASC LIMIT 1");
  const [recordingRows] = await pool.query("SELECT * FROM recordings ORDER BY seq ASC");
  const [folderRows] = await pool.query("SELECT * FROM recording_folders ORDER BY created_at ASC");
  const [segmentRows] = await pool.query("SELECT * FROM transcript_segments ORDER BY recording_id ASC, start_ms ASC");
  const [qaRows] = await pool.query("SELECT * FROM recording_questions ORDER BY created_at ASC");
  const [briefRows] = await pool.query("SELECT * FROM daily_meeting_briefs ORDER BY date_key DESC");
  const [clientProfileRows] = await pool.query("SELECT * FROM client_profiles ORDER BY updated_at DESC, created_at DESC");
  const [accountRows] = await pool.query("SELECT * FROM app_accounts ORDER BY created_at ASC");
  const maxSeq = recordingRows.reduce((max, row) => Math.max(max, Number(row.seq || 0)), 0);

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
    recordings: recordingRows.map((row) => ({
      id: row.id,
      seq: Number(row.seq || 0),
      name: row.name,
      speakerName: row.speaker_name || "说话人 1",
      speakerMap: row.speaker_map_json ? JSON.parse(row.speaker_map_json) : {},
      ownerClientId: row.owner_client_id || "",
      ownerName: row.owner_name || "",
      shared: row.shared !== undefined ? Boolean(row.shared) : true,
      sharedAt: iso(row.shared_at),
      detectedLanguage: row.detected_language || "",
      translationText: row.translation_text || "",
      tag: row.tag || "",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      durationMs: Number(row.duration_ms || 0),
      mimeType: row.mime_type || "audio/mpeg",
      size: Number(row.file_size || 0),
      fileName: row.file_name || path.basename(row.storage_key || ""),
      storagePath: row.storage_key,
      transcriptPath: row.transcript_path || "",
      transcriptRawPath: row.transcript_raw_path || "",
      transcriptCorrectedPath: row.transcript_corrected_path || "",
      transcriptionMetaPath: row.transcription_meta_path || "",
      favorite: Boolean(row.favorite),
      folderId: row.folder_id || null,
      deletedAt: iso(row.deleted_at) || null,
      status: row.status,
      errorMessage: row.error_message || "",
      transcriptProvider: row.transcript_provider || "",
      transcriptSource: row.transcript_source || "",
      transcribedAt: iso(row.transcribed_at),
      meetingOutline: parseJson(row.meeting_outline_json, null),
      meetingOutlineStatus: row.meeting_outline_status || "",
      meetingOutlineError: row.meeting_outline_error || "",
      meetingOutlinedAt: iso(row.meeting_outlined_at),
      source: row.source || "wecom-h5",
      tencentMeetingCreatorUserid: row.tencent_meeting_creator_userid || "",
      tencentMeetingMeetingId: row.tencent_meeting_meeting_id || "",
      tencentMeetingMeetingCode: row.tencent_meeting_meeting_code || "",
      tencentMeetingMeetingRecordId: row.tencent_meeting_meeting_record_id || "",
      tencentMeetingSourceKind: row.tencent_meeting_source_kind || "",
      userAgent: row.user_agent || "",
    })),
    folders: folderRows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerClientId: row.owner_client_id || "",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    transcriptSegments: segmentRows.map((row) => ({
      id: row.id,
      recordingId: row.recording_id,
      startMs: Number(row.start_ms || 0),
      endMs: Number(row.end_ms || 0),
      text: row.text || "",
      confidence: Number(row.confidence || 0),
      speakerKey: row.speaker_label || "speaker-1",
      createdAt: iso(row.created_at),
    })),
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
  await ensureMysqlSchema(pool);
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
    await connection.query("DELETE FROM transcript_segments");
    await connection.query("DELETE FROM recordings");
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

    for (const recording of db.recordings || []) {
      await connection.query(
        `INSERT INTO recordings
        (id, seq, user_id, folder_id, name, speaker_name, speaker_map_json, owner_client_id, owner_name, shared, shared_at, detected_language, translation_text, tag, duration_ms, mime_type, file_size,
         file_name, storage_provider, storage_key, transcript_path, transcript_raw_path, transcript_corrected_path, transcription_meta_path, status, favorite, deleted_at, transcript_provider,
         transcript_source, transcribed_at, meeting_outline_json, meeting_outline_status, meeting_outline_error, meeting_outlined_at,
         source, tencent_meeting_creator_userid, tencent_meeting_meeting_id, tencent_meeting_meeting_code, tencent_meeting_meeting_record_id, tencent_meeting_source_kind,
         error_message, user_agent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recording.id,
          recording.seq,
          "default-user",
          recording.folderId || null,
          recording.name,
          recording.speakerName || "说话人 1",
          JSON.stringify(recording.speakerMap || {}),
          recording.ownerClientId || "",
          recording.ownerName || "",
          recording.shared !== false,
          mysqlDate(recording.sharedAt),
          recording.detectedLanguage || "",
          recording.translationText || "",
          recording.tag || "",
          recording.durationMs || 0,
          recording.mimeType || "audio/mpeg",
          recording.size || 0,
          recording.fileName || path.basename(recording.storagePath || ""),
          "local",
          recording.storagePath || "",
          recording.transcriptPath || "",
          recording.transcriptRawPath || "",
          recording.transcriptCorrectedPath || "",
          recording.transcriptionMetaPath || "",
          recording.status || "uploaded",
          Boolean(recording.favorite),
          mysqlDate(recording.deletedAt),
          recording.transcriptProvider || "",
          recording.transcriptSource || "",
          mysqlDate(recording.transcribedAt),
          recording.meetingOutline ? JSON.stringify(recording.meetingOutline) : null,
          recording.meetingOutlineStatus || "",
          recording.meetingOutlineError || "",
          mysqlDate(recording.meetingOutlinedAt),
          recording.source || "wecom-h5",
          recording.tencentMeetingCreatorUserid || "",
          recording.tencentMeetingMeetingId || "",
          recording.tencentMeetingMeetingCode || "",
          recording.tencentMeetingMeetingRecordId || "",
          recording.tencentMeetingSourceKind || "",
          recording.errorMessage || "",
          recording.userAgent || "",
          mysqlDate(recording.createdAt) || mysqlDate(new Date()),
          mysqlDate(recording.updatedAt) || mysqlDate(new Date()),
        ],
      );
    }

    for (const segment of db.transcriptSegments || []) {
      await connection.query(
        `INSERT INTO transcript_segments (id, recording_id, start_ms, end_ms, text, confidence, speaker_label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          segment.id,
          segment.recordingId,
          segment.startMs || 0,
          segment.endMs || 0,
          segment.text || "",
          segment.confidence || null,
          segment.speakerKey || "speaker-1",
          mysqlDate(segment.createdAt) || mysqlDate(new Date()),
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
    const result = await mutator(db);
    await saveDb(db);
    return result;
  });

  writeQueue = next.catch(() => {});
  return next;
}
