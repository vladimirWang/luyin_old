-- Production database schema for the enterprise WeChat recording H5.
-- The local demo stores the same shape in server/data/db.json so it can run without a database.

CREATE TABLE app_users (
  id VARCHAR(64) PRIMARY KEY,
  wecom_user_id VARCHAR(128) UNIQUE,
  name VARCHAR(100) NOT NULL,
  company VARCHAR(160),
  department VARCHAR(160),
  phone VARCHAR(40),
  language VARCHAR(32) DEFAULT '中文',
  records_title VARCHAR(200) DEFAULT '我的录音',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recordings (
  id VARCHAR(64) PRIMARY KEY,
  seq BIGINT NOT NULL,
  user_id VARCHAR(64),
  folder_id VARCHAR(64),
  name VARCHAR(200) NOT NULL,
  speaker_name VARCHAR(120) NOT NULL DEFAULT '说话人 1',
  speaker_map_json TEXT,
  owner_client_id VARCHAR(160),
  owner_name VARCHAR(120),
  shared BOOLEAN NOT NULL DEFAULT TRUE,
  detected_language VARCHAR(24),
  translation_text MEDIUMTEXT,
  tag VARCHAR(120),
  duration_ms BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_name VARCHAR(260),
  storage_provider VARCHAR(40) NOT NULL DEFAULT 'local',
  storage_key VARCHAR(500) NOT NULL,
  transcript_path VARCHAR(500),
  transcript_raw_path VARCHAR(500),
  transcript_corrected_path VARCHAR(500),
  transcription_meta_path VARCHAR(500),
  audio_url VARCHAR(1000),
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  transcript_provider VARCHAR(80),
  transcript_source VARCHAR(80),
  transcribed_at TIMESTAMP,
  meeting_outline_json LONGTEXT,
  meeting_outline_status VARCHAR(32),
  meeting_outline_error TEXT,
  meeting_outlined_at TIMESTAMP,
  source VARCHAR(80) NOT NULL DEFAULT 'wecom-h5',
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recordings_user FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX idx_recordings_user_created ON recordings(user_id, created_at DESC);
CREATE INDEX idx_recordings_owner_shared ON recordings(owner_client_id, shared, created_at DESC);
CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_recordings_folder_created ON recordings(folder_id, created_at DESC);
CREATE INDEX idx_recordings_deleted ON recordings(deleted_at);
CREATE UNIQUE INDEX idx_recordings_seq ON recordings(seq);

CREATE TABLE recording_folders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_folders_user FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX idx_folders_user_created ON recording_folders(user_id, created_at);

CREATE TABLE transcript_segments (
  id VARCHAR(64) PRIMARY KEY,
  recording_id VARCHAR(64) NOT NULL,
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,
  text TEXT NOT NULL,
  confidence DECIMAL(5, 4),
  speaker_label VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_segments_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

CREATE INDEX idx_segments_recording_time ON transcript_segments(recording_id, start_ms);

CREATE TABLE recording_questions (
  id VARCHAR(64) PRIMARY KEY,
  recording_id VARCHAR(64),
  recording_ids_json TEXT,
  user_id VARCHAR(64),
  client_id VARCHAR(160),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  qa_status VARCHAR(32),
  jump_to_ms BIGINT NOT NULL DEFAULT 0,
  citations_json TEXT,
  attachments_json TEXT,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_questions_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE SET NULL,
  CONSTRAINT fk_questions_user FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX idx_questions_recording_created ON recording_questions(recording_id, created_at DESC);
CREATE INDEX idx_questions_client_created ON recording_questions(client_id, created_at DESC);
CREATE INDEX idx_questions_favorite_created ON recording_questions(favorite, created_at DESC);
CREATE INDEX idx_questions_deleted_created ON recording_questions(deleted_at, created_at DESC);

CREATE TABLE transcription_jobs (
  id VARCHAR(64) PRIMARY KEY,
  recording_id VARCHAR(64) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  request_id VARCHAR(160),
  error_message TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_jobs_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_recording_created ON transcription_jobs(recording_id, created_at DESC);
