import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function logAdminAction(params: {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata
    }
  });
}
