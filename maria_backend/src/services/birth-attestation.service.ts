import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII, mergeSealedPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * Birth Attestation — same manual-review pattern as NIN/BVN Modification:
 * there is no provider API for this (NPC has no developer platform Techhub
 * exposes), so submitBirthAttestationRequest() debits the wallet, generates
 * a PDF of exactly what the customer submitted (including the uploaded
 * photo), and leaves the transaction PENDING. An admin processes the actual
 * attestation with NPC by hand and, from the Transaction admin page, either
 * marks it complete (completeBirthAttestation()) or rejects it (the
 * existing generic "reverse" action, which refunds).
 *
 * Unlike NIN/BVN Modification there's only one variant here ("NPC Birth
 * Attestation & Instant approval") - the reference design's own dropdown
 * only ever had that one option - so there's no type union, just one fixed
 * field list.
 */
const SERVICE_KEY = 'BIRTH_ATTESTATION';
const DEFAULT_PRICE = 20000;

export type BirthAttestationFieldInput = 'text' | 'date' | 'nin' | 'select' | 'image';

export type BirthAttestationField = {
  key: string;
  label: string;
  required: boolean;
  input: BirthAttestationFieldInput;
  options?: string[];
  /** Groups fields on the frontend form (e.g. "Father's Details") - purely
   *  presentational, not used for validation. */
  section?: string;
};

