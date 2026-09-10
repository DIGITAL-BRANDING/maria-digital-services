import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManageReferralSettings = ({
  currentAdmin
}: {
  currentAdmin?: Record<string, unknown>;
}) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

export const referralSettingsResource: ResourceWithOptions = {
  resource: { model: getModelByName('ReferralSettings'), client: prisma },
  options: {
    id: 'ReferralSettings',
    navigation: { name: 'Wallet', icon: 'Percent' },
    // Singleton - there's only ever the one 'default' row (self-seeded by
    // referral.service.ts's getReferralSettings() on first read), so
    // new/delete are disabled. Admins open the one row from the list and
    // edit it there.
    listProperties: ['isEnabled', 'commissionRate', 'minWithdrawalKobo', 'updatedAt'],
    showProperties: ['id', 'isEnabled', 'commissionRate', 'minWithdrawalKobo', 'updatedAt'],
    editProperties: ['isEnabled', 'commissionRate', 'minWithdrawalKobo'],
    properties: {
      id: { isVisible: { list: false, filter: false, show: true, edit: false } },
      isEnabled: {
        description: 'Turn the whole referral commission program on or off.'
      },
      commissionRate: {
        description:
          'Fraction of each referred purchase paid as commission. 0.02 = 2%. Example: 0.05 = 5%.'
      },
      minWithdrawalKobo: {
        description:
          'Minimum commission a user can withdraw to their wallet, in kobo. Example: 50000 = NGN 500.'
      },
      updatedAt: { isVisible: { list: true, filter: false, show: true, edit: false } }
    },
    actions: {
      list: { isAccessible: canManageReferralSettings },
      show: { isAccessible: canManageReferralSettings },
      edit: { isAccessible: canManageReferralSettings },
      new: { isAccessible: false },
      delete: { isAccessible: false },
      bulkDelete: { isAccessible: false }
    }
  }
};
