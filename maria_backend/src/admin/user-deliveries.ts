import { readFile } from 'node:fs/promises';
import type { Request, Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { createUserDelivery } from '../services/user-delivery.service.js';
import { notifyUser } from '../services/notification.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' { interface SessionData { adminUser?: AdminSessionUser; } }
type Upload = { filepath?: string; path?: string; originalFilename?: string; name?: string; mimetype?: string; type?: string };
const value = (req: Request, name: string) => { const v = (req as unknown as { fields?: Record<string, string | string[]> }).fields?.[name]; return typeof v === 'string' ? v.trim() : ''; };
const upload = (req: Request) => { const v = (req as unknown as { files?: Record<string, Upload | Upload[]> }).files?.file; return Array.isArray(v) ? v[0] : v; };

export function registerUserDeliveryRoutes(router: Router) {
  router.get('/user-deliveries', async (req, res) => {
    const admin = req.session?.adminUser; if (!admin) return res.redirect('/admin/login');
    const rows = await prisma.userDelivery.findMany({ take: 30, orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true, email: true } } } });
    res.type('html').send(`<!doctype html><html><head><title>User Deliveries</title><style>body{font:14px Arial;background:#f6f3ea;color:#201708;max-width:900px;margin:32px auto;padding:0 16px}section{background:#fff;border:1px solid #d4af37;border-radius:14px;padding:22px;margin:16px 0}input,textarea{width:100%;box-sizing:border-box;padding:10px;margin:5px 0 14px}button{background:#171106;color:#ffe9a3;border:0;border-radius:8px;padding:11px 16px;font-weight:bold}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #eadfb9;text-align:left}.hint{color:#6c5a2a}</style></head><body><p><a href="/admin">← Admin panel</a></p><h1>User Deliveries</h1><section><h2>Send a file to a user</h2><p class="hint">Use their email, phone number, or User ID. PDF, PNG, JPEG, or TXT only; maximum 10MB.</p><form method="post" enctype="multipart/form-data"><label>User email / phone / ID</label><input name="user" required><label>Title</label><input name="title" required maxlength="120"><label>Description (optional)</label><textarea name="description" maxlength="500"></textarea><label>Transaction/reference (optional)</label><input name="reference" maxlength="120"><label>File</label><input type="file" name="file" accept="application/pdf,image/png,image/jpeg,text/plain" required><button>Upload and notify user</button></form></section><section><h2>Recent deliveries</h2><table><tr><th>User</th><th>File</th><th>Sent</th></tr>${rows.map(r => `<tr><td>${escape(r.user.fullName)}<br><small>${escape(r.user.email)}</small></td><td>${escape(r.title)}<br><small>${escape(r.fileName)}</small></td><td>${r.createdAt.toLocaleString()}</td></tr>`).join('')}</table></section></body></html>`);
  });
  router.post('/user-deliveries', async (req, res) => {
    const admin = req.session?.adminUser; if (!admin) return res.redirect('/admin/login'); if (admin.role === 'SUPPORT') return res.status(403).send('Finance or Super Admin access required.');
    const userQuery = value(req, 'user'); const file = upload(req); const filePath = file?.filepath ?? file?.path;
    const user = await prisma.user.findFirst({ where: { OR: [{ id: userQuery }, { email: { equals: userQuery } }, { phone: userQuery }] } });
    if (!user || !filePath) return res.status(400).send('User or file was not found. Go back and try again.');
    const bytes = await readFile(filePath); const mime = file?.mimetype ?? file?.type ?? 'application/octet-stream';
    const delivery = await createUserDelivery({ userId: user.id, adminId: admin.id, title: value(req, 'title'), description: value(req, 'description') || undefined, reference: value(req, 'reference') || undefined, fileName: file?.originalFilename ?? file?.name ?? 'delivery', mimeType: mime, base64: bytes.toString('base64') });
    await notifyUser({ userId: user.id, type: 'SYSTEM', title: delivery.title, body: 'A file has been delivered to your dashboard. Open Deliveries to download it.', data: { delivery_id: delivery.id } });
    await logAdminAction({ adminId: admin.id, action: 'CREATE_USER_DELIVERY', targetType: 'UserDelivery', targetId: delivery.id, metadata: { userId: user.id, fileName: delivery.fileName, reference: delivery.reference } });
    res.redirect('/admin/user-deliveries');
  });
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
