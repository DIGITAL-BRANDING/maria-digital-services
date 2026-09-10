import type { Request, Router } from 'express';
import { NotificationType, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptBvnLicensePII, renderBvnLicensePdf, type BvnLicenseInput } from '../services/bvn-license-onboarding.service.js';
import { logAdminAction } from './audit.js';
import { createUserDelivery } from '../services/user-delivery.service.js';
import { notifyUser } from '../services/notification.service.js';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function registerBvnLicenseRoutes(router: Router) {
  router.get('/bvn-license/:transactionId/manage', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role === 'SUPPORT') return res.status(403).send('Support admins cannot manage BVN License requests.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BVN_LICENSE_ONBOARDING) return res.status(404).send('BVN License request not found.');
    const pii = decryptBvnLicensePII(tx) ?? {};
    const metadata = tx.metadata as Record<string, unknown> | null;
    const values = Object.entries(pii).filter(([key]) => key !== 'consent');
    const submissionPdf = typeof metadata?.pdf_base64 === 'string' ? metadata.pdf_base64 : typeof pii.pdf_base64 === 'string' ? pii.pdf_base64 : null;
    const editable = tx.status === TransactionStatus.PENDING;
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BVN Licence Request</title><style>
      *{box-sizing:border-box} body{margin:0;background:#f4f7fb;color:#13213a;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1020px;margin:34px auto;padding:0 20px}.back{color:#0b4f91;text-decoration:none;font-weight:650}.hero{margin:18px 0;background:linear-gradient(135deg,#082858,#1261aa);border-radius:18px;padding:26px;color:#fff}.hero h1{margin:0;font-size:25px}.hero p{margin:7px 0 0;color:#dcecff}.badge{display:inline-block;margin-top:13px;border-radius:999px;background:${editable ? '#fef3c7' : '#dcfce7'};color:#172554;padding:5px 10px;font-size:12px;font-weight:750}.card{background:#fff;border:1px solid #dbe7f4;border-radius:18px;padding:25px;margin:18px 0;box-shadow:0 6px 20px #0b2f7310}.card h2{margin:0 0 7px;font-size:18px;color:#0b2f73}.hint{font-size:13px;color:#64748b;line-height:1.45}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}.field{border:1px solid #dce7f4;border-radius:10px;padding:12px;background:#f8fbff}.field small{display:block;color:#64748b;text-transform:capitalize;margin-bottom:5px}.field b{word-break:break-word}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{border:0;border-radius:10px;padding:11px 15px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;background:#0b4f91;color:#fff}.btn.secondary{background:#edf5ff;color:#0b4f91;border:1px solid #bcd4ee}.upload{margin-top:16px;border:1px dashed #91b6dc;border-radius:12px;padding:16px;background:#f8fbff}.upload input{width:100%;margin-top:8px}#msg{margin-top:12px;font-weight:650}.success{color:#087443}.error{color:#b42318}@media(max-width:620px){.wrap{padding:0 12px;margin:16px auto}.grid{grid-template-columns:1fr}.card,.hero{padding:18px}}
    </style></head><body><main class="wrap"><a class="back" href="/admin/resources/Transaction/records/${tx.id}/show">← Back to transaction</a><section class="hero"><h1>BVN Licence Onboarding</h1><p>${escapeHtml(tx.reference)} · ${escapeHtml(String(metadata?.tracking_id ?? 'No tracking ID'))}</p><span class="badge">${escapeHtml(tx.status)}</span></section><section class="card"><h2>Applicant form</h2><p class="hint">Submitted information, arranged for easy review before processing.</p><div class="grid">${values.map(([key,value]) => `<div class="field"><small>${escapeHtml(key.replaceAll('_',' '))}</small><b>${escapeHtml(String(value || '—'))}</b></div>`).join('')}</div></section><section class="card"><h2>Documents and completion</h2><p class="hint">Download the submitted form. Attaching a completed licence document is optional; when attached, the customer can download it from Deliveries.</p><div class="actions">${submissionPdf ? `<a class="btn secondary" href="/admin/bvn-license/${tx.id}/pdf" target="_blank">Download submission PDF</a>` : '<span class="hint">Submission PDF unavailable for this older request.</span>'}</div>${editable ? `<div class="upload"><label><b>Completed licence document <span class="hint">(optional)</span></b><br><span class="hint">PDF, PNG or JPG — maximum 10 MB</span><input id="file" type="file" accept="application/pdf,image/png,image/jpeg"></label><label style="display:block;margin-top:12px"><b>Message to customer (optional)</b><input id="note" style="width:100%;margin-top:6px;padding:10px;border:1px solid #cbdceb;border-radius:8px" placeholder="Your BVN licence request is complete."></label><button class="btn" id="complete" style="margin-top:14px">Complete request${' '}<span id="buttonSuffix">and send document</span></button><p id="msg"></p></div>` : '<p class="hint">This request has already been completed.</p>'}</section></main><script>const button=document.getElementById('complete'),msg=document.getElementById('msg'),fileInput=document.getElementById('file');if(fileInput)fileInput.onchange=()=>{document.getElementById('buttonSuffix').textContent=fileInput.files[0]?'and send document':'without document'};if(button)button.onclick=()=>{const file=fileInput.files[0],note=document.getElementById('note').value;if(file&&file.size>10*1024*1024){msg.className='error';msg.textContent='File must be 10MB or smaller.';return}msg.className='';msg.textContent=file?'Uploading document…':'Completing request…';const send=async(payload)=>{const response=await fetch('/admin/bvn-license/${tx.id}/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await response.json().catch(()=>({}));if(response.ok){msg.className='success';msg.textContent=file?'Completed and sent to the customer.':'Request completed.';setTimeout(()=>location.reload(),850)}else{msg.className='error';msg.textContent=body.error||'Upload failed.'}};if(!file){send({note});return}const reader=new FileReader();reader.onload=()=>send({file_base64:String(reader.result).split(',')[1],file_name:file.name,mime_type:file.type,note});reader.readAsDataURL(file)}</script></body></html>`);
  });

  router.post('/bvn-license/:transactionId/complete', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.status(401).json({ error: 'Not signed in' });
    if (admin.role === 'SUPPORT') return res.status(403).json({ error: 'Support admins cannot complete requests.' });
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BVN_LICENSE_ONBOARDING) return res.status(404).json({ error: 'BVN Licence request not found.' });
    if (tx.status !== TransactionStatus.PENDING) return res.status(409).json({ error: 'This request is already completed.' });
    const body = (req.body ?? (req as Request & { fields?: unknown }).fields ?? {}) as { file_base64?: string; file_name?: string; mime_type?: string; note?: string };
    const hasDocument = Boolean(body.file_base64 || body.file_name || body.mime_type);
    if (hasDocument && (!body.file_base64 || !body.file_name || !['application/pdf','image/png','image/jpeg'].includes(body.mime_type ?? ''))) return res.status(400).json({ error: 'Attached document must be a PDF, PNG or JPG.' });
    try {
      const delivery = hasDocument ? await createUserDelivery({ userId: tx.userId, adminId: admin.id, title: 'BVN Licence document', description: String(body.note ?? '').slice(0, 500) || 'Your BVN Licence onboarding document is ready for download.', fileName: body.file_name!, mimeType: body.mime_type!, base64: body.file_base64!, reference: tx.reference }) : null;
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: TransactionStatus.SUCCESS } });
      await notifyUser({ userId: tx.userId, type: NotificationType.SYSTEM, title: 'BVN Licence request completed', body: delivery ? 'Your completed document is ready in Deliveries.' : String(body.note ?? '').slice(0, 500) || 'Your BVN Licence request has been completed.', data: { delivery_id: delivery?.id, reference: tx.reference } });
      await logAdminAction({ adminId: admin.id, action: 'COMPLETE_BVN_LICENSE', targetType: 'Transaction', targetId: tx.id, metadata: { reference: tx.reference, deliveryId: delivery?.id } });
      res.json({ ok: true });
    } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : 'Could not complete request.' }); }
  });

  router.get('/bvn-license/:transactionId/pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role !== 'SUPER_ADMIN') return res.status(403).send('Only a Super Admin can download this PDF.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BVN_LICENSE_ONBOARDING) return res.status(404).send('BVN License request not found.');
    const pii = decryptBvnLicensePII(tx);
    const metadata = tx.metadata as Record<string, unknown> | null;
    // Generated PDFs are stored outside sealed PII; support older sealed data too.
    // Regenerate the readable, branded form from the encrypted request data.
    // This also upgrades older submissions that were generated with the old
    // “MAJOR DATA-LINK” heading and unstructured one-column layout.
    const trackingId = typeof metadata?.tracking_id === 'string' ? metadata.tracking_id : tx.reference;
    const pdfBase64 = pii ? await renderBvnLicensePdf(pii as BvnLicenseInput, trackingId) : typeof metadata?.pdf_base64 === 'string' ? metadata.pdf_base64 : null;
    if (!pdfBase64) return res.status(404).send('PDF not found.');
    await logAdminAction({ adminId: admin.id, action: 'VIEW_TRANSACTION_PII', targetType: 'Transaction', targetId: tx.id, metadata: { tracking_id: (tx.metadata as any)?.tracking_id } });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${tx.reference}.pdf"`).send(Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/i, ''), 'base64'));
  });
}
