import { Router, type Request } from 'express';
import { z } from 'zod';
import { TransactionType } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { GEO_POLITICAL_ZONES, submitBvnLicense, type BvnLicenseInput } from '../services/bvn-license-onboarding.service.js';
import { CAC_TYPES, listCacHistory, listCacPrices, submitCacRequest, type CacType, type CacApplicantDetails } from '../services/cac.service.js';
import { listTinCertificateHistory, listTinCertificatePrices, submitTinCertificateRequest } from '../services/tin-certificate.service.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import { prisma } from '../lib/prisma.js';
import {
  checkBvnRetrievalStatus,
  checkDelinkingStatus,
  checkIpeClearanceStatus,
  checkNinValidationStatus,
  checkPersonalizationStatus,
  listServiceTickets,
  listVerificationPrices,
  purchaseBvnSlip,
  purchaseNinByDemographic,
  purchaseNinByNin,
  purchaseNinByPhone,
  submitBvnRetrieval,
  submitDelinking,
  submitIpeClearance,
  submitNinValidation,
  submitPersonalization
} from '../services/verification.service.js';

export const verificationRoutes = Router();

verificationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

const ninSlipTier = z.enum(['premium', 'standard', 'regular', 'vnin']);
const ninPhoneSlipTier = z.enum(['premium', 'standard', 'regular']);
const bvnSlipTier = z.enum(['premium', 'standard']);
const ninValidationType = z.enum([
  'nin_validation',
  'no_record',
  'sim',
  'modification',
  'photo_error',
  'bank_validation',
  'v.nin_validation',
  'update_records'
]);

function slipResponse(result: Awaited<ReturnType<typeof purchaseNinByNin>>) {
  return {
    status: result.status,
    message: result.message,
    data: {
      reference: result.reference,
      user_data: result.userData ?? null,
      pdf_base64: result.pdfBase64 ?? null,
      pdf_url: result.pdfUrl ?? null,
      balance_after: result.balanceAfter
    }
  };
}

// ── Prices ───────────────────────────────────────────────────────

verificationRoutes.get('/prices', async (_req, res) => {
  const prices = await listVerificationPrices();
  res.json({ status: true, data: prices });
});

verificationRoutes.post('/bvn/license-onboarding', async (req, res) => {
  const body = z.object({
    agent_location: z.string().trim().min(2),
    bvn: z.string().trim().length(11),
    nin: z.string().trim().length(11),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    middle_name: z.string().trim().max(100).optional(),
    phone_number: z.string().trim().length(11),
    date_of_birth: z.string().trim().min(8),
    email: z.string().trim().email(),
    alternative_email: z.string().trim().email().optional().or(z.literal('')),
    account_number: z.string().trim().min(10).max(12),
    bank_name: z.string().trim().min(2),
    account_name: z.string().trim().min(2),
    address: z.string().trim().min(3),
    city: z.string().trim().min(2),
    lga: z.string().trim().min(2),
    state_of_residence: z.string().trim().min(2),
    geo_political_zone: z.enum(GEO_POLITICAL_ZONES), consent: z.literal(true), ...pinField
  }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin: _pin, ...values } = body;
  // Zod has already validated the required fields above; this intermediate
  // assertion accounts for the optional-property inference of the parsed body.
  const result = await submitBvnLicense({ userId: req.user!.id, values: values as unknown as BvnLicenseInput, idempotencyKey: idempotencyKeyFrom(req) });
  res.json({ status: true, data: result });
});

verificationRoutes.get('/bvn/license-onboarding/history', async (req, res) => {
  // A manual onboarding request may sit PENDING for days while an admin
  // processes it - unlike GET /history above, this deliberately does NOT
  // filter to status: SUCCESS only, so a customer can see (and download the
  // submission PDF for) a request that's still in progress, not just
  // completed ones. Same reasoning as listServiceTickets() in
  // verification.service.ts, just for the BVN_LICENSE_ONBOARDING
  // transaction type specifically, which that helper doesn't cover.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.transaction.findMany({
    where: {
      userId: req.user!.id,
      type: TransactionType.BVN_LICENSE_ONBOARDING,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: 'desc' }, take: 20
  });
  res.json({ status: true, data: rows.map((tx) => {
    const metadata = tx.metadata as Record<string, unknown> | null;
    return {
      reference: tx.reference,
      tracking_id: metadata?.tracking_id ?? null,
      status: tx.status.toLowerCase(),
      amount: Number(tx.amountKobo) / 100,
      pdf_base64: typeof metadata?.pdf_base64 === 'string' ? metadata.pdf_base64 : null,
      created_at: tx.createdAt.toISOString()
    };
  }) });
});

