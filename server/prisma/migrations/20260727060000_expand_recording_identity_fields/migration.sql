-- Preserve canonical Tencent Meeting subjects and immutable producer-name snapshots.
ALTER TABLE `recordings`
  MODIFY `name` VARCHAR(160) NULL,
  MODIFY `owner_name` VARCHAR(120) NULL;
