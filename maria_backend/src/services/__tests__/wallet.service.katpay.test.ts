import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests creditDirectDepositByAccountNumber - the KatPay counterpart to
 * creditDirectDeposit, used when the webhook confirms money landed in a
 * user's permanent virtual account with no pending Transaction row already
 * created for it (see webhook.routes.ts's virtual_account.payment_received
 * handler).
 *
 * NOTE on what this does NOT cover: creditDirectDepositByAccountNumber relies
 * on Postgres rolling back the whole $transaction (including the balance
 * increment) when the Transaction.reference unique constraint rejects a
 * redelivered webhook - see the P2002 catch branch in wallet.service.ts. The
 * in-memory fake Prisma client used here does not implement real rollback
 * (see fake-prisma.ts's own note on this), so a true "redelivered webhook is
 * a no-op" test would give a false pass/fail signal here. That guarantee
 * needs an integration test against real Postgres, same as debitWallet's
 * race-safety guarantee.
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
  return { prisma: fake.api };
});

const notifyUser = vi.fn().mockResolvedValue(undefined);
vi.mock('../notification.service.js', () => ({ notifyUser }));

const { prisma } = await import('../../lib/prisma.js');
const { creditDirectDepositByAccountNumber } = await import('../wallet.service.js');

beforeEach(() => {
  vi.clearAllMocks();
});

async function seedUser(overrides: Record<string, unknown> & { id: string }) {
  await prisma.user.create({
    data: {
      walletBalanceKobo: 0n,
      fullName: 'Test User',
      email: 'test@example.test',
      phone: '+2348000000000',
      referralCode: 'REF1',
      ...overrides
    }
  });
}

describe('creditDirectDepositByAccountNumber', () => {
  it('credits the wallet of the user whose virtualAccountNumber matches', async () => {
    await seedUser({ id: 'user-1', virtualAccountNumber: '8012345678', walletBalanceKobo: 100000n });

    const transaction = await creditDirectDepositByAccountNumber({
      reference: 'KATPAY-REF-1',
      amountKobo: 500000n,
      accountNumber: '8012345678',
      channel: 'katpay_virtual_account'
    });

    expect(transaction.userId).toBe('user-1');
    expect(transaction.status).toBe('SUCCESS');
    expect(transaction.provider).toBe('katpay');
    expect(transaction.providerRef).toBe('katpay:virtual-account:KATPAY-REF-1');
    expect(transaction.reference).not.toBe('KATPAY-REF-1');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-1' } });
    // Default WALLET_FUNDING_FEE_PERCENT is 2%, so ₦5,000 funding incurs ₦100.
    expect(user.walletBalanceKobo).toBe(590000n);
  });

  it('only touches the matching user, not other users with different account numbers', async () => {
    await seedUser({ id: 'user-a', virtualAccountNumber: '1111111111', walletBalanceKobo: 100000n });
    await seedUser({ id: 'user-b', virtualAccountNumber: '2222222222', walletBalanceKobo: 100000n });

    await creditDirectDepositByAccountNumber({
      reference: 'KATPAY-REF-2',
      amountKobo: 200000n,
      accountNumber: '2222222222',
      channel: 'katpay_virtual_account'
    });

    const userA = await prisma.user.findUniqueOrThrow({ where: { id: 'user-a' } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { id: 'user-b' } });
    expect(userA.walletBalanceKobo).toBe(100000n);
    // ₦2,000 funding incurs the configured 2% (₦40) fee.
    expect(userB.walletBalanceKobo).toBe(296000n);
  });

  it('throws 404 when no user has that virtual account number', async () => {
    await expect(
      creditDirectDepositByAccountNumber({
        reference: 'KATPAY-REF-3',
        amountKobo: 500000n,
        accountNumber: '0000000000',
        channel: 'katpay_virtual_account'
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND_FOR_PAYMENT' });
  });

  it('notifies only the credited user', async () => {
    await seedUser({ id: 'user-notify', virtualAccountNumber: '3333333333', walletBalanceKobo: 0n });

    await creditDirectDepositByAccountNumber({
      reference: 'KATPAY-REF-4',
      amountKobo: 150000n,
      accountNumber: '3333333333',
      channel: 'katpay_virtual_account'
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-notify', type: 'WALLET' }));
  });
});
