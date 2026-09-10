import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';

/**
 * "Company Wallet" - not a real bank/provider account like Provider Wallet
 * (ProviderBalanceStatus, your balance AT Alrahuz), but a computed view of
 * how much profit the business has actually made: what customers paid for
 * services, minus what those services cost us upstream, minus what we paid
 * out in referral commissions.
 *
 * Every number here is derived from Transaction rows at query time - there is
 * no separate ledger table to keep in sync. This depends entirely on
 * Transaction.costKobo being captured correctly at purchase time (see the
 * doc-comment on that column in schema.prisma, and debitWallet() in
 * wallet.service.ts) - a transaction with a null costKobo is treated as
 * "cost unknown" and excluded from the profit sum (see unknownCostCount
 * below), never silently counted as zero cost (which would overstate
 * profit) or zero revenue (which would understate it).
 */

/** Transaction types that represent a service actually sold to a customer - i.e. real revenue. */
const REVENUE_TYPES = [
  TransactionType.DATA_PURCHASE,
  TransactionType.AIRTIME_PURCHASE,
  TransactionType.ELECTRICITY_PURCHASE,
  TransactionType.CABLE_PURCHASE,
  TransactionType.RESULT_PIN,
  TransactionType.SMS,
  TransactionType.NIN_VERIFICATION,
  TransactionType.BVN_VERIFICATION,
  TransactionType.IDENTITY_SERVICE_REQUEST,
  // costKobo is always 0 for these (see applyFundingFee() in
  // wallet.service.ts) so they show up as 100% profit, correctly.
  TransactionType.WALLET_FUNDING_FEE
] as const;

export type DateRange = { from?: Date; to?: Date };

export type RevenueByType = {
  type: TransactionType;
  count: number;
  revenueKobo: bigint;
  costKobo: bigint;
  /** How many of `count` rows had no recorded cost basis (costKobo IS NULL) - these are EXCLUDED from costKobo/profit above, not counted as zero. */
  unknownCostCount: number;
  profitKobo: bigint;
};

export type CompanyWalletSummary = {
  range: DateRange;
  byType: RevenueByType[];
  totals: {
    revenueKobo: bigint;
    costKobo: bigint;
    grossProfitKobo: bigint;
    referralPayoutsKobo: bigint;
    /** grossProfitKobo - referralPayoutsKobo - what actually stays with the company. */
    netProfitKobo: bigint;
    transactionCount: number;
    unknownCostCount: number;
  };
  /** Total money customers have deposited (WALLET_FUNDING + COUPON_REDEMPTION), for context only - this is cash inflow, not profit. */
  totalFundingKobo: bigint;
};

function dateFilter(range: DateRange) {
  if (!range.from && !range.to) return undefined;
  return { gte: range.from, lte: range.to };
}

