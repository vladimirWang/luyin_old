CREATE TABLE `recording_feedback` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `recording_id` VARCHAR(80) NOT NULL,
  `user_id` VARCHAR(80) NOT NULL,
  `content_type` VARCHAR(32) NOT NULL,
  `satisfied` BOOLEAN NOT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  UNIQUE INDEX `recording_feedback_recording_user_type_unique`(`recording_id`, `user_id`, `content_type`),
  INDEX `recording_feedback_recording_index`(`recording_id`),
  INDEX `recording_feedback_user_index`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
