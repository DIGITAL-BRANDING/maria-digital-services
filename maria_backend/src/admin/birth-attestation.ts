import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BIRTH_ATTESTATION_FIELDS, completeBirthAttestation, decryptBirthAttestationPII, updateBirthAttestationProgressNotes } from '../services/birth-attestation.service.js';
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
 * Custom admin page (not an AdminJS record action) for handling a Birth
 * Attestation request while it's PENDING - same shape as cac.ts's
 * registerCacRoutes(): reached via the "manageBirthAttestation" action's
 * redirectUrl on the Transaction resource. An admin needs to see every
 * field the customer submitted (including the uploaded ID photo), leave a
 * free-text progress note while still PENDING, and - separately - attach
 * the real NPC-issued attestation document (which marks it SUCCESS). Both
 * are handled by the one page below; the client-side script reads the
 * chosen file with FileReader and posts it as base64 in a normal JSON
 * body, so this needs no file-upload middleware (multer etc) at all.
 */
export function registerBirthAttestationRoutes(router: Router) {
  router.get('/birth-attestation/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).type('html').send('<p>Support admins cannot manage Birth Attestation requests.</p>');

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BIRTH_ATTESTATION) {
      return res.status(404).type('html').send('<p>Birth Attestation request not found.</p>');
    }

    await logAdminAction({ adminId: admin.id, action: 'VIEW_TRANSACTION_PII', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference, via: 'birth_attestation_manage' } });

    const metadata = tx.metadata as Record<string, unknown> | null;
    const pii = decryptBirthAttestationPII(tx);
    const progressNotes = typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : '';
    const isPending = tx.status === 'PENDING';
    const hasSubmissionForm = typeof pii?.pdf_base64 === 'string' && pii.pdf_base64.length > 0;
    const hasFinalDoc = typeof pii?.attestation_pdf_base64 === 'string' && pii.attestation_pdf_base64.length > 0;
    const photo = typeof pii?.clean_picture === 'string' && pii.clean_picture.startsWith('data:image/') ? pii.clean_picture : null;

    const detailRows = BIRTH_ATTESTATION_FIELDS.filter((f) => f.input !== 'image').map(
      (f): [string, string | undefined] => [f.label, typeof pii?.[f.key] === 'string' ? (pii![f.key] as string) : undefined]
    );

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Manage Birth Attestation ${escapeHtml(tx.reference)}</title>
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
  .photo { max-width: 220px; border-radius: 8px; margin-top: 10px; display: block; }
</style></head>
<body>
  <p><a href="/admin/resources/Transaction/records/${tx.id}/show">&larr; Back to transaction</a></p>
  <h1>Birth Attestation — ${escapeHtml(tx.reference)}</h1>
  <p class="meta">Status: <span class="status ${tx.status}">${tx.status}</span> · NPC Birth Attestation &amp; Instant approval</p>

  ${photo ? `<img class="photo" src="${photo}" alt="Applicant's National ID photo" />` : '<p class="meta"><i>No photo was attached to this request.</i></p>'}

  <h2>File this with NPC</h2>
  <p class="meta">Every detail the customer submitted, laid out as a printable form - download this before processing the attestation with NPC.</p>
  ${
    hasSubmissionForm
      ? `<a href="#" class="btn primary" onclick="downloadForm(event)">Download submission form (PDF)</a>`
      : `<p class="meta"><i>No submission form was generated for this request.</i></p>`
  }
  <table class="details">
    ${detailRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value ?? '—')}</td></tr>`).join('')}
  </table>

  ${hasFinalDoc ? `<p class="meta" style="margin-top:16px">A completed attestation document is already attached. <a href="#" onclick="downloadFinal(event)">Download it</a>.</p>` : ''}

  <h2>Progress note</h2>
  <p class="meta">Visible to the customer on their Birth Attestation history. Save this any time while the request is pending.</p>
  <div class="field"><textarea id="notes" placeholder="e.g. Submitted to NPC office, awaiting approval">${escapeHtml(progressNotes)}</textarea></div>
  <button id="saveNotes" ${isPending ? '' : 'disabled'}>Save progress note</button>

  <h2>Complete request</h2>
  <p class="meta">Upload the final NPC attestation document once it's issued. This marks the request SUCCESS and lets the customer download it immediately.</p>
  <div class="field"><input type="file" id="finalFile" accept="application/pdf" ${isPending ? '' : 'disabled'} /></div>
  <button id="complete" ${isPending ? '' : 'disabled'}>Mark complete &amp; attach document</button>

  <p id="msg"></p>

<script>
  const txId = ${JSON.stringify(tx.id)};
  const finalBase64 = ${JSON.stringify(hasFinalDoc ? pii!.attestation_pdf_base64 : null)};
  const formBase64 = ${JSON.stringify(hasSubmissionForm ? pii!.pdf_base64 : null)};
  const msg = document.getElementById('msg');

  function downloadFinal(e) {
    e.preventDefault();
    if (!finalBase64) return;
    const a = document.createElement('a');
    a.href = 'data:application/pdf;base64,' + finalBase64;
    a.download = ${JSON.stringify(tx.reference)} + '-attestation.pdf';
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
    const res = await fetch('/admin/birth-attestation/' + txId + '/manage', {
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
    // Base64 adds ~33% on top of the raw file size, and the server accepts
    // request bodies up to 20mb (see app.ts) - 14mb raw is the largest file
    // that stays comfortably under that after the base64 conversion below.
    const MAX_RAW_BYTES = 14 * 1024 * 1024;
    if (file.size > MAX_RAW_BYTES) {
      msg.textContent = 'That PDF is too large (' + (file.size / (1024 * 1024)).toFixed(1) + 'MB). Please compress it to under 14MB and try again.';
      return;
    }
    msg.textContent = 'Uploading…';
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const res = await fetch('/admin/birth-attestation/' + txId + '/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', attestation_pdf_base64: base64 })
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

  router.post('/birth-attestation/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.status(401).json({ error: 'Not signed in' });
    if (admin.role === 'SUPPORT') return res.status(403).json({ error: 'Support admins cannot manage Birth Attestation requests.' });

    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BIRTH_ATTESTATION) {
      return res.status(404).json({ error: 'Birth Attestation request not found' });
    }

    // AdminJS's express-formidable parser exposes normal form/JSON payloads
    // through `fields` and may leave `req.body` undefined.
    const body = (req.body ?? (req as Request & { fields?: unknown }).fields ?? {}) as {
      action?: string;
      progress_notes?: string;
      attestation_pdf_base64?: string;
    };

    try {
      if (body.action === 'notes') {
        await updateBirthAttestationProgressNotes({ transactionId: tx.id, notes: String(body.progress_notes ?? '').slice(0, 2000) });
        await logAdminAction({ adminId: admin.id, action: 'UPDATE_BIRTH_ATTESTATION_PROGRESS', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      if (body.action === 'complete') {
        if (!body.attestation_pdf_base64 || typeof body.attestation_pdf_base64 !== 'string') {
          return res.status(400).json({ error: 'The final attestation PDF is required.' });
        }
        await completeBirthAttestation({ transactionId: tx.id, attestationPdfBase64: body.attestation_pdf_base64 });
        await logAdminAction({ adminId: admin.id, action: 'COMPLETE_BIRTH_ATTESTATION', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference } });
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
}
