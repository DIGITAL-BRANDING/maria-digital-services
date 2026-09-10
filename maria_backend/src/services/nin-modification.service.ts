import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * Techhub has no API for NIN Modification yet (confirmed against
 * techhubltd.co/nin_modifications.php directly) - so unlike every other
 * identity service in verification.service.ts, nothing is called here.
 * submitModificationRequest() debits the wallet, generates a PDF of exactly
 * what the customer submitted, and leaves the transaction PENDING. An admin
 * then re-keys the same data on techhubltd.co by hand and, from the
 * Transaction admin page, either marks it complete (completeModification())
 * or rejects it (the existing generic "reverse" action, which refunds).
 *
 * Prices below are Techhub's own listed prices for each modification type
 * (confirmed from their site) - selling price equals provider cost until an
 * admin sets a margin via ServicePricing, same DEFAULTS-fallback convention
 * as verification.service.ts.
 */
export const MODIFICATION_TYPES = [
  'update_name',
  'update_phone',
  'update_dob',
  'update_address',
  'update_name_dob',
  'update_name_phone'
] as const;

export type ModificationType = (typeof MODIFICATION_TYPES)[number];

export type ModificationFieldInput = 'text' | 'date' | 'phone' | 'nin' | 'select' | 'document';

export type ModificationField = {
  key: string;
  label: string;
  required: boolean;
  input: ModificationFieldInput;
  options?: string[];
};

type ModificationTypeConfig = {
  id: ModificationType;
  title: string;
  price: number;
  fields: ModificationField[];
};

const maritalStatusOptions = ['Single', 'Married', 'Divorced', 'Widowed'];
const educationLevelOptions = ['No Education', 'Primary', 'Secondary', 'Tertiary'];
const hospitalHouseOptions = ['Hospital', 'House'];

// The full demographic/parentage field set NIMC requires alongside any DOB
// change - shared verbatim between update_dob and update_name_dob (the two
// screenshots for these are otherwise identical past the name fields).
const dobSupportingFields: ModificationField[] = [
  { key: 'marital_status', label: 'Marital Status', required: true, input: 'select', options: maritalStatusOptions },
  { key: 'state_of_origin', label: 'State of Origin', required: true, input: 'text' },
  { key: 'lga_of_origin', label: 'L.G.A of Origin', required: true, input: 'text' },
  { key: 'village_town_of_origin', label: 'Village/Town of Origin', required: true, input: 'text' },
  { key: 'place_of_birth', label: 'Place of Birth', required: true, input: 'text' },
  { key: 'hospital_or_house', label: 'Hospital or House', required: true, input: 'select', options: hospitalHouseOptions },
  { key: 'resident_state', label: 'Resident State', required: true, input: 'text' },
  { key: 'resident_lga', label: 'Resident L.G.A', required: true, input: 'text' },
  { key: 'resident_village_town', label: 'Resident Village/Town', required: true, input: 'text' },
  { key: 'resident_address', label: 'Resident Address', required: true, input: 'text' },
  { key: 'level_of_education', label: 'Level of Education', required: true, input: 'select', options: educationLevelOptions },
  { key: 'phone_number', label: 'Phone Number', required: true, input: 'phone' },
  { key: 'state_of_birth', label: 'State of Birth', required: true, input: 'text' },
  { key: 'lga_of_birth', label: 'L.G.A of Birth', required: true, input: 'text' },
  { key: 'village_town_of_birth', label: 'Village/Town of Birth', required: false, input: 'text' },
  { key: 'father_surname', label: 'Father\u2019s Surname', required: true, input: 'text' },
  { key: 'father_firstname', label: 'Father\u2019s Firstname', required: true, input: 'text' },
  { key: 'father_state_of_origin', label: 'Father\u2019s State of Origin', required: false, input: 'text' },
  { key: 'father_lga_of_origin', label: 'Father\u2019s LGA of Origin', required: false, input: 'text' },
  { key: 'father_village_town_of_origin', label: 'Father\u2019s Village/Town of Origin', required: false, input: 'text' },
  { key: 'mother_surname', label: 'Mother\u2019s Surname', required: true, input: 'text' },
  { key: 'mother_firstname', label: 'Mother\u2019s Firstname', required: true, input: 'text' },
  { key: 'mother_maiden_name', label: 'Mother\u2019s Maiden Name', required: true, input: 'text' },
  { key: 'mother_state_of_origin', label: 'Mother\u2019s State of Origin', required: false, input: 'text' },
  { key: 'mother_lga_of_origin', label: 'Mother\u2019s LGA of Origin', required: false, input: 'text' },
  { key: 'mother_village_town_of_origin', label: 'Mother\u2019s Village/Town of Origin', required: false, input: 'text' },
  { key: 'document_base64', label: 'Upload Supporting Document (Attestation)', required: false, input: 'document' }
];