// Whitelisted identity preview for the transaction's own owner. Every
// caller of toSlipHistoryEntry below is already scoped to
// `where: { userId: req.user!.id }`, the exact same boundary that already
// gates pdf_base64/pdf_url access - so surfacing these few named fields for
// an in-app preview does not open any access this owner didn't already
// have via the downloadable slip PDF itself; it just saves them from
// opening that PDF to see who/what they verified. Deliberately a fixed,
// named whitelist (never the raw provider payload) so a provider field we
// don't recognise can't leak through unreviewed.
// A short, non-technical explanation for a failed/reversed request - the
// actual provider error text isn't persisted (see purchaseSlip() in
// verification.service.ts), so this is deliberately generic rather than
// guessed from data we don't have.
function friendlyOutcomeMessage(status: string): string | null {
  if (status === 'failed') return 'This request could not be completed by the verification provider. Your payment has been refunded to your wallet.';
  if (status === 'reversed') return 'This request was reversed. Your payment has been refunded to your wallet.';
  return null;
}

// Compact row returned by verification history lists. The document itself is
// fetched from the owner-scoped transaction document endpoint only on demand.
function toSlipHistoryEntry(transaction: { id: string; reference: string; status: string; updatedAt: Date; service: string | null; ticket_id?: string | null }) {
  return {
    id: transaction.id,
    reference: transaction.reference,
    status: transaction.status.toLowerCase(),
    created_at: transaction.updatedAt.toISOString(),
    service: transaction.service,
    has_document: true,
    document_url: `/transactions/${encodeURIComponent(transaction.id)}/document`,
    ticket_id: transaction.ticket_id ?? null,
    identity: null,
    failure_message: null
  };
}

// A customer can retrieve a completed verification result for seven days.
verificationRoutes.get('/history', async (req, res) => {
  const service = z.string().trim().min(1).max(60).parse(req.query.service);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.$queryRaw<Array<{ id: string; reference: string; status: string; updatedAt: Date; service: string | null; ticket_id: string | null }>>`
    SELECT "id", "reference", "status"::text AS "status", "updatedAt",
      "metadata"->>'service' AS "service", "metadata"->>'ticket_id' AS "ticket_id"
    FROM "Transaction"
    WHERE "userId" = ${req.user!.id} AND "status"::text = 'SUCCESS'
      AND "updatedAt" >= ${since}
      AND "type"::text IN ('NIN_VERIFICATION','BVN_VERIFICATION','IDENTITY_SERVICE_REQUEST')
      AND "metadata"->>'service' = ${service}
    ORDER BY "updatedAt" DESC LIMIT 10
  `;
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data: transactions.map(toSlipHistoryEntry) });
});

