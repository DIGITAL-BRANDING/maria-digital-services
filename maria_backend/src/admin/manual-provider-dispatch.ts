import type { Request, Router } from 'express';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { manuallyDispatchPendingTicketToKtech, manuallyDispatchPendingTinToKtech } from '../services/verification.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData { adminUser?: AdminSessionUser; }
}

const DISPATCHABLE_SERVICES = new Set([
  'NIN_VALIDATION_GENERAL', 'NIN_VALIDATION_NO_RECORD', 'NIN_VALIDATION_SIM',
  'NIN_VALIDATION_BANK', 'NIN_VALIDATION_UPDATE_RECORDS', 'NIN_VALIDATION_MODIFICATION',
  'NIN_VALIDATION_PHOTO_ERROR', 'NIN_VALIDATION_VNIN', 'NIN_PERSONALIZATION', 'IPE_CLEARANCE'
  , 'TIN_INDIVIDUAL', 'TIN_CORPORATE'
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
      type: { in: [TransactionType.IDENTITY_SERVICE_REQUEST, TransactionType.TIN_CERTIFICATE_REQUEST] },
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
    return (typeof metadata?.service === 'string' && DISPATCHABLE_SERVICES.has(metadata.service) && !metadata.ticket_id)
      || (transaction.type === TransactionType.TIN_CERTIFICATE_REQUEST && ['individual', 'corporate'].includes(String(metadata?.tin_type)));
  });
}

function renderPage(rows: Awaited<ReturnType<typeof getDispatchQueue>>, notice = '') {
  const body = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Service</th><th>User</th><th>Amount</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${rows.map((transaction) => {
        const metadata = transaction.metadata as Record<string, unknown> | null;
        const service = String(metadata?.service ?? '');
        const tin = transaction.type === TransactionType.TIN_CERTIFICATE_REQUEST;
        const confirmation = tin
          ? 'Send this TIN request and its personal/business details to K-Tech now? Their docs currently list ₦1,500 for individual and ₦2,500 for company TIN. Confirm the actual partner price and K-Tech wallet balance before dispatch.'
          : 'Send this request and its identity details to K-Tech now? The provider may charge our K-Tech wallet.';
        return `<tr><td><strong>${escape(transaction.reference)}</strong><small>${escape(transaction.id)}</small></td><td>${escape(serviceLabel(service))}</td><td>${escape(transaction.user.fullName)}<small>${escape(transaction.user.email)}</small></td><td>₦${koboToNaira(transaction.amountKobo).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td><td>${transaction.createdAt.toLocaleString('en-NG')}</td><td><form method="post" action="/admin/manual-provider-dispatch" onsubmit="return confirm('${escape(confirmation)}');"><input type="hidden" name="transaction_id" value="${escape(transaction.id)}"><button type="submit">Dispatch to K‑Tech</button></form></td></tr>`;
      }).join('')}</tbody></table></div>`
    : '<div class="empty">There are no unassigned NIN Validation, Personalization, IPE, or TIN requests waiting for dispatch.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manual Provider Dispatch</title><style>
*{box-sizing:border-box}body{font:15px Arial,sans-serif;background:#f4f7fb;color:#172554;margin:0;padding:28px}main{max-width:1200px;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.top a{color:#1d4ed8;text-decoration:none;font-weight:600}h1{margin:0 0 7px;font-size:26px}.muted{color:#64748b;line-height:1.5}.panel{background:#fff;border:1px solid #dbe4f0;border-radius:14px;padding:20px;margin:16px 0}.notice{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:9px;padding:13px;margin:14px 0}.result{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:9px;padding:13px;margin:14px 0}.result.error{background:#fff7ed;border-color:#fed7aa;color:#9a3412}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:780px}th,td{text-align:left;padding:13px 11px;border-bottom:1px solid #e5eaf1;vertical-align:middle}th{font-size:12px;color:#64748b;text-transform:uppercase}small{display:block;color:#64748b;margin-top:5px;font-size:12px}button{background:#0b2f73;color:white;border:0;border-radius:8px;padding:10px 13px;font-weight:700;cursor:pointer;white-space:nowrap}button:hover{background:#1452a0}.empty{padding:32px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px}@media(max-width:700px){body{padding:15px}.panel{padding:14px}.top{align-items:flex-start;flex-direction:column}}
</style></head><body><main><div class="top"><div><h1>Manual Provider Dispatch</h1><div class="muted">Send eligible, unassigned live async requests to K‑Tech without creating a second customer charge.</div></div><a href="/admin">← Admin dashboard</a></div><section class="panel"><div class="notice"><strong>Currently supported:</strong> NIN Validation, NIN Personalization, IPE Clearance, and TIN Generation (company and individual). TIN submissions go to <code>POST /identity/tin-generation</code> with the existing transaction reference as the idempotency key. CAC, Newspaper, and BVN Modification are not listed because their K-Tech endpoint mappings are not configured.</div>${notice ? `<div class="result${notice.startsWith('Dispatch failed:') ? ' error' : ''}">${escape(notice)}</div>` : ''}${body}</section></main></body></html>`;
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

    const transaction = await prisma.transaction.findUnique({ where: { id: transactionId }, select: { type: true } });
    const result = transaction?.type === TransactionType.TIN_CERTIFICATE_REQUEST
      ? await manuallyDispatchPendingTinToKtech(transactionId)
      : await manuallyDispatchPendingTicketToKtech(transactionId);
    await logAdminAction({
      adminId: admin.id,
      action: result.ok ? 'MANUAL_DISPATCH_KTECH_SUCCESS' : 'MANUAL_DISPATCH_KTECH_FAILED',
      targetType: 'Transaction',
      targetId: transactionId,
      metadata: result.ok ? { reference: result.reference, provider: 'ktech', providerRef: 'ticketId' in result ? result.ticketId : result.providerReference } : { provider: 'ktech', reason: result.message }
    });
    const message = result.ok
      ? `Request ${result.reference} was sent to K‑Tech. Provider reference: ${'ticketId' in result ? result.ticketId : result.providerReference}.`
      : `Dispatch failed: ${result.message}`;
    return res.type('html').send(renderPage(await getDispatchQueue(), message));
  });
}
