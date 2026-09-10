CREATE TABLE "DataPlanPricing" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'alrahuz',
    "providerPlanId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "networkId" INTEGER NOT NULL,
    "planType" TEXT,
    "name" TEXT NOT NULL,
    "validity" TEXT,
    "providerCostKobo" BIGINT NOT NULL,
    "sellingPriceKobo" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataPlanPricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataPlanPricing_provider_providerPlanId_key" ON "DataPlanPricing"("provider", "providerPlanId");
CREATE INDEX "DataPlanPricing_network_isActive_idx" ON "DataPlanPricing"("network", "isActive");
CREATE INDEX "DataPlanPricing_networkId_isActive_idx" ON "DataPlanPricing"("networkId", "isActive");
