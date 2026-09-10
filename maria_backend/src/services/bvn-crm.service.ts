import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * BVN CRM — same manual-review pattern as Birth Attestation/Newspaper
 * Publication/NIN/BVN Modification: no provider API for this (the customer
 * has already raised a ticket on the bank/NIBSS BVN CRM portal themselves
 * and just needs an admin to follow up on it), so submitBvnCrmRequest()
 * debits the wallet, generates a submission PDF, and leaves the
 * transaction PENDING for an admin to work the ticket by hand and, from
 * the Transaction admin page, either mark it complete
 * (completeBvnCrm()) or reject it (the existing generic "reverse" action,
 * which refunds).
 *
 * Only one field: the 8-digit TicketID the customer already has from the
 * CRM portal (looks like 88248XXX).
 */
const SERVICE_KEY = 'BVN_CRM';
const DEFAULT_PRICE = 2000;

export type BvnCrmField = { key: string; label: string; required: boolean; placeholder?: string };

export const BVN_CRM_FIELDS: BvnCrmField[] = [
  { key: 'ticket_id', label: '8 DIGITS TicketID', required: true, placeholder: 'e.g. 88248XXX' }
];

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

/** Same plain-findUnique-then-conditional-create shape used throughout -
 *  never resets an admin's already-configured price back to the default. */
async function getOrCreatePricingRow() {
  const existing = await prisma.servicePricing.findUnique({ where: { service: SERVICE_KEY } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service: SERVICE_KEY,
        provider: 'manual',
        label: 'BVN CRM \u2014 Ticket follow-up',
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

export async function getBvnCrmPrice() {
  const row = await getOrCreatePricingRow();
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

function renderBvnCrmPdf(params: { reference: string; values: Record<string, unknown>; submittedAt: Date }): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text('MARIA Digital Solutions \u2014 BVN CRM Request', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Ticket follow-up', { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text('Reference: ', { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text('Submitted: ', { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    for (const field of BVN_CRM_FIELDS) {
      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(10).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a submission record only. Processed manually by an admin.', { align: 'left' });

    doc.end();
  });
}

export type SubmitBvnCrmResult = { reference: string; balanceAfter: number };

export async function submitBvnCrmRequest(params: {
  userId: string;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitBvnCrmResult> {
  const price = await getBvnCrmPrice();

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.BVN_CRM,
    description: 'BVN CRM \u2014 Ticket follow-up',
    metadata: {
      service: SERVICE_KEY,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // No provider was actually paid yet - an admin follows up on the ticket by hand.
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderBvnCrmPdf({
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

export type BvnCrmHistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

export async function listBvnCrmHistory(params: { userId: string }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      type: TransactionType.BVN_CRM,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return transactions.map((transaction): BvnCrmHistoryEntry => {
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

/** Called from the "Complete BVN CRM" admin action once the ticket has
 *  actually been followed up on. No wallet movement - the customer was
 *  already charged at submit time. Rejection uses the existing generic
 *  refundWallet()/"reverse" admin action. */
export async function completeBvnCrm(params: { transactionId: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.BVN_CRM) {
    throw new ApiError(404, 'BVN CRM transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending request can be marked complete', 'INVALID_STATUS');
  }
  return prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.SUCCESS } });
}

/** Decrypts the sealed PII (including the generated PDF) for the admin's
 *  PDF-download route. Never call this from a user-facing endpoint. */
export function decryptBvnCrmPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string }>(metadata?.pii);
}
