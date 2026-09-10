-- Adds real per-user notifications + device tokens, plus admin broadcast messages.
--
-- Root cause being fixed: the app had no Notification/DeviceToken tables at all, so
-- there was no way to store "this alert belongs to this one user" or "this FCM token
-- belongs to this one user". Any endpoint or push job built against a shared/global
-- source (or a naive "select all notifications" query) is exactly what produces the
-- symptom of every user seeing every other user's alerts. From this migration on,
-- every Notification row and every DeviceToken row is FK'd to a single userId, and
-- all app-facing queries must filter by req.user.id (see notification.routes.ts).

DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('TRANSACTION', 'WALLET', 'KYC', 'PROMO', 'ADMIN_BROADCAST', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationAudience" AS ENUM ('ALL_USERS', 'SPECIFIC_USERS', 'KYC_VERIFIED_ONLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX IF NOT EXISTS "DeviceToken_userId_idx" ON "DeviceToken"("userId");

DO $$ BEGIN
  ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "NotificationBroadcast" (
    "id" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'ADMIN_BROADCAST',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL DEFAULT 'ALL_USERS',
    "targetUserIds" JSONB,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationBroadcast_createdByAdminId_createdAt_idx" ON "NotificationBroadcast"("createdByAdminId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_createdByAdminId_fkey"
    FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "broadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "NotificationBroadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
