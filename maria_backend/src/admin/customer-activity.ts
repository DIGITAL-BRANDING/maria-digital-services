import type { Router } from 'express';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData { adminUser?: AdminSessionUser; }
}

const usageTypes = [
  TransactionType.DATA_PURCHASE, TransactionType.AIRTIME_PURCHASE,
  TransactionType.ELECTRICITY_PURCHASE, TransactionType.CABLE_PURCHASE,
  TransactionType.RESULT_PIN, TransactionType.SMS, TransactionType.NIN_VERIFICATION,
  TransactionType.BVN_VERIFICATION, TransactionType.IDENTITY_SERVICE_REQUEST,
  TransactionType.NIN_MODIFICATION, TransactionType.BVN_LICENSE_ONBOARDING
] as const;

const money = (kobo: bigint) => `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

/** AdminJS companion page for identifying loyal customers and inspecting what
 * they bought. It uses successful service transactions only—never funding,
 * refunds, transfers, or adjustments—so reward rankings cannot be gamed. */
export function registerCustomerActivityRoutes(router: Router) {
  router.get('/customer-activity', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    const requestedDays = Number(req.query.days);
    const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { status: TransactionStatus.SUCCESS, type: { in: [...usageTypes] }, createdAt: { gte: since } };
    const [grouped, recent] = await Promise.all([
      prisma.transaction.groupBy({ by: ['userId'], where, _count: { _all: true }, _sum: { amountKobo: true }, _max: { createdAt: true } }),
      prisma.transaction.findMany({
        where, take: 30, orderBy: { createdAt: 'desc' },
        select: { type: true, amountKobo: true, description: true, createdAt: true, user: { select: { fullName: true, email: true } } }
      })
    ]);
    const ranked = [...grouped].sort((a, b) => Number(b._sum.amountKobo ?? 0n) - Number(a._sum.amountKobo ?? 0n)).slice(0, 30);
    const users = await prisma.user.findMany({ where: { id: { in: ranked.map((row) => row.userId) } }, select: { id: true, fullName: true, email: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    const totalKobo = grouped.reduce((total, row) => total + (row._sum.amountKobo ?? 0n), 0n);
    const totalPurchases = grouped.reduce((total, row) => total + row._count._all, 0);
    const options = [7, 30, 90, 365].map((value) => `<option value="${value}" ${value === days ? 'selected' : ''}>Last ${value} days</option>`).join('');
    const rankings = ranked.map((row, index) => {
      const user = usersById.get(row.userId);
      return `<tr><td>${index + 1}</td><td><b>${esc(user?.fullName ?? 'Unknown user')}</b><br><small>${esc(user?.email ?? '')}</small></td><td>${row._count._all}</td><td><b>${money(row._sum.amountKobo ?? 0n)}</b></td><td>${row._max.createdAt?.toLocaleString() ?? '—'}</td></tr>`;
    }).join('');
    const activity = recent.map((tx) => `<tr><td><b>${esc(tx.user.fullName)}</b><br><small>${esc(tx.user.email)}</small></td><td>${esc(tx.description)}</td><td>${esc(tx.type.replaceAll('_', ' '))}</td><td>${money(tx.amountKobo)}</td><td>${tx.createdAt.toLocaleString()}</td></tr>`).join('');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Customer Activity</title><style>body{font-family:Arial,sans-serif;background:#f5f6f8;color:#18212f;margin:0;padding:28px}a{color:#8b6c00}.top{display:flex;justify-content:space-between;align-items:center;gap:16px}.cards{display:flex;gap:14px;flex-wrap:wrap;margin:20px 0}.card{background:#fff;border-radius:10px;padding:18px;min-width:180px;box-shadow:0 1px 4px #0001}.value{font-size:25px;font-weight:bold;margin-top:7px}table{border-collapse:collapse;width:100%;background:#fff;margin:12px 0 28px;box-shadow:0 1px 4px #0001}th,td{text-align:left;padding:12px;border-bottom:1px solid #eee;vertical-align:top}th{background:#d4af37;color:#111}small{color:#64748b}select,button{padding:9px;border-radius:6px;border:1px solid #ccc}button{background:#d4af37;font-weight:bold;cursor:pointer}</style></head><body><div class="top"><div><h1>Customer Activity</h1><p>Successful services only — use this list to identify loyal customers for rewards.</p></div><a href="/admin">← Back to Admin Dashboard</a></div><form method="get"><label>Period <select name="days">${options}</select></label> <button type="submit">Apply</button></form><div class="cards"><div class="card">Active customers<div class="value">${grouped.length}</div></div><div class="card">Successful purchases<div class="value">${totalPurchases}</div></div><div class="card">Total usage<div class="value">${money(totalKobo)}</div></div></div><h2>Top customers — reward candidates</h2><table><thead><tr><th>#</th><th>Customer</th><th>Purchases</th><th>Total usage</th><th>Last purchase</th></tr></thead><tbody>${rankings || '<tr><td colspan="5">No successful purchases in this period.</td></tr>'}</tbody></table><h2>Recent successful activities</h2><table><thead><tr><th>Customer</th><th>What they bought</th><th>Service</th><th>Amount</th><th>When</th></tr></thead><tbody>${activity || '<tr><td colspan="5">No recent successful activity.</td></tr>'}</tbody></table></body></html>`);
  });
}
