ALTER TABLE `recordings`
    ADD COLUMN `transcription_started_at` TIMESTAMP(0) NULL,
    ADD COLUMN `meeting_outline_started_at` TIMESTAMP(0) NULL;

CREATE INDEX `recordings_folder_deleted_index` ON `recordings`(`folder_id`, `deleted_at`);
CREATE INDEX `recordings_favorite_deleted_index` ON `recordings`(`favorite`, `deleted_at`);
CREATE INDEX `recordings_transcription_queue_index` ON `recordings`(`status`, `deleted_at`, `updated_at`);
CREATE INDEX `recordings_outline_queue_index` ON `recordings`(`meeting_outline_status`, `meeting_outline_started_at`);
