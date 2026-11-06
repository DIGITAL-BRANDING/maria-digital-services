import type { Request, Router } from 'express';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { manuallyDispatchPendingTicketToKtech } from '../services/verification.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData { adminUser?: AdminSessionUser; }
}

const DISPATCHABLE_SERVICES = new Set([
  'NIN_VALIDATION_GENERAL', 'NIN_VALIDATION_NO_RECORD', 'NIN_VALIDATION_SIM',
  'NIN_VALIDATION_BANK', 'NIN_VALIDATION_UPDATE_RECORDS', 'NIN_VALIDATION_MODIFICATION',
  'NIN_VALIDATION_PHOTO_ERROR', 'NIN_VALIDATION_VNIN', 'NIN_PERSONALIZATION', 'IPE_CLEARANCE'
]);

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function field(req: Request, name: string) {
  const fields = (req as Request & { fields?: Record<string, string | string[]> }).fields;
  const value = fields?.[name];
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}

function serviceLabel(value: string) {
  return value.replaceAll('_', ' ');
}

async function getDispatchQueue() {
  const transactions = await prisma.transaction.findMany({
    where: {
      type: TransactionType.IDENTITY_SERVICE_REQUEST,
      status: TransactionStatus.PENDING,
      provider: null,
      providerRef: null
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { user: { select: { fullName: true, email: true } } }
  });
  return transactions.filter((transaction) => {
    const metadata = transaction.metadata as Record<string, unknown> | null;
    return typeof metadata?.service === 'string' && DISPATCHABLE_SERVICES.has(metadata.service) && !metadata.ticket_id;
  });
}

function renderPage(rows: Awaited<ReturnType<typeof getDispatchQueue>>, notice = '') {
  const body = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Service</th><th>User</th><th>Amount</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${rows.map((transaction) => {
        const metadata = transaction.metadata as Record<string, unknown> | null;
        const service = String(metadata?.service ?? '');
        return `<tr><td><strong>${escape(transaction.reference)}</strong><small>${escape(transaction.id)}</small></td><td>${escape(serviceLabel(service))}</td><td>${escape(transaction.user.fullName)}<small>${escape(transaction.user.email)}</small></td><td>₦${koboToNaira(transaction.amountKobo).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td><td>${transaction.createdAt.toLocaleString('en-NG')}</td><td><form method="post" action="/admin/manual-provider-dispatch" onsubmit="return confirm('Send this request and its identity details to K-Tech now? The provider may charge our K-Tech wallet.');"><input type="hidden" name="transaction_id" value="${escape(transaction.id)}"><button type="submit">Dispatch to K‑Tech</button></form></td></tr>`;
      }).join('')}</tbody></table></div>`
    : '<div class="empty">There are no unassigned NIN Validation, Personalization, or IPE requests waiting for dispatch.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manual Provider Dispatch</title><style>
*{box-sizing:border-box}body{font:15px Arial,sans-serif;background:#f4f7fb;color:#172554;margin:0;padding:28px}main{max-width:1200px;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.top a{color:#1d4ed8;text-decoration:none;font-weight:600}h1{margin:0 0 7px;font-size:26px}.muted{color:#64748b;line-height:1.5}.panel{background:#fff;border:1px solid #dbe4f0;border-radius:14px;padding:20px;margin:16px 0}.notice{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:9px;padding:13px;margin:14px 0}.result{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:9px;padding:13px;margin:14px 0}.result.error{background:#fff7ed;border-color:#fed7aa;color:#9a3412}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:780px}th,td{text-align:left;padding:13px 11px;border-bottom:1px solid #e5eaf1;vertical-align:middle}th{font-size:12px;color:#64748b;text-transform:uppercase}small{display:block;color:#64748b;margin-top:5px;font-size:12px}button{background:#0b2f73;color:white;border:0;border-radius:8px;padding:10px 13px;font-weight:700;cursor:pointer;white-space:nowrap}button:hover{background:#1452a0}.empty{padding:32px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px}@media(max-width:700px){body{padding:15px}.panel{padding:14px}.top{align-items:flex-start;flex-direction:column}}
</style></head><body><main><div class="top"><div><h1>Manual Provider Dispatch</h1><div class="muted">Send eligible, unassigned live async requests to K‑Tech without creating a second customer charge.</div></div><a href="/admin">← Admin dashboard</a></div><section class="panel"><div class="notice"><strong>Currently supported:</strong> NIN Validation, NIN Personalization, and IPE Clearance. Dispatch reuses the original transaction reference as K‑Tech's idempotency key. TIN, CAC, Newspaper, and BVN Modification are not listed because their K‑Tech endpoint mappings are not configured.</div>${notice ? `<div class="result${notice.startsWith('Dispatch failed:') ? ' error' : ''}">${escape(notice)}</div>` : ''}${body}</section></main></body></html>`;
}

export function registerManualProviderDispatchRoutes(router: Router) {
  router.get('/manual-provider-dispatch', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');
    return res.type('html').send(renderPage(await getDispatchQueue()));
  });

  router.post('/manual-provider-dispatch', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');
    const transactionId = field(req, 'transaction_id');
    if (!transactionId || transactionId.length > 128) {
      return res.status(400).type('html').send(renderPage(await getDispatchQueue(), 'Select a valid request to dispatch.'));
    }

    const result = await manuallyDispatchPendingTicketToKtech(transactionId);
    await logAdminAction({
      adminId: admin.id,
      action: result.ok ? 'MANUAL_DISPATCH_KTECH_SUCCESS' : 'MANUAL_DISPATCH_KTECH_FAILED',
      targetType: 'Transaction',
      targetId: transactionId,
      metadata: result.ok ? { reference: result.reference, provider: 'ktech', ticketId: result.ticketId } : { provider: 'ktech', reason: result.message }
    });
    const message = result.ok
      ? `Request ${result.reference} was sent to K‑Tech. Provider ticket: ${result.ticketId}.`
      : `Dispatch failed: ${result.message}`;
    return res.type('html').send(renderPage(await getDispatchQueue(), message));
  });
}
