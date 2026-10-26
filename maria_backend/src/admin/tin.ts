import { z } from 'zod';
import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { completeTinRequest, decryptTinPII, updateTinProgressNotes } from '../services/tin-certificate.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function registerTinRoutes(router: Router) {
  router.get('/tin/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('<p>Support admins cannot manage TIN requests.</p>');

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction || transaction.type !== TransactionType.TIN_CERTIFICATE_REQUEST) {
      return res.status(404).type('html').send('<p>TIN request not found.</p>');
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'VIEW_TIN_REQUEST',
      targetType: 'Transaction',
      targetId: transaction.id,
      metadata: { reference: transaction.reference }
    });

    const metadata = transaction.metadata as Record<string, unknown> | null;
    const pii = decryptTinPII(transaction);
    const isPending = transaction.status === 'PENDING';
    const hasCertificate = typeof pii?.certificate_pdf_base64 === 'string' && pii.certificate_pdf_base64.length > 0;
    const details = metadata?.tin_type === 'corporate'
      ? [
          ['RC number', pii?.type === 'corporate' ? pii.rc_number : undefined],
          ['Company name', pii?.type === 'corporate' ? pii.company_name : undefined],
          ['Organization type', pii?.type === 'corporate' ? pii.organization_type : undefined]
        ]
      : [
          ['NIN number', pii?.type === 'individual' ? pii.nin_number : undefined],
          ['First name', pii?.type === 'individual' ? pii.first_name : undefined],
          ['Surname', pii?.type === 'individual' ? pii.surname : undefined],
          ['Date of birth', pii?.type === 'individual' ? pii.date_of_birth : undefined]
        ];
    const progressNotes = typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : '';
    const detailRows = details.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value ?? '—')}</td></tr>`).join('');

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Manage TIN request ${escapeHtml(transaction.reference)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 32px; }
  textarea, input[type=file] { width: 100%; box-sizing: border-box; padding: 8px; font: inherit; }
  textarea { min-height: 90px; }
  button, .btn { margin-top: 12px; padding: 10px 18px; font: inherit; cursor: pointer; border: 0; border-radius: 6px; background: #6b4f0b; color: #fff; display: inline-block; text-decoration: none; }
  .btn.primary { background: #0b2f73; } button:disabled { opacity: .5; cursor: not-allowed; }
  .meta { color: #666; font-size: 13px; }
  table.details { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  table.details td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.details td:first-child { color: #666; width: 42%; }
</style></head>
<body>
  <p><a href="/admin/resources/Transaction/records/${encodeURIComponent(transaction.id)}/show">&larr; Back to transaction</a></p>
  <h1>TIN certificate request — ${escapeHtml(transaction.reference)}</h1>
  <p class="meta">Status: <b>${escapeHtml(transaction.status)}</b> · Type: ${escapeHtml(String(metadata?.tin_type ?? ''))}</p>
  <table class="details">${detailRows}</table>
  ${hasCertificate ? `<p class="meta" style="margin-top:16px">Certificate attached. <a href="/admin/tin/${encodeURIComponent(transaction.id)}/certificate-pdf">Download certificate</a>.</p>` : ''}
  <h2>Progress note</h2>
  <p class="meta">Visible to the customer while their request is being processed.</p>
  <textarea id="notes" ${isPending ? '' : 'disabled'}>${escapeHtml(progressNotes)}</textarea>
  <button id="saveNotes" ${isPending ? '' : 'disabled'}>Save progress note</button>
  <h2>Complete request</h2>
  <p class="meta">Upload the issued TIN certificate PDF. This marks the request complete and makes the certificate available to the customer.</p>
  <input type="file" id="certFile" accept="application/pdf" ${isPending ? '' : 'disabled'} />
  <button id="complete" ${isPending ? '' : 'disabled'}>Mark complete &amp; attach certificate</button>
  <p id="msg" role="status"></p>
<script>
  const txId = ${JSON.stringify(transaction.id)};
  const msg = document.getElementById('msg');
  async function post(payload) {
    const response = await fetch('/admin/tin/' + encodeURIComponent(txId) + '/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || ('Request failed (HTTP ' + response.status + ').'));
    return data;
  }
  document.getElementById('saveNotes').addEventListener('click', async () => {
    msg.textContent = 'Saving…';
    try { await post({ action: 'notes', progress_notes: document.getElementById('notes').value }); msg.textContent = 'Saved.'; }
    catch (error) { msg.textContent = error.message; }
  });
  document.getElementById('complete').addEventListener('click', async () => {
    const input = document.getElementById('certFile');
    const file = input.files && input.files[0];
    if (!file) { msg.textContent = 'Choose a PDF file first.'; return; }
    if (file.type !== 'application/pdf') { msg.textContent = 'Please choose a PDF file.'; return; }
    if (file.size > 14 * 1024 * 1024) { msg.textContent = 'Please compress the PDF to under 14MB and try again.'; return; }
    msg.textContent = 'Uploading…';
    const reader = new FileReader();
    reader.onerror = () => { msg.textContent = 'Could not read the selected PDF.'; };
    reader.onload = async () => {
      try {
        await post({ action: 'complete', certificate_pdf_base64: reader.result.split(',')[1] });
        msg.textContent = 'Marked complete. Reloading…';
        setTimeout(() => window.location.reload(), 800);
      } catch (error) { msg.textContent = error.message; }
    };
    reader.readAsDataURL(file);
  });
</script>
</body></html>`);
  });

  router.get('/tin/:transactionId/certificate-pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).send('Support admins cannot download TIN certificates.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction || transaction.type !== TransactionType.TIN_CERTIFICATE_REQUEST) return res.status(404).send('TIN request not found.');
    const pii = decryptTinPII(transaction);
    if (!pii?.certificate_pdf_base64) return res.status(404).send('No certificate has been attached to this request yet.');
    await logAdminAction({
      adminId: admin.id,
      action: 'DOWNLOAD_TIN_CERTIFICATE',
      targetType: 'Transaction',
      targetId: transaction.id,
      metadata: { reference: transaction.reference }
    });
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${transaction.reference}-certificate.pdf"`)
      .send(Buffer.from(pii.certificate_pdf_base64, 'base64'));
  });

  router.post('/tin/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.status(401).json({ error: 'Not signed in' });
    if (admin.role === 'SUPPORT') return res.status(403).json({ error: 'Support admins cannot manage TIN requests.' });
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction || transaction.type !== TransactionType.TIN_CERTIFICATE_REQUEST) {
      return res.status(404).json({ error: 'TIN request not found' });
    }
    const parsed = z.discriminatedUnion('action', [
      z.object({ action: z.literal('notes'), progress_notes: z.string().max(2000) }),
      z.object({ action: z.literal('complete'), certificate_pdf_base64: z.string().min(20).max(20_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) })
    ]).safeParse(req.body ?? (req as Request & { fields?: unknown }).fields ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request data.' });

    try {
      if (parsed.data.action === 'notes') {
        await updateTinProgressNotes({ transactionId: transaction.id, notes: parsed.data.progress_notes });
        await logAdminAction({ adminId: admin.id, action: 'UPDATE_TIN_PROGRESS', targetType: 'Transaction', targetId: transaction.id, metadata: { reference: transaction.reference } });
        return res.json({ ok: true });
      }
      await completeTinRequest({ transactionId: transaction.id, certificatePdfBase64: parsed.data.certificate_pdf_base64 });
      await logAdminAction({ adminId: admin.id, action: 'COMPLETE_TIN_REQUEST', targetType: 'Transaction', targetId: transaction.id, metadata: { reference: transaction.reference } });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
}
