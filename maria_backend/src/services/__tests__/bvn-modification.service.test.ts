import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests the BVN Modification manual-processing flow. Same pattern as
 * cac.service.test.ts, but note one deliberate difference under test:
 * listBvnModificationHistory is SUCCESS-only (matching
 * listVerificationHistory's convention), unlike listCacHistory which shows
 * every status - see the comment on each function for why they differ.
 */

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const echoEnum = new Proxy({}, { get: (_target, prop) => prop });
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }
  return {
    ...actual,
    TransactionStatus: echoEnum,
    TransactionType: echoEnum,
    Prisma: { ...((actual as Record<string, unknown>).Prisma as Record<string, unknown>), PrismaClientKnownRequestError }
  };
});

vi.mock('../../lib/prisma.js', async () => {
  const { createFakePrisma } = await import('../../test-utils/fake-prisma.js');
  const fake = createFakePrisma();
  return { prisma: fake.api, __resetFakePrisma: () => fake.reset() };
});

vi.mock('../notification.service.js', () => ({ notifyUser: vi.fn().mockResolvedValue(undefined) }));

const { prisma, __resetFakePrisma } = (await import('../../lib/prisma.js')) as unknown as {
  prisma: Awaited<ReturnType<typeof import('../../test-utils/fake-prisma.js').createFakePrisma>>['api'];
  __resetFakePrisma: () => void;
};
const {
  BVN_MODIFICATION_BANKS,
  getBvnModificationPrice,
  listBvnModificationPrices,
  submitBvnModificationRequest,
  listBvnModificationHistory,
  completeBvnModification
} = await import('../bvn-modification.service.js');