// Matches the reference design's own field order/grouping exactly.
export const BIRTH_ATTESTATION_FIELDS: BirthAttestationField[] = [
  { key: 'nin', label: 'NIN Number', required: true, input: 'nin', section: 'Applicant' },
  { key: 'last_name', label: 'Last Name / Surname', required: true, input: 'text', section: 'Applicant' },
  { key: 'first_name', label: 'First Name', required: true, input: 'text', section: 'Applicant' },
  { key: 'middle_name', label: 'Middle Name', required: false, input: 'text', section: 'Applicant' },
  { key: 'old_dob', label: 'Old DoB', required: true, input: 'date', section: 'Applicant' },
  { key: 'new_dob', label: 'New DoB', required: true, input: 'date', section: 'Applicant' },
  { key: 'gender', label: 'Gender', required: true, input: 'select', options: ['Male', 'Female'], section: 'Applicant' },
  { key: 'marital_status', label: 'Marital Status', required: true, input: 'select', options: ['Single', 'Married', 'Divorced'], section: 'Applicant' },
  { key: 'religion', label: 'Religion', required: true, input: 'text', section: 'Applicant' },

  { key: 'state_of_origin', label: 'State of Origin', required: true, input: 'text', section: 'Origin & Birth' },
  { key: 'lga_of_origin', label: 'LGA of Origin', required: true, input: 'text', section: 'Origin & Birth' },
  { key: 'town_village_of_origin', label: 'Town/Village of Origin', required: true, input: 'text', section: 'Origin & Birth' },
  { key: 'place_of_birth', label: 'Place of Birth', required: true, input: 'text', section: 'Origin & Birth' },
  { key: 'state_of_birth', label: 'State of Birth', required: true, input: 'text', section: 'Origin & Birth' },
  { key: 'lga_of_birth', label: 'LGA of Birth', required: true, input: 'text', section: 'Origin & Birth' },

  { key: 'birth_registration_state', label: 'Birth Registration State (Resident state)', required: true, input: 'text', section: 'Registration' },
  { key: 'birth_registration_lga', label: 'Birth Registration LGA (Resident LGA)', required: true, input: 'text', section: 'Registration' },
  { key: 'registration_center', label: 'Registration Center (Nearest to you)', required: true, input: 'text', section: 'Registration' },

  { key: 'current_house_address', label: 'Full Current House Address', required: true, input: 'text', section: 'Address & Background' },
  { key: 'work_address', label: 'Full Work Address', required: true, input: 'text', section: 'Address & Background' },
  { key: 'education_level', label: 'Highest Level of Education', required: true, input: 'text', section: 'Address & Background' },
  { key: 'occupation', label: 'Occupation', required: true, input: 'text', section: 'Address & Background' },

  { key: 'father_surname', label: "Father's Surname", required: true, input: 'text', section: "Father's Details" },
  { key: 'father_first_name', label: "Father's First Name", required: true, input: 'text', section: "Father's Details" },
  { key: 'father_middle_name', label: "Father's Middle Name", required: false, input: 'text', section: "Father's Details" },
  { key: 'father_state_of_origin', label: "Father's State of Origin", required: true, input: 'text', section: "Father's Details" },
  { key: 'father_lga_of_origin', label: "Father's LGA of Origin", required: true, input: 'text', section: "Father's Details" },
  { key: 'father_town_village_of_origin', label: "Father's Town/Village of Origin", required: true, input: 'text', section: "Father's Details" },

  { key: 'mother_surname', label: "Mother's Surname", required: true, input: 'text', section: "Mother's Details" },
  { key: 'mother_first_name', label: "Mother's First Name", required: true, input: 'text', section: "Mother's Details" },
  { key: 'mother_maiden_name', label: "Mother's Maiden Name", required: true, input: 'text', section: "Mother's Details" },
  { key: 'mother_state_of_origin', label: "Mother's State of Origin", required: true, input: 'text', section: "Mother's Details" },
  { key: 'mother_lga_of_origin', label: "Mother's LGA of Origin", required: true, input: 'text', section: "Mother's Details" },
  { key: 'mother_town_village_of_origin', label: "Mother's Town/Village of Origin", required: true, input: 'text', section: "Mother's Details" },

  { key: 'clean_picture', label: 'Upload Clean Picture', required: true, input: 'image', section: 'Photo' }
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
        label: 'Birth Attestation \u2014 NPC Birth Attestation & Instant approval',
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

export async function getBirthAttestationPrice() {
  const row = await getOrCreatePricingRow();
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

/** Renders exactly what the customer submitted into a PDF - the document an
 *  admin opens to manually process the attestation with NPC, and the copy
 *  the customer can re-download from their own history. */
function renderBirthAttestationPdf(params: { reference: string; values: Record<string, unknown>; submittedAt: Date }): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text('MARIA Digital Solutions \u2014 Birth Attestation Request', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555').text('NPC Birth Attestation & Instant approval', { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text('Reference: ', { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text('Submitted: ', { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);

    let currentSection = '';
    for (const field of BIRTH_ATTESTATION_FIELDS) {
      // The photo is embedded as an actual image further down, never
      // printed as a wall of base64 text.
      if (field.input === 'image') continue;

      if (field.section && field.section !== currentSection) {
        currentSection = field.section;
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0b2f73').text(currentSection);
        doc.fillColor('#000');
        doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ddd').stroke();
        doc.moveDown(0.4);
      }

      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(9.5).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    const imageField = BIRTH_ATTESTATION_FIELDS.find((f) => f.input === 'image');
    if (imageField) {
      const raw = params.values[imageField.key];
      if (typeof raw === 'string' && raw.startsWith('data:image/')) {
        try {
          const base64 = raw.slice(raw.indexOf(',') + 1);
          const buffer = Buffer.from(base64, 'base64');
          doc.moveDown(0.6);
          doc.font('Helvetica-Bold').fontSize(10).text(`${imageField.label}:`);
          doc.moveDown(0.3);
          doc.image(buffer, { fit: [240, 240] });
        } catch {
          doc.font('Helvetica').fontSize(9).fillColor('#a00').text(`${imageField.label}: could not be embedded (invalid image data)`);
        }
      }
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a submission record only, not an NPC-issued document. Processed manually by an admin.', { align: 'left' });

    doc.end();
  });
}

export type SubmitBirthAttestationResult = { reference: string; balanceAfter: number };

export async function submitBirthAttestationRequest(params: {
  userId: string;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitBirthAttestationResult> {
  const price = await getBirthAttestationPrice();

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.BIRTH_ATTESTATION,
    description: 'Birth Attestation \u2014 NPC Birth Attestation & Instant approval',
    metadata: {
      service: SERVICE_KEY,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // No provider was actually paid yet - an admin processes this by hand with NPC.
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderBirthAttestationPdf({
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

export type BirthAttestationHistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

export async function listBirthAttestationHistory(params: { userId: string }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      type: TransactionType.BIRTH_ATTESTATION,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return transactions.map((transaction): BirthAttestationHistoryEntry => {
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

/** Called from the "Complete Birth Attestation" admin action once NPC has
 *  actually processed it. No wallet movement - the customer was already
 *  charged at submit time. Rejection uses the existing generic
 *  refundWallet()/"reverse" admin action. */
/** Admin-only: leaves a free-text progress note visible to the customer on
 *  their Birth Attestation history, without changing the transaction's
 *  status. Same shape as cac.service.ts's updateCacProgressNotes(). */
export async function updateBirthAttestationProgressNotes(params: { transactionId: string; notes: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.BIRTH_ATTESTATION) {
    throw new ApiError(404, 'Birth Attestation transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { metadata: { ...metadata, progress_notes: params.notes } as Prisma.InputJsonValue }
  });
}

/** Called from the manage page once NPC has actually issued the attestation
 *  - attaches that final document (same mergeSealedPII approach as
 *  cac.service.ts's completeCacRequest()) and marks the request SUCCESS. No
 *  wallet movement - the customer was already charged at submit time.
 *  Rejection still uses the existing generic refundWallet()/"reverse"
 *  admin action. */
export async function completeBirthAttestation(params: { transactionId: string; attestationPdfBase64: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.BIRTH_ATTESTATION) {
    throw new ApiError(404, 'Birth Attestation transaction not found', 'TRANSACTION_NOT_FOUND');
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
        pii: mergeSealedPII(metadata.pii, { attestation_pdf_base64: params.attestationPdfBase64 })
      } as Prisma.InputJsonValue
    }
  });
}

/** Decrypts the sealed PII (submitted values, the auto-generated submission
 *  PDF, and - once completed - the final NPC attestation document) for the
 *  admin's manage page. Never call this from a user-facing endpoint. */
export function decryptBirthAttestationPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string; attestation_pdf_base64?: string }>(metadata?.pii);
}
