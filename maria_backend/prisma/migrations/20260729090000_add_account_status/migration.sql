-- Account lifecycle: adds a real "deactivated" state distinct from deletion,
-- and lets requireAuth reject a deactivated/deleted user's requests
-- immediately, rather than only after the current access token expires
-- (the existing DELETE /account flow revoked refresh tokens but left the
-- current access token valid until its natural TTL).

DO $$ BEGIN
  CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'DELETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;
