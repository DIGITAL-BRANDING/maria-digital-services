-- AlterTable
-- Adds fields needed to support BVN-based KYC + automatic Dedicated Virtual
-- Account creation via Paystack. Deliberately does NOT add a column for the
-- raw BVN itself - only the validation outcome (bvnVerifiedAt), a masked
-- last-4 digits for support/display purposes (bvnLast4), the Paystack
-- customer code needed for follow-up API calls, and a failure reason for
-- surfacing a helpful message to the user if validation is rejected.
ALTER TABLE "User" ADD COLUMN     IF NOT EXISTS "paystackCustomerCode" TEXT;
ALTER TABLE "User" ADD COLUMN     IF NOT EXISTS "bvnLast4" TEXT;
ALTER TABLE "User" ADD COLUMN     IF NOT EXISTS "bvnVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     IF NOT EXISTS "kycFailureReason" TEXT;
