-- AlterEnum
-- Adds the transaction type used when a user redeems a prepaid "Fund with
-- Coupon" code (see the new Coupon model below). Kept in its own statement,
-- outside any surrounding transaction with code that uses the new value —
-- Postgres does not allow a new enum value to be used in the same
-- transaction that adds it.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'COUPON_REDEMPTION';

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "valueKobo" BIGINT NOT NULL,
    "isRedeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedByUserId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isRedeemed_idx" ON "Coupon"("isRedeemed");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
