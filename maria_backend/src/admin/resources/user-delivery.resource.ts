import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManage = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN' || admin?.role === 'FINANCE';
};

export const userDeliveryResource: ResourceWithOptions = {
  resource: { model: getModelByName('UserDelivery'), client: prisma },
  options: {
    id: 'UserDelivery',
    navigation: { name: 'Communication', icon: 'Upload' },
    listProperties: ['title', 'user', 'fileName', 'reference', 'createdAt'],
    showProperties: ['id', 'title', 'description', 'user', 'fileName', 'mimeType', 'fileSize', 'reference', 'createdByAdmin', 'createdAt'],
    editProperties: [],
    actions: {
      new: { isAccessible: canManage, handler: async () => ({ redirectUrl: '/admin/user-deliveries' }) },
      edit: { isAccessible: false },
      delete: { isAccessible: false },
      list: { isAccessible: canManage },
      show: { isAccessible: canManage }
    }
  }
};
