import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  NEWSPAPER_PUBLICATION_FIELDS,
  completeNewspaperPublication,
  decryptNewspaperPublicationPII,
  updateNewspaperPublicationProgressNotes
} from '../services/newspaper-publication.service.js';
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
 * Custom admin page (not an AdminJS record action) for handling a
 * Newspaper Publication request while it's PENDING - same shape as
 * cac.ts/birth-attestation.ts: reached via the "manageNewspaperPublication"
 * action's redirectUrl on the Transaction resource. An admin needs to see
 * the old/new name details, leave a free-text progress note while still
 * PENDING, and - separately - attach the scanned newspaper cutting/
 * affidavit once the publication has actually run (which marks it
 * SUCCESS).
 */
export function registerNewspaperPublicationRoutes(router: Router) {
  router.get('/newspaper-publication/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('<p>Support admins cannot manage Newspaper Publication requests.</p>');

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.NEWSPAPER_PUBLICATION) {
      return res.status(404).type('html').send('<p>Newspaper Publication request not found.</p>');
    }

    await logAdminAction({ adminId: admin.id, action: 'VIEW_TRANSACTION_PII', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference, via: 'newspaper_publication_manage' } });

    const metadata = tx.metadata as Record<string, unknown> | null;
    const pii = decryptNewspaperPublicationPII(tx);
    const progressNotes = typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : '';
    const isPending = tx.status === 'PENDING';
    const hasSubmissionForm = typeof pii?.pdf_base64 === 'string' && pii.pdf_base64.length > 0;
    const hasFinalDoc = typeof pii?.publication_pdf_base64 === 'string' && pii.publication_pdf_base64.length > 0;

    const oldRows = NEWSPAPER_PUBLICATION_FIELDS.filter((f) => f.key.startsWith('old_')).map(
      (f): [string, string | undefined] => [f.label, typeof pii?.[f.key] === 'string' ? (pii![f.key] as string) : undefined]
    );
    const newRows = NEWSPAPER_PUBLICATION_FIELDS.filter((f) => f.key.startsWith('new_')).map(
      (f): [string, string | undefined] => [f.label, typeof pii?.[f.key] === 'string' ? (pii![f.key] as string) : undefined]
    );

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Manage Newspaper Publication ${escapeHtml(tx.reference)}</title>
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
  <h1>Newspaper Publication — ${escapeHtml(tx.reference)}</h1>
  <p class="meta">Status: <span class="status ${tx.status}">${tx.status}</span> · Name only or Name &amp; DoB (BluePrint/DailyTrust)</p>

  <h2>File this with the newspaper</h2>
  <p class="meta">Every detail the customer submitted, laid out as a printable form - download this before placing the publication.</p>
  ${
    hasSubmissionForm
      ? `<a href="#" class="btn primary" onclick="downloadForm(event)">Download submission form (PDF)</a>`
      : `<p class="meta"><i>No submission form was generated for this request.</i></p>`
  }

  <h2 style="margin-top:20px">Old Details</h2>
  <table class="details">${oldRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value ?? '—')}</td></tr>`).join('')}</table>

  <h2>New Details</h2>
  <table class="details">${newRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value ?? '—')}</td></tr>`).join('')}</table>

  ${hasFinalDoc ? `<p class="meta" style="margin-top:16px">A completed publication cutting is already attached. <a href="#" onclick="downloadFinal(event)">Download it</a>.</p>` : ''}

  <h2>Progress note</h2>
  <p class="meta">Visible to the customer on their Newspaper Publication history. Save this any time while the request is pending.</p>
  <div class="field"><textarea id="notes" placeholder="e.g. Submitted to BluePrint, awaiting publication date">${escapeHtml(progressNotes)}</textarea></div>
  <button id="saveNotes" ${isPending ? '' : 'disabled'}>Save progress note</button>

  <h2>Complete request</h2>
  <p class="meta">Upload the scanned newspaper cutting/affidavit once the publication has run. This marks the request SUCCESS and lets the customer download it immediately.</p>
  <div class="field"><input type="file" id="finalFile" accept="application/pdf" ${isPending ? '' : 'disabled'} /></div>
  <button id="complete" ${isPending ? '' : 'disabled'}>Mark complete &amp; attach cutting</button>

  <p id="msg"></p>

