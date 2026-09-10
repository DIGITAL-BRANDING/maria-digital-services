-- AlterEnum
-- Adds the transaction types used by the new Techhub NIN/BVN identity
-- verification integration (see src/services/verification.service.ts).
-- Kept in its own statement, outside any surrounding transaction with code
-- that uses the new values - Postgres does not allow a new enum value to be
-- used in the same transaction that adds it (same reasoning as the
-- COUPON_REDEMPTION migration before this one).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'NIN_VERIFICATION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BVN_VERIFICATION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'IDENTITY_SERVICE_REQUEST';
