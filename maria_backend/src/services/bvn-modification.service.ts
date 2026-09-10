import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';
import { purchaseBvnSlip, purchaseNinByNin } from './verification.service.js';

/**
 * BVN Modification — same manual pattern as NIN Modification
 * (nin-modification.service.ts), for BVN instead: there is no provider API
 * for updating a BVN's details, so submitBvnModificationRequest() debits
 * the wallet, generates a PDF of exactly what the customer submitted, and
 * leaves the transaction PENDING. An admin then processes the change by
 * hand (bank/NIBSS agent portal) and, from the Transaction admin page,
 * either marks it complete (completeBvnModification()) or rejects it (the
 * existing generic "reverse" action, which refunds).
 *
 * Every type asks for the enrollment type (agency or a named bank)
 * alongside the BVN itself, since that's the minimum an agent portal needs
 * to actually locate and verify the record before changing anything on it.
 */
export const BVN_MODIFICATION_TYPES = [
  'update_name',
  'update_phone',
  'update_dob',
  'update_address',
  'update_name_dob',
  'update_name_phone',
  'update_name_address',
  'update_dob_phone'
] as const;

export type BvnModificationType = (typeof BVN_MODIFICATION_TYPES)[number];

export type BvnModificationFieldInput = 'text' | 'date' | 'phone' | 'email' | 'bvn' | 'nin' | 'image' | 'select';

export type BvnModificationField = {
  key: string;
  label: string;
  required: boolean;
  input: BvnModificationFieldInput;
  /** Only for input: 'select'. */
  options?: string[];
  /** Only rendered/required when the named field currently holds `value` -
   *  e.g. `bank_name` only makes sense once `enrollment_type` is "Bank".
   *  The frontend is responsible for the show/hide; the backend schema
   *  (routes/bvn-modification.routes.ts) makes the field itself optional
   *  and validates the conditional requirement separately. */
  dependsOn?: { key: string; value: string };
};

type BvnModificationTypeConfig = {
  id: BvnModificationType;
  title: string;
  price: number;
  fields: BvnModificationField[];
};

export const BVN_MODIFICATION_BANKS = [
  'Micro Finance Bank',
  'First Bank',
  'Access Bank',
  'Heritage Bank',
  'Enterprise Bank',
  'BOA Bank',
  'LAPO Bank',
  'NIBSS'
] as const;

// Every type starts with these - the minimum an agent portal needs to
// locate and verify the record before changing anything on it, plus proof
// of identity (the NIN and a photo of the National ID card) so an admin can
// actually confirm the requester is who they say they are before re-keying
// anything. "Bank Name" only appears once "Bank" is chosen as the
// enrollment type (an agency enrollment has no associated bank) - see
// `dependsOn` above.
const identifyingFields: BvnModificationField[] = [
  { key: 'bvn', label: 'BVN Number', required: true, input: 'bvn' },
  { key: 'nin', label: 'NIN Number', required: true, input: 'nin' },
  { key: 'id_card_image', label: 'National ID Card (photo)', required: true, input: 'image' },
  { key: 'enrollment_type', label: 'Enrollment Type', required: true, input: 'select', options: ['Agency', 'Bank'] },
  {
    key: 'bank_name',
    label: 'Bank Name',
    required: true,
    input: 'select',
    options: [...BVN_MODIFICATION_BANKS],
    dependsOn: { key: 'enrollment_type', value: 'Bank' }
  }
];

const nameFields: BvnModificationField[] = [
  { key: 'new_first_name', label: 'New First Name', required: true, input: 'text' },
  { key: 'new_last_name', label: 'New Last Name', required: true, input: 'text' },
  { key: 'new_middle_name', label: 'New Middle Name', required: false, input: 'text' }
];
const phoneFields: BvnModificationField[] = [
  { key: 'new_phone_number', label: 'New Phone Number', required: true, input: 'phone' },
  { key: 'second_phone_number', label: 'Second Phone Number', required: false, input: 'phone' }
];
const dobFields: BvnModificationField[] = [{ key: 'new_date_of_birth', label: 'New Date of Birth', required: true, input: 'date' }];
const addressFields: BvnModificationField[] = [
  { key: 'new_address', label: 'New Address', required: true, input: 'text' },
  { key: 'new_state', label: 'State', required: true, input: 'text' },
  { key: 'new_lga', label: 'L.G.A', required: true, input: 'text' }
];

