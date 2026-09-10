import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests the CAC Services manual-processing flow: pricing defaults,
 * submission (debit + sealed PII + generated form), the all-status history
 * (the key difference from listVerificationHistory - see the comment on
 * listCacHistory itself), progress notes, and completion/certificate
 * attachment. Techhub/provider.service.ts is never touched by this file -
 * CAC has no provider integration at all, which is the whole point of the
 * feature (see cac.service.ts's top-of-file comment).
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
  getCacPrice,
  listCacPrices,
  submitCacRequest,
  listCacHistory,
  updateCacProgressNotes,
  completeCacRequest
} = await import('../cac.service.js');

const SAMPLE_DETAILS = {
  business_nature: 'Retail of electronics',
  business_address: '12 Ahmadu Bello Way, Kano',
  proprietor_full_name: 'Sunusi Usama',
  proprietor_phone: '08012345678',
  proprietor_email: 'sunusi@example.test',
  proprietor_residential_address: '4 Zoo Road, Kano',
  proprietor_date_of_birth: '1994-05-01',
  proprietor_gender: 'Male' as const,
  proprietor_nin: '12345678901'
};

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

describe('getCacPrice / listCacPrices', () => {
  it('creates a default-priced row the first time a type is looked up', async () => {
    const price = await getCacPrice('sole');
    expect(price.unitPrice).toBe(28000);
  });

  it('does not reset an already-configured price on a later call', async () => {
    await getCacPrice('partnership'); // creates the row with the default (32000)
    await prisma.servicePricing.update({ where: { service: 'CAC_PARTNERSHIP' }, data: { sellingPriceKobo: 35000_00n } });
    const price = await getCacPrice('partnership');
    expect(price.unitPrice).toBe(35000);
  });

  it('lists all three types with their titles and active flags', async () => {
    const prices = await listCacPrices();
    expect(prices.map((p) => p.type).sort()).toEqual(['llc', 'partnership', 'sole']);
    expect(prices.every((p) => p.isActive)).toBe(true);
  });

  it('rejects a deactivated service', async () => {
    await getCacPrice('llc');
    await prisma.servicePricing.update({ where: { service: 'CAC_LLC' }, data: { isActive: false } });
    await expect(getCacPrice('llc')).rejects.toThrow(/unavailable/i);
  });
});

describe('submitCacRequest', () => {
  it('debits the wallet by the type price and leaves the transaction PENDING', async () => {
    const userId = await seedUser(50000);
    const result = await submitCacRequest({
      userId,
      type: 'sole',
      proposedName1: 'Amana Traders',
      proposedName2: 'Amana Global Ventures',
      details: SAMPLE_DETAILS
    });

    expect(result.balanceAfter).toBe(50000 - 28000);
    expect(await balanceOf(userId)).toBe(50000 - 28000);

    const tx = await prisma.transaction.findUnique({ where: { reference: result.reference } });
    expect(tx?.status).toBe('PENDING');
  });

  it('generates a submission PDF containing the applicant details, sealed alongside the proposed names', async () => {
    const userId = await seedUser(50000);
    await submitCacRequest({
      userId,
      type: 'sole',
      proposedName1: 'Amana Traders',
      details: SAMPLE_DETAILS
    });

    const [entry] = await listCacHistory(userId);
    expect(entry.proposed_name_1).toBe('Amana Traders');
    expect(entry.submission_pdf_base64).toBeTruthy();
    // A real PDF starts with the "%PDF-" magic bytes once base64-decoded.
    const header = Buffer.from(entry.submission_pdf_base64 as string, 'base64').subarray(0, 5).toString('latin1');
    expect(header).toBe('%PDF-');
  });
});

describe('listCacHistory', () => {
  it('includes PENDING requests, unlike the SUCCESS-only /history endpoint used by other services', async () => {
    const userId = await seedUser(50000);
    await submitCacRequest({ userId, type: 'sole', proposedName1: 'Pending Biz', details: SAMPLE_DETAILS });

    const history = await listCacHistory(userId);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('pending');
  });
});

describe('updateCacProgressNotes / completeCacRequest', () => {
  it('updates the progress note visible to the customer without changing status', async () => {
    const userId = await seedUser(50000);
    await submitCacRequest({ userId, type: 'sole', proposedName1: 'Biz', details: SAMPLE_DETAILS });
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;

    await updateCacProgressNotes({ transactionId: tx.id, notes: 'Name reservation submitted' });

    const [entry] = await listCacHistory(userId);
    expect(entry.progress_notes).toBe('Name reservation submitted');
    expect(entry.status).toBe('pending');
  });

  it('marks the request SUCCESS and attaches the certificate once completed', async () => {
    const userId = await seedUser(50000);
    await submitCacRequest({ userId, type: 'sole', proposedName1: 'Biz', details: SAMPLE_DETAILS });
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;

    await completeCacRequest({ transactionId: tx.id, certificatePdfBase64: 'ZmFrZS1wZGY=' });

    const [entry] = await listCacHistory(userId);
    expect(entry.status).toBe('success');
    expect(entry.certificate_pdf_base64).toBe('ZmFrZS1wZGY=');
  });

  it('refuses to complete a request that is not PENDING', async () => {
    const userId = await seedUser(50000);
    await submitCacRequest({ userId, type: 'sole', proposedName1: 'Biz', details: SAMPLE_DETAILS });
    const tx = (await prisma.transaction.findFirst({ where: { userId } }))!;
    await completeCacRequest({ transactionId: tx.id, certificatePdfBase64: 'AAAA' });

    await expect(completeCacRequest({ transactionId: tx.id, certificatePdfBase64: 'BBBB' })).rejects.toThrow(/pending/i);
  });
});
