import type { Request, Router } from 'express';
import type { AdminSessionUser } from './auth.js';
import { nairaToKobo } from '../lib/money.js';
import {
  getProviderLedgerSummaries,
  listProviderLedgerEntries,
  recordProviderSettlement,
  recordProviderAdjustment,
  toNairaLedgerSummary
} from '../services/provider-ledger.service.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

// AdminJSExpress's buildAuthenticatedRouter() mounts `express-formidable` as
// router-level middleware (`router.use(formidableMiddleware(...))` inside
// buildAuthenticatedRouter.js) - BEFORE any route registered on this same
// router, including these custom ones. That parses the request body into
// `req.fields` (formidable's own property), NOT Express's `req.body` - no
// body-parsing middleware here ever populates `req.body`, so reading
// `req.body.xxx` on a POST either throws (`req.body` is undefined) or, if
// something upstream did chain a second body parser, throws "stream is not
// readable" (the socket was already consumed by formidable). Read
// `req.fields` instead, and never chain another body parser on this router.
type FormidableFields = Record<string, string | string[] | undefined>;
function fields(req: Request): FormidableFields {
  return ((req as unknown as { fields?: FormidableFields }).fields ?? {}) as FormidableFields;
}
function field(req: Request, name: string): string {
  const v = fields(req)[name];
  return typeof v === 'string' ? v : '';
}

const TYPE_LABELS: Record<string, string> = {
  PURCHASE_DEBIT: 'Purchase',
  TOPUP_CREDIT: 'Settlement',
  ADJUSTMENT: 'Adjustment'
};

/**
 * "Provider Ledger" - the company's own running balance at each upstream
 * provider (Alrahuz, Techhub), built from an append-only history of
 * PURCHASE_DEBIT (automatic, on every successful sale - see the
 * recordProviderDebit() call sites in vtu.routes.ts / result-pin.service.ts /
 * verification.service.ts) and TOPUP_CREDIT/ADJUSTMENT (manual, recorded
 * here). Same server-rendered-HTML pattern as company-wallet.ts.
 *
 * Finance/Super Admin only - same reasoning as Company Wallet: this is
 * upstream cost/balance data, more sensitive than the customer-facing
 * transaction ledger.
 */
