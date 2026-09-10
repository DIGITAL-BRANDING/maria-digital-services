import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { registerDeviceToken, unregisterDeviceToken } from '../services/notification.service.js';

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);

/**
 * Every query below is scoped to `req.user!.id` from the verified auth token —
 * never to a body/query param — so there is no way for one user's request to
 * read or mutate another user's notifications.
 */
notificationRoutes.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  res.json({
    status: true,
    data: notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type.toLowerCase(),
      is_read: n.isRead,
      data: n.data,
      image_key: n.imageKey,
      show_as_popup: n.showAsPopup,
      created_at: n.createdAt.toISOString()
    }))
  });
});

notificationRoutes.post('/read', async (req, res) => {
  const body = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});

  await prisma.notification.updateMany({
    where: {
      userId: req.user!.id,
      ...(body.ids && body.ids.length > 0 ? { id: { in: body.ids } } : {})
    },
    data: { isRead: true, readAt: new Date() }
  });

  res.json({ status: true, message: 'Notifications marked as read' });
});

notificationRoutes.post('/fcm', async (req, res) => {
  const body = z.object({
    token: z.string().min(1),
    platform: z.string().optional()
  }).parse(req.body);

  await registerDeviceToken(req.user!.id, body.token, body.platform);
  res.json({ status: true, message: 'Device registered' });
});

/** Called on logout so a signed-out device stops receiving pushes for this account. */
notificationRoutes.post('/fcm/unregister', async (req, res) => {
  const body = z.object({ token: z.string().min(1) }).parse(req.body);
  await unregisterDeviceToken(body.token);
  res.json({ status: true, message: 'Device unregistered' });
});
