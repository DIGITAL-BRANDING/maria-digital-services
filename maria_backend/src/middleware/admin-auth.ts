import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from './auth.js';

export type AppAdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT';
};

declare global {
  namespace Express {
    interface Request {
      admin?: AppAdminUser;
    }
  }
}

export function requireAppAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async (error?: unknown) => {
    if (error) return next(error);

    try {
      const admin = await prisma.adminUser.findFirst({
        where: {
          email: { equals: req.user!.email },
          isActive: true
        }
      });

      if (!admin) {
        return res.status(403).json({ status: false, message: 'Admin access required' });
      }

      req.admin = {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role as AppAdminUser['role']
      };
      next();
    } catch (adminError) {
      next(adminError);
    }
  });
}

export function requireFinanceAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.admin || req.admin.role === 'SUPPORT') {
    return res.status(403).json({ status: false, message: 'Finance admin access required' });
  }
  next();
}
