import type { Request, Router } from 'express';
import type { AdminSessionUser } from './auth.js';
import { getCompanyWalletSummary, toNairaView, type DateRange } from '../services/company-wallet.service.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

const TYPE_LABELS: Record<string, string> = {
  DATA_PURCHASE: 'Data',
  AIRTIME_PURCHASE: 'Airtime',
  ELECTRICITY_PURCHASE: 'Electricity',
  CABLE_PURCHASE: 'Cable TV',
  RESULT_PIN: 'Result PINs (WAEC/NECO/NABTEB)',
  SMS: 'SMS',
  NIN_VERIFICATION: 'NIN Verification',
  BVN_VERIFICATION: 'BVN Verification',
  IDENTITY_SERVICE_REQUEST: 'Identity Services',
  WALLET_FUNDING_FEE: 'Wallet Funding Fees'
};

type PresetKey = 'today' | 'week' | 'month' | 'all' | 'custom';

/**
 * "Company Wallet" - a computed profit dashboard, not a real account. Same
 * server-rendered-HTML-on-the-AdminJS-router pattern as bulk-pricing.ts (see
 * its doc-comment for why: no dependency on AdminJS's own frontend bundle).
 *
 * Finance/Super Admin only - this shows margin data (what we actually pay
 * upstream vs what we charge), which is more sensitive than the raw
 * transaction ledger SUPPORT can already see via the Transactions resource.
 */
export function registerCompanyWalletRoutes(router: Router) {
  router.get('/company-wallet', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const preset = (typeof req.query.preset === 'string' ? req.query.preset : 'month') as PresetKey;
    const range = resolveRange(preset, req.query);

    const summary = toNairaView(await getCompanyWalletSummary(range));

    res.type('html').send(
      renderPage({
        admin,
        summary,
        preset,
        customFrom: typeof req.query.from === 'string' ? req.query.from : undefined,
        customTo: typeof req.query.to === 'string' ? req.query.to : undefined
      })
    );
  });
}

function requireFinanceOrSuper(req: Request): AdminSessionUser | null {
  const admin = req.session?.adminUser;
  if (!admin || admin.role === 'SUPPORT') return null;
  return admin;
}

function resolveRange(preset: PresetKey, query: Request['query']): DateRange {
  if (preset === 'custom') {
    const from = typeof query.from === 'string' && query.from ? new Date(query.from) : undefined;
    const to = typeof query.to === 'string' && query.to ? new Date(`${query.to}T23:59:59.999`) : undefined;
    return { from, to };
  }

  const now = new Date();
  if (preset === 'today') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (preset === 'week') {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from, to: now };
  }
  if (preset === 'month') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from, to: now };
  }
  return {}; // 'all'
}

