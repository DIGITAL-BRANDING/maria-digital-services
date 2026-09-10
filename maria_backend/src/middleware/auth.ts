import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from '../lib/auth-token.js';
import { prisma } from '../lib/prisma.js';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ status: false, message: 'Missing auth token' });

    const payload = verifyAuthToken(token, 'access');

    // Unlike the old Firebase/Supabase flow, we do NOT auto-create a user here —
    // accounts are created explicitly via POST /api/auth/register. If a valid
    // token's user no longer exists (deleted account), fail closed rather than
    // silently re-creating a blank one.
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ status: false, message: 'Account no longer exists' });
    }
    if (user.accountStatus === 'DELETED') {
      return res.status(401).json({ status: false, message: 'Account no longer exists', code: 'ACCOUNT_DELETED' });
    }
    if (user.accountStatus === 'DEACTIVATED') {
      return res.status(403).json({
        status: false,
        message: 'Your account is deactivated. Contact support to reactivate it.',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone
    };
    next();
  } catch (error) {
    next(error);
  }
}
