-- Referral commission is 1% by default. Keep an explicitly configured
-- admin rate unchanged; only migrate the original untouched 2% default.
UPDATE "ReferralSettings"
SET "commissionRate" = 0.01
WHERE "id" = 'default' AND "commissionRate" = 0.02;
