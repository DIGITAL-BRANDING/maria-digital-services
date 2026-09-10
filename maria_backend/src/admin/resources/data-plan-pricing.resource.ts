import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManagePricing = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

export const dataPlanPricingResource: ResourceWithOptions = {
  resource: { model: getModelByName('DataPlanPricing'), client: prisma },
  options: {
    id: 'DataPlanPricing',
    navigation: { name: 'Products', icon: 'ShoppingCart' },
    listProperties: ['network', 'planType', 'name', 'providerCostKobo', 'sellingPriceKobo', 'isActive'],
    showProperties: [
      'id',
      'provider',
      'providerPlanId',
      'network',
      'networkId',
      'planType',
      'name',
      'validity',
      'providerCostKobo',
      'sellingPriceKobo',
      'isActive',
      'lastSeenAt',
      'updatedAt'
    ],
    editProperties: ['sellingPriceKobo', 'isActive'],
    actions: {
      new: { isAccessible: false },
      delete: { isAccessible: false },
      edit: { isAccessible: canManagePricing },
      // Redirects to the plain server-rendered /admin/bulk-pricing page
      // (src/admin/bulk-pricing.ts) - a resource-level action needs no input
      // form of its own here, it's just a discoverable button in this
      // resource's toolbar pointing at the real tool, so an admin editing
      // one plan's price notices there's a faster way to do 250 of them at
      // once instead of one at a time.
      bulkPricingTool: {
        actionType: 'resource',
        icon: 'TrendingUp',
        component: false,
        isAccessible: canManagePricing,
        handler: async () => ({ redirectUrl: '/admin/bulk-pricing' }),
        guard: 'Open the Bulk Pricing tool to reprice many plans at once?'
      }
    },
    properties: {
      providerCostKobo: {
        isDisabled: true,
        description: 'Provider cost in kobo. Example: 21500 = NGN 215.'
      },
      sellingPriceKobo: {
        description: 'Selling price in kobo. Example: 23000 = NGN 230. Leave empty to use default markup.'
      }
    }
  }
};
