import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const isSuperAdmin = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN';
};

export const adminUserResource: ResourceWithOptions = {
  resource: { model: getModelByName('AdminUser'), client: prisma },
  options: {
    id: 'AdminUser',
    navigation: { name: 'Access Control', icon: 'Shield' },
    listProperties: ['email', 'fullName', 'role', 'isActive', 'lastLoginAt'],
    showProperties: ['id', 'email', 'fullName', 'role', 'isActive', 'lastLoginAt', 'createdAt'],
    editProperties: ['email', 'fullName', 'role', 'isActive', 'password'],
    properties: {
      passwordHash: { isVisible: false },
      // Virtual field: never stored directly, converted to passwordHash in the
      // beforeSave hook below and stripped from the payload before Prisma sees it.
      password: {
        type: 'password',
        isVisible: { list: false, show: false, edit: true, filter: false }
      }
    },
    actions: {
      list: { isAccessible: isSuperAdmin },
      show: { isAccessible: isSuperAdmin },
      new: {
        isAccessible: isSuperAdmin,
        before: async (request) => {
          if (!request.payload?.password) {
            throw new Error('A password is required when creating a new admin account');
          }
          request.payload.passwordHash = await bcrypt.hash(request.payload.password as string, 12);
          delete request.payload.password;
          return request;
        }
      },
      edit: {
        isAccessible: isSuperAdmin,
        before: async (request) => {
          if (request.payload?.password) {
            request.payload.passwordHash = await bcrypt.hash(request.payload.password as string, 12);
          }
          delete request.payload?.password;
          return request;
        }
      },
      delete: { isAccessible: isSuperAdmin }
    }
  }
};
