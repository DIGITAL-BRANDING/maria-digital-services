import type { Request, Router } from 'express';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { ApiError } from '../middleware/error.js';
import { getUserWalletSummary } from '../services/company-wallet.service.js';
import { manualWalletAdjustment } from '../services/wallet.service.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

// AdminJSExpress's buildAuthenticatedRouter() mounts `express-formidable` as
// router-level middleware (`router.use(formidableMiddleware(...))` inside
// buildAuthenticatedRouter.js) - BEFORE any route registered on this same
// router, including these custom ones. That means the request body has
// already been read off the socket and parsed into `req.fields` (formidable's
// own property, NOT Express's `req.body`) by the time a handler here runs.
// Adding a second body parser (e.g. express.urlencoded()) to try and read
// `req.body` throws "stream is not readable" - the stream was already
// consumed - which is why POST forms here must read `req.fields`, not
// `req.body`, and must NOT chain their own body-parsing middleware.
type FormidableFields = Record<string, string | string[] | undefined>;
function fields(req: Request): FormidableFields {
  return ((req as unknown as { fields?: FormidableFields }).fields ?? {}) as FormidableFields;
}
function field(req: Request, name: string): string {
  const v = fields(req)[name];
  return typeof v === 'string' ? v : '';
}

/**
 * Answers "what has user A/B/C actually done" in one place: search by email,
 * phone, or user id, then see their funding total, spend total, and a recent
 * transaction list - without an admin having to know a user's internal id up
 * front to filter the Transactions resource (AdminJS's `user` filter there
 * still works for the FULL ledger of one user once you're on their profile;
 * this page is the fast lookup + summary in front of it).
 *
 * The search + summary is visible to any logged-in admin role (including
 * SUPPORT) - it's plain account-activity information support staff routinely
 * need for customer service, unlike Company Wallet's margin data. The
 * Credit/Debit form further down is real money movement though, so that part
 * is gated to FINANCE/SUPER_ADMIN only, same as Company Wallet and Bulk
 * Pricing - SUPPORT can look but not touch a balance.
 *
 * Manual credits go through manualWalletAdjustment(), which records a
 * MANUAL_ADJUSTMENT transaction with its own generated `IDS-ADJ-...`
 * reference. That reference is deliberately unrelated to any KatPay
 * transaction reference, so if you're crediting someone here to work around
 * the KatPay webhook not matching their virtual account, remember to note
 * the KatPay reference/order number in the "Reason" box - and once the
 * underlying webhook issue is fixed, cross-check any reprocessed/retried
 * KatPay webhook deliveries against reasons logged here so the same deposit
 * doesn't get credited twice (once manually, once via the webhook).
 */
export function registerUserWalletRoutes(router: Router) {
  router.get('/user-wallet', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let user: Awaited<ReturnType<typeof findUser>> = null;
    let summary: Awaited<ReturnType<typeof getUserWalletSummary>> | null = null;
    let recentTransactions: Awaited<ReturnType<typeof recentTransactionsFor>> = [];
    let notFound = false;

    if (q) {
      user = await findUser(q);
      if (user) {
        [summary, recentTransactions] = await Promise.all([getUserWalletSummary(user.id), recentTransactionsFor(user.id)]);
      } else {
        notFound = true;
      }
    }

    res.type('html').send(
      renderPage({ admin, q, user, summary, recentTransactions, notFound, flash: flashFromQuery(req.query) })
    );
  });

  router.post('/user-wallet/:userId/adjust', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    const q = field(req, 'q');
    const backTo = (flash: string) => `/admin/user-wallet?q=${encodeURIComponent(q)}&flash=${flash}`;

    if (!admin) return res.redirect('/admin/login');

    const { userId } = req.params;
    const directionRaw = field(req, 'direction');
    const direction = directionRaw === 'debit' ? 'debit' : directionRaw === 'credit' ? 'credit' : null;
    const amount = parsePositiveAmount(field(req, 'amount'));
    const reason = field(req, 'reason').trim();

    if (!direction || amount === null || reason.length < 4) {
      return res.redirect(
        backTo(encodeFlash('error', 'Enter a valid amount and a reason (min 4 characters, e.g. include the KatPay reference) before submitting.'))
      );
    }

    try {
      const { transaction, balanceAfter } = await manualWalletAdjustment({
        userId,
        direction,
        amount,
        reason,
        adminId: admin.id
      });

      await logAdminAction({
        adminId: admin.id,
        action: direction === 'credit' ? 'MANUAL_WALLET_CREDIT' : 'MANUAL_WALLET_DEBIT',
        targetType: 'User',
        targetId: userId,
        metadata: { transactionId: transaction.id, amount, reason, balanceAfterKobo: balanceAfter.toString() }
      });

      return res.redirect(
        backTo(
          encodeFlash(
            'success',
            `Wallet ${direction === 'credit' ? 'credited' : 'debited'} with NGN${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}. New balance: NGN${koboToNaira(balanceAfter).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`
          )
        )
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Something went wrong applying this adjustment. Check the server logs.';
      console.error('[user-wallet] manual adjustment failed:', error);
      return res.redirect(backTo(encodeFlash('error', message)));
    }
  });
}

