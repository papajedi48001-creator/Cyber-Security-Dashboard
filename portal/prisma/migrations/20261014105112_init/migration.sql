-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `displayName` VARCHAR(128) NOT NULL,
    `role` ENUM('SECURITY_ADMINISTRATOR', 'SECURITY_OPERATOR', 'EXECUTIVE_VIEWER') NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `totpSecretEnc` VARCHAR(255) NULL,
    `totpEnrolledAt` DATETIME(3) NULL,
    `lastTotpStep` BIGINT NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `csrfSecret` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `mfaPassed` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `role` VARCHAR(255) NOT NULL,
    `owner` VARCHAR(128) NOT NULL,
    `critical` BOOLEAN NOT NULL DEFAULT false,
    `criticalReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Asset_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogSource` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `expectedIntervalMinutes` INTEGER NOT NULL,
    `lastEventAt` DATETIME(3) NULL,
    `assetId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LogSource_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConnectorState` (
    `name` VARCHAR(64) NOT NULL,
    `checkpoint` VARCHAR(255) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlertReference` (
    `id` VARCHAR(191) NOT NULL,
    `wazuhAlertId` VARCHAR(128) NOT NULL,
    `ruleId` INTEGER NOT NULL,
    `ruleLevel` INTEGER NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `sourceName` VARCHAR(128) NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveryCount` INTEGER NOT NULL DEFAULT 1,
    `investigationUrl` VARCHAR(500) NOT NULL,
    `incidentId` VARCHAR(191) NULL,

    UNIQUE INDEX `AlertReference_wazuhAlertId_key`(`wazuhAlertId`),
    INDEX `AlertReference_detectedAt_idx`(`detectedAt`),
    INDEX `AlertReference_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Incident` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(32) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `severity` ENUM('P1', 'P2', 'P3', 'P4') NOT NULL,
    `status` ENUM('NEW', 'ASSIGNED', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATED', 'PENDING_REVIEW', 'CLOSED') NOT NULL DEFAULT 'NEW',
    `assetId` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `acknowledgeDue` DATETIME(3) NOT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `mitigatedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `cause` TEXT NULL,
    `remediation` TEXT NULL,
    `closedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Incident_number_key`(`number`),
    INDEX `Incident_status_severity_idx`(`status`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncidentTimelineEntry` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(191) NULL,
    `type` VARCHAR(64) NOT NULL,
    `note` TEXT NULL,

    INDEX `IncidentTimelineEntry_incidentId_at_idx`(`incidentId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClosureEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `submittedById` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `summary` TEXT NOT NULL,
    `reference` VARCHAR(500) NOT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `decision` VARCHAR(16) NULL,
    `reviewNote` TEXT NULL,

    INDEX `ClosureEvidence_incidentId_idx`(`incidentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditRecord` (
    `id` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(64) NULL,
    `actorLabel` VARCHAR(128) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `targetType` VARCHAR(64) NOT NULL,
    `targetId` VARCHAR(128) NULL,
    `metadata` JSON NULL,
    `correlationId` VARCHAR(64) NOT NULL,

    INDEX `AuditRecord_at_idx`(`at`),
    INDEX `AuditRecord_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LogSource` ADD CONSTRAINT `LogSource_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlertReference` ADD CONSTRAINT `AlertReference_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentTimelineEntry` ADD CONSTRAINT `IncidentTimelineEntry_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClosureEvidence` ADD CONSTRAINT `ClosureEvidence_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit records are append-only: reject any UPDATE or DELETE.
CREATE TRIGGER `AuditRecord_no_update` BEFORE UPDATE ON `AuditRecord`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditRecord is append-only';

CREATE TRIGGER `AuditRecord_no_delete` BEFORE DELETE ON `AuditRecord`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditRecord is append-only';
