-- CreateTable
CREATE TABLE `ExternalIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `issuer` VARCHAR(64) NOT NULL,
    `subject` VARCHAR(64) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `linkedById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ExternalIdentity_issuer_subject_key`(`issuer`, `subject`),
    UNIQUE INDEX `ExternalIdentity_userId_issuer_key`(`userId`, `issuer`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExternalIdentity` ADD CONSTRAINT `ExternalIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

