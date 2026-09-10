-- Global default markup for data plans (see PricingSettings in schema.prisma
-- and defaultSellingPrice() in data-plan-pricing.service.ts). Self-seeds one
-- row (id='default') on first read via getPricingSettings()'s getOrCreate -
-- same pattern as ReferralSettings, no manual seed step required.
CREATE TABLE IF NOT EXISTS "PricingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "dataPlanMarkupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataPlanMarkupNaira" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);
