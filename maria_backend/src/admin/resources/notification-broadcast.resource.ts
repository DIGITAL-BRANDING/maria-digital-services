import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import { fanOutBroadcast, PROMO_ILLUSTRATIONS } from '../../services/notification.service.js';
import { logAdminAction } from '../audit.js';
import type { AdminSessionUser } from '../auth.js';

const canSendNotifications = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

export const notificationBroadcastResource: ResourceWithOptions = {
  resource: { model: getModelByName('NotificationBroadcast'), client: prisma },
  options: {
    id: 'NotificationBroadcast',
    navigation: { name: 'Communication', icon: 'Bell' },
    listProperties: ['title', 'audience', 'showAsPopup', 'recipientCount', 'createdByAdmin', 'createdAt'],
    showProperties: [
      'id',
      'title',
      'body',
      'type',
      'audience',
      'targetUserIds',
      'imageKey',
      'showAsPopup',
      'recipientCount',
      'createdByAdmin',
      'createdAt'
    ],
    // Composing a broadcast is the only write path exposed here — once sent, a
    // broadcast is a historical record of what went out and to how many people,
    // so it's never edited or deleted after the fact (mirrors Transaction's
    // append-only design).
    editProperties: ['title', 'body', 'type', 'audience', 'targetUserIds', 'imageKey', 'showAsPopup'],
    filterProperties: ['audience', 'showAsPopup', 'createdByAdmin', 'createdAt'],
    properties: {
      title: { description: 'Shown as the push/notification title, e.g. "Data prices updated".' },
      body: { description: 'The message body users will see in-app and in the push notification.' },
      audience: {
        availableValues: [
          { value: 'ALL_USERS', label: 'All users' },
          { value: 'KYC_VERIFIED_ONLY', label: 'KYC-verified users only' },
          { value: 'SPECIFIC_USERS', label: 'Specific users (enter IDs in Target User Ids)' }
        ]
      },
      targetUserIds: {
        type: 'string',
        description: 'Only used when Audience is "Specific users". Comma-separated list of User IDs.',
        isVisible: { list: false, filter: false, show: true, edit: true }
      },
      imageKey: {
        description:
          'Optional illustration for the popup style below. Leave unset for a plain text notification.',
        availableValues: PROMO_ILLUSTRATIONS.map((i) => ({ value: i.value, label: i.label }))
      },
      showAsPopup: {
        description:
          'ON: shows as a full-screen promotional dialog the next time each recipient opens the app (in addition to the notification list). OFF: appears in the notification list only.'
      },
      recipientCount: { isDisabled: true },
      createdByAdmin: { isVisible: { list: true, filter: true, show: true, edit: false } }
    },
    actions: {
      list: { isAccessible: canSendNotifications },
      show: { isAccessible: canSendNotifications },
      edit: { isAccessible: false },
      delete: { isAccessible: false },
      new: {
        isAccessible: canSendNotifications,
        before: async (request, context) => {
          const admin = context.currentAdmin as unknown as AdminSessionUser | undefined;
          if (!admin?.id) throw new Error('Missing admin session');

          if (request.payload) {
            request.payload.createdByAdmin = admin.id;

            // The edit form exposes targetUserIds as a plain comma-separated string
            // (simplest UI for pasting a handful of IDs) — convert it to the JSON
            // array the column actually stores before AdminJS's Prisma adapter writes it.
            const raw = request.payload.targetUserIds;
            if (typeof raw === 'string' && raw.trim().length > 0) {
              request.payload.targetUserIds = JSON.stringify(
                raw.split(',').map((id: string) => id.trim()).filter(Boolean)
              );
            } else {
              request.payload.targetUserIds = null;
            }
          }
          return request;
        },
        after: async (response: any) => {
          const record = response.record;
          // AdminJS always serializes `errors` as an object. An empty object is
          // truthy in JavaScript, so `!record.errors` was *always* false and
          // this fan-out never ran for broadcasts created through AdminJS.
          // The Flutter admin route calls sendAdminBroadcast directly, which
          // is why it worked while this dashboard did not.
          const hasValidationErrors =
            Boolean(record?.baseError) || Object.keys(record?.errors ?? {}).length > 0;
          if (record?.params?.id && !hasValidationErrors) {
            const broadcast = await fanOutBroadcast(record.params.id as string);

            await logAdminAction({
              adminId: broadcast.createdByAdminId,
              action: 'SEND_NOTIFICATION_BROADCAST',
              targetType: 'NotificationBroadcast',
              targetId: broadcast.id,
              metadata: { title: broadcast.title, audience: broadcast.audience, recipientCount: broadcast.recipientCount }
            });

            response.notice = { message: `Sent to ${broadcast.recipientCount} user(s).`, type: 'success' };
          }
          return response;
        }
      }
    }
  }
};
