-- CreateTable
CREATE TABLE `BackupLifecycleRequest` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(128) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('PROPOSED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SENT', 'DESTROYED', 'FAILED') NOT NULL DEFAULT 'PROPOSED',
    `proposedById` VARCHAR(64) NOT NULL,
    `proposedByLabel` VARCHAR(64) NOT NULL,
    `proposedAt` DATETIME(3) NOT NULL,
    `decidedById` VARCHAR(64) NULL,
    `decidedByLabel` VARCHAR(64) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `holdUntil` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `outcome` VARCHAR(32) NULL,

    INDEX `BackupLifecycleRequest_status_idx`(`status`),
    INDEX `BackupLifecycleRequest_fileName_idx`(`fileName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