export const MODIFICATION_CONFIG: Record<ModificationType, ModificationTypeConfig> = {
  update_name: {
    id: 'update_name',
    title: 'Update Name',
    price: 5000,
    fields: [
      { key: 'first_name', label: 'First Name', required: true, input: 'text' },
      { key: 'last_name', label: 'Last Name', required: true, input: 'text' },
      { key: 'middle_name', label: 'Middle Name', required: false, input: 'text' },
      { key: 'nin', label: 'NIN Number', required: true, input: 'nin' }
    ]
  },
  update_phone: {
    id: 'update_phone',
    title: 'Update Phone Number',
    price: 5000,
    fields: [
      { key: 'nin', label: 'NIN Number', required: true, input: 'nin' },
      { key: 'new_phone_number', label: 'New Phone Number', required: true, input: 'phone' }
    ]
  },
  update_dob: {
    id: 'update_dob',
    title: 'Update Date of Birth',
    price: 50000,
    fields: [
      { key: 'nin', label: 'NIN Number', required: true, input: 'nin' },
      { key: 'new_dob', label: 'New Date Of Birth', required: true, input: 'date' },
      ...dobSupportingFields
    ]
  },
  update_address: {
    id: 'update_address',
    title: 'Update Address',
    price: 5000,
    fields: [
      { key: 'address_line1', label: 'Address Line 1', required: true, input: 'text' },
      { key: 'address_line2', label: 'Address Line 2', required: false, input: 'text' },
      { key: 'town_city', label: 'Town/City', required: true, input: 'text' },
      { key: 'postal_code', label: 'Postal Code', required: false, input: 'text' },
      { key: 'state', label: 'State', required: true, input: 'text' },
      { key: 'nin', label: 'NIN Number', required: true, input: 'nin' }
    ]
  },
  update_name_dob: {
    id: 'update_name_dob',
    title: 'Update Name & DOB',
    price: 55000,
    fields: [
      { key: 'nin', label: 'NIN No', required: true, input: 'nin' },
      { key: 'new_first_name', label: 'New First Name', required: true, input: 'text' },
      { key: 'new_last_name', label: 'New Last Name', required: true, input: 'text' },
      { key: 'new_middle_name', label: 'New Middle Name', required: false, input: 'text' },
      { key: 'new_dob', label: 'New Date Of Birth', required: true, input: 'date' },
      ...dobSupportingFields
    ]
  },
  update_name_phone: {
    id: 'update_name_phone',
    title: 'Update Name & Phone',
    price: 11000,
    fields: [
      { key: 'nin', label: 'NIN', required: true, input: 'nin' },
      { key: 'new_first_name', label: 'New First Name', required: true, input: 'text' },
      { key: 'new_last_name', label: 'New Last Name', required: true, input: 'text' },
      { key: 'new_middle_name', label: 'New Middle Name', required: false, input: 'text' },
      { key: 'new_phone_number', label: 'New Phone Number', required: true, input: 'phone' }
    ]
  }
};

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

function serviceKeyFor(type: ModificationType) {
  return `NIN_MODIFICATION_${type.toUpperCase()}`;
}

/**
 * Same plain-findUnique-then-conditional-create shape as
 * getOrCreateVerificationPricingRow() in verification.service.ts - never
 * resets an admin's already-configured price back to the Techhub default.
 */
async function getOrCreatePricingRow(type: ModificationType) {
  const config = MODIFICATION_CONFIG[type];
  const service = serviceKeyFor(type);
  const existing = await prisma.servicePricing.findUnique({ where: { service } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service,
        provider: 'techhub',
        label: `NIN Modification \u2014 ${config.title}`,
        providerCostKobo: priceToKobo(config.price)
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.servicePricing.findUniqueOrThrow({ where: { service } });
    }
    throw error;
  }
}

