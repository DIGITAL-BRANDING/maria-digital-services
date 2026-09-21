CREATE TABLE IF NOT EXISTS "ServicePricing" (
  "id" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'alrahuz',
  "label" TEXT NOT NULL,
  "providerCostKobo" BIGINT NOT NULL,
  "sellingPriceKobo" BIGINT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServicePricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServicePricing_service_key" ON "ServicePricing"("service");
CREATE INDEX IF NOT EXISTS "ServicePricing_isActive_idx" ON "ServicePricing"("isActive");

INSERT INTO "ServicePricing" ("id", "service", "provider", "label", "providerCostKobo", "sellingPriceKobo", "isActive", "updatedAt")
VALUES
  ('svc_waec_pin', 'WAEC_PIN', 'alrahuz', 'WAEC Result Checker PIN', 515000, NULL, true, CURRENT_TIMESTAMP),
  ('svc_neco_pin', 'NECO_PIN', 'alrahuz', 'NECO Result Checker Token', 215000, NULL, true, CURRENT_TIMESTAMP),
  ('svc_nabteb_pin', 'NABTEB_PIN', 'alrahuz', 'NABTEB Result Checker PIN', 90000, NULL, true, CURRENT_TIMESTAMP)
ON CONFLICT ("service") DO NOTHING;
