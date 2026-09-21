-- Adds failure-count + lockout tracking for the main account password on
-- POST /api/auth/login, mirroring the pattern already used for the 4-digit
-- transaction PIN (pinFailures/pinLockedUntil) and the 6-digit login PIN
-- (loginPinFailures/loginPinLockedUntil). Previously the password itself had
-- no brute-force protection at all - only the global 120 req/min per-IP rate
-- limit stood between an attacker and unlimited password guesses against a
-- single account.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordLockedUntil" TIMESTAMP(3);
