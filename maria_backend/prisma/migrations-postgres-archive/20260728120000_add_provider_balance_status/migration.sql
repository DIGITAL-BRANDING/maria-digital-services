-- CreateTable
CREATE TABLE "ProviderBalanceStatus" (
    "provider" TEXT NOT NULL,
    "lastKnownBalance" DOUBLE PRECISION NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "lowBalanceAlertSentAt" TIMESTAMP(3),

    CONSTRAINT "ProviderBalanceStatus_pkey" PRIMARY KEY ("provider")
);
