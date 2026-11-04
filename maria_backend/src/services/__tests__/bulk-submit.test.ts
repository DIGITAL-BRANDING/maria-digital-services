import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same mocking approach as ipe-clearance.test.ts: in-memory fake Prisma plus
 * an echo-Proxy for enums. These tests cover the bulk fan-out only; the
 * single-item submit underneath (debit, refund, provider routing) has its own
 * coverage in ipe-clearance.test.ts.
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
vi.mock('../provider-ledger.service.js', () => ({ recordProviderDebit: vi.fn().mockResolvedValue(undefined) }));

const submitIpeClearanceMock = vi.fn();
const checkIpeClearanceMock = vi.fn();
vi.mock('../ktech.service.js', () => ({
  ktechService: { submitIpeClearance: submitIpeClearanceMock, checkIpeClearance: checkIpeClearanceMock }
}));
vi.mock('../techhub.service.js', () => ({
  techhubService: {
    submitIpeClearance: vi.fn(() => {
      throw new Error('IPE Clearance must not call Techhub - it is pinned to K-Tech');
    }),
    checkIpeClearance: vi.fn(() => {
      throw new Error('IPE Clearance must not call Techhub - it is pinned to K-Tech');
    })
  }
}));

const { prisma } = await import('../../lib/prisma.js');
const { submitIpeClearanceBulk, getVerificationPrice } = await import('../verification.service.js');

let userCounter = 0;
async function seedUser(balanceKobo: bigint) {
  userCounter += 1;
  const id = `bulk-user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: balanceKobo,
      fullName: `Bulk User ${userCounter}`,
      email: `bulk-user-${userCounter}@example.test`,
      phone: `+23482222${String(userCounter).padStart(4, '0')}`,
      referralCode: `BULKREF${userCounter}`
    }
  });
  return id;
}

async function balanceKoboOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.walletBalanceKobo;
}

/** getVerificationPrice returns naira; the wallet works in kobo. */
async function unitKobo() {
  const price = await getVerificationPrice('IPE_CLEARANCE');
  return BigInt(Math.round(price.unitPrice * 100));
}

let ticketCounter = 0;
beforeEach(() => {
  submitIpeClearanceMock.mockReset();
  checkIpeClearanceMock.mockReset();
  submitIpeClearanceMock.mockImplementation(async (trackingId: string) => {
    ticketCounter += 1;
    if (trackingId.startsWith('REJECT')) {
      return { ok: false, message: 'Provider rejected the tracking ID', raw: {} };
    }
    return { ok: true, ticketId: `TICKET-${ticketCounter}`, message: 'submitted', raw: {} };
  });
});

describe('IPE Clearance bulk submit', () => {
  it('debits and submits every unique tracking ID as its own ticket', async () => {
    const price = await unitKobo();
    const userId = await seedUser(price * 10n);

    const summary = await submitIpeClearanceBulk({
      userId,
      trackingIds: ['TRACK001', 'TRACK002', 'TRACK003'],
      idempotencyKey: 'batch-happy-1'
    });

    expect(summary.submitted_count).toBe(3);
    expect(summary.failed_count).toBe(0);
    expect(summary.skipped_count).toBe(0);
    const ticketIds = summary.results.map((r) => r.ticket_id);
    expect(new Set(ticketIds).size).toBe(3);
    expect(submitIpeClearanceMock).toHaveBeenCalledTimes(3);
    expect(await balanceKoboOf(userId)).toBe(price * 7n);
  });

  it('charges a duplicated line only once', async () => {
    const price = await unitKobo();
    const userId = await seedUser(price * 10n);

    const summary = await submitIpeClearanceBulk({
      userId,
      trackingIds: ['DUP000001', 'DUP000001', 'DUP000002'],
      idempotencyKey: 'batch-dup-1'
    });

    expect(summary.submitted_count).toBe(2);
    expect(summary.skipped_count).toBe(1);
    expect(submitIpeClearanceMock).toHaveBeenCalledTimes(2);
    expect(await balanceKoboOf(userId)).toBe(price * 8n);
  });

  it('stops at the balance limit and never charges past it', async () => {
    const price = await unitKobo();
    const userId = await seedUser(price * 2n);

    const summary = await submitIpeClearanceBulk({
      userId,
      trackingIds: ['FUND00001', 'FUND00002', 'FUND00003', 'FUND00004'],
      idempotencyKey: 'batch-funds-1'
    });

    expect(summary.submitted_count).toBe(2);
    expect(summary.failed_count + summary.skipped_count).toBe(2);
    expect(await balanceKoboOf(userId)).toBe(0n);
    expect(summary.message).toMatch(/submitted/);
  });

  it('refunds a line the provider rejects and reports it as failed', async () => {
    const price = await unitKobo();
    const userId = await seedUser(price * 5n);

    const summary = await submitIpeClearanceBulk({
      userId,
      trackingIds: ['GOOD00001', 'REJECT0001'],
      idempotencyKey: 'batch-reject-1'
    });

    expect(summary.submitted_count).toBe(1);
    expect(summary.failed_count).toBe(1);
    const rejected = summary.results.find((r) => r.input === 'REJECT0001');
    expect(rejected?.status).toBe('failed');
    // Only the accepted line stays charged.
    expect(await balanceKoboOf(userId)).toBe(price * 4n);
  });

  it('replays the same batch key without charging twice', async () => {
    const price = await unitKobo();
    const userId = await seedUser(price * 10n);
    const input = { userId, trackingIds: ['REPLAY001', 'REPLAY002'], idempotencyKey: 'batch-replay-1' };

    const first = await submitIpeClearanceBulk(input);
    const second = await submitIpeClearanceBulk(input);

    expect(first.results.map((r) => r.ticket_id)).toEqual(second.results.map((r) => r.ticket_id));
    expect(submitIpeClearanceMock).toHaveBeenCalledTimes(2);
    expect(await balanceKoboOf(userId)).toBe(price * 8n);
  });
});
