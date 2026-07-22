-- AlterTable
ALTER TABLE `transcript_segments` ADD COLUMN `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);