function requireFinanceOrSuper(req: Request): AdminSessionUser | null {
  const admin = req.session?.adminUser;
  if (!admin || admin.role === 'SUPPORT') return null;
  return admin;
}

function parsePositiveAmount(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function encodeFlash(type: 'success' | 'error', message: string): string {
  return encodeURIComponent(`${type}:${message}`);
}

function flashFromQuery(query: Request['query']): { type: 'success' | 'error'; message: string } | null {
  const raw = query.flash;
  if (typeof raw !== 'string') return null;
  const [type, ...rest] = raw.split(':');
  if (type !== 'success' && type !== 'error') return null;
  return { type, message: rest.join(':') };
}

async function findUser(q: string) {
  return prisma.user.findFirst({
    where: {
      OR: [{ id: q }, { email: { equals: q } }, { phone: { contains: q } }, { fullName: { contains: q } }]
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      walletBalanceKobo: true,
      virtualAccountNumber: true,
      virtualAccountBank: true,
      virtualAccountProvider: true,
      kycStatus: true,
      createdAt: true
    }
  });
}

async function recentTransactionsFor(userId: string) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, type: true, status: true, amountKobo: true, description: true, createdAt: true, reference: true }
  });
}

function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canFinance(admin: AdminSessionUser): boolean {
  return admin.role === 'SUPER_ADMIN' || admin.role === 'FINANCE';
}

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: '#1E7B34',
  PENDING: '#9C7A17',
  FAILED: '#B3261E',
  REVERSED: '#6B6248'
};

