import type { NotificationAudience, NotificationType, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { getFirebaseAdmin } from '../lib/firebase.js';
import { env } from '../config/env.js';

/**
 * Preset illustrations a promotional popup notification can use (see the
 * "Notification popup" feature: PromoPopupDialog on the Flutter side).
 * Deliberately a closed set the admin picks from - not a free-form image
 * upload/URL - so there's no image-hosting infrastructure to stand up and
 * no risk of a broken/slow-loading external image inside the popup. Each
 * key must have a matching case in PromoIllustration.fromKey() on the
 * Flutter side (lib/shared/widgets/promo_illustration.dart) - keep the two
 * lists in sync if either changes.
 */
export const PROMO_ILLUSTRATIONS = [
  { value: 'megaphone', label: 'Megaphone — general announcement' },
  { value: 'discount', label: 'Discount tag — price drop / sale' },
  { value: 'party', label: 'Party popper — celebration / anniversary' },
  { value: 'gift', label: 'Gift — bonus / reward / giveaway' },
  { value: 'rocket', label: 'Rocket — new feature / update' },
  { value: 'bell', label: 'Bell — reminder / notice' }
] as const;

/**
 * Sends a push notification to exactly the device tokens passed in — NEVER to a
 * topic, and never to "all tokens in the table". Every caller in this file resolves
 * the specific userId(s) first and only pushes to tokens belonging to those users.
 * Firebase's multicast endpoint accepts at most 500 tokens per call, so large
 * broadcasts are chunked.
 */
async function pushToTokens(tokens: string[], title: string, body: string, data?: Record<string, string>) {
  if (tokens.length === 0) return;
  if (!env.FIREBASE_SERVICE_ACCOUNT_BASE64) return; // push not configured — DB row still saved

  const admin = getFirebaseAdmin();
  const CHUNK_SIZE = 500;

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + CHUNK_SIZE);
    try {
      const result = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data
      });

      // Prune tokens FCM reports as dead (uninstalled app, expired token, etc.) so they
      // stop being targeted — and so a stale token can't quietly "leak" a push to
      // whichever device happens to hold that identifier now.
      const deadTokens: string[] = [];
      result.responses.forEach((response, index) => {
        if (!response.success) {
          const code = response.error?.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            deadTokens.push(chunk[index]);
          }
        }
      });
      if (deadTokens.length > 0) {
        await prisma.deviceToken.deleteMany({ where: { token: { in: deadTokens } } });
      }
    } catch (error) {
      console.error('[notifications] push send failed for a chunk', error);
    }
  }
}

/**
 * Creates a notification for exactly one user and pushes it to exactly that user's
 * registered devices. This is the ONLY function transaction/wallet/KYC code should
 * call to notify a user of something that happened to their own account.
 */
export async function notifyUser(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}) {
  const notification = await prisma.notification.create({
    data: {
      id: nanoid(),
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data
    }
  });

  const devices = await prisma.deviceToken.findMany({
    where: { userId: params.userId },
    select: { token: true }
  });

  await pushToTokens(
    devices.map((d) => d.token),
    params.title,
    params.body,
    { type: params.type, notificationId: notification.id }
  );

  return notification;
}

async function resolveAudienceUserIds(audience: NotificationAudience, userIds?: string[]) {
  if (audience === 'SPECIFIC_USERS') {
    const ids = userIds ?? [];
    if (ids.length === 0) {
      throw new Error('userIds is required when audience is SPECIFIC_USERS');
    }
    return prisma.user.findMany({
      where: { id: { in: ids }, accountStatus: { not: 'DELETED' } },
      select: { id: true }
    });
  }
  if (audience === 'KYC_VERIFIED_ONLY') {
    return prisma.user.findMany({
      where: { kycStatus: 'VERIFIED', accountStatus: { not: 'DELETED' } },
      select: { id: true }
    });
  }
  return prisma.user.findMany({
    where: { accountStatus: { not: 'DELETED' } },
    select: { id: true }
  });
}

/**
 * Fans an ALREADY-CREATED NotificationBroadcast row out into one Notification row
 * per targeted recipient, pushes to those recipients' devices only, and records the
 * final recipient count on the broadcast. Split out from `sendAdminBroadcast` so the
 * AdminJS "new" form (which creates the NotificationBroadcast row itself) can trigger
 * the same fan-out afterward, instead of duplicating this logic.
 */
export async function fanOutBroadcast(broadcastId: string) {
  const broadcast = await prisma.notificationBroadcast.findUniqueOrThrow({ where: { id: broadcastId } });
  const targetUserIds = Array.isArray(broadcast.targetUserIds) ? (broadcast.targetUserIds as string[]) : undefined;
  const targetUsers = await resolveAudienceUserIds(broadcast.audience, targetUserIds);

  if (targetUsers.length > 0) {
    await prisma.notification.createMany({
      data: targetUsers.map((u) => ({
        id: nanoid(),
        userId: u.id,
        type: broadcast.type,
        title: broadcast.title,
        body: broadcast.body,
        broadcastId: broadcast.id,
        imageKey: broadcast.imageKey,
        showAsPopup: broadcast.showAsPopup
      }))
    });

    const devices = await prisma.deviceToken.findMany({
      where: { userId: { in: targetUsers.map((u) => u.id) } },
      select: { token: true }
    });

    await pushToTokens(devices.map((d) => d.token), broadcast.title, broadcast.body, {
      type: broadcast.type,
      broadcastId: broadcast.id
    });
  }

  return prisma.notificationBroadcast.update({
    where: { id: broadcast.id },
    data: { recipientCount: targetUsers.length }
  });
}

/**
 * Admin-initiated broadcast (price changes, maintenance notices, promos, etc).
 * Resolves the target audience to a concrete list of userIds, fans out one
 * Notification row PER recipient (so each person's unread/read state is fully
 * independent), and pushes only to those recipients' device tokens.
 */
export async function sendAdminBroadcast(params: {
  adminId: string;
  title: string;
  body: string;
  type?: NotificationType;
  audience: NotificationAudience;
  userIds?: string[];
  imageKey?: string;
  showAsPopup?: boolean;
}) {
  const broadcast = await prisma.notificationBroadcast.create({
    data: {
      id: nanoid(),
      createdByAdminId: params.adminId,
      type: params.type ?? 'ADMIN_BROADCAST',
      title: params.title,
      body: params.body,
      audience: params.audience,
      targetUserIds: params.audience === 'SPECIFIC_USERS' ? params.userIds : undefined,
      imageKey: params.imageKey,
      showAsPopup: params.showAsPopup ?? false
    }
  });

  return fanOutBroadcast(broadcast.id);
}

export async function registerDeviceToken(userId: string, token: string, platform?: string) {
  // Upsert on the token (not userId+token): if this exact device previously belonged
  // to a different account (e.g. shared device, or user logged out and a different
  // user logged in on the same phone), the token is REASSIGNED to the current user
  // rather than left pointing at whoever registered it first — otherwise the old
  // owner would keep receiving pushes meant for this device.
  return prisma.deviceToken.upsert({
    where: { token },
    create: { id: nanoid(), userId, token, platform, lastSeenAt: new Date() },
    update: { userId, platform, lastSeenAt: new Date() }
  });
}

export async function unregisterDeviceToken(token: string) {
  await prisma.deviceToken.deleteMany({ where: { token } });
}