export const BVN_MODIFICATION_CONFIG: Record<BvnModificationType, BvnModificationTypeConfig> = {
  update_name: { id: 'update_name', title: 'Update Name', price: 5000, fields: [...identifyingFields, ...nameFields] },
  update_phone: { id: 'update_phone', title: 'Update Phone Number', price: 3500, fields: [...identifyingFields, ...phoneFields] },
  update_dob: { id: 'update_dob', title: 'Update Date of Birth', price: 5000, fields: [...identifyingFields, ...dobFields] },
  update_address: { id: 'update_address', title: 'Update Address', price: 3500, fields: [...identifyingFields, ...addressFields] },
  update_name_dob: {
    id: 'update_name_dob',
    title: 'Update Name & DOB',
    price: 8000,
    fields: [...identifyingFields, ...nameFields, ...dobFields]
  },
  update_name_phone: {
    id: 'update_name_phone',
    title: 'Update Name & Phone',
    price: 7500,
    fields: [...identifyingFields, ...nameFields, ...phoneFields]
  },
  update_name_address: {
    id: 'update_name_address',
    title: 'Update Name & Address',
    price: 7500,
    fields: [...identifyingFields, ...nameFields, ...addressFields]
  },
  update_dob_phone: {
    id: 'update_dob_phone',
    title: 'Update DOB & Phone',
    price: 7500,
    fields: [...identifyingFields, ...dobFields, ...phoneFields]
  }
};

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

function serviceKeyFor(type: BvnModificationType) {
  return `BVN_MODIFICATION_${type.toUpperCase()}`;
}

/** Same plain-findUnique-then-conditional-create shape as
 *  getOrCreatePricingRow() in nin-modification.service.ts - never resets an
 *  admin's already-configured price back to the default. */