function renderPage(params: {
  admin: AdminSessionUser;
  q: string;
  user: Awaited<ReturnType<typeof findUser>>;
  summary: Awaited<ReturnType<typeof getUserWalletSummary>> | null;
  recentTransactions: Awaited<ReturnType<typeof recentTransactionsFor>>;
  notFound: boolean;
  flash: { type: 'success' | 'error'; message: string } | null;
}) {
  const { admin, q, user, summary, recentTransactions, notFound, flash } = params;

  const flashHtml = flash
    ? `<div class="banner ${flash.type === 'success' ? 'banner-success' : ''}">${escape(flash.message)}</div>`
    : '';

  const adjustFormHtml =
    user && canFinance(admin)
      ? `
    <div class="card">
      <h2>Credit / Debit wallet</h2>
      <p class="hint">For manual corrections - e.g. a KatPay virtual-account deposit that arrived (confirmed on the KatPay dashboard) but wasn't auto-credited. Put the KatPay reference/order number in the reason so this can be reconciled once the webhook issue is fixed, and to avoid crediting the same deposit twice.</p>
      <form method="POST" action="/admin/user-wallet/${encodeURIComponent(user.id)}/adjust" class="adjust-form">
        <input type="hidden" name="q" value="${escape(q)}">
        <label>Direction
          <select name="direction" required>
            <option value="credit">Credit (add money)</option>
            <option value="debit">Debit (remove money)</option>
          </select>
        </label>
        <label>Amount (₦)
          <input type="number" name="amount" min="0.01" step="0.01" required placeholder="e.g. 2000.00">
        </label>
        <label class="reason-label">Reason (shown to the user, kept in the audit log)
          <textarea name="reason" required minlength="4" rows="2" placeholder="e.g. KatPay VA deposit ref KP-2026-XXXX confirmed on dashboard, not auto-credited"></textarea>
        </label>
        <button type="submit">Apply adjustment</button>
      </form>
    </div>`
      : '';

  const resultHtml = notFound
    ? `<div class="banner">No user found matching "${escape(q)}". Try their email, phone number, full name, or user id.</div>`
    : user && summary
      ? `
    <div class="card">
      <h2>${escape(user.fullName)}</h2>
      <p class="hint">${escape(user.email)} · ${escape(user.phone)} · KYC: ${escape(user.kycStatus)} · joined ${user.createdAt.toLocaleDateString('en-NG')}</p>
      ${user.virtualAccountNumber ? `<p class="hint">Virtual account: ${escape(user.virtualAccountNumber)} (${escape(user.virtualAccountBank ?? '')}, via ${escape(user.virtualAccountProvider ?? 'paystack')})</p>` : ''}
      <a class="link" href="/admin/resources/Transaction?filters.user=${encodeURIComponent(user.id)}">View full ledger for this user &rarr;</a>
    </div>

    <div class="stats">
      <div class="stat"><div class="label">Current wallet balance</div><div class="value">${naira(koboToNaira(user.walletBalanceKobo))}</div></div>
      <div class="stat"><div class="label">Total funded (all-time)</div><div class="value">${naira(summary.totalFunded)}</div></div>
      <div class="stat"><div class="label">Funding count</div><div class="value">${summary.fundingCount}</div></div>
      <div class="stat"><div class="label">Total spent on services</div><div class="value">${naira(summary.totalSpent)}</div></div>
      <div class="stat"><div class="label">Purchases made</div><div class="value">${summary.purchaseCount}</div></div>
      <div class="stat"><div class="label">Total transactions</div><div class="value">${summary.transactionCount}</div></div>
    </div>

    ${adjustFormHtml}

    <div class="card">
      <h2>Recent activity</h2>
      <p class="hint">Last ${recentTransactions.length} transaction(s). Full history via the link above.</p>
      <table>
        <thead><tr><th>When</th><th>Type</th><th>Description</th><th class="num">Amount</th><th>Status</th></tr></thead>
        <tbody>${recentTransactions
          .map(
            (t: (typeof recentTransactions)[number]) => `<tr>
          <td>${t.createdAt.toLocaleString('en-NG')}</td>
          <td>${escape(t.type)}</td>
          <td>${escape(t.description)}</td>
          <td class="num">${naira(koboToNaira(t.amountKobo))}</td>
          <td><span class="status" style="color:${STATUS_COLOR[t.status] ?? '#1A1508'}">${escape(t.status)}</span></td>
        </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>User Wallet Activity — MAJOR DATA-LINK Admin</title>
<style>
  :root { --gold: #D4AF37; --gold-dark: #9C7A17; --bg: #FAF7EF; --card: #FFFFFF; --text: #1A1508; --muted: #6B6248; --border: #E9E1C8; --green: #1E7B34; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  header h1 { font-size: 20px; margin: 0; }
  header a.back { color: var(--gold-dark); text-decoration: none; font-size: 14px; }
  .search { display: flex; gap: 10px; margin-bottom: 20px; }
  .search input { flex: 1; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; background: #FFFDF5; }
  .search button { background: var(--gold); color: #1A1508; border: none; padding: 0 22px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; }
  .search button:hover { background: var(--gold-dark); color: #fff; }
  .banner { background: #FDECEC; border: 1px solid #F3C6C4; color: #B3261E; padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
  .banner-success { background: #EAF6EC; border-color: #B9E0BF; color: #1E7B34; }
  .adjust-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .adjust-form label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .adjust-form select, .adjust-form input, .adjust-form textarea { font-size: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; text-transform: none; color: var(--text); background: #FFFDF5; }
  .adjust-form .reason-label { grid-column: 1 / -1; }
  .adjust-form button { grid-column: 1 / -1; justify-self: start; background: var(--gold); color: #1A1508; border: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; }
  .adjust-form button:hover { background: var(--gold-dark); color: #fff; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .stat .value { font-size: 19px; font-weight: 700; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 4px; }
  .card p.hint { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .link { color: var(--gold-dark); text-decoration: none; font-size: 13px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); padding: 8px 10px; border-bottom: 2px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .status { font-weight: 700; font-size: 12px; }
  .current { font-size: 13px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>User Wallet Activity</h1>
    <a class="back" href="/admin">&larr; Back to admin panel</a>
  </header>

  <form class="search" method="GET" action="/admin/user-wallet">
    <input type="text" name="q" placeholder="Search by email, phone, full name, or user id..." value="${escape(q)}" autofocus>
    <button type="submit">Search</button>
  </form>

  ${flashHtml}

  ${resultHtml}

  <p class="current">Signed in as ${escape(admin.fullName)} (${escape(admin.role)})</p>
</div>
</body>
</html>`;
}