let userCounter = 0;
async function seedUser(balanceNaira: number) {
  userCounter += 1;
  const id = `user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)),
      fullName: `Test User ${userCounter}`,
      email: `test-user-${userCounter}@example.test`,
      phone: `+23480000${String(userCounter).padStart(4, '0')}`,
      referralCode: `REF${userCounter}`
    }
  });
  return id;
}

async function balanceOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return Number(user.walletBalanceKobo) / 100;
}

beforeEach(() => {
  __resetFakePrisma();
});

describe('getBvnModificationPrice / listBvnModificationPrices', () => {
  it('creates a default-priced row per type and enrollment on first lookup', async () => {
    expect((await getBvnModificationPrice('update_phone')).unitPrice).toBe(3500);
    expect((await getBvnModificationPrice('update_name')).unitPrice).toBe(5000);
    expect((await getBvnModificationPrice('update_name_dob')).unitPrice).toBe(8000);
  });

  it('lists all eight types with an Agency price and one price per bank', async () => {
    const prices = await listBvnModificationPrices();
    expect(prices).toHaveLength(8 * (1 + BVN_MODIFICATION_BANKS.length));
    expect(prices.filter((p) => p.enrollmentType === 'Agency')).toHaveLength(8);
    const bankRows = prices.filter((p) => p.enrollmentType === 'Bank');
    expect(bankRows).toHaveLength(8 * BVN_MODIFICATION_BANKS.length);
    expect(new Set(bankRows.map((p) => p.bankName))).toEqual(new Set(BVN_MODIFICATION_BANKS));
  });

  it('prices each bank separately - a custom Access Bank price does not leak to other banks', async () => {
    await listBvnModificationPrices(); // creates every row, as the admin bulk-pricing page does
    await prisma.servicePricing.update({ where: { service: 'BVN_MODIFICATION_UPDATE_NAME_BANK_ACCESS_BANK' }, data: { sellingPriceKobo: 1_200_000n } });
    await prisma.servicePricing.update({ where: { service: 'BVN_MODIFICATION_UPDATE_NAME_BANK_FIRST_BANK' }, data: { sellingPriceKobo: 1_000_000n } });
    await prisma.servicePricing.update({ where: { service: 'BVN_MODIFICATION_UPDATE_NAME_BANK_NIBSS' }, data: { sellingPriceKobo: 1_000_000n } });

    const prices = await listBvnModificationPrices();
    const priceOf = (bankName: string) => prices.find((p) => p.type === 'update_name' && p.enrollmentType === 'Bank' && p.bankName === bankName)?.unitPrice;
    expect(priceOf('Access Bank')).toBe(12000);
    expect(priceOf('First Bank')).toBe(10000);
    expect(priceOf('NIBSS')).toBe(10000);
    expect(priceOf('Heritage Bank')).toBe(5000); // untouched bank keeps its default
    expect((await getBvnModificationPrice('update_name', 'Bank', 'Access Bank')).unitPrice).toBe(12000);
    expect((await getBvnModificationPrice('update_name', 'Bank', 'First Bank')).unitPrice).toBe(10000);
  });
});

describe('submitBvnModificationRequest', () => {
  const values = { bvn: '12345678901', account_number: '0123456789', enrollment_type: 'Bank', bank_name: 'First Bank', new_phone_number: '08099999999' };

  it('debits the wallet by the type price and leaves the transaction PENDING', async () => {
    const userId = await seedUser(20000);
    const result = await submitBvnModificationRequest({ userId, type: 'update_phone', values });

    expect(result.balanceAfter).toBe(20000 - 3500);
    expect(await balanceOf(userId)).toBe(20000 - 3500);

    const tx = await prisma.transaction.findUnique({ where: { reference: result.reference } });
    expect(tx?.status).toBe('PENDING');
  });

  it('charges the selected bank\'s own price, not another bank\'s', async () => {
    await listBvnModificationPrices();
    await prisma.servicePricing.update({ where: { service: 'BVN_MODIFICATION_UPDATE_PHONE_BANK_ACCESS_BANK' }, data: { sellingPriceKobo: 900_000n } });
    await prisma.servicePricing.update({ where: { service: 'BVN_MODIFICATION_UPDATE_PHONE_BANK_FIRST_BANK' }, data: { sellingPriceKobo: 600_000n } });

    const accessUser = await seedUser(20000);
    await submitBvnModificationRequest({ userId: accessUser, type: 'update_phone', values: { ...values, bank_name: 'Access Bank' } });
    expect(await balanceOf(accessUser)).toBe(20000 - 9000);

    const firstUser = await seedUser(20000);
    await submitBvnModificationRequest({ userId: firstUser, type: 'update_phone', values: { ...values, bank_name: 'First Bank' } });
    expect(await balanceOf(firstUser)).toBe(20000 - 6000);
  });

  it('generates a real, downloadable submission PDF', async () => {
    const userId = await seedUser(20000);
    await submitBvnModificationRequest({ userId, type: 'update_phone', values });

    // Not yet visible via listBvnModificationHistory (still PENDING) - reach
    // into the transaction directly the way the admin PDF route does.
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;
    const metadata = tx.metadata as Record<string, unknown>;
    expect(metadata.pii).toBeTruthy();

    await completeBvnModification({ transactionId: tx.id });
    const [entry] = await listBvnModificationHistory({ userId });
    expect(entry.pdf_base64).toBeTruthy();
    const header = Buffer.from(entry.pdf_base64 as string, 'base64').subarray(0, 5).toString('latin1');
    expect(header).toBe('%PDF-');
  });

  it('debits the higher combined-type price for a two-field modification', async () => {
    const userId = await seedUser(20000);
    const result = await submitBvnModificationRequest({
      userId,
      type: 'update_name_dob',
      values: {
        bvn: '12345678901',
        account_number: '0123456789',
        enrollment_type: 'Agency',
        new_first_name: 'Amina',
        new_last_name: 'Bello',
        new_date_of_birth: '1990-01-01'
      }
    });
    expect(result.balanceAfter).toBe(20000 - 8000);
  });
});

describe('listBvnModificationHistory', () => {
  it('does NOT include a PENDING request (SUCCESS-only, matching listVerificationHistory)', async () => {
    const userId = await seedUser(20000);
    await submitBvnModificationRequest({
      userId,
      type: 'update_address',
      values: { bvn: '12345678901', account_number: '0123456789', enrollment_type: 'Agency', new_address: '1 Main St', new_state: 'Kano', new_lga: 'Nassarawa' }
    });

    expect(await listBvnModificationHistory({ userId })).toHaveLength(0);
  });

  it('includes it once completeBvnModification marks it SUCCESS, and can filter by type', async () => {
    const userId = await seedUser(20000);
    await submitBvnModificationRequest({
      userId,
      type: 'update_address',
      values: { bvn: '12345678901', account_number: '0123456789', enrollment_type: 'Agency', new_address: '1 Main St', new_state: 'Kano', new_lga: 'Nassarawa' }
    });
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;
    await completeBvnModification({ transactionId: tx.id });

    expect(await listBvnModificationHistory({ userId })).toHaveLength(1);
    expect(await listBvnModificationHistory({ userId, type: 'update_phone' })).toHaveLength(0);
    expect(await listBvnModificationHistory({ userId, type: 'update_address' })).toHaveLength(1);
  });
});

describe('completeBvnModification', () => {
  it('refuses to complete a request that is not PENDING', async () => {
    const userId = await seedUser(20000);
    await submitBvnModificationRequest({
      userId,
      type: 'update_phone',
      values: { bvn: '12345678901', account_number: '0123456789', enrollment_type: 'Agency', new_phone_number: '08099999999' }
    });
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;
    await completeBvnModification({ transactionId: tx.id });

    await expect(completeBvnModification({ transactionId: tx.id })).rejects.toThrow(/pending/i);
  });
});
