import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin, type AdminSessionUser } from '../admin/auth.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { sendAdminBroadcast } from '../services/notification.service.js';
import { providerService } from '../services/provider.service.js';

export const adminPanelRoutes = Router();
const COOKIE = 'imam_admin_panel';
const TTL = 60 * 60 * 8;

function esc(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function cookies(header?: string) {
  const out: Record<string, string> = {};
  for (const p of (header ?? '').split(';')) {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

function sig(payload: string) {
  return crypto.createHmac('sha256', env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
}

function session(admin: AdminSessionUser) {
  const payload = Buffer.from(JSON.stringify({ id: admin.id, exp: Math.floor(Date.now() / 1000) + TTL })).toString('base64url');
  return `${payload}.${sig(payload)}`;
}

async function currentAdmin(req: express.Request) {
  const token = cookies(req.headers.cookie)[COOKIE];
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || signature !== sig(payload)) return null;
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: string; exp?: number };
  if (!decoded.id || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
  const admin = await prisma.adminUser.findUnique({ where: { id: decoded.id } });
  if (!admin || !admin.isActive) return null;
  return { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role as AdminSessionUser['role'] };
}

function canFinance(admin: AdminSessionUser) {
  return admin.role === 'SUPER_ADMIN' || admin.role === 'FINANCE';
}

function money(kobo: bigint | number | null | undefined) {
  return kobo == null ? '' : (Number(kobo) / 100).toFixed(2);
}

function layout(title: string, body: string, admin?: AdminSessionUser) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f7f6fb;color:#191525}header{height:64px;padding:0 24px;background:#fff;border-bottom:1px solid #e8e5f2;display:flex;align-items:center;justify-content:space-between}main{max-width:1100px;margin:auto;padding:24px}.card{background:#fff;border:1px solid #e8e5f2;border-radius:8px;padding:18px;margin-bottom:18px}input,textarea,select{width:100%;padding:10px;border:1px solid #ddd;border-radius:6px}button{background:#6d3df5;color:white;border:0;border-radius:6px;padding:10px 14px;font-weight:700}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.value{font-size:28px;font-weight:800}.muted{color:#777;font-size:13px}.login{max-width:420px;margin:60px auto}</style></head><body><header><b>MAJOR DATA-LINK Admin</b>${admin ? `<span>${esc(admin.fullName)} (${esc(admin.role)}) &nbsp; <a href="/admin/logout">Logout</a></span>` : ''}</header><main>${body}</main></body></html>`;
}

adminPanelRoutes.use(express.urlencoded({ extended: false }));

adminPanelRoutes.get('/login', async (req, res) => {
  if (await currentAdmin(req)) return res.redirect('/admin');
  res.type('html').send(layout('Admin Login', `<div class="card login"><h1>Admin Login</h1><form method="post"><p>Email</p><input name="email" type="email" required><p>Password</p><input name="password" type="password" required><p><button>Login</button></p></form></div>`));
});

adminPanelRoutes.post('/login', async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  const admin = body.success ? await authenticateAdmin(body.data.email, body.data.password) : null;
  if (!admin) return res.status(401).type('html').send(layout('Admin Login', '<div class="card login"><h1>Login failed</h1><p>Invalid email or password.</p><a href="/admin/login">Try again</a></div>'));
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(session(admin))}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${TTL}${secure}`);
  res.redirect('/admin');
});

adminPanelRoutes.get('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`);
  res.redirect('/admin/login');
});

adminPanelRoutes.use(async (req, res, next) => {
  const admin = await currentAdmin(req);
  if (!admin) return res.redirect('/admin/login');
  res.locals.admin = admin;
  next();
});

