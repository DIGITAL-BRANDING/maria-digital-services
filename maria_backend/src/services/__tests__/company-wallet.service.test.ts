import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests getCompanyWalletSummary/getUserWalletSummary - the aggregation logic
 * behind the Company Wallet and User Wallet Activity admin pages. These are
 * pure read/aggregate queries (groupBy/aggregate/count), so unlike
 * wallet.service.ts's tests there's no debit/credit race-safety concern here -
 * the main things worth verifying are the ARITHMETIC (revenue - cost -
 * referral payouts) and, especially, that a transaction with an unknown cost
 * basis (costKobo: null) is excluded from cost/profit rather than silently
 * counted as zero.
 */

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const echoEnum = new Proxy({}, { get: (_target, prop) => prop });
  return { ...actual, TransactionStatus: echoEnum, TransactionType: echoEnum };
});

vi.mock('../../lib/prisma.js', async () => {
  const { createFakePrisma } = await import('../../test-utils/fake-prisma.js');
  const fake = createFakePrisma();
  return { prisma: fake.api, __resetFakePrisma: () => fake.reset() };
});

const { prisma, __resetFakePrisma } = (await import('../../lib/prisma.js')) as unknown as {
  prisma: Awaited<ReturnType<typeof import('../../test-utils/fake-prisma.js').createFakePrisma>>['api'];
  __resetFakePrisma: () => void;
};
const { getCompanyWalletSummary, getUserWalletSummary } = await import('../company-wallet.service.js');

let txCounter = 0;
async function seedTransaction(overrides: Record<string, unknown> & { userId: string }) {
  txCounter += 1;
  await prisma.transaction.create({
    data: {
      id: `tx-${txCounter}`,
      status: 'SUCCESS',
      amountKobo: 0n,
      balanceBeforeKobo: 0n,
      balanceAfterKobo: 0n,
      reference: `ref-${txCounter}`,
      description: 'test transaction',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      costKobo: null,
      ...overrides
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFakePrisma();
  txCounter = 0;
});

describe('getCompanyWalletSummary', () => {
  it('computes revenue, cost, and profit per service type from SUCCESS transactions only', async () => {
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 50000n, costKobo: 40000n });
    await seedTransaction({ userId: 'u2', type: 'DATA_PURCHASE', amountKobo: 100000n, costKobo: 80000n });
    // PENDING and FAILED must never count toward revenue/cost - no sale actually happened.
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 50000n, costKobo: 40000n, status: 'PENDING' });
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 50000n, costKobo: 40000n, status: 'FAILED' });

    const summary = await getCompanyWalletSummary();

    const dataRow = summary.byType.find((t) => t.type === 'DATA_PURCHASE');
    expect(dataRow).toMatchObject({ count: 2, revenueKobo: 150000n, costKobo: 120000n, profitKobo: 30000n, unknownCostCount: 0 });
    expect(summary.totals.revenueKobo).toBe(150000n);
    expect(summary.totals.costKobo).toBe(120000n);
    expect(summary.totals.grossProfitKobo).toBe(30000n);
  });

  it('excludes transactions with an unknown cost basis from cost/profit totals, and reports them separately', async () => {
    await seedTransaction({ userId: 'u1', type: 'AIRTIME_PURCHASE', amountKobo: 100000n, costKobo: null });
    await seedTransaction({ userId: 'u2', type: 'AIRTIME_PURCHASE', amountKobo: 200000n, costKobo: 190000n });

    const summary = await getCompanyWalletSummary();

    const airtimeRow = summary.byType.find((t) => t.type === 'AIRTIME_PURCHASE')!;
    // Revenue counts BOTH sales (customers really did pay ₦3000 total)...
    expect(airtimeRow.revenueKobo).toBe(300000n);
    // ...but cost/profit only reflect the one row where cost is actually known.
    expect(airtimeRow.costKobo).toBe(190000n);
    expect(airtimeRow.profitKobo).toBe(110000n);
    expect(airtimeRow.unknownCostCount).toBe(1);
    expect(summary.totals.unknownCostCount).toBe(1);
  });

  it('subtracts referral commission payouts from gross profit to get net profit', async () => {
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 100000n, costKobo: 70000n });
    await seedTransaction({ userId: 'referrer1', type: 'REFERRAL_COMMISSION', amountKobo: 5000n, costKobo: null });

    const summary = await getCompanyWalletSummary();

    expect(summary.totals.grossProfitKobo).toBe(30000n);
    expect(summary.totals.referralPayoutsKobo).toBe(5000n);
    expect(summary.totals.netProfitKobo).toBe(25000n);
  });

  it('never counts WALLET_FUNDING, WALLET_TRANSFER, or MANUAL_ADJUSTMENT as revenue', async () => {
    await seedTransaction({ userId: 'u1', type: 'WALLET_FUNDING', amountKobo: 500000n });
    await seedTransaction({ userId: 'u1', type: 'WALLET_TRANSFER', amountKobo: 10000n });
    await seedTransaction({ userId: 'u1', type: 'MANUAL_ADJUSTMENT', amountKobo: 20000n });

    const summary = await getCompanyWalletSummary();

    expect(summary.totals.revenueKobo).toBe(0n);
    expect(summary.totals.transactionCount).toBe(0);
    // WALLET_FUNDING still shows up in totalFundingKobo, for context (not profit).
    expect(summary.totalFundingKobo).toBe(500000n);
  });

  it('filters by date range when provided', async () => {
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 100000n, costKobo: 80000n, createdAt: new Date('2026-01-01T00:00:00Z') });
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 200000n, costKobo: 160000n, createdAt: new Date('2026-02-01T00:00:00Z') });

    const summary = await getCompanyWalletSummary({ from: new Date('2026-01-15T00:00:00Z'), to: new Date('2026-02-15T00:00:00Z') });

    expect(summary.totals.revenueKobo).toBe(200000n);
  });
});

