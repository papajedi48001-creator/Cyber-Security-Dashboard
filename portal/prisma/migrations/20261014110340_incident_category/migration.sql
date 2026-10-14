-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `category` VARCHAR(64) NULL,
    ADD COLUMN `sourceName` VARCHAR(128) NULL;

-- CreateIndex
CREATE INDEX `Incident_category_sourceName_status_idx` ON `Incident`(`category`, `sourceName`, `status`);
