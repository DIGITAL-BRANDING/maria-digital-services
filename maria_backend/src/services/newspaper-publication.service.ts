import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII, mergeSealedPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * Newspaper Publication (name-change notice) — same manual-review pattern
 * as Birth Attestation/NIN/BVN Modification: no provider API (this is an
 * actual print-newspaper affidavit + publication placed by an admin with
 * BluePrint or DailyTrust), so submitNewspaperPublicationRequest() debits
 * the wallet, generates a PDF of exactly what the customer submitted, and
 * leaves the transaction PENDING for an admin to place the publication and
 * upload the completed cutting/certificate, then mark it complete.
 *
 * Only one variant, matching the reference design's own single dropdown
 * option: "Name only or Name & DoB Publication (BluePrint or DailyTrust
 * only)" - submit before 5:30pm Monday to Friday only, ~20hr duration.
 */
const SERVICE_KEY = 'NEWSPAPER_PUBLICATION';
const DEFAULT_PRICE = 3300;

export type NewspaperPublicationField = { key: string; label: string; required: boolean };

export const NEWSPAPER_PUBLICATION_FIELDS: NewspaperPublicationField[] = [
  { key: 'old_first_name', label: 'Old First Name', required: true },
  { key: 'old_last_name', label: 'Old Last Name / Surname', required: true },
  { key: 'old_middle_name', label: 'Old Middle Name', required: false },
  { key: 'new_first_name', label: 'New First Name', required: true },
  { key: 'new_last_name', label: 'New Last Name / Surname', required: true },
  { key: 'new_middle_name', label: 'New Middle Name', required: false }
];

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

async function getOrCreatePricingRow() {
  const existing = await prisma.servicePricing.findUnique({ where: { service: SERVICE_KEY } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service: SERVICE_KEY,
        provider: 'manual',
        label: 'Newspaper Publication \u2014 Name only or Name & DoB (BluePrint/DailyTrust)',
        providerCostKobo: priceToKobo(DEFAULT_PRICE)
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.servicePricing.findUniqueOrThrow({ where: { service: SERVICE_KEY } });
    }
    throw error;
  }
}

export async function getNewspaperPublicationPrice() {
  const row = await getOrCreatePricingRow();
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

function renderNewspaperPublicationPdf(params: { reference: string; values: Record<string, unknown>; submittedAt: Date }): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text('MARIA Digital Solutions \u2014 Newspaper Publication Request', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text('Name only or Name & DoB Publication (BluePrint or DailyTrust only)', { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text('Reference: ', { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text('Submitted: ', { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0b2f73').text('Old Details');
    doc.fillColor('#000').moveDown(0.4);
    for (const field of NEWSPAPER_PUBLICATION_FIELDS.filter((f) => f.key.startsWith('old_'))) {
      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(9.5).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0b2f73').text('New Details');
    doc.fillColor('#000').moveDown(0.4);
    for (const field of NEWSPAPER_PUBLICATION_FIELDS.filter((f) => f.key.startsWith('new_'))) {
      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(9.5).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a submission record only, not the published newspaper cutting/affidavit. Processed manually by an admin.', { align: 'left' });

    doc.end();
  });
}

export type SubmitNewspaperPublicationResult = { reference: string; balanceAfter: number };

export async function submitNewspaperPublicationRequest(params: {
  userId: string;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitNewspaperPublicationResult> {
  const price = await getNewspaperPublicationPrice();

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.NEWSPAPER_PUBLICATION,
    description: 'Newspaper Publication \u2014 Name Change',
    metadata: {
      service: SERVICE_KEY,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderNewspaperPublicationPdf({
    reference: debit.reference,
    values: params.values,
    submittedAt: debit.transaction.createdAt
  });

  await prisma.transaction.update({
    where: { id: debit.transaction.id },
    data: {
      metadata: {
        service: SERVICE_KEY,
        unit_price: price.unitPrice,
        pii: sealPII({ ...params.values, pdf_base64: pdfBase64 })
      } as Prisma.InputJsonValue
    }
  });

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type NewspaperPublicationHistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

export async function listNewspaperPublicationHistory(params: { userId: string }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      type: TransactionType.NEWSPAPER_PUBLICATION,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return transactions.map((transaction): NewspaperPublicationHistoryEntry => {
    const metadata = transaction.metadata as Record<string, unknown> | null;
    const pii = openPII<{ pdf_base64?: string }>(metadata?.pii);
    return {
      reference: transaction.reference,
      status: transaction.status.toLowerCase(),
      created_at: transaction.updatedAt.toISOString(),
      pdf_base64: typeof pii?.pdf_base64 === 'string' ? pii.pdf_base64 : null
    };
  });
}

/** Admin-only: leaves a free-text progress note visible to the customer on
 *  their Newspaper Publication history, without changing the transaction's
 *  status. Same shape as cac.service.ts's updateCacProgressNotes(). */
export async function updateNewspaperPublicationProgressNotes(params: { transactionId: string; notes: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.NEWSPAPER_PUBLICATION) {
    throw new ApiError(404, 'Newspaper Publication transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { metadata: { ...metadata, progress_notes: params.notes } as Prisma.InputJsonValue }
  });
}

/** Called from the manage page once the newspaper cutting has actually been
 *  placed - attaches that final proof (scanned cutting/affidavit) and marks
 *  the request SUCCESS. No wallet movement - the customer was already
 *  charged at submit time. */
export async function completeNewspaperPublication(params: { transactionId: string; publicationPdfBase64: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.NEWSPAPER_PUBLICATION) {
    throw new ApiError(404, 'Newspaper Publication transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending request can be marked complete', 'INVALID_STATUS');
  }

  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: TransactionStatus.SUCCESS,
      metadata: {
        ...metadata,
        pii: mergeSealedPII(metadata.pii, { publication_pdf_base64: params.publicationPdfBase64 })
      } as Prisma.InputJsonValue
    }
  });
}

/** Decrypts the sealed PII (submitted values, the auto-generated submission
 *  PDF, and - once completed - the final published cutting/proof) for the
 *  admin's manage page. Never call this from a user-facing endpoint. */
export function decryptNewspaperPublicationPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string; publication_pdf_base64?: string }>(metadata?.pii);
}
