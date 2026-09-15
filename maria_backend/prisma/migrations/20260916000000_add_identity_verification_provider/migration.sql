-- Admin-switchable NIN/BVN identity-verification provider (Techhub vs
-- K-Tech Solutions), same role as the existing dataAirtimeProvider /
-- resultPinProvider columns on this table. See
-- src/services/pricing-settings.service.ts and src/services/ktech.service.ts.
ALTER TABLE `PricingSettings`
  ADD COLUMN `identityVerificationProvider` VARCHAR(191) NOT NULL DEFAULT 'techhub';