verificationRoutes.get('/history/all', async (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.$queryRaw<Array<{ id: string; reference: string; status: string; updatedAt: Date; service: string | null; ticket_id: string | null }>>`
    SELECT "id", "reference", "status"::text AS "status", "updatedAt",
      "metadata"->>'service' AS "service", "metadata"->>'ticket_id' AS "ticket_id"
    FROM "Transaction"
    WHERE "userId" = ${req.user!.id} AND "status"::text = 'SUCCESS'
      AND "updatedAt" >= ${since}
      AND "type"::text IN ('NIN_VERIFICATION','BVN_VERIFICATION','IDENTITY_SERVICE_REQUEST')
    ORDER BY "updatedAt" DESC LIMIT 50
  `;
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data: transactions.map(toSlipHistoryEntry) });
});
verificationRoutes.get('/service-history', async (req, res) => {
  // Project only public history fields. PII may contain multi-megabyte files,
  // so the list query deliberately never loads the sealed PII blob.
  const transactions = await prisma.$queryRaw<Array<{
    id: string; reference: string; status: string; type: string; service: string | null;
    description: string; amountKobo: bigint; createdAt: Date; updatedAt: Date;
    progress_notes: string | null; ticket_id: string | null;
  }>>`
    SELECT "id", "reference", "status"::text AS "status", "type"::text AS "type",
      "metadata"->>'service' AS "service", "description", "amountKobo", "createdAt", "updatedAt",
      "metadata"->>'progress_notes' AS "progress_notes", "metadata"->>'ticket_id' AS "ticket_id"
    FROM "Transaction"
    WHERE "userId" = ${req.user!.id}
      AND "type"::text IN ('DATA_PURCHASE','AIRTIME_PURCHASE','ELECTRICITY_PURCHASE','CABLE_PURCHASE',
        'RESULT_PIN','SMS','WITHDRAWAL','NIN_VERIFICATION','BVN_VERIFICATION','IDENTITY_SERVICE_REQUEST',
        'NIN_MODIFICATION','BVN_LICENSE_ONBOARDING','CAC_SERVICE_REQUEST','BVN_MODIFICATION',
        'BIRTH_ATTESTATION','NEWSPAPER_PUBLICATION','BVN_CRM','TIN_CERTIFICATE_REQUEST')
    ORDER BY "createdAt" DESC
    LIMIT 100
  `;
  const downloadableTypes = new Set(['NIN_VERIFICATION', 'BVN_VERIFICATION', 'IDENTITY_SERVICE_REQUEST', 'NIN_MODIFICATION', 'BVN_LICENSE_ONBOARDING', 'CAC_SERVICE_REQUEST', 'BVN_MODIFICATION', 'BIRTH_ATTESTATION', 'NEWSPAPER_PUBLICATION', 'BVN_CRM', 'TIN_CERTIFICATE_REQUEST']);
  const data = transactions.map((tx) => {
    const status = tx.status.toLowerCase();
    const hasDocument = status === 'success' && downloadableTypes.has(tx.type);
    return {
      id: tx.id, reference: tx.reference, status, type: tx.type, service: tx.service,
      description: tx.description, amount: Number(tx.amountKobo) / 100,
      created_at: tx.createdAt.toISOString(), updated_at: tx.updatedAt.toISOString(),
      progress_notes: tx.progress_notes, ticket_id: tx.ticket_id, has_document: hasDocument,
      document_url: hasDocument ? `/transactions/${encodeURIComponent(tx.id)}/document` : null,
      identity: null, failure_message: friendlyOutcomeMessage(status)
    };
  });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});
