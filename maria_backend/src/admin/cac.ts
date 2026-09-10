import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { completeCacRequest, decryptCacPII, updateCacProgressNotes } from '../services/cac.service.js';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Custom admin page (not an AdminJS record action) for handling a CAC
 * request while it's PENDING - reached via the "manageCacRequest" action's
 * redirectUrl on the Transaction resource. AdminJS's built-in record
 * actions only support a single confirm-guard click, which is enough for
 * completeModification/completeBvnLicense elsewhere, but not here: an admin
 * needs to leave a free-text progress note (while still PENDING) and,
 * separately, attach a real finished PDF certificate (which marks it
 * SUCCESS). Both are handled by the one page below - the client-side script
 * reads the chosen file with FileReader and posts it as base64 in a normal
 * JSON body, so this needs no file-upload middleware (multer etc) at all.
 */
export function registerCacRoutes(router: Router) {
  router.get('/cac/:transactionId/upload/:index', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).send('Support admins cannot download customer documents.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const index = Number(req.params.index);
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.CAC_SERVICE_REQUEST || !Number.isInteger(index) || index < 0) return res.status(404).send('Document not found.');
    const uploads = decryptCacPII(tx)?.supporting_documents ?? [];
    const upload = uploads[index];
    if (!upload?.base64 || !upload.name || !upload.mime_type) return res.status(404).send('Document not found.');
    await logAdminAction({ adminId: admin.id, action: 'DOWNLOAD_CAC_CUSTOMER_UPLOAD', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference, fileName: upload.name } });
    res.type(upload.mime_type).setHeader('Content-Disposition', `attachment; filename="${upload.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`).send(Buffer.from(upload.base64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
  });

  // Plain server-streamed downloads for the submission form and the final
  // certificate, instead of the client-side `data:` URI + a.click() trick
  // the manage page used before. That approach is unreliable on several
  // mobile browsers (the "Download submission form" button would silently
  // do nothing) - this route follows the exact same working pattern as
  // /upload/:index just above, which customer document downloads already
  // rely on successfully.
  router.get('/cac/:transactionId/submission-pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).send('Support admins cannot download CAC submission forms.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.CAC_SERVICE_REQUEST) return res.status(404).send('CAC request not found.');
    const pii = decryptCacPII(tx);
    if (!pii?.submission_pdf_base64) return res.status(404).send('No submission form was generated for this request.');
    await logAdminAction({ adminId: admin.id, action: 'DOWNLOAD_CAC_SUBMISSION_PDF', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${tx.reference}-submission-form.pdf"`)
      .send(Buffer.from(pii.submission_pdf_base64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
  });

  router.get('/cac/:transactionId/certificate-pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).send('Support admins cannot download CAC certificates.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.CAC_SERVICE_REQUEST) return res.status(404).send('CAC request not found.');
    const pii = decryptCacPII(tx);
    if (!pii?.certificate_pdf_base64) return res.status(404).send('No certificate has been attached to this request yet.');
    await logAdminAction({ adminId: admin.id, action: 'DOWNLOAD_CAC_CERTIFICATE_PDF', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${tx.reference}-certificate.pdf"`)
      .send(Buffer.from(pii.certificate_pdf_base64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
  });

  router.get('/cac/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('<p>Support admins cannot manage CAC requests.</p>');

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.CAC_SERVICE_REQUEST) {
      return res.status(404).type('html').send('<p>CAC request not found.</p>');
    }

    await logAdminAction({ adminId: admin.id, action: 'VIEW_TRANSACTION_PII', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference, via: 'cac_manage' } });

    const metadata = tx.metadata as Record<string, unknown> | null;
    const pii = decryptCacPII(tx);
    const progressNotes = typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : '';
    const isPending = tx.status === 'PENDING';
    const hasCertificate = typeof pii?.certificate_pdf_base64 === 'string' && pii.certificate_pdf_base64.length > 0;
    const hasSubmissionForm = typeof pii?.submission_pdf_base64 === 'string' && pii.submission_pdf_base64.length > 0;
    const supportingDocuments = Array.isArray(pii?.supporting_documents) ? pii.supporting_documents.filter((item): item is { label: string; name: string; mime_type: string; base64: string } => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).base64 === 'string') : [];

    const detailRows: [string, string | undefined][] = [
      ['Nature of business', pii?.business_nature],
      ['Business address', pii?.business_address],
      ['Proprietor full name', pii?.proprietor_full_name],
      ['Proprietor phone', pii?.proprietor_phone],
      ['Proprietor email', pii?.proprietor_email],
      ['Proprietor residential address', pii?.proprietor_residential_address],
      ['Proprietor date of birth', pii?.proprietor_date_of_birth],
      ['Proprietor gender', pii?.proprietor_gender],
      ['Proprietor NIN', pii?.proprietor_nin]
    ];

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Manage CAC request ${escapeHtml(tx.reference)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 32px; }
  .field { margin-top: 8px; }
  textarea, input[type=file] { width: 100%; box-sizing: border-box; padding: 8px; font: inherit; }
  textarea { min-height: 90px; }
  button, .btn { margin-top: 12px; padding: 10px 18px; font: inherit; cursor: pointer; border: 0; border-radius: 6px; background: #6b4f0b; color: #fff; display: inline-block; text-decoration: none; }
  .btn.primary { background: #0b2f73; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .meta { color: #666; font-size: 13px; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .status.PENDING { background: #fff3cd; color: #7a5b00; }
  .status.SUCCESS { background: #d4edda; color: #155724; }
  #msg { margin-top: 12px; font-size: 14px; }
  table.details { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  table.details td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.details td:first-child { color: #666; width: 42%; }
</style></head>
<body>
  <p><a href="/admin/resources/Transaction/records/${tx.id}/show">&larr; Back to transaction</a></p>
  <h1>CAC request — ${escapeHtml(tx.reference)}</h1>
  <p class="meta">Status: <span class="status ${tx.status}">${tx.status}</span> · Type: ${escapeHtml(String(metadata?.cac_type ?? ''))}</p>
  <p class="meta">Proposed name 1: <b>${escapeHtml(pii?.proposed_name_1 ?? '—')}</b><br>Proposed name 2: <b>${escapeHtml(pii?.proposed_name_2 ?? '—')}</b></p>

  <h2>File this with CAC</h2>
  <p class="meta">Every detail the customer submitted, laid out as a printable form - download this before registering the business on the CAC portal.</p>
  ${
    hasSubmissionForm
      ? `<a href="/admin/cac/${tx.id}/submission-pdf" class="btn primary">Download submission form (PDF)</a>`
      : `<p class="meta"><i>No submission form was generated for this request (it may predate this feature).</i></p>`
  }
  <table class="details">
    ${detailRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value ?? '—')}</td></tr>`).join('')}
  </table>

  <h2>Customer uploads</h2>
  ${supportingDocuments.length ? `<ul>${supportingDocuments.map((document, index) => `<li><a href="/admin/cac/${tx.id}/upload/${index}">${escapeHtml(document.label)} — ${escapeHtml(document.name)}</a></li>`).join('')}</ul>` : '<p class="meta">No supporting documents were uploaded.</p>'}

  ${hasCertificate ? `<p class="meta" style="margin-top:16px">A completed certificate is already attached. <a href="/admin/cac/${tx.id}/certificate-pdf">Download it</a>.</p>` : ''}

  <h2>Progress note</h2>
  <p class="meta">Visible to the customer on their CAC history table. Save this any time while the request is pending.</p>
  <div class="field"><textarea id="notes" placeholder="e.g. Name reservation submitted, awaiting CAC approval">${escapeHtml(progressNotes)}</textarea></div>
  <button id="saveNotes" ${isPending ? '' : 'disabled'}>Save progress note</button>

  <h2>Complete request</h2>
  <p class="meta">Upload the final CAC certificate once registration is done. This marks the request SUCCESS and lets the customer download it immediately.</p>
  <div class="field"><input type="file" id="certFile" accept="application/pdf" ${isPending ? '' : 'disabled'} /></div>
  <button id="complete" ${isPending ? '' : 'disabled'}>Mark complete &amp; attach certificate</button>

  <p id="msg"></p>

<script>
  const txId = ${JSON.stringify(tx.id)};
  const msg = document.getElementById('msg');

  document.getElementById('saveNotes').addEventListener('click', async () => {
    msg.textContent = 'Saving…';
    const res = await fetch('/admin/cac/' + txId + '/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notes', progress_notes: document.getElementById('notes').value })
    });
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.ok ? 'Saved.' : (data.error || data.message || 'Failed to save.');
  });

  document.getElementById('complete').addEventListener('click', async () => {
    const input = document.getElementById('certFile');
    const file = input.files && input.files[0];
    if (!file) { msg.textContent = 'Choose a PDF file first.'; return; }
    if (file.type !== 'application/pdf') { msg.textContent = 'Please choose a PDF file.'; return; }
    // Base64 adds ~33% on top of the raw file size, and the server currently
    // accepts request bodies up to 20mb (see app.ts) - 14mb raw is the
    // largest file that stays comfortably under that after the base64
    // conversion below. Checked here, before even reading the file, so a
    // too-large scan gets a clear message immediately instead of a vague
    // "Failed to complete." after a slow upload that was always going to be
    // rejected.
    const MAX_RAW_BYTES = 14 * 1024 * 1024;
    if (file.size > MAX_RAW_BYTES) {
      msg.textContent = 'That PDF is too large (' + (file.size / (1024 * 1024)).toFixed(1) + 'MB). Please compress it to under 14MB and try again.';
      return;
    }
    msg.textContent = 'Uploading…';
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const res = await fetch('/admin/cac/' + txId + '/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', certificate_pdf_base64: base64 })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        msg.textContent = 'Marked complete. Reloading…';
        setTimeout(() => window.location.reload(), 800);
      } else if (res.status === 413) {
        msg.textContent = 'That PDF is too large for the server to accept. Please compress it and try again.';
      } else {
        // The route's own catch block returns { error: '...' } (see the
        // POST handler below), but a failure in global middleware BEFORE
        // this route even runs (e.g. the body-size-limit check in app.ts)
        // goes through the app-wide error handler instead, which uses
        // { message: '...' } - checking both keeps this readable either way
        // instead of silently falling back to a generic message.
        msg.textContent = data.error || data.message || ('Failed to complete (HTTP ' + res.status + ').');
      }
    };
    reader.readAsDataURL(file);
  });
</script>
</body></html>`);
  });

  router.post('/cac/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.status(401).json({ error: 'Not signed in' });
    if (admin.role === 'SUPPORT') return res.status(403).json({ error: 'Support admins cannot manage CAC requests.' });

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.CAC_SERVICE_REQUEST) {
      return res.status(404).json({ error: 'CAC request not found' });
    }

    // AdminJS's express-formidable parser exposes normal form/JSON payloads
    // through `fields` and may leave `req.body` undefined.
    const body = (req.body ?? (req as Request & { fields?: unknown }).fields ?? {}) as {
      action?: string;
      progress_notes?: string;
      certificate_pdf_base64?: string;
    };

    try {
      if (body.action === 'notes') {
        await updateCacProgressNotes({ transactionId: tx.id, notes: String(body.progress_notes ?? '').slice(0, 2000) });
        await logAdminAction({ adminId: admin.id, action: 'UPDATE_CAC_PROGRESS', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      if (body.action === 'complete') {
        if (!body.certificate_pdf_base64 || typeof body.certificate_pdf_base64 !== 'string') {
          return res.status(400).json({ error: 'A certificate PDF is required.' });
        }
        await completeCacRequest({ transactionId: tx.id, certificatePdfBase64: body.certificate_pdf_base64 });
        await logAdminAction({ adminId: admin.id, action: 'COMPLETE_CAC_REQUEST', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
}
