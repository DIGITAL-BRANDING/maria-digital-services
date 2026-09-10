import type { Request, Router } from 'express';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

/**
 * Powers the "unresolved requests" popup shown on the admin dashboard
 * (components/dashboard.tsx) - a quick summary of every manually-processed
 * request type (CAC, BVN License, BVN Modification, NIN Modification,
 * Birth Attestation, Newspaper Publication) still sitting PENDING, plus how
 * many of each arrived in the last 24 hours, so an admin logging in
 * immediately sees what's backed up without clicking through every
 * "Requests" tile individually.
 *
 * This is registered on the SAME router AdminJS itself uses (see
 * setup.ts), which shares AdminJS's own session/cookie
 * (`imam_admin_sid`) - NOT routes/admin-api.routes.ts, which requires a
 * customer-app Bearer token that a request originating from inside the
 * AdminJS panel's own React components never has. Same pattern as
 * admin/cac.ts's manage page.
 */
const PENDING_SUMMARY_TYPES: { type: TransactionType; label: string }[] = [
  { type: TransactionType.CAC_SERVICE_REQUEST, label: 'CAC Registration' },
  { type: TransactionType.BVN_LICENSE_ONBOARDING, label: 'BVN License Enrollment' },
  { type: TransactionType.BVN_MODIFICATION, label: 'BVN Modification' },
  { type: TransactionType.BVN_CRM, label: 'BVN CRM Follow-up' },
  { type: TransactionType.NIN_MODIFICATION, label: 'NIN Modification' },
  { type: TransactionType.BIRTH_ATTESTATION, label: 'Birth Attestation' },
  { type: TransactionType.NEWSPAPER_PUBLICATION, label: 'Newspaper Publication' }
];

export function registerPendingSummaryRoutes(router: Router) {
  router.get('/pending-summary', async (req: Request, res) => {
    if (!req.session?.adminUser) {
      return res.status(401).json({ status: false, message: 'Not signed in' });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Do one query without a `type IN (...)` clause, then group in memory.
    // A live database may not yet have an enum member introduced by newer
    // application code (e.g. BVN_MODIFICATION); sending that name to Postgres
    // in a WHERE clause throws 22P02 and used to spam the production logs.
    const pendingTransactions = await prisma.transaction.findMany({
      where: { status: TransactionStatus.PENDING },
      select: { type: true, createdAt: true }
    });
    const rows = PENDING_SUMMARY_TYPES.map(({ type, label }) => {
      const matching = pendingTransactions.filter((transaction) => String(transaction.type) === String(type));
      const oldest = matching.reduce<Date | null>((value, transaction) => !value || transaction.createdAt < value ? transaction.createdAt : value, null);
      return { type, label, pending: matching.length, new_last_24h: matching.filter((transaction) => transaction.createdAt >= since24h).length, oldest_pending_at: oldest?.toISOString() ?? null };
    });

    res.json({
      status: true,
      data: {
        total_pending: rows.reduce((sum, r) => sum + r.pending, 0),
        total_new_last_24h: rows.reduce((sum, r) => sum + r.new_last_24h, 0),
        by_type: rows
      }
    });
  });
}
