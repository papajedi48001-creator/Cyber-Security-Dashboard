-- CreateTable
CREATE TABLE `ModuleSetting` (
    `id` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
