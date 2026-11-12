import { describe, expect, it, vi } from 'vitest';

/**
 * A provider refund must reach the customer.
 *
 * Same mocking approach as ipe-clearance.test.ts: in-memory fake Prisma plus an
 * echo-Proxy for the enums (this sandbox's generated Prisma client is a stub).
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
vi.mock('../provider-ledger.service.js', () => ({
  recordProviderDebit: vi.fn().mockResolvedValue(undefined),
  recordProviderRefundCredit: vi.fn().mockResolvedValue(undefined)
}));

const submitIpeClearanceMock = vi.fn();
const checkIpeClearanceMock = vi.fn();
vi.mock('../ktech.service.js', () => ({
  ktechService: { submitIpeClearance: submitIpeClearanceMock, checkIpeClearance: checkIpeClearanceMock }
}));
vi.mock('../techhub.service.js', () => ({ techhubService: {} }));
vi.mock('../pricing-settings.service.js', () => ({ activeIdentityVerificationProvider: vi.fn() }));

const { prisma } = await import('../../lib/prisma.js');
const { recordProviderRefundCredit } = await import('../provider-ledger.service.js');
const { providerSignalsRefund } = await import('../../lib/provider-refund.js');
const { submitIpeClearance, checkIpeClearanceStatus, settleKtechTicket } = await import('../verification.service.js');

// The shared fake Prisma has no `OR` support, which settleKtechTicket's lookup
// uses. Teach just this test's copy to resolve `OR: [{ providerRef }, ...]`.
const fakeTransaction = prisma.transaction as unknown as {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
};
const baseFindFirst = fakeTransaction.findFirst.bind(fakeTransaction);
fakeTransaction.findFirst = async ({ where }) => {
  const { OR, provider: _provider, type: _type, ...rest } = where as Record<string, unknown> & { OR?: Array<Record<string, unknown>> };
  if (!Array.isArray(OR)) return baseFindFirst({ where });
  for (const alt of OR) {
    if (typeof alt.providerRef !== 'string' && typeof alt.reference !== 'string' && typeof alt.id !== 'string') continue;
    const found = await baseFindFirst({ where: { ...rest, ...alt } });
    if (found) return found;
  }
  return null;
};

let userCounter = 0;
async function seedUser(balanceNaira: number) {
  userCounter += 1;
  const id = `refund-user-${userCounter}`;
  await prisma.user.create({
    data: {
      id,
      walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)),
      fullName: `Refund User ${userCounter}`,
      email: `refund-user-${userCounter}@example.test`,
      phone: `+23482222${String(userCounter).padStart(4, '0')}`,
      referralCode: `RFNDREF${userCounter}`
    }
  });
  return id;
}

async function balanceOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return Number(user.walletBalanceKobo) / 100;
}

let ticketCounter = 0;
async function submitTicket(userId: string) {
  ticketCounter += 1;
  const ticketId = `RFND-TICKET-${ticketCounter}`;
  submitIpeClearanceMock.mockResolvedValueOnce({ ok: true, ticketId, message: 'submitted', raw: {} });
  const submitted = await submitIpeClearance({ userId, trackingId: `TRK${String(ticketCounter).padStart(12, '0')}` });
  return { ticketId, ...submitted };
}

describe('providerSignalsRefund', () => {
  it.each([
    [{ status: 'refunded' }],
    [{ status: ' Reversed ' }],
    [{ data: { status: 'refunded' } }],
    [{ event: 'transaction.refunded', data: { status: 'success' } }],
    [{ event_type: 'wallet_refund' }],
    [{ refunded: true }]
  ])('recognises a refund in %j', (payload) => {
    expect(providerSignalsRefund(payload)).toBe(true);
  });

  it.each([
    [{ status: 'failed' }],
    [{ status: 'rejected' }],
    [{ status: 'success' }],
    [{ event: 'transaction.updated', data: { status: 'success', type: 'data_purchase' } }],
    [{ event: 'refund_failed' }],
    [{ status: 'not_refunded' }],
    [{ refunded: false }],
    [null],
    ['refunded']
  ])('does NOT treat %j as a refund', (payload) => {
    expect(providerSignalsRefund(payload)).toBe(false);
  });

  it('looks at every source it is given', () => {
    expect(providerSignalsRefund({ status: 'failed' }, null, { data: { status: 'refunded' } })).toBe(true);
  });
});

describe('provider refunds reach the customer', () => {
  it('refunds an IPE ticket that was still pending when the provider refunded it', async () => {
    const userId = await seedUser(2000);
    const { ticketId, balanceAfter } = await submitTicket(userId);
    expect(await balanceOf(userId)).toBe(balanceAfter);

    checkIpeClearanceMock.mockResolvedValueOnce({
      ticketId,
      status: 'failed',
      response: { status: 'refunded' },
      raw: { status: true, data: { status: 'refunded', ticket_id: ticketId } }
    });
    const status = await checkIpeClearanceStatus({ userId, ticketId });

    expect(status.status).toBe('failed');
    expect(await balanceOf(userId)).toBeGreaterThan(balanceAfter);
  });

  it('refunds an IPE ticket we already closed as failed (no refund) once the provider refunds it later', async () => {
    const userId = await seedUser(2000);
    const { ticketId, balanceAfter } = await submitTicket(userId);

    // Step 1: plain failure - IPE is non-refundable, so the wallet is untouched.
    checkIpeClearanceMock.mockResolvedValueOnce({ ticketId, status: 'failed', response: null, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId });
    expect(await balanceOf(userId)).toBe(balanceAfter);

    // Step 2: still failed, provider has NOT refunded - nothing changes.
    checkIpeClearanceMock.mockResolvedValueOnce({ ticketId, status: 'failed', response: null, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId });
    expect(await balanceOf(userId)).toBe(balanceAfter);

    // Step 3: the provider refunds it. This is the case that used to be ignored.
    checkIpeClearanceMock.mockResolvedValueOnce({
      ticketId,
      status: 'failed',
      response: null,
      raw: { data: { status: 'refunded' } }
    });
    await checkIpeClearanceStatus({ userId, ticketId });
    const refunded = await balanceOf(userId);
    expect(refunded).toBeGreaterThan(balanceAfter);

    // Step 4: polled again, and the provider still says refunded - paid exactly once.
    checkIpeClearanceMock.mockResolvedValue({
      ticketId,
      status: 'failed',
      response: null,
      raw: { data: { status: 'refunded' } }
    });
    await checkIpeClearanceStatus({ userId, ticketId });
    await checkIpeClearanceStatus({ userId, ticketId });
    expect(await balanceOf(userId)).toBe(refunded);
  });

  it('a failed IPE ticket is still readable when the provider cannot be reached for the re-check', async () => {
    const userId = await seedUser(2000);
    const { ticketId } = await submitTicket(userId);
    checkIpeClearanceMock.mockResolvedValueOnce({ ticketId, status: 'failed', response: null, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId });

    checkIpeClearanceMock.mockRejectedValueOnce(new Error('provider down'));
    const status = await checkIpeClearanceStatus({ userId, ticketId });

    expect(status.status).toBe('failed');
  });

  it('refunds via the webhook for a ticket we had already marked SUCCESS, and credits the provider ledger once', async () => {
    const userId = await seedUser(2000);
    const { ticketId, balanceAfter } = await submitTicket(userId);

    checkIpeClearanceMock.mockResolvedValueOnce({ ticketId, status: 'success', response: { note: 'done' }, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId });
    expect(await balanceOf(userId)).toBe(balanceAfter);

    // Make sure there is a recorded provider cost to offset.
    const row = await prisma.transaction.findFirst({ where: { userId, providerRef: ticketId } });
    await prisma.transaction.update({ where: { id: row!.id }, data: { costKobo: 5000n } });
    (recordProviderRefundCredit as ReturnType<typeof vi.fn>).mockClear();

    const webhook = {
      ticketId,
      status: 'failed' as const,
      response: { status: 'refunded' },
      raw: { event: 'transaction.refunded', data: { status: 'refunded', ticket_id: ticketId } }
    };
    const first = await settleKtechTicket(webhook);
    expect(first.handled).toBe(true);
    const refunded = await balanceOf(userId);
    expect(refunded).toBeGreaterThan(balanceAfter);

    // K-Tech retries deliveries - a redelivery must not pay out again.
    await settleKtechTicket(webhook);
    expect(await balanceOf(userId)).toBe(refunded);
    expect(recordProviderRefundCredit).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ktech', amountKobo: 5000n, relatedTransactionId: row!.id })
    );
  });

  it('a plain failure webhook for a SUCCESS ticket does NOT refund (only an explicit provider refund does)', async () => {
    const userId = await seedUser(2000);
    const { ticketId, balanceAfter } = await submitTicket(userId);
    checkIpeClearanceMock.mockResolvedValueOnce({ ticketId, status: 'success', response: { note: 'done' }, raw: {} });
    await checkIpeClearanceStatus({ userId, ticketId });

    await settleKtechTicket({
      ticketId,
      status: 'failed',
      response: { status: 'failed' },
      raw: { event: 'transaction.updated', data: { status: 'failed', ticket_id: ticketId } }
    });

    expect(await balanceOf(userId)).toBe(balanceAfter);
  });
});
