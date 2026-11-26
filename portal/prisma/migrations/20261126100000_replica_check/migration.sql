-- CreateTable
CREATE TABLE `ReplicaCheck` (
    `name` VARCHAR(64) NOT NULL,
    `state` VARCHAR(16) NOT NULL,
    `lagSeconds` INTEGER NULL,
    `ioRunning` BOOLEAN NOT NULL,
    `sqlRunning` BOOLEAN NOT NULL,
    `error` VARCHAR(255) NULL,
    `consecutiveFailures` INTEGER NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