adminPanelRoutes.get('/', async (_req, res) => {
  const admin = res.locals.admin as AdminSessionUser;
  const [users, txs, kyc, prices, broadcasts] = await Promise.all([
    prisma.user.count({ where: { accountStatus: { not: 'DELETED' } } }),
    prisma.transaction.count(),
    prisma.user.count({ where: { kycStatus: 'PENDING', accountStatus: { not: 'DELETED' } } }),
    prisma.servicePricing.findMany({ orderBy: { service: 'asc' } }),
    prisma.notificationBroadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  ]);
  const providerBalance = await prisma.providerBalanceStatus.findUnique({ where: { provider: 'alrahuz' } });
  const fundingAccount = providerService.getFundingAccount();
  const providerCard = '<div class="card"><h2>Alrahuz Wallet</h2><div class="grid"><div><div class="muted">Live/last known balance</div><div class="value">' + (providerBalance ? 'NGN ' + money(providerBalance.lastKnownBalance) : 'Not checked') + '</div><div class="muted">' + (providerBalance ? 'Last checked: ' + providerBalance.lastCheckedAt.toISOString() : 'Click refresh to fetch from Alrahuz.') + '</div></div><div><div class="muted">Funding Account</div><p><b>' + esc(fundingAccount.accountNumber) + '</b><br>' + esc(fundingAccount.accountName) + '<br>' + esc(fundingAccount.bankName) + '</p><form method="post" action="/admin/provider-balance/refresh"><button>Refresh Alrahuz Balance</button></form></div></div></div>';
  const rows = prices.map((p) => `<tr><td><b>${esc(p.label)}</b><div class="muted">${esc(p.service)}</div></td><td>NGN ${money(p.providerCostKobo)}</td><td>${p.sellingPriceKobo ? `NGN ${money(p.sellingPriceKobo)}` : 'Provider cost'}</td><td>${p.isActive ? 'Active' : 'Inactive'}</td><td>${canFinance(admin) ? `<form method="post" action="/admin/service-prices/${esc(p.service)}"><input name="sellingPrice" type="number" step="0.01" value="${money(p.sellingPriceKobo)}" placeholder="Selling price"><select name="isActive"><option value="true" ${p.isActive ? 'selected' : ''}>Active</option><option value="false" ${!p.isActive ? 'selected' : ''}>Inactive</option></select><button>Save</button></form>` : 'Read only'}</td></tr>`).join('');
  const bRows = broadcasts.map((b) => `<tr><td>${esc(b.title)}</td><td>${esc(b.type)}</td><td>${esc(b.audience)}</td><td>${b.recipientCount}</td></tr>`).join('');
  const form = canFinance(admin) ? `<div class="card"><h2>Send Welcome/Broadcast Notice</h2><form method="post" action="/admin/broadcast"><p>Title</p><input name="title" required><p>Message</p><textarea name="body" required></textarea><p>Type</p><select name="type"><option value="ADMIN_BROADCAST">Admin Broadcast</option><option value="PROMO">Promo</option><option value="SYSTEM">System</option></select><p>Audience</p><select name="audience"><option value="ALL_USERS">All Users</option><option value="KYC_VERIFIED_ONLY">KYC Verified Only</option></select><p><button>Send</button></p></form></div>` : '';
  res.type('html').send(layout('Dashboard', `<h1>Dashboard</h1><div class="grid"><div class="card"><div>Users</div><div class="value">${users}</div></div><div class="card"><div>Transactions</div><div class="value">${txs}</div></div><div class="card"><div>Pending KYC</div><div class="value">${kyc}</div></div></div>${providerCard}<div class="card"><h2>Service Prices</h2><table><thead><tr><th>Service</th><th>Cost</th><th>Selling</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No service prices found.</td></tr>'}</tbody></table></div>${form}<div class="card"><h2>Recent Broadcasts</h2><table><tbody>${bRows || '<tr><td>No broadcasts yet.</td></tr>'}</tbody></table></div>`, admin));
});


adminPanelRoutes.post('/provider-balance/refresh', async (_req, res) => {
  const admin = res.locals.admin as AdminSessionUser;
  if (!canFinance(admin)) return res.sendStatus(403);
  await providerService.refreshBalance();
  res.redirect('/admin');
});

adminPanelRoutes.post('/service-prices/:service', async (req, res) => {
  const admin = res.locals.admin as AdminSessionUser;
  if (!canFinance(admin)) return res.sendStatus(403);
  const body = z.object({ sellingPrice: z.string().optional(), isActive: z.enum(['true', 'false']).optional() }).parse(req.body);
  const price = body.sellingPrice?.trim();
  await prisma.servicePricing.update({ where: { service: req.params.service }, data: { sellingPriceKobo: price ? BigInt(Math.round(Number(price) * 100)) : null, isActive: body.isActive !== 'false' } });
  res.redirect('/admin');
});

adminPanelRoutes.post('/broadcast', async (req, res) => {
  const admin = res.locals.admin as AdminSessionUser;
  if (!canFinance(admin)) return res.sendStatus(403);
  const body = z.object({ title: z.string().min(2), body: z.string().min(2), type: z.enum(['ADMIN_BROADCAST', 'PROMO', 'SYSTEM']), audience: z.enum(['ALL_USERS', 'KYC_VERIFIED_ONLY']) }).parse(req.body);
  await sendAdminBroadcast({ adminId: admin.id, title: body.title, body: body.body, type: body.type, audience: body.audience });
  res.redirect('/admin');
});



