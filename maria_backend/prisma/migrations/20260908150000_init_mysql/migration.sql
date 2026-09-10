-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `photoUrl` VARCHAR(191) NULL,
    `walletBalanceKobo` BIGINT NOT NULL DEFAULT 0,
    `referralCode` VARCHAR(191) NOT NULL,
    `referredByCode` VARCHAR(191) NULL,
    `referralEarningsKobo` BIGINT NOT NULL DEFAULT 0,
    `referralWithdrawnKobo` BIGINT NOT NULL DEFAULT 0,
    `kycStatus` ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `pinHash` VARCHAR(191) NULL,
    `pinFailures` INTEGER NOT NULL DEFAULT 0,
    `pinLockedUntil` DATETIME(3) NULL,
    `pinFailureAt` DATETIME(3) NULL,
    `loginPinHash` VARCHAR(191) NULL,
    `loginPinFailures` INTEGER NOT NULL DEFAULT 0,
    `loginPinLockedUntil` DATETIME(3) NULL,
    `loginPinFailureAt` DATETIME(3) NULL,
    `passwordFailures` INTEGER NOT NULL DEFAULT 0,
    `passwordLockedUntil` DATETIME(3) NULL,
    `passwordFailureAt` DATETIME(3) NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `virtualAccountNumber` VARCHAR(191) NULL,
    `virtualAccountBank` VARCHAR(191) NULL,
    `virtualAccountProvider` VARCHAR(191) NULL,
    `paystackCustomerCode` VARCHAR(191) NULL,
    `bvnLast4` VARCHAR(191) NULL,
    `bvnVerifiedAt` DATETIME(3) NULL,
    `kycFailureReason` VARCHAR(191) NULL,
    `accountStatus` ENUM('ACTIVE', 'DEACTIVATED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `deactivatedAt` DATETIME(3) NULL,
    `deletionReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    UNIQUE INDEX `User_referralCode_key`(`referralCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `inlineData` JSON NULL,
    `fileSize` INTEGER NOT NULL,
    `reference` VARCHAR(191) NULL,
    `createdByAdminId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserDelivery_filePath_key`(`filePath`),
    INDEX `UserDelivery_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantAuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `intent` VARCHAR(191) NULL,
    `stage` VARCHAR(191) NOT NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `transactionRef` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantAuditEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AssistantAuditEvent_stage_outcome_createdAt_idx`(`stage`, `outcome`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PasswordResetCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('WALLET_FUNDING', 'WALLET_TRANSFER', 'DATA_PURCHASE', 'AIRTIME_PURCHASE', 'ELECTRICITY_PURCHASE', 'CABLE_PURCHASE', 'RESULT_PIN', 'SMS', 'WITHDRAWAL', 'REFERRAL_COMMISSION', 'MANUAL_ADJUSTMENT', 'COUPON_REDEMPTION', 'NIN_VERIFICATION', 'BVN_VERIFICATION', 'IDENTITY_SERVICE_REQUEST', 'NIN_MODIFICATION', 'BVN_LICENSE_ONBOARDING', 'CAC_SERVICE_REQUEST', 'BVN_MODIFICATION', 'BIRTH_ATTESTATION', 'NEWSPAPER_PUBLICATION', 'BVN_CRM', 'REFUND', 'WALLET_FUNDING_FEE') NOT NULL,
    `status` ENUM('PENDING', 'SUCCESS', 'FAILED', 'REVERSED') NOT NULL DEFAULT 'PENDING',
    `amountKobo` BIGINT NOT NULL,
    `balanceBeforeKobo` BIGINT NOT NULL,
    `balanceAfterKobo` BIGINT NOT NULL,
    `costKobo` BIGINT NULL,
    `provider` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `relatedTransactionId` VARCHAR(191) NULL,

    UNIQUE INDEX `Transaction_reference_key`(`reference`),
    INDEX `Transaction_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Transaction_type_status_createdAt_idx`(`type`, `status`, `createdAt`),
    INDEX `Transaction_relatedTransactionId_idx`(`relatedTransactionId`),
    UNIQUE INDEX `Transaction_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    UNIQUE INDEX `Transaction_provider_providerRef_key`(`provider`, `providerRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataPlanPricing` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'alrahuz',
    `providerPlanId` VARCHAR(191) NOT NULL,
    `network` VARCHAR(191) NOT NULL,
    `networkId` INTEGER NOT NULL,
    `planType` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `validity` VARCHAR(191) NULL,
    `providerCostKobo` BIGINT NOT NULL,
    `sellingPriceKobo` BIGINT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DataPlanPricing_network_isActive_idx`(`network`, `isActive`),
    INDEX `DataPlanPricing_networkId_isActive_idx`(`networkId`, `isActive`),
    UNIQUE INDEX `DataPlanPricing_provider_providerPlanId_key`(`provider`, `providerPlanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServicePricing` (
    `id` VARCHAR(191) NOT NULL,
    `service` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'alrahuz',
    `label` VARCHAR(191) NOT NULL,
    `providerCostKobo` BIGINT NOT NULL,
    `sellingPriceKobo` BIGINT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ServicePricing_service_key`(`service`),
    INDEX `ServicePricing_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTicket` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `subject` TEXT NOT NULL,
    `status` ENUM('OPEN', 'PENDING', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupportTicket_userId_idx`(`userId`),
    INDEX `SupportTicket_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTicketMessage` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `senderType` ENUM('USER', 'ADMIN') NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportTicketMessage_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferralSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `commissionRate` DOUBLE NOT NULL DEFAULT 0.01,
    `minWithdrawalKobo` BIGINT NOT NULL DEFAULT 50000,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `minAndroidVersion` VARCHAR(191) NOT NULL DEFAULT '1.0.0',
    `latestAndroidVersion` VARCHAR(191) NOT NULL DEFAULT '1.0.0',
    `androidDownloadUrl` VARCHAR(191) NOT NULL DEFAULT 'https://github.com/DIGITAL-BRANDING/MAJOR-DATA-LINK/releases/latest/download/MajorDataLink.apk',
    `updateMessage` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `dataPlanMarkupPercent` DOUBLE NOT NULL DEFAULT 0,
    `dataPlanMarkupNaira` DOUBLE NOT NULL DEFAULT 0,
    `dataAirtimeProvider` VARCHAR(191) NOT NULL DEFAULT 'alrahuz',
    `resultPinProvider` VARCHAR(191) NOT NULL DEFAULT 'alrahuz',
    `cableMarkupPercent` DOUBLE NOT NULL DEFAULT 0,
    `electricityMarkupPercent` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppSession` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'START',
    `context` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppSession_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Coupon` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `valueKobo` BIGINT NOT NULL,
    `isRedeemed` BOOLEAN NOT NULL DEFAULT false,
    `redeemedByUserId` VARCHAR(191) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `createdByAdminId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Coupon_code_key`(`code`),
    INDEX `Coupon_isRedeemed_idx`(`isRedeemed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderBalanceStatus` (
    `provider` VARCHAR(191) NOT NULL,
    `lastKnownBalance` DOUBLE NOT NULL,
    `lastCheckedAt` DATETIME(3) NOT NULL,
    `lowBalanceAlertSentAt` DATETIME(3) NULL,

    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderLedgerBalance` (
    `provider` VARCHAR(191) NOT NULL,
    `balanceKobo` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `type` ENUM('PURCHASE_DEBIT', 'TOPUP_CREDIT', 'ADJUSTMENT') NOT NULL,
    `amountKobo` BIGINT NOT NULL,
    `balanceBeforeKobo` BIGINT NOT NULL,
    `balanceAfterKobo` BIGINT NOT NULL,
    `relatedTransactionId` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `createdByAdminId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProviderLedgerEntry_provider_createdAt_idx`(`provider`, `createdAt`),
    INDEX `ProviderLedgerEntry_relatedTransactionId_idx`(`relatedTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeviceToken_token_key`(`token`),
    INDEX `DeviceToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('TRANSACTION', 'WALLET', 'KYC', 'PROMO', 'ADMIN_BROADCAST', 'SYSTEM') NOT NULL DEFAULT 'SYSTEM',
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `data` JSON NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `broadcastId` VARCHAR(191) NULL,
    `imageKey` VARCHAR(191) NULL,
    `showAsPopup` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_isRead_idx`(`userId`, `isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationBroadcast` (
    `id` VARCHAR(191) NOT NULL,
    `createdByAdminId` VARCHAR(191) NOT NULL,
    `type` ENUM('TRANSACTION', 'WALLET', 'KYC', 'PROMO', 'ADMIN_BROADCAST', 'SYSTEM') NOT NULL DEFAULT 'ADMIN_BROADCAST',
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` ENUM('ALL_USERS', 'SPECIFIC_USERS', 'KYC_VERIFIED_ONLY') NOT NULL DEFAULT 'ALL_USERS',
    `targetUserIds` JSON NULL,
    `imageKey` VARCHAR(191) NULL,
    `showAsPopup` BOOLEAN NOT NULL DEFAULT false,
    `recipientCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationBroadcast_createdByAdminId_createdAt_idx`(`createdByAdminId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'FINANCE', 'SUPPORT') NOT NULL DEFAULT 'SUPPORT',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `AdminAuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserDelivery` ADD CONSTRAINT `UserDelivery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDelivery` ADD CONSTRAINT `UserDelivery_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `AdminUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantAuditEvent` ADD CONSTRAINT `AssistantAuditEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetCode` ADD CONSTRAINT `PasswordResetCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_relatedTransactionId_fkey` FOREIGN KEY (`relatedTransactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportTicketMessage` ADD CONSTRAINT `SupportTicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `SupportTicket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_redeemedByUserId_fkey` FOREIGN KEY (`redeemedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceToken` ADD CONSTRAINT `DeviceToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_broadcastId_fkey` FOREIGN KEY (`broadcastId`) REFERENCES `NotificationBroadcast`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationBroadcast` ADD CONSTRAINT `NotificationBroadcast_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `AdminUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAuditLog` ADD CONSTRAINT `AdminAuditLog_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `AdminUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

