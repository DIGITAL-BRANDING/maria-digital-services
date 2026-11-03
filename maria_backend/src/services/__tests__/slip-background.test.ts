import { describe, expect, it, vi } from 'vitest';

/** Background slip processing: respond after the debit, settle later, report via getSlipStatus. */

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

vi.mock('../provider-reconciliation.service.js', () => ({ flagPendingReconciliation: vi.fn().mockResolvedValue(undefined) }));

const bvnSlip = vi.fn();
vi.mock('../ktech.service.js', () => ({ ktechService: { bvnSlip: vi.fn(), assertConfigured: vi.fn() } }));
vi.mock('../hubbu.service.js', () => ({ hubbuService: { bvnSlip: vi.fn(), assertConfigured: vi.fn() } }));
vi.mock('../techhub.service.js', () => ({ techhubService: { bvnSlip } }));

const { prisma } = await import('../../lib/prisma.js');
const { flagPendingReconciliation } = await import('../provider-reconciliation.service.js');
const { purchaseBvnSlip, getSlipStatus } = await import('../verification.service.js');
const { ApiError } = await import('../../middleware/error.js');

let n = 0;
async function seedUser(balanceNaira: number) {
  n += 1;
  const id = `slip-user-${n}`;
  await prisma.user.create({
    data: { id, walletBalanceKobo: BigInt(Math.round(balanceNaira * 100)), fullName: `T ${n}`, email: `s${n}@example.test`, phone: `+23482222${String(n).padStart(4, '0')}`, referralCode: `SLIP${n}` }
  });
  return id;
}
async function balanceOf(id: string) {
  return Number((await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalanceKobo) / 100;
}
/** Let the un-awaited background settle finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('background slip processing', () => {
  it('answers right after the debit, then reports success once the provider finishes', async () => {
    let finish!: (value: unknown) => void;
    bvnSlip.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const userId = await seedUser(5000);

    const started = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true });
    expect(started).toMatchObject({ status: false, pending: true, processing: true });
    expect(await balanceOf(userId)).toBeLessThan(5000);
    expect(await getSlipStatus({ userId, reference: started.reference })).toEqual({ state: 'processing' });

    finish({ ok: true, message: 'done', userData: { first_name: 'JOHN' }, pdfBase64: 'JVBERi0=', raw: {} });
    await flush();

    const status = await getSlipStatus({ userId, reference: started.reference });
    expect(status).toMatchObject({ state: 'success', pdfBase64: 'JVBERi0=', userData: { first_name: 'JOHN' } });
  });

  it('refunds and returns the provider reason when the provider rejects it', async () => {
    bvnSlip.mockResolvedValue({ ok: false, message: 'BVN not found', raw: {} });
    const userId = await seedUser(5000);
    const started = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true });
    await flush();

    const status = await getSlipStatus({ userId, reference: started.reference });
    expect(status).toMatchObject({ state: 'failed' });
    expect((status as { message: string }).message).toContain('BVN not found');
    expect(await balanceOf(userId)).toBe(5000);
  });

  it('keeps an unconfirmed result for review (no refund) and flags it', async () => {
    bvnSlip.mockResolvedValue({ ok: false, ambiguous: true, message: 'maybe', raw: null });
    const userId = await seedUser(5000);
    const started = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true });
    await flush();

    expect((await getSlipStatus({ userId, reference: started.reference })).state).toBe('review');
    expect(await balanceOf(userId)).toBeLessThan(5000);
    expect(flagPendingReconciliation).toHaveBeenCalled();
  });

  it('refunds when the provider client is not configured (request never left)', async () => {
    bvnSlip.mockRejectedValue(new ApiError(500, 'no key', 'TECHHUB_NOT_CONFIGURED'));
    const userId = await seedUser(5000);
    const started = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true });
    await flush();

    expect((await getSlipStatus({ userId, reference: started.reference })).state).toBe('failed');
    expect(await balanceOf(userId)).toBe(5000);
  });

  it('parks an unexpected error for review instead of refunding blindly', async () => {
    bvnSlip.mockRejectedValue(new Error('socket hang up'));
    const userId = await seedUser(5000);
    const started = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true });
    await flush();

    expect((await getSlipStatus({ userId, reference: started.reference })).state).toBe('review');
    expect(await balanceOf(userId)).toBeLessThan(5000);
  });

  it('a retry with the same key while still running reports processing, without a second debit or provider call', async () => {
    bvnSlip.mockReturnValue(new Promise(() => undefined));
    const userId = await seedUser(5000);
    bvnSlip.mockClear();
    const first = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true, idempotencyKey: 'k1' });
    const after = await balanceOf(userId);
    const second = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium', background: true, idempotencyKey: 'k1' });
    expect(second).toMatchObject({ reference: first.reference, processing: true });
    expect(await balanceOf(userId)).toBe(after);
    expect(bvnSlip).toHaveBeenCalledTimes(1);
  });

  it('foreground mode still returns the final result in one call', async () => {
    bvnSlip.mockResolvedValue({ ok: true, message: 'ok', pdfBase64: 'JVBERi0=', raw: {} });
    const userId = await seedUser(5000);
    const result = await purchaseBvnSlip({ userId, bvn: '12345678901', tier: 'premium' });
    expect(result).toMatchObject({ status: true, pdfBase64: 'JVBERi0=' });
    expect(result.processing).toBeUndefined();
  });

  it('does not show another customer\'s request', async () => {
    bvnSlip.mockResolvedValue({ ok: true, message: 'ok', pdfBase64: 'JVBERi0=', raw: {} });
    const owner = await seedUser(5000);
    const other = await seedUser(5000);
    const started = await purchaseBvnSlip({ userId: owner, bvn: '12345678901', tier: 'premium', background: true });
    await flush();
    await expect(getSlipStatus({ userId: other, reference: started.reference })).rejects.toThrow(/not found/i);
  });
});
