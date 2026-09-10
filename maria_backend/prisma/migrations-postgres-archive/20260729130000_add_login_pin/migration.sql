-- Adds a separate 6-digit "login PIN" to the User model, distinct from the
-- existing 4-digit transaction pinHash (wallet confirm / balance / delete).
-- Once loginPinHash is set, POST /api/auth/login requires it (in addition to
-- the password) - this is what forces password + PIN on an unrecognized
-- device, while a device already holding a valid session unlocks locally
-- and never calls /auth/login again.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginPinHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginPinFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginPinLockedUntil" TIMESTAMP(3);
