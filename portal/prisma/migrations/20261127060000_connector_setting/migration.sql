-- CreateTable
CREATE TABLE `ConnectorSetting` (
    `name` VARCHAR(64) NOT NULL,
    `target` VARCHAR(255) NOT NULL,
    `username` VARCHAR(128) NULL,
    `secretEnc` TEXT NULL,
    `secretUpdatedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