function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPage(params: {
  admin: AdminSessionUser;
  summary: ReturnType<typeof toNairaView>;
  preset: PresetKey;
  customFrom?: string;
  customTo?: string;
}) {
  const { admin, summary, preset } = params;

  const presetLink = (key: PresetKey, label: string) =>
    `<a class="chip ${preset === key ? 'active' : ''}" href="/admin/company-wallet?preset=${key}">${label}</a>`;

  const rows = summary.byType
    .filter((t) => t.count > 0)
    .sort((a, b) => b.profit - a.profit)
    .map((t) => {
      const label = TYPE_LABELS[t.type] ?? t.type;
      const unknownNote =
        t.unknownCostCount > 0
          ? `<div class="unknown">${t.unknownCostCount} of ${t.count} excluded - cost unknown</div>`
          : '';
      return `<tr>
        <td>${escape(label)}</td>
        <td class="num">${t.count}</td>
        <td class="num">${naira(t.revenue)}</td>
        <td class="num">${naira(t.cost)}</td>
        <td class="num profit">${naira(t.profit)}${unknownNote}</td>
      </tr>`;
    })
    .join('');

  const unknownBanner =
    summary.totals.unknownCostCount > 0
      ? `<div class="banner">⚠ ${summary.totals.unknownCostCount} successful sale(s) in this range have no recorded cost basis (usually airtime purchased before Alrahuz returned balance figures, or purchases made in MOCK_PROVIDER mode) and are <strong>excluded</strong> from the cost/profit totals below - the true profit for this range is at most this number, possibly lower.</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Company Wallet — MAJOR DATA-LINK Admin</title>
<style>
  :root { --gold: #D4AF37; --gold-dark: #9C7A17; --bg: #FAF7EF; --card: #FFFFFF; --text: #1A1508; --muted: #6B6248; --border: #E9E1C8; --green: #1E7B34; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  header h1 { font-size: 20px; margin: 0; }
  header a.back { color: var(--gold-dark); text-decoration: none; font-size: 14px; }
  .chips { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .chip { padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border); color: var(--text); text-decoration: none; font-size: 13px; background: #FFFDF5; }
  .chip.active { background: var(--gold); border-color: var(--gold); font-weight: 700; }
  .custom-range { display: flex; align-items: end; gap: 14px; flex-wrap: wrap; padding: 14px 20px; }
  .custom-range label { font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
  .custom-range input[type=date] { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; }
  .custom-range button { background: var(--gold); color: #1A1508; border: none; padding: 9px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
  .custom-range button:hover { background: var(--gold-dark); color: #fff; }
  .banner { background: #FFF6E0; border: 1px solid #F0D98C; color: #6B4E00; padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .stat .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .stat .value { font-size: 22px; font-weight: 700; }
  .stat.net .value { color: var(--green); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 4px; }
  .card p.hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); padding: 8px 10px; border-bottom: 2px solid var(--border); }
  td { padding: 10px; border-bottom: 1px solid var(--border); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.profit { font-weight: 700; color: var(--green); }
  .unknown { font-size: 11px; color: #B3261E; font-weight: 400; margin-top: 2px; }
  .current { font-size: 13px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Company Wallet</h1>
    <a class="back" href="/admin">&larr; Back to admin panel</a>
  </header>

  <div class="chips">
    ${presetLink('today', 'Today')}
    ${presetLink('week', 'Last 7 days')}
    ${presetLink('month', 'Last 30 days')}
    ${presetLink('all', 'All time')}
  </div>

  <form class="card custom-range" method="GET" action="/admin/company-wallet">
    <input type="hidden" name="preset" value="custom">
    <label>From <input type="date" name="from" value="${escape(params.customFrom ?? '')}"></label>
    <label>To <input type="date" name="to" value="${escape(params.customTo ?? '')}"></label>
    <button type="submit">Apply custom range</button>
  </form>

  ${unknownBanner}

  <div class="stats">
    <div class="stat"><div class="label">Revenue (services sold)</div><div class="value">${naira(summary.totals.revenue)}</div></div>
    <div class="stat"><div class="label">Provider cost</div><div class="value">${naira(summary.totals.cost)}</div></div>
    <div class="stat"><div class="label">Gross profit</div><div class="value">${naira(summary.totals.grossProfit)}</div></div>
    <div class="stat"><div class="label">Referral payouts</div><div class="value">- ${naira(summary.totals.referralPayouts)}</div></div>
    <div class="stat net"><div class="label">Net profit</div><div class="value">${naira(summary.totals.netProfit)}</div></div>
    <div class="stat"><div class="label">Wallet funding received</div><div class="value">${naira(summary.totalFunding)}</div></div>
  </div>

  <div class="card">
    <h2>Profit by service</h2>
    <p class="hint">Only successful transactions. Cost is what we were actually charged upstream for that exact sale, not today's price list — see the note above if any rows show excluded transactions.</p>
    <table>
      <thead><tr><th>Service</th><th class="num">Count</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">No successful sales in this range.</td></tr>'}</tbody>
    </table>
  </div>

  <p class="current">Signed in as ${escape(admin.fullName)} (${escape(admin.role)})</p>
</div>
</body>
</html>`;
}