<script>
  const txId = ${JSON.stringify(tx.id)};
  const finalBase64 = ${JSON.stringify(hasFinalDoc ? pii!.publication_pdf_base64 : null)};
  const formBase64 = ${JSON.stringify(hasSubmissionForm ? pii!.pdf_base64 : null)};
  const msg = document.getElementById('msg');

  function downloadFinal(e) {
    e.preventDefault();
    if (!finalBase64) return;
    const a = document.createElement('a');
    a.href = 'data:application/pdf;base64,' + finalBase64;
    a.download = ${JSON.stringify(tx.reference)} + '-cutting.pdf';
    a.click();
  }

  function downloadForm(e) {
    e.preventDefault();
    if (!formBase64) return;
    const a = document.createElement('a');
    a.href = 'data:application/pdf;base64,' + formBase64;
    a.download = ${JSON.stringify(tx.reference)} + '-submission-form.pdf';
    a.click();
  }

  document.getElementById('saveNotes').addEventListener('click', async () => {
    msg.textContent = 'Saving…';
    const res = await fetch('/admin/newspaper-publication/' + txId + '/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notes', progress_notes: document.getElementById('notes').value })
    });
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.ok ? 'Saved.' : (data.error || data.message || 'Failed to save.');
  });

  document.getElementById('complete').addEventListener('click', async () => {
    const input = document.getElementById('finalFile');
    const file = input.files && input.files[0];
    if (!file) { msg.textContent = 'Choose a PDF file first.'; return; }
    if (file.type !== 'application/pdf') { msg.textContent = 'Please choose a PDF file.'; return; }
    const MAX_RAW_BYTES = 14 * 1024 * 1024;
    if (file.size > MAX_RAW_BYTES) {
      msg.textContent = 'That PDF is too large (' + (file.size / (1024 * 1024)).toFixed(1) + 'MB). Please compress it to under 14MB and try again.';
      return;
    }
    msg.textContent = 'Uploading…';
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const res = await fetch('/admin/newspaper-publication/' + txId + '/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', publication_pdf_base64: base64 })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        msg.textContent = 'Marked complete. Reloading…';
        setTimeout(() => window.location.reload(), 800);
      } else if (res.status === 413) {
        msg.textContent = 'That PDF is too large for the server to accept. Please compress it and try again.';
      } else {
        msg.textContent = data.error || data.message || ('Failed to complete (HTTP ' + res.status + ').');
      }
    };
    reader.readAsDataURL(file);
  });
</script>
</body></html>`);
  });

  router.post('/newspaper-publication/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.status(401).json({ error: 'Not signed in' });
    if (admin.role === 'SUPPORT') return res.status(403).json({ error: 'Support admins cannot manage Newspaper Publication requests.' });

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.NEWSPAPER_PUBLICATION) {
      return res.status(404).json({ error: 'Newspaper Publication request not found' });
    }

    const body = (req.body ?? (req as Request & { fields?: unknown }).fields ?? {}) as {
      action?: string;
      progress_notes?: string;
      publication_pdf_base64?: string;
    };

    try {
      if (body.action === 'notes') {
        await updateNewspaperPublicationProgressNotes({ transactionId: tx.id, notes: String(body.progress_notes ?? '').slice(0, 2000) });
        await logAdminAction({ adminId: admin.id, action: 'UPDATE_NEWSPAPER_PUBLICATION_PROGRESS', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      if (body.action === 'complete') {
        if (!body.publication_pdf_base64 || typeof body.publication_pdf_base64 !== 'string') {
          return res.status(400).json({ error: 'The published cutting PDF is required.' });
        }
        await completeNewspaperPublication({ transactionId: tx.id, publicationPdfBase64: body.publication_pdf_base64 });
        await logAdminAction({ adminId: admin.id, action: 'COMPLETE_NEWSPAPER_PUBLICATION', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
}
