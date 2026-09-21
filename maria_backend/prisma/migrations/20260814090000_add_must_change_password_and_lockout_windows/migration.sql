-- mustChangePassword backs the admin-issued temporary password flow (see
-- the "Reset Password" action on the User admin resource) - a stopgap for
-- self-service email reset until Resend has a verified sending domain.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- pinFailureAt/loginPinFailureAt/passwordFailureAt back the rolling-window
-- lockout logic in src/lib/lockout.ts - each records when its matching
-- *Failures counter was last incremented, so a stale failure streak (older
-- than the reset window) is treated as expired instead of accumulating
-- forever across unrelated sessions.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pinFailureAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginPinFailureAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordFailureAt" TIMESTAMP(3);
