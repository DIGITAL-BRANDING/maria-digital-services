import type { Request, Router } from 'express';
import type { AdminSessionUser } from './auth.js';
import { nairaToKobo, koboToNaira } from '../lib/money.js';
import {
  listPendingReconciliations,
  resolveReconciliationAsSuccess,
  resolveReconciliationAsFailed,
  type PendingReconciliationRow
} from '../services/provider-reconciliation.service.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

// Same formidable body-parsing caveat as provider-ledger.ts - read
// `req.fields`, never `req.body`, on this router. See that file's own
// comment on `fields()`/`field()` for the full explanation.
type FormidableFields = Record<string, string | string[] | undefined>;
function fields(req: Request): FormidableFields {
  return ((req as unknown as { fields?: FormidableFields }).fields ?? {}) as FormidableFields;
}
function field(req: Request, name: string): string {
  const v = fields(req)[name];
  return typeof v === 'string' ? v : '';
}

/**
 * "Provider Reconciliation" - transactions where BilalSadaSub responded
 * with `status: "process"` (see the doc-comment on normalize() in
 * bilalsadasub.service.ts). Neither a confirmed success nor a confirmed
 * failure, so purchase routes leave these PENDING instead of guessing -
 * this page is where a human admin makes the final call after checking
 * BilalSadaSub's own merchant dashboard/support for the real outcome.
 *
 * Finance/Super Admin only - same reasoning as Provider Ledger: resolving
 * one of these either finalizes a real debit against the provider ledger
 * (Mark Success) or moves real money back to a customer's wallet (Mark
 * Failed), so it belongs with the other money-moving admin actions, not
 * general support tooling.
 */
export function registerProviderReconciliationRoutes(router: Router) {
  router.get('/provider-reconciliation', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const pending = await listPendingReconciliations();

    res.type('html').send(
      renderPage({
        admin,
        pending,
        notice: typeof req.query.notice === 'string' ? req.query.notice : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined
      })
    );
  });

  router.post('/provider-reconciliation/:id/success', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    try {
      const providerRef = field(req, 'provider_ref').trim() || undefined;
      const costAmount = field(req, 'cost_amount').trim();
      const pin = field(req, 'pin').trim() || undefined;
      const serial = field(req, 'serial').trim() || undefined;
      const note = field(req, 'note').trim() || undefined;

      await resolveReconciliationAsSuccess({
        transactionId: req.params.id,
        adminId: admin.id,
        providerRef,
        costKobo: costAmount ? nairaToKobo(Number(costAmount)) : undefined,
        pin,
        serial,
        note
      });

      res.redirect('/admin/provider-reconciliation?notice=Marked as successful');
    } catch (error) {
      res.redirect(`/admin/provider-reconciliation?error=${encodeURIComponent((error as Error).message)}`);
    }
  });

  router.post('/provider-reconciliation/:id/failed', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    try {
      const reason = field(req, 'reason').trim();
      if (!reason) throw new Error('A reason is required to refund a customer');

      await resolveReconciliationAsFailed({
        transactionId: req.params.id,
        adminId: admin.id,
        reason
      });

      res.redirect('/admin/provider-reconciliation?notice=Marked as failed and refunded');
    } catch (error) {
      res.redirect(`/admin/provider-reconciliation?error=${encodeURIComponent((error as Error).message)}`);
    }
  });
}

function requireFinanceOrSuper(req: Request): AdminSessionUser | null {
  const admin = req.session?.adminUser;
  if (!admin || admin.role === 'SUPPORT') return null;
  return admin;
}

