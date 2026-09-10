import PDFDocument from 'pdfkit';
import { TransactionType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { sealPII, openPII } from '../lib/pii.js';
import { debitWallet } from './wallet.service.js';
export const GEO_POLITICAL_ZONES = ['North Central','North East','North West','South East','South South','South West'] as const;
export type BvnLicenseInput = Record<string, string | boolean> & { geo_political_zone: typeof GEO_POLITICAL_ZONES[number]; consent: boolean };
export function createBvnLicenseTrackingId() { return `MDL-BVN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; }
export async function renderBvnLicensePdf(values:BvnLicenseInput, trackingId:string) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 }); const chunks:Buffer[]=[];
  doc.on('data',(c:Buffer)=>chunks.push(c));
  const done = new Promise<string>((resolve,reject)=>{ doc.on('end',()=>resolve(Buffer.concat(chunks).toString('base64'))); doc.on('error',reject); });
  const pageWidth = doc.page.width;
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  const fields = Object.entries(values).filter(([key]) => key !== 'consent');
  doc.rect(0, 0, pageWidth, 104).fill('#0b2f73');
  doc.fillColor('#ffffff').fontSize(21).font('Helvetica-Bold').text('MARIA DIGITAL SOLUTIONS', margin, 30, { width: contentWidth, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#dbeafe').text('BVN LICENCE ONBOARDING — SUBMISSION FORM', margin, 61, { width: contentWidth, align: 'center' });
  doc.roundedRect(margin, 120, contentWidth, 50, 8).fill('#eef6ff');
  doc.fillColor('#0b2f73').font('Helvetica-Bold').fontSize(10).text('TRACKING ID', margin + 14, 133);
  doc.font('Helvetica').fontSize(11).text(trackingId, margin + 14, 148);
  doc.font('Helvetica-Bold').fontSize(10).text('SUBMITTED', margin + contentWidth / 2, 133);
  doc.font('Helvetica').fontSize(10).text(new Date().toLocaleString('en-NG'), margin + contentWidth / 2, 148);
  let y = 195;
  doc.fillColor('#0b2f73').font('Helvetica-Bold').fontSize(14).text('Applicant Details', margin, y); y += 24;
  const cellWidth = (contentWidth - 14) / 2;
  for (let index = 0; index < fields.length; index += 2) {
    if (y > 700) { doc.addPage(); y = 60; }
    for (let column = 0; column < 2; column++) {
      const entry = fields[index + column]; if (!entry) continue;
      const [key, value] = entry; const x = margin + column * (cellWidth + 14);
      doc.roundedRect(x, y, cellWidth, 52, 6).fillAndStroke('#ffffff', '#cbdceb');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text(key.replaceAll('_', ' ').toUpperCase(), x + 10, y + 10, { width: cellWidth - 20 });
      doc.fillColor('#172554').font('Helvetica').fontSize(10).text(String(value || '—'), x + 10, y + 26, { width: cellWidth - 20, height: 16, ellipsis: true });
    }
    y += 64;
  }
  doc.roundedRect(margin, y + 7, contentWidth, 40, 7).fill('#fff8e6');
  doc.fillColor('#735b12').fontSize(9).font('Helvetica').text('This is a customer submission record for manual processing. Verify the details before completing the BVN Licence request.', margin + 12, y + 20, { width: contentWidth - 24 });
  doc.end(); return done;
}
export async function submitBvnLicense(params:{userId:string;values:BvnLicenseInput;idempotencyKey?:string}) {
  const trackingId=createBvnLicenseTrackingId();
  const debit=await debitWallet({userId:params.userId,amount:10000,type:TransactionType.BVN_LICENSE_ONBOARDING,description:'BVN License Onboarding',metadata:{service:'BVN_LICENSE_ONBOARDING',tracking_id:trackingId,pii:sealPII(params.values)} as Prisma.InputJsonValue,idempotencyKey:params.idempotencyKey});
  if (!debit.reused) { const pdf_base64=await renderBvnLicensePdf(params.values,trackingId); const tx=await prisma.transaction.findUnique({where:{id:debit.transaction.id}}); if(tx) await prisma.transaction.update({where:{id:tx.id},data:{metadata:{service:'BVN_LICENSE_ONBOARDING',tracking_id:trackingId,pdf_base64,pii:sealPII(params.values)} as Prisma.InputJsonValue}}); }
  const existing=(debit.transaction?.metadata as Record<string,unknown>|null)?.tracking_id;
  return {trackingId: (existing as string|undefined) ?? trackingId,reference:debit.reference,balanceAfter:debit.balanceAfter};
}
export function decryptBvnLicensePII(t:{metadata:unknown}) { return openPII<Record<string,unknown>>((t.metadata as Record<string,unknown>|null)?.pii); }