export async function getCompanyWalletSummary(range: DateRange = {}): Promise<CompanyWalletSummary> {
  const createdAt = dateFilter(range);

  const grouped = await prisma.transaction.groupBy({
    by: ['type'],
    where: {
      status: TransactionStatus.SUCCESS,
      type: { in: REVENUE_TYPES as unknown as TransactionType[] },
      ...(createdAt ? { createdAt } : {})
    },
    _sum: { amountKobo: true, costKobo: true },
    _count: { _all: true }
  });

  // groupBy can't separately count "rows where costKobo is null" within the
  // same query alongside a sum of the non-null ones, so a second targeted
  // count per type covers that gap - these calls are cheap (indexed by
  // [type, status, createdAt]) and only run once per revenue type.
  const unknownCostCounts = await Promise.all(
    REVENUE_TYPES.map((type) =>
      prisma.transaction.count({
        where: {
          status: TransactionStatus.SUCCESS,
          type,
          costKobo: null,
          ...(createdAt ? { createdAt } : {})
        }
      })
    )
  );
  const unknownCostByType = new Map(REVENUE_TYPES.map((type, i) => [type, unknownCostCounts[i]]));

  const byType: RevenueByType[] = REVENUE_TYPES.map((type) => {
    const row = grouped.find((g) => g.type === type);
    const revenueKobo = row?._sum.amountKobo ?? 0n;
    const costKobo = row?._sum.costKobo ?? 0n;
    return {
      type,
      count: row?._count._all ?? 0,
      revenueKobo,
      costKobo,
      unknownCostCount: unknownCostByType.get(type) ?? 0,
      profitKobo: revenueKobo - costKobo
    };
  });

  const referralPayouts = await prisma.transaction.aggregate({
    where: {
      status: TransactionStatus.SUCCESS,
      type: TransactionType.REFERRAL_COMMISSION,
      ...(createdAt ? { createdAt } : {})
    },
    _sum: { amountKobo: true }
  });

  const funding = await prisma.transaction.aggregate({
    where: {
      status: TransactionStatus.SUCCESS,
      type: { in: [TransactionType.WALLET_FUNDING, TransactionType.COUPON_REDEMPTION] },
      ...(createdAt ? { createdAt } : {})
    },
    _sum: { amountKobo: true }
  });

  const totalRevenueKobo = byType.reduce((sum, t) => sum + t.revenueKobo, 0n);
  const totalCostKobo = byType.reduce((sum, t) => sum + t.costKobo, 0n);
  const grossProfitKobo = totalRevenueKobo - totalCostKobo;
  const referralPayoutsKobo = referralPayouts._sum.amountKobo ?? 0n;
  // REFERRAL_COMMISSION amounts are recorded as positive credits to the
  // referrer's wallet (see referral.service.ts) - a straightforward
  // subtraction here is correct, no sign-flipping needed.
  const netProfitKobo = grossProfitKobo - referralPayoutsKobo;
  const transactionCount = byType.reduce((sum, t) => sum + t.count, 0);
  const unknownCostCount = byType.reduce((sum, t) => sum + t.unknownCostCount, 0);

  return {
    range,
    byType,
    totals: {
      revenueKobo: totalRevenueKobo,
      costKobo: totalCostKobo,
      grossProfitKobo,
      referralPayoutsKobo,
      netProfitKobo,
      transactionCount,
      unknownCostCount
    },
    totalFundingKobo: funding._sum.amountKobo ?? 0n
  };
}

/** Naira-formatted mirror of CompanyWalletSummary, for rendering in the admin page. */
export function toNairaView(summary: CompanyWalletSummary) {
  return {
    range: summary.range,
    byType: summary.byType.map((t) => ({
      type: t.type,
      count: t.count,
      revenue: koboToNaira(t.revenueKobo),
      cost: koboToNaira(t.costKobo),
      unknownCostCount: t.unknownCostCount,
      profit: koboToNaira(t.profitKobo)
    })),
    totals: {
      revenue: koboToNaira(summary.totals.revenueKobo),
      cost: koboToNaira(summary.totals.costKobo),
      grossProfit: koboToNaira(summary.totals.grossProfitKobo),
      referralPayouts: koboToNaira(summary.totals.referralPayoutsKobo),
      netProfit: koboToNaira(summary.totals.netProfitKobo),
      transactionCount: summary.totals.transactionCount,
      unknownCostCount: summary.totals.unknownCostCount
    },
    totalFunding: koboToNaira(summary.totalFundingKobo)
  };
}

/**
 * Per-user wallet activity summary - powers the "Wallet Activity" block on
 * the admin User show page (see user.resource.ts). Answers exactly "what has
 * this user done": how much they've funded, how much they've spent on
 * services, and their most recent transaction, without an admin having to
 * manually filter the Ledger by this one user.
 */
export async function getUserWalletSummary(userId: string) {
  const [funding, spend, lastTransaction, transactionCount] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId,
        status: TransactionStatus.SUCCESS,
        type: { in: [TransactionType.WALLET_FUNDING, TransactionType.COUPON_REDEMPTION] }
      },
      _sum: { amountKobo: true },
      _count: { _all: true }
    }),
    prisma.transaction.aggregate({
      where: { userId, status: TransactionStatus.SUCCESS, type: { in: REVENUE_TYPES as unknown as TransactionType[] } },
      _sum: { amountKobo: true },
      _count: { _all: true }
    }),
    prisma.transaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { type: true, status: true, amountKobo: true, description: true, createdAt: true }
    }),
    prisma.transaction.count({ where: { userId } })
  ]);

  return {
    totalFunded: koboToNaira(funding._sum.amountKobo ?? 0n),
    fundingCount: funding._count._all,
    totalSpent: koboToNaira(spend._sum.amountKobo ?? 0n),
    purchaseCount: spend._count._all,
    transactionCount,
    lastTransaction: lastTransaction
      ? {
          type: lastTransaction.type,
          status: lastTransaction.status,
          amount: koboToNaira(lastTransaction.amountKobo),
          description: lastTransaction.description,
          createdAt: lastTransaction.createdAt
        }
      : null
  };
}
