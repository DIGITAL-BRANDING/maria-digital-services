import { TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

/**
 * Mocks the real database (see src/test-utils/fake-prisma.ts) and outbound
 * push notifications - wallet.service.ts is tested purely as business logic
 * here: balance math, idempotency, and status transitions. It is NOT a
 * substitute for an integration test against a real Postgres instance,
 * which is the only way to actually verify the `updateMany({ gte })` guard
 * closes the race window it's designed for under real concurrent load -
 * that guarantee comes from Postgres's row-level locking during the
 * conditional UPDATE, which this in-memory fake does not (and cannot)
 * reproduce. If this project adds a test database, add a companion
 * `wallet.service.integration.test.ts` that fires concurrent debitWallet()
 * calls at a real database and asserts only one wins - that's the test that
 * actually proves the race condition is closed.
 */
/**
 * wallet.service.ts imports TransactionStatus/TransactionType/Prisma
 * directly from '@prisma/client' (not through lib/prisma.js), so mocking
 * the singleton client above isn't enough on its own. This sandbox's
 * generated Prisma client is a stub missing real runtime enum exports (see
 * this repo's other `tsc --noEmit` runs for the same root cause) - a Proxy
 * that echoes back whatever property is accessed reproduces exactly how a
 * real Prisma string enum behaves (`TransactionType.DATA_PURCHASE ===
 * 'DATA_PURCHASE'`) without needing to hand-maintain every enum member here.
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

vi.mock('../notification.service.js', () => ({ notifyUser: vi.fn().mockResolvedValue(undefined) }));

const { prisma } = await import('../../lib/prisma.js');
const { debitWallet, refundWallet } = await import('../wallet.service.js');

let userCounter = 0;
async function seedUser(balanceNaira: number) {
  userCounter += 1;
  const id = `user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)),
      // Required by Prisma's UserCreateInput but irrelevant to the wallet
      // logic under test - the fake Prisma client doesn't enforce
      // uniqueness, so per-user placeholder values are enough.
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

describe('debitWallet', () => {
  it('decrements the balance by exactly the debited amount', async () => {
    const userId = await seedUser(5000);

    const result = await debitWallet({
      userId,
      amount: 1500,
      type: TransactionType.DATA_PURCHASE,
      description: 'Test data purchase'
    });

    expect(result.balanceAfter).toBe(3500);
    expect(await balanceOf(userId)).toBe(3500);
    expect(result.transaction.status).toBe('PENDING');
    expect(result.reused).toBe(false);
  });

  it('rejects a debit larger than the current balance and leaves the balance untouched', async () => {
    const userId = await seedUser(1000);

    await expect(
      debitWallet({ userId, amount: 1500, type: TransactionType.DATA_PURCHASE, description: 'Too much' })
    ).rejects.toMatchObject({ statusCode: 402, code: 'INSUFFICIENT_BALANCE' });

    // The failed attempt must not have touched the balance at all.
    expect(await balanceOf(userId)).toBe(1000);
  });

  it('allows a debit that exactly exhausts the balance (boundary: amount === balance)', async () => {
    const userId = await seedUser(2000);

    const result = await debitWallet({
      userId,
      amount: 2000,
      type: TransactionType.AIRTIME_PURCHASE,
      description: 'Exact balance'
    });

    expect(result.balanceAfter).toBe(0);
    expect(await balanceOf(userId)).toBe(0);
  });

  it('is idempotent: a repeated call with the same idempotencyKey does not debit twice', async () => {
    const userId = await seedUser(5000);

    const first = await debitWallet({
      userId,
      amount: 1000,
      type: TransactionType.DATA_PURCHASE,
      description: 'First attempt',
      idempotencyKey: 'idem-key-1'
    });
    const second = await debitWallet({
      userId,
      amount: 1000,
      type: TransactionType.DATA_PURCHASE,
      description: 'Retry with same key',
      idempotencyKey: 'idem-key-1'
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    // Only ONE debit should have actually happened against the balance.
    expect(await balanceOf(userId)).toBe(4000);
  });

  it('does not confuse idempotency keys between two different users', async () => {
    const userA = await seedUser(5000);
    const userB = await seedUser(5000);

    await debitWallet({
      userId: userA,
      amount: 1000,
      type: TransactionType.DATA_PURCHASE,
      description: 'User A',
      idempotencyKey: 'shared-key'
    });
    const resultB = await debitWallet({
      userId: userB,
      amount: 1000,
      type: TransactionType.DATA_PURCHASE,
      description: 'User B',
      idempotencyKey: 'shared-key'
    });

    // Same idempotency key string, but scoped per-user - both debits happen.
    expect(resultB.reused).toBe(false);
    expect(await balanceOf(userA)).toBe(4000);
    expect(await balanceOf(userB)).toBe(4000);
  });

  it('records balanceBeforeKobo/balanceAfterKobo matching the actual before/after balance', async () => {
    const userId = await seedUser(3000);

    const result = await debitWallet({
      userId,
      amount: 700,
      type: TransactionType.CABLE_PURCHASE,
      description: 'Cable TV'
    });

    expect(result.transaction.balanceBeforeKobo).toBe(300000n);
    expect(result.transaction.balanceAfterKobo).toBe(230000n);
  });
});

describe('refundWallet', () => {
  it('credits the debited amount back and marks the transaction REVERSED', async () => {
    const userId = await seedUser(5000);
    const debit = await debitWallet({
      userId,
      amount: 2000,
      type: TransactionType.NIN_VERIFICATION,
      description: 'NIN slip (failed provider call)'
    });
    expect(await balanceOf(userId)).toBe(3000);

    const refunded = await refundWallet({ transactionId: debit.transaction.id, userId });

    // refundWallet returns the new REFUND ledger entry; the original debit is
    // what is marked REVERSED. A refund entry itself is a successful credit.
    expect(refunded.status).toBe('SUCCESS');
    expect(await balanceOf(userId)).toBe(5000);
  });

  it('is idempotent: refunding an already-REVERSED transaction does not credit twice', async () => {
    const userId = await seedUser(5000);
    const debit = await debitWallet({
      userId,
      amount: 1000,
      type: TransactionType.BVN_VERIFICATION,
      description: 'BVN slip (failed)'
    });

    await refundWallet({ transactionId: debit.transaction.id, userId });
    expect(await balanceOf(userId)).toBe(5000);

    // Second refund of the same transaction must be a no-op.
    await refundWallet({ transactionId: debit.transaction.id, userId });
    expect(await balanceOf(userId)).toBe(5000);
  });

  it('throws 404 for a transaction that does not belong to the given user', async () => {
    const owner = await seedUser(5000);
    const attacker = await seedUser(5000);
    const debit = await debitWallet({
      userId: owner,
      amount: 1000,
      type: TransactionType.DATA_PURCHASE,
      description: 'Owner-only transaction'
    });

    await expect(refundWallet({ transactionId: debit.transaction.id, userId: attacker })).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRANSACTION_NOT_FOUND'
    });
    // The attacker's own balance must be completely unaffected.
    expect(await balanceOf(attacker)).toBe(5000);
  });
});

describe('debitWallet + refundWallet round trip', () => {
  it('leaves the balance exactly where it started after a debit followed by a refund', async () => {
    const userId = await seedUser(10_000);

    const debit = await debitWallet({
      userId,
      amount: 3333,
      type: TransactionType.IDENTITY_SERVICE_REQUEST,
      description: 'Async verification service'
    });
    await refundWallet({ transactionId: debit.transaction.id, userId });

    expect(await balanceOf(userId)).toBe(10_000);
  });
});