function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function ageLabel(createdAt: Date): string {
  const minutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function renderPage(params: {
  admin: AdminSessionUser;
  pending: PendingReconciliationRow[];
  notice?: string;
  error?: string;
}) {
  const { admin, pending } = params;

  const rows = pending
    .map((t) => {
      const metadata = (t.metadata as Record<string, unknown> | null) ?? {};
      const reconciliation = (metadata.reconciliation as Record<string, unknown> | undefined) ?? {};
      const stale = Date.now() - new Date(t.createdAt).getTime() > 10 * 60 * 1000; // > 10 minutes
      return `<div class="card txn-card ${stale ? 'stale' : ''}">
        <div class="txn-head">
          <div>
            <strong>${escape(t.description)}</strong>
            <div class="muted">Ref: ${escape(t.reference)} · ${escape(t.type)} · <span class="provider-tag">${escape(t.provider ?? 'unknown')}</span> · ${ageLabel(t.createdAt)}${stale ? ' <span class="stale-tag">STALE</span>' : ''}</div>
          </div>
          <div class="amount">${naira(koboToNaira(t.amountKobo))}</div>
        </div>
        <div class="txn-meta">
          <span>Customer: ${escape(t.user.fullName ?? '')} (${escape(t.user.email ?? t.user.phone ?? '')})</span>
          <span>Provider ref: ${t.providerRef ? escape(t.providerRef) : '—'}</span>
          ${reconciliation.providerMessage ? `<span>Provider said: "${escape(String(reconciliation.providerMessage))}"</span>` : ''}
        </div>
        <div class="forms">
          <form class="action-form" method="POST" action="/admin/provider-reconciliation/${t.id}/success">
            <label>Provider ref (optional, if different)<input type="text" name="provider_ref" placeholder="${t.providerRef ? escape(t.providerRef) : ''}"></label>
            <label>Actual cost ₦ (optional)<input type="number" name="cost_amount" min="0" step="0.01" placeholder="Leave blank to keep estimate"></label>
            ${t.type === 'RESULT_PIN' ? '<label>PIN (from BilalSadaSub dashboard)<input type="text" name="pin"></label><label>Serial (optional)<input type="text" name="serial"></label>' : ''}
            <label>Note (optional)<input type="text" name="note" placeholder="e.g. Confirmed on BilalSadaSub dashboard"></label>
            <button type="submit" class="btn-success">Mark Success</button>
          </form>
          <form class="action-form" method="POST" action="/admin/provider-reconciliation/${t.id}/failed">
            <label>Reason (required)<input type="text" name="reason" required placeholder="e.g. Confirmed not delivered, refunding"></label>
            <button type="submit" class="btn-fail">Mark Failed &amp; Refund</button>
          </form>
        </div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Provider Reconciliation — MAJOR DATA-LINK Admin</title>
<style>
  :root { --gold: #D4AF37; --gold-dark: #9C7A17; --bg: #FAF7EF; --card: #FFFFFF; --text: #1A1508; --muted: #6B6248; --border: #E9E1C8; --green: #1E7B34; --red: #B3261E; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  header h1 { font-size: 20px; margin: 0; }
  header a.back { color: var(--gold-dark); text-decoration: none; font-size: 14px; }
  .intro { color: var(--muted); font-size: 13px; margin: 0 0 20px; line-height: 1.5; }
  .notice, .error-banner { padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
  .notice { background: #EAF6EC; border: 1px solid #B8E0BD; color: var(--green); }
  .error-banner { background: #FBEAEA; border: 1px solid #EFC0C0; color: var(--red); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  .txn-card.stale { border-color: var(--red); box-shadow: 0 0 0 2px rgba(179,38,30,0.15); }
  .txn-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
  .txn-head strong { font-size: 14px; }
  .muted { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .provider-tag { text-transform: uppercase; font-weight: 700; letter-spacing: 0.03em; color: var(--gold-dark); }
  .stale-tag { background: var(--red); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 999px; font-weight: 700; }
  .amount { font-size: 16px; font-weight: 700; white-space: nowrap; }
  .txn-meta { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); margin-bottom: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
  .forms { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  form.action-form { display: flex; flex-direction: column; gap: 8px; }
  form.action-form label { font-size: 11px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
  form.action-form input { padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; }
  form.action-form button { border: none; padding: 9px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; margin-top: 2px; }
  .btn-success { background: var(--green); color: #fff; }
  .btn-success:hover { opacity: 0.85; }
  .btn-fail { background: var(--red); color: #fff; }
  .btn-fail:hover { opacity: 0.85; }
  .empty { text-align: center; color: var(--muted); padding: 40px 0; }
  .current { font-size: 13px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Provider Reconciliation</h1>
    <a class="back" href="/admin">&larr; Back to admin panel</a>
  </header>
  <p class="intro">Transactions where a provider responded with an ambiguous "still processing" status instead of a clear success or failure. Check that provider's own merchant dashboard or contact their support for the real outcome, then resolve here - do not guess.</p>

  ${params.notice ? `<div class="notice">${escape(params.notice)}</div>` : ''}
  ${params.error ? `<div class="error-banner">${escape(params.error)}</div>` : ''}

  ${rows || '<div class="card empty">Nothing awaiting reconciliation right now.</div>'}

  <p class="current">Signed in as ${escape(admin.fullName)} (${escape(admin.role)})</p>
</div>
</body>
</html>`;
}