export async function getModificationPrice(type: ModificationType) {
  const row = await getOrCreatePricingRow(type);
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

/** Public price list, keyed by modification type id - never throws on a disabled service. */
export async function listModificationPrices() {
  const rows = await Promise.all(MODIFICATION_TYPES.map((type) => getOrCreatePricingRow(type)));
  return rows.map((row, index) => ({
    type: MODIFICATION_TYPES[index],
    title: MODIFICATION_CONFIG[MODIFICATION_TYPES[index]].title,
    unitPrice: koboToNaira(row.sellingPriceKobo ?? row.providerCostKobo),
    isActive: row.isActive
  }));
}

/**
 * Renders exactly what the customer submitted into a one-page-per-request
 * PDF, in the same field order shown on the form - this is the document an
 * admin opens to manually re-key the request on techhubltd.co, and the copy
 * the customer can re-download from their own history. Returns base64, same
 * convention as the Techhub-issued slip PDFs already stored under
 * metadata.pii.pdf_base64 in verification.service.ts.
 */
function renderModificationPdf(params: {
  reference: string;
  type: ModificationType;
  fields: ModificationField[];
  values: Record<string, unknown>;
  submittedAt: Date;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const config = MODIFICATION_CONFIG[params.type];

    doc.fontSize(16).font('Helvetica-Bold').text('MAJOR DATA-LINK \u2014 NIN Modification Request', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555').text(config.title, { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text(`Reference: `, { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text(`Submitted: `, { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    for (const field of params.fields) {
      const raw = params.values[field.key];
      if (field.input === 'document') {
        const hasDoc = typeof raw === 'string' && raw.trim().length > 0;
        doc.font('Helvetica-Bold').fontSize(10).text(`${field.label}: `, { continued: true });
        doc.font('Helvetica').text(hasDoc ? 'Attached (see admin panel \u2192 View PII)' : 'Not provided');
        continue;
      }
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(10).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#888').text(
      'This is a submission record only, not a NIMC-issued document. Processed manually against techhubltd.co until API integration is available.',
      { align: 'left' }
    );

    doc.end();
  });
}

export type SubmitModificationResult = { reference: string; balanceAfter: number };

export async function submitModificationRequest(params: {
  userId: string;
  type: ModificationType;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitModificationResult> {
  const config = MODIFICATION_CONFIG[params.type];
  const price = await getModificationPrice(params.type);
  const service = serviceKeyFor(params.type);

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.NIN_MODIFICATION,
    description: `NIN Modification \u2014 ${config.title}`,
    metadata: {
      service,
      modification_type: params.type,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // We haven't actually paid Techhub anything yet - the admin pays their
    // listed price when they manually process this on techhubltd.co, which
    // for now is the same number as what we charge (no markup configured).
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderModificationPdf({
    reference: debit.reference,
    type: params.type,
    fields: config.fields,
    values: params.values,
    submittedAt: debit.transaction.createdAt
  });

  await prisma.transaction.update({
    where: { id: debit.transaction.id },
    data: {
      metadata: {
        service,
        modification_type: params.type,
        unit_price: price.unitPrice,
        pii: sealPII({ ...params.values, pdf_base64: pdfBase64 })
      } as Prisma.InputJsonValue
    }
  });

  // Deliberately no recordProviderDebit() here (unlike purchaseSlip()/
  // submitAsyncService() in verification.service.ts) - no Techhub API call
  // has actually happened yet, so there is nothing to log to the provider
  // ledger until an admin completes the manual step.

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type ModificationHistoryEntry = {
  reference: string;
  status: string;
  created_at: string;
  pdf_base64: string | null;
  modification_type: string | null;
};

export async function listModificationHistory(params: { userId: string; type?: ModificationType }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    // A modification is a manual/asynchronous service. Do not expose a
    // pending request as a completed recent activity; begin its seven-day
    // visibility period only when completeModification() sets SUCCESS.
    where: {
      userId: params.userId,
      type: TransactionType.NIN_MODIFICATION,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return transactions
    .filter((transaction) => {
      if (!params.type) return true;
      const metadata = transaction.metadata as Record<string, unknown> | null;
      return metadata?.modification_type === params.type;
    })
    .map((transaction): ModificationHistoryEntry => {
      const metadata = transaction.metadata as Record<string, unknown> | null;
      const pii = openPII<{ pdf_base64?: string }>(metadata?.pii);
      return {
        reference: transaction.reference,
        status: transaction.status.toLowerCase(),
        created_at: transaction.updatedAt.toISOString(),
        pdf_base64: typeof pii?.pdf_base64 === 'string' ? pii.pdf_base64 : null,
        modification_type: typeof metadata?.modification_type === 'string' ? metadata.modification_type : null
      };
    });
}

/**
 * Called from the "Complete modification" admin action once the admin has
 * manually re-keyed the request on techhubltd.co and it went through. No
 * wallet movement - the customer was already charged at submit time.
 * Rejection uses the existing generic refundWallet()/"reverse" admin action
 * instead of a dedicated function here, since it already does exactly what
 * a rejection needs (mark REVERSED, credit the wallet back).
 */
export async function completeModification(params: { transactionId: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.NIN_MODIFICATION) {
    throw new ApiError(404, 'NIN Modification transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending modification request can be marked complete', 'INVALID_STATUS');
  }
  return prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.SUCCESS } });
}

/** Decrypts the sealed PII (including the generated PDF) for the admin's PDF-download route. Never call this from a user-facing endpoint. */
export function decryptModificationPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string }>(metadata?.pii);
}
