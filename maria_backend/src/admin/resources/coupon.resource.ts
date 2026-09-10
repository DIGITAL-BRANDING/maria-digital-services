import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { nanoid } from 'nanoid';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManageCoupons = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

export const couponResource: ResourceWithOptions = {
  resource: { model: getModelByName('Coupon'), client: prisma },
  options: {
    id: 'Coupon',
    navigation: { name: 'Wallet', icon: 'CreditCard' },
    listProperties: ['code', 'valueKobo', 'isRedeemed', 'redeemedBy', 'redeemedAt', 'createdAt'],
    showProperties: [
      'id',
      'code',
      'valueKobo',
      'isRedeemed',
      'redeemedBy',
      'redeemedAt',
      'createdByAdminId',
      'note',
      'expiresAt',
      'createdAt'
    ],
    editProperties: ['code', 'valueKobo', 'note', 'expiresAt'],
    filterProperties: ['code', 'isRedeemed', 'createdAt'],
    properties: {
      valueKobo: { description: 'Value in kobo. Example: 50000 = NGN 500.' },
      code: { description: 'Leave blank to auto-generate a random code.' },
      isRedeemed: { isDisabled: true },
      redeemedBy: { isDisabled: true },
      redeemedAt: { isDisabled: true },
      createdByAdminId: { isVisible: { list: false, filter: false, show: true, edit: false } }
    },
    actions: {
      list: { isAccessible: canManageCoupons },
      show: { isAccessible: canManageCoupons },
      new: {
        isAccessible: canManageCoupons,
        before: async (request, context) => {
          if (!request.payload?.code) {
            request.payload = { ...request.payload, code: nanoid(10).toUpperCase() };
          } else {
            request.payload.code = String(request.payload.code).trim().toUpperCase();
          }
          const admin = context.currentAdmin as unknown as AdminSessionUser | undefined;
          if (admin?.id) {
            request.payload.createdByAdminId = admin.id;
          }
          return request;
        }
      },
      edit: { isAccessible: canManageCoupons },
      delete: { isAccessible: canManageCoupons }
    }
  }
};
