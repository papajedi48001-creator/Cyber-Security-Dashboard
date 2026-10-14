-- CreateTable
CREATE TABLE `CloudflareWafSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL,
    `since` DATETIME(3) NOT NULL,
    `until` DATETIME(3) NOT NULL,
    `summary` JSON NOT NULL,

    INDEX `CloudflareWafSnapshot_fetchedAt_idx`(`fetchedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DuoManualCheck` (
    `id` VARCHAR(191) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `checkedById` VARCHAR(64) NOT NULL,
    `checkedByName` VARCHAR(64) NOT NULL,
    `authLogReviewed` BOOLEAN NOT NULL,
    `adminActionsReviewed` BOOLEAN NOT NULL,
    `deniedAuthentications` INTEGER NOT NULL,
    `fraudReports` INTEGER NOT NULL,
    `bypassUsers` INTEGER NOT NULL,
    `issuesFound` BOOLEAN NOT NULL,
    `note` VARCHAR(1000) NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DuoManualCheck_checkedAt_idx`(`checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
