import { describe, expect, it, vi } from 'vitest';

// webhook.routes.ts pulls in prisma, wallet.service.js (which also imports
// prisma), paystack/katpay services, and the WhatsApp session service - none
// of which this test needs, since pickKatpayTransactionReference() is a
// pure function. Mocked out the same way wallet.service.katpay.test.ts mocks
// prisma, so importing the route module here doesn't require a real
// generated Prisma client or live network access.
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../services/wallet.service.js', () => ({
  creditDirectDeposit: vi.fn(),
  creditDirectDepositByAccountNumber: vi.fn(),
  creditWalletByReference: vi.fn(),
  markFundingFailed: vi.fn()
}));
vi.mock('../../services/paystack.service.js', () => ({ paystackService: {} }));
vi.mock('../../services/katpay.service.js', () => ({ katpayService: {} }));
vi.mock('../../services/whatsapp-session.service.js', () => ({ advanceSession: vi.fn() }));

const { pickKatpayTransactionReference } = await import('../webhook.routes.js');

/**
 * Regression coverage for a real production incident: a user's ₦10,000
 * transfer credited fine, but two subsequent ₦250 transfers into the same
 * virtual account both showed "Delivered" on KatPay's dashboard while never
 * reaching the wallet balance. Root cause was webhook.routes.ts trying
 * `transaction.reference` before `transaction.id` when building the dedup
 * key for creditDirectDepositByAccountNumber - for a bank transfer,
 * `reference` is frequently just the narration text (sender name/account),
 * which is identical across every transfer the same sender makes into the
 * same account, so the second and third deposits were silently treated as
 * "already processed" duplicates of the first.
 */
describe('pickKatpayTransactionReference', () => {
  it('prefers the per-event id over a possibly-repeating narration reference', () => {
    // The exact failure mode: three transfers from the same sender share one
    // narration-style `reference`, but each has KatPay's own distinct `id`.
    const first = pickKatpayTransactionReference({ id: 'evt_1', reference: 'JOHN DOE TRANSFER', order_amount: 10000 });
    const second = pickKatpayTransactionReference({ id: 'evt_2', reference: 'JOHN DOE TRANSFER', order_amount: 250 });
    const third = pickKatpayTransactionReference({ id: 'evt_3', reference: 'JOHN DOE TRANSFER', order_amount: 250 });

    expect(first).toBe('evt_1');
    expect(second).toBe('evt_2');
    expect(third).toBe('evt_3');
    // The whole point: three distinct events must not collapse to one key.
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('falls back to order_no, then orderNo, then reference, when id is absent', () => {
    expect(pickKatpayTransactionReference({ order_no: 'ORD-1', reference: 'NARRATION' })).toBe('ORD-1');
    expect(pickKatpayTransactionReference({ orderNo: 'ORD-2', reference: 'NARRATION' })).toBe('ORD-2');
    expect(pickKatpayTransactionReference({ reference: 'NARRATION' })).toBe('NARRATION');
  });

  it('trims whitespace and stringifies non-string ids', () => {
    expect(pickKatpayTransactionReference({ id: '  evt_9  ' })).toBe('evt_9');
    expect(pickKatpayTransactionReference({ id: 12345 })).toBe('12345');
  });

  it('returns undefined when nothing usable is present', () => {
    expect(pickKatpayTransactionReference({})).toBeUndefined();
    expect(pickKatpayTransactionReference({ id: null, reference: undefined })).toBeUndefined();
  });
});
