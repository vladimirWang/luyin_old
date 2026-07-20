-- CreateTable
CREATE TABLE `app_users` (
    `id` VARCHAR(80) NOT NULL,
    `wecom_user_id` VARCHAR(128) NULL,
    `name` LONGTEXT NULL,
    `company` LONGTEXT NULL,
    `department` LONGTEXT NULL,
    `phone` VARCHAR(80) NULL,
    `language` VARCHAR(40) NULL,
    `records_title` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `app_users_wecom_user_id_key`(`wecom_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recordings` (
    `id` VARCHAR(80) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `user_id` VARCHAR(80) NULL,
    `folder_id` VARCHAR(80) NULL,
    `name` LONGTEXT NULL,
    `speaker_name` LONGTEXT NULL,
    `speaker_map_json` LONGTEXT NULL,
    `owner_client_id` VARCHAR(160) NULL,
    `owner_name` LONGTEXT NULL,
    `shared` BOOLEAN NULL DEFAULT true,
    `shared_at` TIMESTAMP(0) NULL,
    `detected_language` VARCHAR(40) NULL,
    `translation_text` LONGTEXT NULL,
    `tag` LONGTEXT NULL,
    `duration_ms` BIGINT NULL DEFAULT 0,
    `mime_type` VARCHAR(120) NULL,
    `file_size` BIGINT NULL DEFAULT 0,
    `file_name` LONGTEXT NULL,
    `storage_provider` VARCHAR(80) NULL,
    `storage_key` LONGTEXT NULL,
    `transcript_path` LONGTEXT NULL,
    `transcript_raw_path` VARCHAR(500) NULL,
    `transcript_corrected_path` VARCHAR(500) NULL,
    `transcription_meta_path` VARCHAR(500) NULL,
    `status` VARCHAR(32) NULL,
    `favorite` BOOLEAN NULL DEFAULT false,
    `deleted_at` TIMESTAMP(0) NULL,
    `transcript_provider` VARCHAR(80) NULL,
    `transcript_source` VARCHAR(120) NULL,
    `transcribed_at` TIMESTAMP(0) NULL,
    `meeting_outline_json` LONGTEXT NULL,
    `meeting_outline_status` VARCHAR(32) NULL,
    `meeting_outline_error` TEXT NULL,
    `meeting_outlined_at` TIMESTAMP(0) NULL,
    `source` VARCHAR(80) NULL,
    `tencent_meeting_creator_userid` VARCHAR(160) NULL,
    `tencent_meeting_meeting_id` VARCHAR(160) NULL,
    `tencent_meeting_meeting_code` VARCHAR(160) NULL,
    `tencent_meeting_meeting_record_id` VARCHAR(160) NULL,
    `tencent_meeting_source_kind` VARCHAR(40) NULL,
    `error_message` LONGTEXT NULL,
    `user_agent` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `recordings_created_index`(`created_at`),
    INDEX `recordings_owner_index`(`owner_client_id`),
    INDEX `recordings_seq_index`(`seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recording_folders` (
    `id` VARCHAR(80) NOT NULL,
    `user_id` VARCHAR(80) NULL,
    `name` LONGTEXT NULL,
    `owner_client_id` VARCHAR(160) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcript_segments` (
    `id` VARCHAR(160) NOT NULL,
    `recording_id` VARCHAR(80) NOT NULL,
    `start_ms` BIGINT NULL DEFAULT 0,
    `end_ms` BIGINT NULL DEFAULT 0,
    `text` LONGTEXT NULL,
    `confidence` DOUBLE NULL,
    `speaker_label` VARCHAR(120) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `transcript_segments_recording_index`(`recording_id`),
    INDEX `transcript_segments_start_index`(`recording_id`, `start_ms`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recording_questions` (
    `id` VARCHAR(120) NOT NULL,
    `recording_id` VARCHAR(80) NULL,
    `recording_ids_json` LONGTEXT NULL,
    `user_id` VARCHAR(80) NULL,
    `client_id` VARCHAR(160) NULL,
    `question` LONGTEXT NULL,
    `answer` LONGTEXT NULL,
    `structured_answer_json` LONGTEXT NULL,
    `qa_status` VARCHAR(32) NULL,
    `jump_to_ms` BIGINT NULL DEFAULT 0,
    `citations_json` LONGTEXT NULL,
    `attachments_json` LONGTEXT NULL,
    `provider` VARCHAR(64) NULL,
    `model` VARCHAR(160) NULL,
    `reasoning_content` LONGTEXT NULL,
    `thinking_json` LONGTEXT NULL,
    `favorite` BOOLEAN NULL DEFAULT false,
    `deleted_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `recording_questions_client_index`(`client_id`),
    INDEX `recording_questions_created_index`(`created_at`),
    INDEX `recording_questions_recording_index`(`recording_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_accounts` (
    `id` VARCHAR(80) NOT NULL,
    `username` LONGTEXT NOT NULL,
    `password_salt` VARCHAR(160) NULL,
    `password_hash` VARCHAR(255) NULL,
    `profile_json` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_profiles` (
    `client_id` VARCHAR(160) NOT NULL,
    `profile_json` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`client_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_meeting_briefs` (
    `id` VARCHAR(120) NOT NULL,
    `date_key` VARCHAR(20) NOT NULL,
    `client_id` VARCHAR(160) NOT NULL DEFAULT 'anonymous',
    `display_date` VARCHAR(20) NULL,
    `timezone` VARCHAR(64) NULL,
    `meeting_count` INTEGER NULL DEFAULT 0,
    `recording_ids_json` LONGTEXT NULL,
    `title` VARCHAR(255) NULL,
    `summary_markdown` LONGTEXT NULL,
    `status` VARCHAR(32) NULL,
    `generated_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `dirty` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `daily_meeting_briefs_date_client_unique`(`date_key`, `client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tencent_meeting_webhook_events` (
    `id` VARCHAR(30) NOT NULL,
    `unique_sequence` VARCHAR(160) NULL,
    `event_type` VARCHAR(120) NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `received_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `last_attempt_at` TIMESTAMP(0) NULL,
    `processed_at` TIMESTAMP(0) NULL,
    `error_message` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `tm_webhook_events_status_created_index`(`status`, `created_at`),
    INDEX `tm_webhook_events_type_received_index`(`event_type`, `received_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
