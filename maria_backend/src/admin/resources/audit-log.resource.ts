import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';

export const adminAuditLogResource: ResourceWithOptions = {
  resource: { model: getModelByName('AdminAuditLog'), client: prisma },
  options: {
    id: 'AdminAuditLog',
    navigation: { name: 'Access Control', icon: 'FileText' },
    listProperties: ['createdAt', 'action', 'targetType', 'targetId', 'admin'],
    showProperties: ['id', 'admin', 'action', 'targetType', 'targetId', 'metadata', 'createdAt'],
    filterProperties: ['action', 'targetType', 'targetId', 'admin', 'createdAt'],
    sort: { sortBy: 'createdAt', direction: 'desc' },
    actions: {
      // Every write here happens programmatically via logAdminAction — never
      // through the panel itself, or the audit trail could be tampered with.
      new: { isAccessible: false },
      edit: { isAccessible: false },
      delete: { isAccessible: false }
    }
  }
};
