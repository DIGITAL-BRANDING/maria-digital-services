-- Backs the promotional popup notification style (illustration + full-screen
-- dialog on next app launch) - see PROMO_ILLUSTRATIONS in
-- notification.service.ts and PromoPopupDialog on the Flutter side.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "showAsPopup" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NotificationBroadcast" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
ALTER TABLE "NotificationBroadcast" ADD COLUMN IF NOT EXISTS "showAsPopup" BOOLEAN NOT NULL DEFAULT false;
