-- Admin-switchable NIN/BVN identity-verification provider (Techhub vs
-- K-Tech Solutions). PostgreSQL equivalent of the retained MySQL migration.
ALTER TABLE "PricingSettings"
  ADD COLUMN "identityVerificationProvider" TEXT NOT NULL DEFAULT 'techhub';
