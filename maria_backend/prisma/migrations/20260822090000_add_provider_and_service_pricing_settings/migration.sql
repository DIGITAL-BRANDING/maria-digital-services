-- Provider selection and service-specific markups used by the pricing admin.
ALTER TABLE "PricingSettings"
  ADD COLUMN IF NOT EXISTS "dataAirtimeProvider" TEXT NOT NULL DEFAULT 'alrahuz',
  ADD COLUMN IF NOT EXISTS "resultPinProvider" TEXT NOT NULL DEFAULT 'alrahuz',
  ADD COLUMN IF NOT EXISTS "cableMarkupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "electricityMarkupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
