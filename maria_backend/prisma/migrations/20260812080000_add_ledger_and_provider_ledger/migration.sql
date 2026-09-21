-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFUND';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'WALLET_FUNDING_FEE';

-- CreateEnum
CREATE TYPE "ProviderLedgerEntryType" AS ENUM ('PURCHASE_DEBIT', 'TOPUP_CREDIT', 'ADJUSTMENT');

-- AlterTable: costKobo (from the base wallet-tracking-and-company-profit patch -
-- this column existed in schema.prisma before this migration but had no
-- migration file committed for it; adding it here alongside the new columns
-- below since neither has been applied to any real database yet)
ALTER TABLE "Transaction" ADD COLUMN "costKobo" BIGINT;

-- AlterTable: relatedTransactionId (proper append-only reversal linkage)
ALTER TABLE "Transaction" ADD COLUMN "relatedTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_type_status_createdAt_idx" ON "Transaction"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_relatedTransactionId_idx" ON "Transaction"("relatedTransactionId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_relatedTransactionId_fkey" FOREIGN KEY ("relatedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ProviderLedgerBalance" (
    "provider" TEXT NOT NULL,
    "balanceKobo" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderLedgerBalance_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ProviderLedgerEntry" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" "ProviderLedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "balanceBeforeKobo" BIGINT NOT NULL,
    "balanceAfterKobo" BIGINT NOT NULL,
    "relatedTransactionId" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderLedgerEntry_provider_createdAt_idx" ON "ProviderLedgerEntry"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderLedgerEntry_relatedTransactionId_idx" ON "ProviderLedgerEntry"("relatedTransactionId");
