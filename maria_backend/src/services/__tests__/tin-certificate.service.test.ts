import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const echoEnum = new Proxy({}, { get: (_target, property) => property });
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
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
  listTinCertificatePrices,
  submitTinCertificateRequest,
  listTinCertificateHistory,
  updateTinProgressNotes,
  completeTinRequest
} = await import('../tin-certificate.service.js');

let userCounter = 0;
async function seedUser(balanceNaira: number) {
  userCounter += 1;
  const id = `tin-user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)),
      fullName: `TIN Test User ${userCounter}`,
      email: `tin-user-${userCounter}@example.test`,
      phone: `+23481000${String(userCounter).padStart(4, '0')}`,
      referralCode: `TINREF${userCounter}`
    }
  });
  return id;
}

beforeEach(() => {
  __resetFakePrisma();
});

describe('TIN certificate manual requests', () => {
  it('lists the reference individual and corporate prices', async () => {
    const prices = await listTinCertificatePrices();
    expect(prices.map(({ type, unitPrice }) => [type, unitPrice])).toEqual([
      ['individual', 400],
      ['corporate', 500]
    ]);
  });

  it('debits the selected fee and keeps applicant data sealed while the request is pending', async () => {
    const userId = await seedUser(1000);
    const result = await submitTinCertificateRequest({
      userId,
      details: {
        type: 'individual',
        nin_number: '12345678901',
        first_name: 'Amina',
        surname: 'Bello',
        date_of_birth: '1994-05-01'
      }
    });
    const transaction = await prisma.transaction.findUnique({ where: { reference: result.reference } });
    const history = await listTinCertificateHistory(userId);

    expect(result.balanceAfter).toBe(600);
    expect(transaction?.type).toBe('TIN_CERTIFICATE_REQUEST');
    expect(transaction?.status).toBe('PENDING');
    expect(JSON.stringify(transaction?.metadata)).not.toContain('12345678901');
    expect(history[0]).toMatchObject({ status: 'pending', tin_type: 'individual', amount: 400 });
  });

  it('lets admins post progress and attach the issued certificate to complete the request', async () => {
    const userId = await seedUser(1000);
    const result = await submitTinCertificateRequest({
      userId,
      details: {
        type: 'corporate',
        rc_number: 'RC12345',
        company_name: 'Example Company Ltd',
        organization_type: 'Company'
      }
    });
    const transaction = await prisma.transaction.findUnique({ where: { reference: result.reference } });

    await updateTinProgressNotes({ transactionId: transaction!.id, notes: 'Application submitted for processing' });
    expect((await listTinCertificateHistory(userId))[0].progress_notes).toBe('Application submitted for processing');

    await completeTinRequest({ transactionId: transaction!.id, certificatePdfBase64: 'ZmFrZS1wZGY=' });
    expect((await listTinCertificateHistory(userId))[0]).toMatchObject({
      status: 'success',
      certificate_pdf_base64: 'ZmFrZS1wZGY='
    });
    await expect(completeTinRequest({ transactionId: transaction!.id, certificatePdfBase64: 'YW5vdGhlci1wZGY=' })).rejects.toThrow(/pending/i);
  });
});
