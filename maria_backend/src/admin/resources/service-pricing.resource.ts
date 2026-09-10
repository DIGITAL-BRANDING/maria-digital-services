import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManagePricing = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

/**
 * Admin page for the ServicePricing table - covers BOTH Techhub's NIN/BVN
 * verification services and Alrahuz's WAEC/NECO/NABTEB result-pin services
 * (distinguished by the `provider` column). Until this resource existed,
 * there was no AdminJS UI for either: rows were only readable/editable via
 * the raw `GET/PATCH /api/admin/service-prices` API, which is why prices
 * looked "wrong" in the app - nobody had a way to actually set them.
 *
 * Rows are created lazily on first read (see getOrCreateVerificationPricingRow
 * / getOrCreateServicePricingRow in the two services) with a providerCostKobo
 * default and no sellingPriceKobo - so a freshly-deployed environment shows
 * these rows only after each service has been hit at least once (e.g. by
 * loading the app's verification/result-pin price list). `new`/`delete` are
 * disabled here for the same reason as Data Plan Pricing: rows are meant to
 * be provider-synced/lazily-created, not hand-authored.
 */
export const servicePricingResource: ResourceWithOptions = {
  resource: { model: getModelByName('ServicePricing'), client: prisma },
  options: {
    id: 'ServicePricing',
    navigation: { name: 'Products', icon: 'Tag' },
    listProperties: ['provider', 'service', 'label', 'providerCostKobo', 'sellingPriceKobo', 'isActive'],
    showProperties: [
      'id',
      'provider',
      'service',
      'label',
      'providerCostKobo',
      'sellingPriceKobo',
      'isActive',
      'lastSyncedAt',
      'createdAt',
      'updatedAt'
    ],
    editProperties: ['sellingPriceKobo', 'isActive'],
    filterProperties: ['provider', 'service', 'isActive'],
    actions: {
      new: { isAccessible: false },
      delete: { isAccessible: false },
      list: { isAccessible: canManagePricing },
      show: { isAccessible: canManagePricing },
      edit: { isAccessible: canManagePricing },
      bulkPricingTool: {
        actionType: 'resource',
        icon: 'TrendingUp',
        component: false,
        isAccessible: canManagePricing,
        handler: async () => ({ redirectUrl: '/admin/bulk-pricing' }),
        guard: 'Open the Bulk Pricing tool to reprice many services at once?'
      }
    },
    properties: {
      providerCostKobo: {
        isDisabled: true,
        description: 'What the provider (Techhub/Alrahuz) charges us, in kobo. Example: 12000 = NGN 120.'
      },
      sellingPriceKobo: {
        description:
          'What we charge the user, in kobo. Example: 15000 = NGN 150. Leave empty to sell at zero markup (provider cost).'
      }
    }
  }
};