export function registerProviderLedgerRoutes(router: Router) {
  router.get('/provider-ledger', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const provider = typeof req.query.provider === 'string' && req.query.provider ? req.query.provider : undefined;
    const [summaries, entries] = await Promise.all([
      getProviderLedgerSummaries(),
      listProviderLedgerEntries({ provider, limit: 100 })
    ]);

    res.type('html').send(
      renderPage({
        admin,
        summaries: summaries.map(toNairaLedgerSummary),
        entries,
        selectedProvider: provider,
        allProviders: summaries.map((s) => s.provider),
        notice: typeof req.query.notice === 'string' ? req.query.notice : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined
      })
    );
  });

  router.post('/provider-ledger/settle', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    try {
      const provider = field(req, 'provider').trim();
      const amount = Number(field(req, 'amount'));
      const reference = field(req, 'reference').trim() || undefined;
      const note = field(req, 'note').trim();

      if (!provider) throw new Error('Provider is required');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid positive amount');

      await recordProviderSettlement({
        provider,
        amountKobo: nairaToKobo(amount),
        reference,
        description: note || `Settlement top-up for ${provider}`,
        createdByAdminId: admin.id
      });

      res.redirect(`/admin/provider-ledger?provider=${encodeURIComponent(provider)}&notice=Settlement recorded`);
    } catch (error) {
      res.redirect(`/admin/provider-ledger?error=${encodeURIComponent((error as Error).message)}`);
    }
  });

  router.post('/provider-ledger/adjust', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    try {
      const provider = field(req, 'provider').trim();
      const direction = field(req, 'direction') === 'decrease' ? -1 : 1;
      const amount = Number(field(req, 'amount'));
      const note = field(req, 'note').trim();

      if (!provider) throw new Error('Provider is required');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid positive amount');
      if (!note) throw new Error('A note explaining the adjustment is required');

      await recordProviderAdjustment({
        provider,
        amountKobo: nairaToKobo(amount) * BigInt(direction),
        description: note,
        createdByAdminId: admin.id
      });

      res.redirect(`/admin/provider-ledger?provider=${encodeURIComponent(provider)}&notice=Adjustment recorded`);
    } catch (error) {
      res.redirect(`/admin/provider-ledger?error=${encodeURIComponent((error as Error).message)}`);
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

function renderPage(params: {
  admin: AdminSessionUser;
  summaries: ReturnType<typeof toNairaLedgerSummary>[];
  entries: Awaited<ReturnType<typeof listProviderLedgerEntries>>;
  selectedProvider?: string;
  allProviders: string[];
  notice?: string;
  error?: string;
}) {
  const { admin, summaries, entries, selectedProvider } = params;

  const summaryCards = summaries
    .map((s) => {
      const varianceKnown = s.variance !== null;
      const varianceBad = varianceKnown && Math.abs(s.variance as number) > 1; // > ₦1 rounding slack
      return `<div class="provider-card ${selectedProvider === s.provider ? 'active' : ''}">
        <a class="provider-name" href="/admin/provider-ledger?provider=${encodeURIComponent(s.provider)}">${escape(s.provider)}</a>
        <div class="stat-row"><span>Our ledger balance</span><strong>${naira(s.computedBalance)}</strong></div>
        <div class="stat-row"><span>${escape(s.provider)}'s reported balance</span><strong>${s.reportedBalance !== null ? naira(s.reportedBalance) : '— not checked yet'}</strong></div>
        ${varianceKnown ? `<div class="stat-row ${varianceBad ? 'variance-bad' : 'variance-ok'}"><span>Variance</span><strong>${naira(s.variance as number)}</strong></div>` : ''}
        ${s.reportedBalanceCheckedAt ? `<div class="checked-at">Provider figure as of ${new Date(s.reportedBalanceCheckedAt).toLocaleString()}</div>` : ''}
      </div>`;
    })
    .join('');

  const entryRows = entries
    .map((e) => {
      const isCredit = e.amountKobo > 0n;
      return `<tr>
        <td>${new Date(e.createdAt).toLocaleString()}</td>
        <td>${escape(e.provider)}</td>
        <td><span class="badge badge-${e.type.toLowerCase()}">${TYPE_LABELS[e.type] ?? e.type}</span></td>
        <td class="num ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : '-'}${naira(Math.abs(e.amount))}</td>
        <td class="num">${naira(e.balanceAfter)}</td>
        <td>${escape(e.description)}${e.reference ? `<div class="ref">Ref: ${escape(e.reference)}</div>` : ''}</td>
      </tr>`;
    })
    .join('');

  const providerOptions = params.allProviders
    .concat(['alrahuz', 'techhub'].filter((p) => !params.allProviders.includes(p)))
    .map((p) => `<option value="${escape(p)}" ${selectedProvider === p ? 'selected' : ''}>${escape(p)}</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Provider Ledger — MAJOR DATA-LINK Admin</title>
<style>
  :root { --gold: #D4AF37; --gold-dark: #9C7A17; --bg: #FAF7EF; --card: #FFFFFF; --text: #1A1508; --muted: #6B6248; --border: #E9E1C8; --green: #1E7B34; --red: #B3261E; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  header h1 { font-size: 20px; margin: 0; }
  header a.back { color: var(--gold-dark); text-decoration: none; font-size: 14px; }
  .notice, .error-banner { padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
  .notice { background: #EAF6EC; border: 1px solid #B8E0BD; color: var(--green); }
  .error-banner { background: #FBEAEA; border: 1px solid #EFC0C0; color: var(--red); }
  .provider-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .provider-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .provider-card.active { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(212,175,55,0.25); }
  .provider-name { font-weight: 700; text-transform: capitalize; font-size: 15px; color: var(--text); text-decoration: none; display: block; margin-bottom: 10px; }
  .stat-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
  .stat-row span { color: var(--muted); }
  .variance-ok strong { color: var(--green); }
  .variance-bad strong { color: var(--red); }
  .checked-at { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 4px; }
  .card p.hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  .forms { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  form.action-form { display: flex; flex-direction: column; gap: 10px; }
  form.action-form label { font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
  form.action-form input, form.action-form select, form.action-form textarea { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; }
  form.action-form button { background: var(--gold); color: #1A1508; border: none; padding: 10px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; margin-top: 4px; }
  form.action-form button:hover { background: var(--gold-dark); color: #fff; }
  .filter-bar { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); padding: 8px 10px; border-bottom: 2px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.credit { color: var(--green); font-weight: 700; }
  td.debit { color: var(--red); font-weight: 700; }
  .ref { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 700; text-transform: uppercase; }
  .badge-purchase_debit { background: #FBEAEA; color: var(--red); }
  .badge-topup_credit { background: #EAF6EC; color: var(--green); }
  .badge-adjustment { background: #FFF6E0; color: #6B4E00; }
  .current { font-size: 13px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Provider Ledger</h1>
    <a class="back" href="/admin">&larr; Back to admin panel</a>
  </header>

  ${params.notice ? `<div class="notice">${escape(params.notice)}</div>` : ''}
  ${params.error ? `<div class="error-banner">${escape(params.error)}</div>` : ''}

  <div class="provider-cards">
    ${summaryCards || '<p style="color:var(--muted)">No provider ledger activity yet.</p>'}
  </div>

  <div class="forms">
    <div class="card">
      <h2>Record settlement</h2>
      <p class="hint">We paid a provider to top up our balance with them (e.g. a bank transfer to Alrahuz).</p>
      <form class="action-form" method="POST" action="/admin/provider-ledger/settle">
        <label>Provider
          <select name="provider" required>
            <option value="">Select provider…</option>
            ${providerOptions}
          </select>
        </label>
        <label>Amount (₦)<input type="number" name="amount" min="1" step="0.01" required></label>
        <label>Reference (optional)<input type="text" name="reference" placeholder="Bank transfer ref, receipt no…"></label>
        <label>Note<textarea name="note" rows="2" placeholder="e.g. Weekly Alrahuz top-up"></textarea></label>
        <button type="submit">Record settlement</button>
      </form>
    </div>

    <div class="card">
      <h2>Manual adjustment</h2>
      <p class="hint">Reconcile our computed balance against what the provider's own dashboard shows, or correct a one-off error.</p>
      <form class="action-form" method="POST" action="/admin/provider-ledger/adjust">
        <label>Provider
          <select name="provider" required>
            <option value="">Select provider…</option>
            ${providerOptions}
          </select>
        </label>
        <label>Direction
          <select name="direction" required>
            <option value="increase">Increase balance</option>
            <option value="decrease">Decrease balance</option>
          </select>
        </label>
        <label>Amount (₦)<input type="number" name="amount" min="1" step="0.01" required></label>
        <label>Note (required)<textarea name="note" rows="2" required placeholder="Explain why this adjustment is needed"></textarea></label>
        <button type="submit">Record adjustment</button>
      </form>
    </div>
  </div>

  <div class="card">
    <h2>Ledger entries${selectedProvider ? ` — ${escape(selectedProvider)}` : ''}</h2>
    <p class="hint">Most recent 100 entries${selectedProvider ? '' : ' across all providers'}. Purchases are recorded automatically; settlements and adjustments are recorded above.</p>
    <div class="filter-bar">
      <span>Filter:</span>
      <a href="/admin/provider-ledger">All providers</a>
      ${params.allProviders.map((p) => `· <a href="/admin/provider-ledger?provider=${encodeURIComponent(p)}">${escape(p)}</a>`).join(' ')}
    </div>
    <table>
      <thead><tr><th>Date</th><th>Provider</th><th>Type</th><th class="num">Amount</th><th class="num">Balance after</th><th>Description</th></tr></thead>
      <tbody>${entryRows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">No entries yet.</td></tr>'}</tbody>
    </table>
  </div>

  <p class="current">Signed in as ${escape(admin.fullName)} (${escape(admin.role)})</p>
</div>
</body>
</html>`;
}
