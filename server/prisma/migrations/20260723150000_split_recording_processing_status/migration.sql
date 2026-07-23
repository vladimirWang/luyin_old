-- AlterTable
ALTER TABLE `recordings`
  ADD COLUMN `file_status` VARCHAR(32) NULL,
  ADD COLUMN `transcript_status` VARCHAR(32) NULL;

-- Backfill the two independent processing states for existing recordings.
UPDATE `recordings`
SET `file_status` = CASE
  WHEN COALESCE(`storage_key`, '') <> '' THEN 'ready'
  WHEN `status` = 'failed' THEN 'failed'
  ELSE 'pending'
END;

UPDATE `recordings`
SET `transcript_status` = CASE
  WHEN `transcribed_at` IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM `transcript_segments`
      WHERE `transcript_segments`.`recording_id` = `recordings`.`id`
    )
    THEN 'ready'
  WHEN `transcript_source` = 'tencent-meeting-unavailable' THEN 'unavailable'
  WHEN `status` = 'failed' THEN 'failed'
  WHEN `status` IN ('transcribing', 'processing') THEN 'transcribing'
  WHEN `status` = 'pending_retry' THEN 'waiting'
  ELSE 'waiting'
END;
