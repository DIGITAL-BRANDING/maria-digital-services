import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptModificationPII } from '../services/nin-modification.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

/**
 * SUPER_ADMIN-only, same posture as the "View PII" Transaction action in
 * transaction.resource.ts - this is the actual document an admin needs to
 * open to re-key a NIN Modification request on techhubltd.co, so unlike
 * viewPii's raw-JSON notice popup, this streams the real PDF bytes back so
 * it opens directly in the browser. Every open is written to
 * AdminAuditLog, same as viewPii. Reached via the "Download PDF" admin
 * action's redirectUrl on the Transaction resource.
 */
export function registerNinModificationRoutes(router: Router) {
  router.get('/nin-modification/:transactionId/pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role !== 'SUPER_ADMIN') {
      return res.status(403).type('html').send('<p>Only a Super Admin can open NIN Modification submission PDFs.</p>');
    }

    const transactionId = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.type !== TransactionType.NIN_MODIFICATION) {
      return res.status(404).type('html').send('<p>NIN Modification transaction not found.</p>');
    }

    const pii = decryptModificationPII(transaction);
    if (!pii?.pdf_base64 || typeof pii.pdf_base64 !== 'string') {
      return res.status(404).type('html').send('<p>No PDF was generated for this request.</p>');
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'VIEW_TRANSACTION_PII',
      targetType: 'Transaction',
      targetId: transaction.id,
      metadata: { reference: transaction.reference, via: 'nin_modification_pdf' }
    });

    const buffer = Buffer.from(pii.pdf_base64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${transaction.reference}.pdf"`);
    res.send(buffer);
  });
}
