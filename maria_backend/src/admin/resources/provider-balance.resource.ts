import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';

/**
 * Read-only view of YOUR balance at each provider — Alrahuz (VTU),
 * BilalSadaSub (VTU), and Techhub (NIN/BVN verification), distinguished by
 * the `provider` column.
 * See ProviderBalanceStatus in schema.prisma, and recordProviderBalance in
 * provider.service.ts (Alrahuz) / techhub.service.ts (Techhub). Not
 * editable here because it's just a mirror of what each provider itself
 * reports; the only way to actually change it is to fund that provider
 * account directly. A provider's row only appears after its first
 * balance-reporting API call since deploy — BilalSadaSub reports it at
 * authentication/refresh, while Techhub only reports balance
 * on the five async services (Delinking/NIN Validation/Personalization/BVN
 * Retrieval/IPE Clearance), not on slip lookups.
 */
export const providerBalanceResource: ResourceWithOptions = {
  resource: { model: getModelByName('ProviderBalanceStatus'), client: prisma },
  options: {
    id: 'ProviderBalanceStatus',
    navigation: { name: 'Wallet', icon: 'AlertTriangle' },
    listProperties: ['provider', 'lastKnownBalance', 'lastCheckedAt', 'lowBalanceAlertSentAt'],
    showProperties: ['provider', 'lastKnownBalance', 'lastCheckedAt', 'lowBalanceAlertSentAt'],
    actions: {
      new: { isAccessible: false },
      edit: { isAccessible: false },
      delete: { isAccessible: false }
    },
    properties: {
      lastKnownBalance: {
        description:
          'Your last known balance at this provider — updates after Alrahuz purchases, BilalSadaSub authentication/refresh, or Techhub async-service calls.'
      }
    }
  }
};
