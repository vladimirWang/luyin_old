/*
  Warnings:

  - You are about to drop the column `tencent_meeting_meeting_record_id` on the `recordings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `recordings` DROP COLUMN `tencent_meeting_meeting_record_id`,
    MODIFY `name` VARCHAR(30) NULL,
    MODIFY `owner_name` VARCHAR(10) NULL;
