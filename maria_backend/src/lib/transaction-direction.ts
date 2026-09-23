/**
 * Single source of truth for "does this transaction ADD money to the wallet
 * or TAKE it out?".
 *
 * The web app used to keep its own hard-coded list of credit types
 * (wallet_funding, referral_commission, coupon_redemption, manual_adjustment)
 * which silently missed `refund` - so every refund was rendered as a red
 * "-₦150.00" debit and was even added into "Total spent". Deciding this in
 * one place on the server means every client (web, Flutter, admin) agrees.
 *
 * Kept free of `@prisma/client` imports on purpose (plain string unions) so it
 * can be unit-tested without a generated Prisma client.
 */

const CREDIT_TYPES: ReadonlySet<string> = new Set([
  'WALLET_FUNDING',
  'REFERRAL_COMMISSION',
  'COUPON_REDEMPTION',
  'REFUND'
]);

export type TransactionDirection = 'credit' | 'debit';

export function transactionDirection(type: string, metadata?: unknown): TransactionDirection {
  // Admin adjustments can go either way - the direction is recorded in metadata
  // by manualWalletAdjustment(). Anything without it is treated as a credit,
  // which matches how these rows were displayed before.
  if (type === 'MANUAL_ADJUSTMENT') {
    const direction =
      metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>).direction : undefined;
    return direction === 'debit' ? 'debit' : 'credit';
  }
  return CREDIT_TYPES.has(type) ? 'credit' : 'debit';
}

/** Types that are already a credit to the wallet - reversing them would ADD money, so they are never refundable. */
export function isCreditType(type: string, metadata?: unknown): boolean {
  return transactionDirection(type, metadata) === 'credit';
}
