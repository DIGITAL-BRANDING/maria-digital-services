import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { mergeSealedPII, openPII, sealPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

export const TIN_REQUEST_TYPES = ['individual', 'corporate'] as const;
export type TinRequestType = (typeof TIN_REQUEST_TYPES)[number];

export type TinRequestDetails =
  | {
      type: 'individual';
      nin_number: string;
      first_name: string;
      surname: string;
      date_of_birth: string;
    }
  | {
      type: 'corporate';
      rc_number: string;
      company_name: string;
      organization_type: string;
    };

const TIN_CONFIG: Record<TinRequestType, { service: string; title: string; price: number }> = {
  individual: { service: 'TIN_INDIVIDUAL', title: 'Individual TIN Certificate', price: 400 },
  corporate: { service: 'TIN_CORPORATE', title: 'Corporate TIN Certificate', price: 500 }
};

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

async function getOrCreatePricingRow(type: TinRequestType) {
  const config = TIN_CONFIG[type];
  const existing = await prisma.servicePricing.findUnique({ where: { service: config.service } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service: config.service,
        provider: 'manual',
        label: config.title,
        providerCostKobo: priceToKobo(config.price)
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.servicePricing.findUniqueOrThrow({ where: { service: config.service } });
    }
    throw error;
  }
}

export async function listTinCertificatePrices() {
  return Promise.all(
    TIN_REQUEST_TYPES.map(async (type) => {
      const row = await getOrCreatePricingRow(type);
      return {
        type,
        title: TIN_CONFIG[type].title,
        unitPrice: koboToNaira(row.sellingPriceKobo ?? row.providerCostKobo),
        isActive: row.isActive
      };
    })
  );
}

export type SubmitTinRequestResult = { reference: string; balanceAfter: number };

export async function submitTinCertificateRequest(params: {
  userId: string;
  details: TinRequestDetails;
  idempotencyKey?: string;
}): Promise<SubmitTinRequestResult> {
  const config = TIN_CONFIG[params.details.type];
  const pricing = await getOrCreatePricingRow(params.details.type);
  if (!pricing.isActive) {
    throw new ApiError(422, `${pricing.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitPrice = koboToNaira(pricing.sellingPriceKobo ?? pricing.providerCostKobo);
  const debit = await debitWallet({
    userId: params.userId,
    amount: unitPrice,
    type: TransactionType.TIN_CERTIFICATE_REQUEST,
    description: config.title,
    metadata: {
      service: config.service,
      tin_type: params.details.type,
      unit_price: unitPrice,
      progress_notes: null,
      pii: sealPII(params.details)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    costKobo: pricing.providerCostKobo
  });

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type TinCertificateHistoryEntry = {
  reference: string;
  status: string;
  tin_type: string | null;
  amount: number;
  progress_notes: string | null;
  certificate_pdf_base64: string | null;
  created_at: string;
  updated_at: string;
};

type TinPII = TinRequestDetails & { certificate_pdf_base64?: string };

export async function listTinCertificateHistory(userId: string): Promise<TinCertificateHistoryEntry[]> {
  const transactions = await prisma.transaction.findMany({
    where: { userId, type: TransactionType.TIN_CERTIFICATE_REQUEST },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return transactions.map((transaction) => {
    const metadata = transaction.metadata as Record<string, unknown> | null;
    const pii = openPII<TinPII>(metadata?.pii);
    return {
      reference: transaction.reference,
      status: transaction.status.toLowerCase(),
      tin_type: typeof metadata?.tin_type === 'string' ? metadata.tin_type : null,
      amount: koboToNaira(transaction.amountKobo),
      progress_notes: typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : null,
      certificate_pdf_base64: typeof pii?.certificate_pdf_base64 === 'string' ? pii.certificate_pdf_base64 : null,
      created_at: transaction.createdAt.toISOString(),
      updated_at: transaction.updatedAt.toISOString()
    };
  });
}

export async function updateTinProgressNotes(params: { transactionId: string; notes: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.TIN_CERTIFICATE_REQUEST) {
    throw new ApiError(404, 'TIN request not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending TIN request can be updated', 'INVALID_STATUS');
  }
  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { metadata: { ...metadata, progress_notes: params.notes } as Prisma.InputJsonValue }
  });
}

export async function completeTinRequest(params: { transactionId: string; certificatePdfBase64: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.TIN_CERTIFICATE_REQUEST) {
    throw new ApiError(404, 'TIN request not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending TIN request can be marked complete', 'INVALID_STATUS');
  }
  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: TransactionStatus.SUCCESS,
      metadata: {
        ...metadata,
        pii: mergeSealedPII(metadata.pii, { certificate_pdf_base64: params.certificatePdfBase64 })
      } as Prisma.InputJsonValue
    }
  });
}

export function decryptTinPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<TinPII>(metadata?.pii);
}
