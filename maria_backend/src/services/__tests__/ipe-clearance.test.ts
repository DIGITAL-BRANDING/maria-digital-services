import { describe, expect, it, vi } from 'vitest';

/**
 * Same mocking approach as wallet.service.test.ts: an in-memory fake Prisma
 * (see test-utils/fake-prisma.ts) plus an echo-Proxy for the enums, because
 * this sandbox's generated Prisma client is a stub missing real enum exports.
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
// If IPE Clearance ever fell back to reading the admin's shared
// identityVerificationProvider toggle, this mock throwing makes that
// regression fail loudly instead of silently passing techhub calls through.
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
vi.mock('../pricing-settings.service.js', () => ({
  activeIdentityVerificationProvider: vi.fn(() => {
    throw new Error('IPE Clearance must not consult the shared NIN/BVN provider toggle');
  })
}));

const { prisma } = await import('../../lib/prisma.js');
const { notifyUser } = await import('../notification.service.js');
const { submitIpeClearance, checkIpeClearanceStatus } = await import('../verification.service.js');

let userCounter = 0;
async function seedUser(balanceNaira: number) {
  userCounter += 1;
  const id = `ipe-user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)),
      fullName: `Test User ${userCounter}`,
      email: `ipe-user-${userCounter}@example.test`,
      phone: `+23481111${String(userCounter).padStart(4, '0')}`,
      referralCode: `IPEREF${userCounter}`
    }
  });
  return id;
}

async function balanceOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return Number(user.walletBalanceKobo) / 100;
}

describe('IPE Clearance', () => {
  it('always submits through K-Tech, regardless of the admin NIN/BVN provider setting', async () => {
    submitIpeClearanceMock.mockResolvedValue({ ok: true, ticketId: 'TICKET-1', message: 'submitted', raw: {} });
    const userId = await seedUser(2000);

    const result = await submitIpeClearance({ userId, trackingId: 'ABC123456789012' });

    expect(submitIpeClearanceMock).toHaveBeenCalledWith('ABC123456789012', result.reference);
    expect(result.ticketId).toBe('TICKET-1');
  });

  it('does NOT refund the wallet when a submitted ticket later resolves to failed (IPE is non-refundable)', async () => {
    submitIpeClearanceMock.mockResolvedValue({ ok: true, ticketId: 'TICKET-2', message: 'submitted', raw: {} });
    const userId = await seedUser(2000);
    const { balanceAfter } = await submitIpeClearance({ userId, trackingId: 'BAD00000000001' });
    expect(await balanceOf(userId)).toBe(balanceAfter);

    checkIpeClearanceMock.mockResolvedValue({
      ticketId: 'TICKET-2',
      status: 'failed',
      response: { reason: 'Tracking ID not found' },
      raw: {}
    });
    (notifyUser as ReturnType<typeof vi.fn>).mockClear();

    const status = await checkIpeClearanceStatus({ userId, ticketId: 'TICKET-2' });

    expect(status.status).toBe('failed');
    // Balance stays exactly where it was right after the debit - no refund happened.
    expect(await balanceOf(userId)).toBe(balanceAfter);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    const call = (notifyUser as ReturnType<typeof vi.fn>).mock.calls[0][0] as { body: string; title: string };
    expect(call.title).toBe('IPE Clearance was not successful');
    expect(call.body).toContain('non-refundable');
  });

  it('still refunds when the submit itself fails (no ticket was ever created, so nothing was processed)', async () => {
    submitIpeClearanceMock.mockResolvedValue({ ok: false, message: 'Provider unreachable', raw: {} });
    const userId = await seedUser(2000);
    const startingBalance = await balanceOf(userId);

    await expect(submitIpeClearance({ userId, trackingId: 'ABC123456789012' })).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_SUBMIT_FAILED'
    });

    expect(await balanceOf(userId)).toBe(startingBalance);
  });

  it('a repeated failed-status check does not send a second non-refundable notice', async () => {
    submitIpeClearanceMock.mockResolvedValue({ ok: true, ticketId: 'TICKET-3', message: 'submitted', raw: {} });
    const userId = await seedUser(2000);
    await submitIpeClearance({ userId, trackingId: 'ABC123456789099' });

    checkIpeClearanceMock.mockResolvedValue({ ticketId: 'TICKET-3', status: 'failed', response: null, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId: 'TICKET-3' });
    (notifyUser as ReturnType<typeof vi.fn>).mockClear();

    const second = await checkIpeClearanceStatus({ userId, ticketId: 'TICKET-3' });

    expect(second.status).toBe('failed');
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
