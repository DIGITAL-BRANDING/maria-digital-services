import { nanoid } from 'nanoid';
import { ProviderLedgerEntryType, type Prisma } from '@prisma/client';
import { ApiError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';

/**
 * The company's OWN computed running ledger of its balance at each upstream
 * provider (Alrahuz, Techhub, ...) - built entirely from ProviderLedgerEntry
 * rows, the same append-only pattern Transaction/wallet.service.ts uses for a
 * customer's own wallet balance.
 *
 * Deliberately a SEPARATE number from ProviderBalanceStatus.lastKnownBalance
 * (a read-only mirror of whatever the provider's own API reports) - see the
 * doc-comment on ProviderLedgerBalance in schema.prisma for why keeping them
 * apart, rather than trusting one or the other alone, is the point: a
 * mismatch between "what our own ledger says" and "what Alrahuz's dashboard
 * says" is exactly the kind of thing that should be visible to an admin, not
 * silently reconciled away.
 */

async function currentBalance(tx: Prisma.TransactionClient, provider: string): Promise<bigint> {
  const row = await tx.providerLedgerBalance.upsert({
    where: { provider },
    create: { provider, balanceKobo: 0n },
    update: {}
  });
  return row.balanceKobo;
}

async function applyMovement(
  provider: string,
  type: ProviderLedgerEntryType,
  signedAmountKobo: bigint,
  extra: {
    relatedTransactionId?: string;
    reference?: string;
    description: string;
    createdByAdminId?: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  return prisma.$transaction(async (tx) => {
    const before = await currentBalance(tx, provider);
    const updated = await tx.providerLedgerBalance.update({
      where: { provider },
      data: { balanceKobo: { increment: signedAmountKobo } }
    });

    return tx.providerLedgerEntry.create({
      data: {
        id: nanoid(),
        provider,
        type,
        amountKobo: signedAmountKobo,
        balanceBeforeKobo: before,
        balanceAfterKobo: updated.balanceKobo,
        relatedTransactionId: extra.relatedTransactionId,
        reference: extra.reference,
        description: extra.description,
        createdByAdminId: extra.createdByAdminId,
        metadata: extra.metadata
      }
    });
  });
}

/**
 * Records that a customer purchase consumed `amountKobo` of our balance at
 * `provider`. Called automatically once a purchase's real cost is known -
 * see the call sites in vtu.routes.ts (data/airtime), result-pin.service.ts
 * and verification.service.ts, right after each marks its own Transaction
 * SUCCESS with a non-null costKobo. Never called for a transaction whose
 * cost is unknown (costKobo null) - an unknown-cost purchase must not
 * silently appear as a zero-cost (i.e. free) debit on the provider ledger.
 */
export async function recordProviderDebit(params: {
  provider: string;
  amountKobo: bigint;
  relatedTransactionId: string;
  description: string;
}) {
  if (params.amountKobo <= 0n) return null; // nothing to record
  return applyMovement(params.provider, ProviderLedgerEntryType.PURCHASE_DEBIT, -params.amountKobo, {
    relatedTransactionId: params.relatedTransactionId,
    description: params.description
  });
}

/**
 * "Settlement" - an admin recording that we paid the provider to top up our
 * balance with them. Called from the Provider Ledger admin page's "Record
 * Settlement" form (see admin/provider-ledger.ts).
 */
export async function recordProviderSettlement(params: {
  provider: string;
  amountKobo: bigint;
  reference?: string;
  description: string;
  createdByAdminId: string;
}) {
  if (params.amountKobo <= 0n) {
    throw new ApiError(422, 'Settlement amount must be positive', 'INVALID_AMOUNT');
  }
  return applyMovement(params.provider, ProviderLedgerEntryType.TOPUP_CREDIT, params.amountKobo, {
    reference: params.reference,
    description: params.description,
    createdByAdminId: params.createdByAdminId
  });
}

/**
 * Any other manual correction - e.g. reconciling our computed balance
 * against what the provider's own dashboard shows. `amountKobo` is signed:
 * positive increases our ledger balance, negative decreases it.
 */
export async function recordProviderAdjustment(params: {
  provider: string;
  amountKobo: bigint;
  description: string;
  createdByAdminId: string;
}) {
  if (params.amountKobo === 0n) {
    throw new ApiError(422, 'Adjustment amount cannot be zero', 'INVALID_AMOUNT');
  }
  return applyMovement(params.provider, ProviderLedgerEntryType.ADJUSTMENT, params.amountKobo, {
    description: params.description,
    createdByAdminId: params.createdByAdminId
  });
}

export type ProviderLedgerSummary = {
  provider: string;
  computedBalanceKobo: bigint;
  /** Whatever the provider's own API last reported (ProviderBalanceStatus) - null if never checked. */
  reportedBalance: number | null;
  reportedBalanceCheckedAt: Date | null;
  /** computedBalance - reportedBalance*100, in kobo - large non-zero values are worth investigating. */
  varianceKobo: bigint | null;
};

/**
 * Side-by-side comparison of our own computed ledger balance against the
 * provider's self-reported number, for every provider that has EITHER a
 * ledger entry or a known status row - so a provider with entries but no
 * status check yet (or vice versa) still shows up rather than being silently
 * skipped by an inner join.
 */
export async function getProviderLedgerSummaries(): Promise<ProviderLedgerSummary[]> {
  const [ledgerBalances, statuses] = await Promise.all([
    prisma.providerLedgerBalance.findMany(),
    prisma.providerBalanceStatus.findMany()
  ]);

  const providers = new Set([...ledgerBalances.map((b) => b.provider), ...statuses.map((s) => s.provider)]);

  return Array.from(providers).map((provider) => {
    const ledger = ledgerBalances.find((b) => b.provider === provider);
    const status = statuses.find((s) => s.provider === provider);
    const computedBalanceKobo = ledger?.balanceKobo ?? 0n;
    const reportedBalance = status?.lastKnownBalance ?? null;
    const reportedBalanceKobo = reportedBalance !== null ? BigInt(Math.round(reportedBalance * 100)) : null;

    return {
      provider,
      computedBalanceKobo,
      reportedBalance,
      reportedBalanceCheckedAt: status?.lastCheckedAt ?? null,
      varianceKobo: reportedBalanceKobo !== null ? computedBalanceKobo - reportedBalanceKobo : null
    };
  });
}

export function toNairaLedgerSummary(summary: ProviderLedgerSummary) {
  return {
    provider: summary.provider,
    computedBalance: koboToNaira(summary.computedBalanceKobo),
    reportedBalance: summary.reportedBalance,
    reportedBalanceCheckedAt: summary.reportedBalanceCheckedAt,
    variance: summary.varianceKobo !== null ? koboToNaira(summary.varianceKobo) : null
  };
}

export async function listProviderLedgerEntries(params: {
  provider?: string;
  limit?: number;
  before?: Date;
}) {
  const entries = await prisma.providerLedgerEntry.findMany({
    where: {
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.before ? { createdAt: { lt: params.before } } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 50
  });

  return entries.map((e) => ({
    ...e,
    amount: koboToNaira(e.amountKobo),
    balanceBefore: koboToNaira(e.balanceBeforeKobo),
    balanceAfter: koboToNaira(e.balanceAfterKobo)
  }));
}