async function getOrCreatePricingRow(type: BvnModificationType) {
  const config = BVN_MODIFICATION_CONFIG[type];
  const service = serviceKeyFor(type);
  const existing = await prisma.servicePricing.findUnique({ where: { service } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service,
        provider: 'manual',
        label: `BVN Modification \u2014 ${config.title}`,
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

export async function getBvnModificationPrice(type: BvnModificationType) {
  const row = await getOrCreatePricingRow(type);
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

/** Public price list, keyed by modification type id - never throws on a disabled service. */
export async function listBvnModificationPrices() {
  const rows = await Promise.all(BVN_MODIFICATION_TYPES.map((type) => getOrCreatePricingRow(type)));
  return rows.map((row, index) => ({
    type: BVN_MODIFICATION_TYPES[index],
    title: BVN_MODIFICATION_CONFIG[BVN_MODIFICATION_TYPES[index]].title,
    unitPrice: koboToNaira(row.sellingPriceKobo ?? row.providerCostKobo),
    isActive: row.isActive
  }));
}

/** Renders exactly what the customer submitted into a one-page PDF - the
 *  document an admin opens to manually process the change, and the copy
 *  the customer can re-download from their own history. */
function renderBvnModificationPdf(params: {
  reference: string;
  type: BvnModificationType;
  fields: BvnModificationField[];
  values: Record<string, unknown>;
  submittedAt: Date;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const config = BVN_MODIFICATION_CONFIG[params.type];

    doc.fontSize(16).font('Helvetica-Bold').text('MARIA Digital Solutions \u2014 BVN Modification Request', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555').text(config.title, { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text('Reference: ', { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text('Submitted: ', { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    for (const field of params.fields) {
      // The ID card photo gets embedded as an actual image further down,
      // never printed as a wall of base64 text.
      if (field.input === 'image') continue;
      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(10).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    const imageField = params.fields.find((f) => f.input === 'image');
    if (imageField) {
      const raw = params.values[imageField.key];
      if (typeof raw === 'string' && raw.startsWith('data:image/')) {
        try {
          const base64 = raw.slice(raw.indexOf(',') + 1);
          const buffer = Buffer.from(base64, 'base64');
          doc.moveDown(0.5);
          doc.font('Helvetica-Bold').fontSize(10).text(`${imageField.label}:`);
          doc.moveDown(0.3);
          doc.image(buffer, { fit: [240, 240] });
        } catch {
          doc.font('Helvetica').fontSize(9).fillColor('#a00').text(`${imageField.label}: could not be embedded (invalid image data)`);
        }
      } else {
        doc.font('Helvetica-Bold').fontSize(10).text(`${imageField.label}: `, { continued: true });
        doc.font('Helvetica').text('\u2014');
      }
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a submission record only, not a bank/NIBSS-issued confirmation. Processed manually by an admin.', { align: 'left' });

    doc.end();
  });
}

export type SubmitBvnModificationResult = { reference: string; balanceAfter: number };

export async function submitBvnModificationRequest(params: {
  userId: string;
  type: BvnModificationType;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitBvnModificationResult> {
  const config = BVN_MODIFICATION_CONFIG[params.type];
  const price = await getBvnModificationPrice(params.type);
  const service = serviceKeyFor(params.type);

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.BVN_MODIFICATION,
    description: `BVN Modification \u2014 ${config.title}`,
    metadata: {
      service,
      modification_type: params.type,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // No provider was actually paid yet - an admin processes this by hand.
    // Same reasoning as NIN Modification's costKobo.
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderBvnModificationPdf({
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

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type BvnModificationHistoryEntry = {
  reference: string;
  status: string;
  created_at: string;
  pdf_base64: string | null;
  modification_type: string | null;
};

export async function listBvnModificationHistory(params: { userId: string; type?: BvnModificationType }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    // A modification is a manual/asynchronous service. Do not expose a
    // pending request as a completed recent activity; begin its seven-day
    // visibility period only when completeBvnModification() sets SUCCESS.
    where: {
      userId: params.userId,
      type: TransactionType.BVN_MODIFICATION,
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
    .map((transaction): BvnModificationHistoryEntry => {
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
 * manually processed the change. No wallet movement - the customer was
 * already charged at submit time. Rejection uses the existing generic
 * refundWallet()/"reverse" admin action instead of a dedicated function
 * here, since it already does exactly what a rejection needs.
 */
export async function completeBvnModification(params: { transactionId: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.BVN_MODIFICATION) {
    throw new ApiError(404, 'BVN Modification transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending modification request can be marked complete', 'INVALID_STATUS');
  }
  return prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.SUCCESS } });
}

/** Decrypts the sealed PII (including the generated PDF) for the admin's PDF-download route. Never call this from a user-facing endpoint. */
export function decryptBvnModificationPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string }>(metadata?.pii);
}

// ── "Not sure what's wrong?" BVN/NIN match check ────────────────
//
// A customer often knows their BVN details are wrong somehow, but not
// exactly which field - or that BOTH a name AND a date of birth need
// fixing, when they only came in expecting one. Before picking a
// modification type, they can instead have the platform pull both their
// BVN slip and their NIN slip (each a REAL, separately-priced Techhub
// purchase - reusing purchaseBvnSlip/purchaseNinByNin from
// verification.service.ts exactly as the BVN Verification and NIN
// Verification pages do, so this costs whatever those already cost, not a
// separate fee) and compare the date of birth on each.
//
// Techhub doesn't document a single fixed key name for "date of birth"
// across every endpoint response, so `extractDob` below tries a handful of
// the field-name variants actually seen in the wild rather than assuming
// one. If neither slip's data contains a recognisable DOB field at all, the
// result is reported as "couldn't compare automatically" rather than a
// silent false "match" - the customer is shown both raw records instead
// and asked to compare by eye.

const DOB_KEY_CANDIDATES = ['dob', 'date_of_birth', 'dateofbirth', 'birthdate', 'birth_date'];

function extractDob(userData: Record<string, unknown> | undefined | null): string | null {
  if (!userData) return null;
  for (const [key, value] of Object.entries(userData)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
    if (DOB_KEY_CANDIDATES.some((candidate) => normalizedKey === candidate.replace(/[\s_-]/g, ''))) {
      return value.trim();
    }
  }
  return null;
}

/** Loose equality for two DOB strings that might be formatted differently
 *  (e.g. "1994-05-01" vs "01-May-1994") - compares only the digit
 *  characters, which is resilient to separator/month-name/order
 *  differences without trying to fully parse every possible date format
 *  Techhub's various endpoints might return. */
function dobsLooselyMatch(a: string, b: string): boolean {
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  if (!digitsA || !digitsB) return false;
  const sortedA = digitsA.split('').sort().join('');
  const sortedB = digitsB.split('').sort().join('');
  return digitsA === digitsB || sortedA === sortedB;
}

export type BvnNinMatchResult = {
  bvn_reference: string;
  nin_reference: string;
  bvn_date_of_birth: string | null;
  nin_date_of_birth: string | null;
  comparable: boolean;
  dob_matches: boolean | null;
  suggested_types: BvnModificationType[];
  bvn_user_data: Record<string, unknown> | undefined;
  nin_user_data: Record<string, unknown> | undefined;
};

export async function verifyBvnNinMatch(params: { userId: string; bvn: string; nin: string; idempotencyKey?: string }): Promise<BvnNinMatchResult> {
  // Cheapest tier of each, since this check only needs the underlying data
  // fields (not a premium-format slip image) to compare a date of birth.
  const [bvnResult, ninResult] = await Promise.all([
    purchaseBvnSlip({ userId: params.userId, bvn: params.bvn, tier: 'standard', idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:bvn` : undefined }),
    purchaseNinByNin({ userId: params.userId, nin: params.nin, tier: 'regular', idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:nin` : undefined })
  ]);

  if (!bvnResult.status) throw new ApiError(422, bvnResult.message || 'Could not retrieve the BVN record', 'BVN_LOOKUP_FAILED');
  if (!ninResult.status) throw new ApiError(422, ninResult.message || 'Could not retrieve the NIN record', 'NIN_LOOKUP_FAILED');

  const bvnDob = extractDob(bvnResult.userData);
  const ninDob = extractDob(ninResult.userData);
  const comparable = Boolean(bvnDob && ninDob);
  const dobMatches = comparable ? dobsLooselyMatch(bvnDob as string, ninDob as string) : null;

  const suggestedTypes: BvnModificationType[] = comparable && dobMatches === false ? ['update_dob', 'update_name_dob', 'update_dob_phone'] : [];

  return {
    bvn_reference: bvnResult.reference,
    nin_reference: ninResult.reference,
    bvn_date_of_birth: bvnDob,
    nin_date_of_birth: ninDob,
    comparable,
    dob_matches: dobMatches,
    suggested_types: suggestedTypes,
    bvn_user_data: bvnResult.userData,
    nin_user_data: ninResult.userData
  };
}
