-- CreateTable
CREATE TABLE `BackupJob` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `assetName` VARCHAR(128) NULL,
    `expectedIntervalHours` INTEGER NOT NULL,
    `destination` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BackupJob_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackupEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `result` ENUM('SUCCESS', 'FAILED') NOT NULL,
    `completedAt` DATETIME(3) NOT NULL,
    `sizeBytes` BIGINT NULL,
    `encrypted` BOOLEAN NOT NULL,
    `retentionUntil` DATETIME(3) NULL,
    `recordedById` VARCHAR(64) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BackupEvidence_jobId_completedAt_idx`(`jobId`, `completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RestoreVerification` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `testedAt` DATETIME(3) NOT NULL,
    `result` ENUM('PASSED', 'FAILED') NOT NULL,
    `reference` VARCHAR(500) NOT NULL,
    `verifiedById` VARCHAR(64) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RestoreVerification_jobId_testedAt_idx`(`jobId`, `testedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BackupEvidence` ADD CONSTRAINT `BackupEvidence_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `BackupJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RestoreVerification` ADD CONSTRAINT `RestoreVerification_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `BackupJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
