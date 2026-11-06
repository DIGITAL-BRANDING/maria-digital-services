import { readFile } from 'node:fs/promises';
import type { Request, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendAdminComposedEmail } from '../lib/email.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' { interface SessionData { adminUser?: AdminSessionUser; } }

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

type UserOption = { id: string; fullName: string; email: string };
type UploadedFile = { filepath?: string; originalFilename?: string | null; mimetype?: string | null; size?: number };

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function field(req: Request, name: string) {
  const fields = (req as Request & { fields?: Record<string, string | string[]> }).fields;
  const value = fields?.[name];
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}

function uploadedFile(req: Request): UploadedFile | undefined {
  const files = (req as Request & { files?: Record<string, UploadedFile | UploadedFile[]> }).files;
  const value = files?.attachment;
  return Array.isArray(value) ? value[0] : value;
}

function userOptions(users: UserOption[], selected = '') {
  return users.map((user) => `<option value="${escape(user.id)}"${user.id === selected ? ' selected' : ''}>${escape(user.fullName)} — ${escape(user.email)}</option>`).join('');
}

function page(users: UserOption[], message = '', selectedMode = 'all', selectedUser = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email users</title><style>
body{font:15px Arial,sans-serif;background:#f6f3ea;color:#201708;max-width:820px;margin:32px auto;padding:0 16px}section{background:#fff;border:1px solid #d4af37;border-radius:14px;padding:24px;margin:18px 0}label{display:block;font-weight:600;margin:14px 0 5px}input,textarea,select{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:7px;font:inherit}textarea{min-height:180px}button{background:#0b2f73;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:bold;cursor:pointer;margin-top:16px}.hint{color:#64748b;font-size:13px}.message{padding:12px;background:#ecfdf5;border-radius:8px;color:#065f46}.message.error{background:#fff1f2;color:#9f1239}
</style></head><body><p><a href="/admin">← Admin dashboard</a></p><h1>Email users</h1><section><p>Send a separate email to all users or to one selected account. You can attach one PDF, PNG, or JPG (maximum 5 MB).</p>${message ? `<p class="message${message.startsWith('Email sent') ? '' : ' error'}">${escape(message)}</p>` : ''}<form method="post" enctype="multipart/form-data"><label for="recipientMode">Recipients</label><select id="recipientMode" name="recipientMode" onchange="toggleRecipient()"><option value="all"${selectedMode === 'all' ? ' selected' : ''}>Everyone (all users)</option><option value="individual"${selectedMode === 'individual' ? ' selected' : ''}>One person</option></select><label for="recipientUser">Choose a recipient when sending to one person</label><select id="recipientUser" name="recipientUser"${selectedMode === 'individual' ? ' required' : ' disabled'}><option value="">Select a user…</option>${userOptions(users, selectedUser)}</select><p class="hint">Showing the 1,000 most recently registered accounts.</p><label for="subject">Subject</label><input id="subject" name="subject" required maxlength="150"><label for="message">Message</label><textarea id="message" name="message" required maxlength="5000"></textarea><label for="attachment">Attachment (optional)</label><input id="attachment" type="file" name="attachment" accept="application/pdf,image/png,image/jpeg"><p class="hint">Accepted: PDF, PNG, JPG/JPEG. Maximum file size: 5 MB.</p><button type="submit">Send email</button></form></section><script>function toggleRecipient(){const individual=document.getElementById('recipientMode').value==='individual';const picker=document.getElementById('recipientUser');picker.disabled=!individual;picker.required=individual;if(!individual)picker.value='';}</script></body></html>`;
}

async function listRecipientOptions() {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 1000, select: { id: true, fullName: true, email: true } });
}

export function registerEmailUsersRoutes(router: Router) {
  router.get('/email-users', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');
    return res.type('html').send(page(await listRecipientOptions()));
  });

  router.post('/email-users', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('Finance or Super Admin access required.');

    const mode = field(req, 'recipientMode');
    const selectedUser = field(req, 'recipientUser');
    const parsed = z.object({
      mode: z.enum(['all', 'individual']),
      recipientUser: z.string().trim().optional(),
      subject: z.string().trim().min(2).max(150),
      message: z.string().trim().min(1).max(5000)
    }).safeParse({ mode, recipientUser: selectedUser, subject: field(req, 'subject'), message: field(req, 'message') });
    if (!parsed.success || (mode === 'individual' && !selectedUser)) {
      return res.status(400).type('html').send(page(await listRecipientOptions(), 'Choose a recipient and provide a valid subject and message.', mode, selectedUser));
    }

    let attachment: { filename: string; content: string } | undefined;
    const file = uploadedFile(req);
    if (file?.filepath) {
      const name = file.originalFilename || 'attachment';
      const mime = file.mimetype || '';
      if (!ALLOWED_MIME_TYPES.has(mime) || !file.size || file.size > MAX_ATTACHMENT_BYTES) {
        return res.status(400).type('html').send(page(await listRecipientOptions(), 'Attachment must be a PDF, PNG, or JPG no larger than 5 MB.', mode, selectedUser));
      }
      const bytes = await readFile(file.filepath);
      const validSignature = mime === 'application/pdf'
        ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
        : mime === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!validSignature) return res.status(400).type('html').send(page(await listRecipientOptions(), 'The uploaded file content does not match its file type.', mode, selectedUser));
      attachment = { filename: name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120), content: bytes.toString('base64') };
    }

    const users = parsed.data.mode === 'individual'
      ? await prisma.user.findMany({ where: { id: parsed.data.recipientUser }, take: 1, select: { id: true, email: true } })
      : null;
    if (parsed.data.mode === 'individual' && !users?.length) {
      return res.status(404).type('html').send(page(await listRecipientOptions(), 'That user could not be found.', mode, selectedUser));
    }

    let sent = 0;
    let total = 0;
    let cursor: string | undefined;
    do {
      const batch = users ?? await prisma.user.findMany({
        orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, email: true }
      });
      if (!batch.length) break;
      for (let i = 0; i < batch.length; i += 10) {
        const outcomes = await Promise.all(batch.slice(i, i + 10).map((user) => sendAdminComposedEmail({
          to: user.email, subject: parsed.data.subject, message: parsed.data.message, ...(attachment ? { attachment } : {})
        })));
        sent += outcomes.filter((outcome) => outcome.sent).length;
      }
      total += batch.length;
      cursor = batch[batch.length - 1]!.id;
      if (users) break;
    } while (true);

    await logAdminAction({
      adminId: admin.id,
      action: 'SEND_USER_EMAIL',
      targetType: 'User',
      metadata: { recipients: total, sent, broadcast: parsed.data.mode === 'all', subject: parsed.data.subject, attachment: attachment?.filename }
    });
    const result = sent === total ? `Email sent to ${sent} user${sent === 1 ? '' : 's'}.` : `Email sent to ${sent} of ${total} users. Check Railway logs for Resend delivery errors.`;
    return res.type('html').send(page(await listRecipientOptions(), result));
  });
}
