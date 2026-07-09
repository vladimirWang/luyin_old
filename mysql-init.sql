CREATE DATABASE IF NOT EXISTS wecom_recorder
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'wecom_recorder'@'localhost' IDENTIFIED BY 'wecom_recorder';
CREATE USER IF NOT EXISTS 'wecom_recorder'@'%' IDENTIFIED BY 'wecom_recorder';
GRANT ALL PRIVILEGES ON wecom_recorder.* TO 'wecom_recorder'@'localhost';
GRANT ALL PRIVILEGES ON wecom_recorder.* TO 'wecom_recorder'@'%';
FLUSH PRIVILEGES;

USE wecom_recorder;

CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(80) PRIMARY KEY,
  name LONGTEXT,
  company LONGTEXT,
  department LONGTEXT,
  phone VARCHAR(80),
  language VARCHAR(40),
  records_title LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS recording_folders (
  id VARCHAR(80) PRIMARY KEY,
  user_id VARCHAR(80),
  name LONGTEXT,
  owner_client_id VARCHAR(160),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS recordings (
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
  error_message LONGTEXT,
  user_agent LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL,
  INDEX recordings_seq_index (seq),
  INDEX recordings_owner_index (owner_client_id),
  INDEX recordings_created_index (created_at)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
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
);

CREATE TABLE IF NOT EXISTS recording_questions (
  id VARCHAR(120) PRIMARY KEY,
  recording_id VARCHAR(80),
  recording_ids_json LONGTEXT,
  user_id VARCHAR(80),
  client_id VARCHAR(160),
  question LONGTEXT,
  answer LONGTEXT,
  qa_status VARCHAR(32),
  jump_to_ms BIGINT DEFAULT 0,
  citations_json LONGTEXT,
  attachments_json LONGTEXT,
  favorite TINYINT(1) DEFAULT 0,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL,
  INDEX recording_questions_recording_index (recording_id),
  INDEX recording_questions_client_index (client_id),
  INDEX recording_questions_created_index (created_at)
);

CREATE TABLE IF NOT EXISTS client_profiles (
  client_id VARCHAR(160) PRIMARY KEY,
  profile_json LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS app_accounts (
  id VARCHAR(80) PRIMARY KEY,
  username LONGTEXT NOT NULL,
  password_salt VARCHAR(160),
  password_hash VARCHAR(255),
  profile_json LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS daily_meeting_briefs (
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
);
