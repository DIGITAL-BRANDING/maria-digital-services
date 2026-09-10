-- Admin-editable referral program settings, managed via the AdminJS panel.
-- Seeded with one row (id='default') by referral.service.ts's
-- getReferralSettings() the first time it's read, so no manual seed step
-- is required - the app self-heals if this table is ever empty.

-- referralWithdrawnKobo tracks lifetime commission actually moved into the
-- wallet via /referral/withdraw, separate from referralEarningsKobo (the
-- current unwithdrawn/pending balance) - referral.service.ts reads and
-- writes both. This column was in the intended schema change but missing
-- from the original migration; added here so the two stay in sync.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralWithdrawnKobo" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ReferralSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "minWithdrawalKobo" BIGINT NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSettings_pkey" PRIMARY KEY ("id")
);
