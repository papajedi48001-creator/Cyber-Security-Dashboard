-- CreateTable
CREATE TABLE `PortScan` (
    `id` VARCHAR(191) NOT NULL,
    `scanner` VARCHAR(64) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NOT NULL,
    `targets` JSON NOT NULL,
    `findings` JSON NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `importedById` VARCHAR(64) NOT NULL,

    INDEX `PortScan_finishedAt_idx`(`finishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FirewallExposureSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `rules` JSON NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `importedById` VARCHAR(64) NOT NULL,

    INDEX `FirewallExposureSnapshot_importedAt_idx`(`importedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortException` (
    `id` VARCHAR(191) NOT NULL,
    `family` ENUM('EXTERNAL_EXPOSURE', 'RESTRICTED_EGRESS') NOT NULL,
    `address` VARCHAR(45) NULL,
    `port` INTEGER NOT NULL,
    `protocol` VARCHAR(3) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `owner` VARCHAR(128) NOT NULL,
    `approvedById` VARCHAR(64) NOT NULL,
    `approvedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    INDEX `PortException_family_port_idx`(`family`, `port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
