import type { Request, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendAdminComposedEmail } from '../lib/email.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' { interface SessionData { adminUser?: AdminSessionUser; } }

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function field(req: Request, name: string) {
  const fields = (req as Request & { fields?: Record<string, string | string[]> }).fields;
  const value = fields?.[name];
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}

function page(message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Email users</title><style>
body{font:15px Arial,sans-serif;background:#f6f3ea;color:#201708;max-width:820px;margin:32px auto;padding:0 16px}section{background:#fff;border:1px solid #d4af37;border-radius:14px;padding:24px;margin:18px 0}label{display:block;font-weight:600;margin:14px 0 5px}input,textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:7px;font:inherit}textarea{min-height:180px}button{background:#0b2f73;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:bold;cursor:pointer;margin-top:16px}.hint{color:#64748b;font-size:13px} .message{padding:12px;background:#ecfdf5;border-radius:8px;color:#065f46}
</style></head><body><p><a href="/admin">← Admin dashboard</a></p><h1>Email users</h1><section><p>Send a plain text message to one account or the newest 500 accounts. Each person receives an individual email; recipient addresses are not shared.</p>${message ? `<p class="message">${escape(message)}</p>` : ''}<form method="post"><label>Recipient email, phone, or user ID</label><input name="recipient" placeholder="e.g. user@example.com"><p class="hint">Leave this empty to send to the newest 500 user accounts.</p><label>Subject</label><input name="subject" required maxlength="150"><label>Message</label><textarea name="message" required maxlength="5000"></textarea><button type="submit">Send email</button></form></section></body></html>`;
}

export function registerEmailUsersRoutes(router: Router) {
  router.get('/email-users', (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');
    return res.type('html').send(page());
  });

  router.post('/email-users', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');

    const parsed = z.object({
      recipient: z.string().trim().max(254).optional(),
      subject: z.string().trim().min(2).max(150),
      message: z.string().trim().min(1).max(5000)
    }).safeParse({ recipient: field(req, 'recipient'), subject: field(req, 'subject'), message: field(req, 'message') });
    if (!parsed.success) return res.status(400).type('html').send(page('Please provide a valid subject and message.'));

    const users = parsed.data.recipient
      ? await prisma.user.findMany({
          where: { OR: [{ id: parsed.data.recipient }, { phone: parsed.data.recipient }, { email: { equals: parsed.data.recipient } }] },
          take: 1,
          select: { id: true, email: true }
        })
      : await prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: { id: true, email: true }
        });
    if (!users.length) return res.status(404).type('html').send(page('No matching user was found.'));

    let sent = 0;
    for (let i = 0; i < users.length; i += 10) {
      const outcomes = await Promise.all(users.slice(i, i + 10).map((user) => sendAdminComposedEmail({ to: user.email, subject: parsed.data.subject, message: parsed.data.message })));
      sent += outcomes.filter((outcome) => outcome.sent).length;
    }
    await logAdminAction({
      adminId: admin.id,
      action: 'SEND_USER_EMAIL',
      targetType: 'User',
      metadata: { recipients: users.length, sent, broadcast: !parsed.data.recipient, subject: parsed.data.subject }
    });
    const result = sent === users.length ? `Email sent to ${sent} user${sent === 1 ? '' : 's'}.` : `Email sent to ${sent} of ${users.length} users. Check Railway logs for Resend delivery errors.`;
    return res.type('html').send(page(result));
  });
}
