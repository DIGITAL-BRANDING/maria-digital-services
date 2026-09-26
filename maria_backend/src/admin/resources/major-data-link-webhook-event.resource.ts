import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';

/** Read-only audit trail for signed Major Data Link partner notifications. */
export const majorDataLinkWebhookEventResource: ResourceWithOptions = {
  resource: { model: getModelByName('MajorDataLinkWebhookEvent'), client: prisma },
  options: {
    id: 'MajorDataLinkWebhookEvent',
    navigation: { name: 'API Integrations', icon: 'Radio' },
    listProperties: ['event', 'reference', 'receivedAt'],
    showProperties: ['eventId', 'event', 'reference', 'payload', 'receivedAt'],
    filterProperties: ['event', 'reference', 'receivedAt'],
    actions: { new: { isAccessible: false }, edit: { isAccessible: false }, delete: { isAccessible: false } }
  }
};