verificationRoutes.post('/nin/by-nin', async (req, res) => {
  const body = z.object({ nin: z.string().trim().length(11), tier: ninSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByNin({
    userId: req.user!.id,
    nin: body.nin,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/nin/by-phone', async (req, res) => {
  const body = z.object({ phone: z.string().trim().length(11), tier: ninPhoneSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByPhone({
    userId: req.user!.id,
    phone: body.phone,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/nin/by-demographic', async (req, res) => {
  const body = z
    .object({
      firstname: z.string().trim().min(1),
      lastname: z.string().trim().min(1),
      dob: z.string().trim().min(1),
      gender: z.enum(['MALE', 'FEMALE']).optional(),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByDemographic({
    userId: req.user!.id,
    firstname: body.firstname,
    lastname: body.lastname,
    dob: body.dob,
    gender: body.gender,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/bvn/slip', async (req, res) => {
  const body = z.object({ bvn: z.string().trim().length(11), tier: bvnSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseBvnSlip({
    userId: req.user!.id,
    bvn: body.bvn,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

// ── Async services (submit + poll) ────────────────────────────────

verificationRoutes.post('/delinking', async (req, res) => {
  const body = z.object({ nin: z.string().trim().length(11), email: z.string().trim().email(), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitDelinking({
    userId: req.user!.id,
    nin: body.nin,
    email: body.email,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/delinking/:ticketId', async (req, res) => {
  const result = await checkDelinkingStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/nin-validation', async (req, res) => {
  const body = z
    .object({ nin: z.string().trim().length(11), validation_type: ninValidationType.optional(), ...pinField })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitNinValidation({
    userId: req.user!.id,
    nin: body.nin,
    validationType: body.validation_type,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/nin-validation/:ticketId', async (req, res) => {
  const result = await checkNinValidationStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/personalization', async (req, res) => {
  const body = z.object({ tracking_id: z.string().trim().min(1).max(50), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitPersonalization({
    userId: req.user!.id,
    trackingId: body.tracking_id,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/personalization/:ticketId', async (req, res) => {
  const result = await checkPersonalizationStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

// ── Ticket tracking table (Personalization, BVN Retrieval, IPE, Validation) ──
// See listServiceTickets in verification.service.ts for why this is separate
// from GET /history: it includes PENDING requests, not just SUCCESS ones.
verificationRoutes.get('/tickets', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Accepts either one service key or a comma-separated list. Validation has
  // four separate service keys (one per detail type) but is shown to the
  // customer as a single "recent requests" table across all of them - see
  // ValidationPage.tsx, which passes all four joined with commas.
  const raw = z.string().trim().min(1).max(300).parse(req.query.service);
  const services = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const data = await listServiceTickets(req.user!.id, services);
  res.json({ status: true, data });
});

verificationRoutes.post('/bvn-retrieval', async (req, res) => {
  const body = z
    .object({
      first_name: z.string().trim().min(1),
      last_name: z.string().trim().min(1),
      phone_number: z.string().trim().length(11),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitBvnRetrieval({
    userId: req.user!.id,
    firstName: body.first_name,
    lastName: body.last_name,
    phoneNumber: body.phone_number,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/bvn-retrieval/:ticketId', async (req, res) => {
  const result = await checkBvnRetrievalStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/ipe-clearance', async (req, res) => {
  const body = z.object({ tracking_id: z.string().trim().min(1).max(20), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitIpeClearance({
    userId: req.user!.id,
    trackingId: body.tracking_id,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/ipe-clearance/:ticketId', async (req, res) => {
  const result = await checkIpeClearanceStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

// ── CAC Services (manual — no provider API) ────────────────────────

verificationRoutes.get('/tin/prices', async (_req, res) => {
  const data = await listTinCertificatePrices();
  res.json({ status: true, data });
});

verificationRoutes.post('/tin', async (req, res) => {
  const body = z.discriminatedUnion('verification_type', [
    z.object({
      verification_type: z.literal('individual'),
      nin_number: z.string().trim().regex(/^\d{11}$/),
      first_name: z.string().trim().min(1).max(100),
      surname: z.string().trim().min(1).max(100),
      date_of_birth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      ...pinField
    }),
    z.object({
      verification_type: z.literal('corporate'),
      rc_number: z.string().trim().min(1).max(30),
      company_name: z.string().trim().min(2).max(200),
      organization_type: z.enum(['Business Name', 'Company', 'Incorporated Trustee', 'Limited Partnership', 'Limited Liability Partnership']),
      ...pinField
    })
  ]).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const details = body.verification_type === 'individual'
    ? {
        type: 'individual' as const,
        nin_number: body.nin_number,
        first_name: body.first_name,
        surname: body.surname,
        date_of_birth: body.date_of_birth
      }
    : {
        type: 'corporate' as const,
        rc_number: body.rc_number,
        company_name: body.company_name,
        organization_type: body.organization_type
      };
  const result = await submitTinCertificateRequest({
    userId: req.user!.id,
    details,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/tin/history', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const data = await listTinCertificateHistory(req.user!.id);
  res.json({ status: true, data });
});

verificationRoutes.get('/cac/prices', async (_req, res) => {
  const prices = await listCacPrices();
  res.json({ status: true, data: prices });
});

verificationRoutes.post('/cac', async (req, res) => {
  const body = z
    .object({
      cac_type: z.enum(CAC_TYPES),
      proposed_name_1: z.string().trim().min(2).max(200),
      proposed_name_2: z.string().trim().max(200).optional(),
      business_nature: z.string().trim().min(2).max(300),
      business_address: z.string().trim().min(3).max(300),
      proprietor_full_name: z.string().trim().min(2).max(200),
      proprietor_phone: z.string().trim().length(11),
      proprietor_email: z.string().trim().email(),
      proprietor_residential_address: z.string().trim().min(3).max(300),
      proprietor_date_of_birth: z.string().trim().min(8),
      proprietor_gender: z.enum(['Male', 'Female']),
      proprietor_nin: z.string().trim().length(11),
      supporting_documents: z.array(z.object({
        label: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(200),
        mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
        base64: z.string().min(20).max(7_000_000)
      })).max(8).optional(),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin: _pin, cac_type, proposed_name_1, proposed_name_2, ...details } = body;
  const result = await submitCacRequest({
    userId: req.user!.id,
    type: cac_type as CacType,
    proposedName1: proposed_name_1,
    proposedName2: proposed_name_2,
    // The request schema validates these required applicant fields before this point.
    details: details as unknown as CacApplicantDetails,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/cac/history', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const data = await listCacHistory(req.user!.id);
  res.json({ status: true, data });
});
