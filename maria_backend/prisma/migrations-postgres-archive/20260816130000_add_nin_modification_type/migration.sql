-- AlterEnum
-- Adds the transaction type used by the new manually-processed NIN
-- Modification service (see src/services/nin-modification.service.ts).
-- Kept in its own statement, outside any surrounding transaction with code
-- that uses the new value - Postgres does not allow a new enum value to be
-- used in the same transaction that adds it (same reasoning as the
-- NIN_VERIFICATION / BVN_VERIFICATION / IDENTITY_SERVICE_REQUEST migration
-- before this one).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'NIN_MODIFICATION';