describe('getUserWalletSummary', () => {
  it('separates funding (money in) from spend (services bought)', async () => {
    await seedTransaction({ userId: 'u1', type: 'WALLET_FUNDING', amountKobo: 1000000n });
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 50000n, costKobo: 40000n });
    await seedTransaction({ userId: 'u1', type: 'AIRTIME_PURCHASE', amountKobo: 30000n, costKobo: null });
    // A different user's activity must never leak into u1's summary.
    await seedTransaction({ userId: 'u2', type: 'WALLET_FUNDING', amountKobo: 999999n });

    const summary = await getUserWalletSummary('u1');

    expect(summary.totalFunded).toBe(10000); // ₦1,000,000 kobo -> ₦10,000
    expect(summary.fundingCount).toBe(1);
    expect(summary.totalSpent).toBe(800); // (50000 + 30000) kobo -> ₦800
    expect(summary.purchaseCount).toBe(2);
    expect(summary.transactionCount).toBe(3);
  });

  it('reports the most recent transaction regardless of type', async () => {
    await seedTransaction({ userId: 'u1', type: 'WALLET_FUNDING', amountKobo: 100000n, createdAt: new Date('2026-01-01T00:00:00Z') });
    await seedTransaction({ userId: 'u1', type: 'DATA_PURCHASE', amountKobo: 50000n, createdAt: new Date('2026-01-10T00:00:00Z'), description: 'MTN 1GB' });

    const summary = await getUserWalletSummary('u1');

    expect(summary.lastTransaction).toMatchObject({ type: 'DATA_PURCHASE', description: 'MTN 1GB' });
  });

  it('returns zeroed-out summary for a user with no transactions, rather than throwing', async () => {
    const summary = await getUserWalletSummary('brand-new-user');
    expect(summary).toMatchObject({ totalFunded: 0, totalSpent: 0, transactionCount: 0, lastTransaction: null });
  });
});
