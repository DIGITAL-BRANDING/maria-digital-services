import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { koboToNaira, nairaToKobo } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { clearLockout, isLocked, recordFailure } from '../lib/lockout.js';
import { notifyUser } from './notification.service.js';

function formatNaira(kobo: bigint) {
  return `NGN${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Store the configured percentage as basis points (1/100th of one percent),
// so 2.5% is exact and all calculations remain in integer kobo.
const WALLET_FUNDING_FEE_BASIS_POINTS = BigInt(Math.round(env.WALLET_FUNDING_FEE_PERCENT * 100));

function fundingFeeKobo(amountKobo: bigint) {
  return (amountKobo * WALLET_FUNDING_FEE_BASIS_POINTS) / 10_000n;
}

/**
 * Debits the configured WALLET_FUNDING_FEE_PERCENT fee right after a wallet-funding
 * credit, as its own separate, linked Transaction - not folded into the
 * funding transaction's own amount - so a user's history clearly shows
 * "Wallet funded ₦1,000" followed by its percentage fee as two distinct
 * line items, and Company Wallet's profit-by-type report picks up
 * WALLET_FUNDING_FEE automatically as its own revenue line (costKobo 0 - no
 * upstream cost) without needing any special-case aggregation logic.
 *
 * MUST be called from inside the SAME `tx` (Prisma transaction) that just
 * performed the funding credit, using the balance it left behind - never
 * re-reads the user row itself, so there's no window where the fee could be
 * computed against a balance some other concurrent operation has since
 * changed.
 *
 * If the funded amount is smaller than the fee itself (shouldn't normally
 * happen - callers enforce sane minimums - but defends against ever pushing
 * a balance negative), the fee is silently skipped for that one funding.
 */
async function applyFundingFee(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    fundingTransactionId: string;
    fundingReference: string;
    fundingAmountKobo: bigint;
    balanceAfterFunding: bigint;
  }
) {
  const feeKobo = fundingFeeKobo(params.fundingAmountKobo);
  if (feeKobo <= 0n) return null; // fee disabled or too small to produce one kobo
  if (params.balanceAfterFunding < feeKobo) return null;

  const after = await tx.user.update({
    where: { id: params.userId },
    data: { walletBalanceKobo: { decrement: feeKobo } }
  });

  return tx.transaction.create({
    data: {
      id: nanoid(),
      userId: params.userId,
      type: TransactionType.WALLET_FUNDING_FEE,
      status: TransactionStatus.SUCCESS,
      amountKobo: feeKobo,
      costKobo: 0n,
      balanceBeforeKobo: params.balanceAfterFunding,
      balanceAfterKobo: after.walletBalanceKobo,
      relatedTransactionId: params.fundingTransactionId,
      reference: `FEE-${params.fundingReference}`,
      description: `Wallet funding fee (${env.WALLET_FUNDING_FEE_PERCENT}% / ${formatNaira(feeKobo)})`
    }
  });
}

export async function setPin(userId: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new ApiError(422, 'PIN must be 4 digits', 'INVALID_PIN');
  const pinHash = await bcrypt.hash(pin, 12);
  const cleared = clearLockout();
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash, pinFailures: cleared.failures, pinLockedUntil: cleared.lockedUntil, pinFailureAt: cleared.failureAt }
  });
}

/**
 * Verifies the 4-digit transaction PIN, locking out after 5 failures. Shares
 * its rolling-window failure logic with the account password and login PIN -
 * see src/lib/lockout.ts.
 */
export async function verifyPin(userId: string, pin: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (isLocked(user.pinLockedUntil)) {
    throw new ApiError(423, 'PIN is temporarily locked', 'PIN_LOCKED');
  }
  if (!user.pinHash) throw new ApiError(400, 'Transaction PIN has not been set', 'PIN_NOT_SET');

  const ok = await bcrypt.compare(pin, user.pinHash);
  if (!ok) {
    const next = recordFailure(
      { failures: user.pinFailures, failureAt: user.pinFailureAt },
      { maxFailures: 5, lockoutMinutes: 30 }
    );
    await prisma.user.update({
      where: { id: userId },
      data: { pinFailures: next.failures, pinLockedUntil: next.lockedUntil, pinFailureAt: next.failureAt }
    });
    throw new ApiError(401, 'Invalid transaction PIN', 'INVALID_PIN');
  }

  const cleared = clearLockout();
  await prisma.user.update({
    where: { id: userId },
    data: { pinFailures: cleared.failures, pinLockedUntil: cleared.lockedUntil, pinFailureAt: cleared.failureAt }
  });
  return true;
}

export type DebitResult = {
  transaction: Prisma.TransactionGetPayload<Record<string, never>>;
  reference: string;
  balanceAfter: number;
  /** true when an existing transaction with the same idempotency key was returned instead of creating a new debit */
  reused: boolean;
};

/**
 * Debits a user's wallet atomically and idempotently.
 *
 * - Atomic: uses a conditional `updateMany` (WHERE balance >= amount) so two concurrent
 *   requests can never both succeed against the same balance (no read-then-write race).
 * - Idempotent: if `idempotencyKey` is provided and a transaction with that key already
 *   exists for this user, the existing transaction is returned instead of debiting again.
 *   Callers (route handlers) should check `reused` and, if the prior transaction already
 *   reached a final state (SUCCESS/FAILED/REVERSED), skip calling the provider again.
 */
export async function debitWallet(params: {
  userId: string;
  amount: number;
  type: TransactionType;
  description: string;
  metadata?: Prisma.InputJsonValue;
  idempotencyKey?: string;
  /**
   * Our cost basis for this purchase, in kobo, captured up front from
   * whatever pricing config the caller already looked up (e.g.
   * DataPlanPricing.providerCostKobo, ServicePricing.providerCostKobo).
   * Omit when there's no cost basis at all (funding, transfers, manual
   * adjustments, etc) or when it genuinely isn't known yet (e.g. airtime,
   * whose real cost is only learned from Alrahuz's response balance delta -
   * see normalize() in provider.service.ts, which overwrites this with the
   * observed actual cost on success when one is available). Never pass an
   * estimated/guessed value just to avoid a null - company-wallet.service.ts
   * treats a null costKobo as "unknown, excluded from margin totals", which
   * is safer than a wrong number silently poisoning a profit report.
   */
  costKobo?: bigint;
}): Promise<DebitResult> {
  if (params.idempotencyKey) {
    const existing = await prisma.transaction.findFirst({
      where: { userId: params.userId, idempotencyKey: params.idempotencyKey }
    });
    if (existing) {
      return {
        transaction: existing,
        reference: existing.reference,
        balanceAfter: koboToNaira(existing.balanceAfterKobo),
        reused: true
      };
    }
  }

  const amountKobo = nairaToKobo(params.amount);
  const reference = `IDS-${Date.now()}-${nanoid(8).toUpperCase()}`;

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: params.userId } });
    if (!before) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');

    // Conditional update: only decrements if the balance is still sufficient at write time.
    // This closes the race window that a read-then-write (findUnique + update) leaves open
    // between two concurrent debits.
    const updateResult = await tx.user.updateMany({
      where: { id: params.userId, walletBalanceKobo: { gte: amountKobo } },
      data: { walletBalanceKobo: { decrement: amountKobo } }
    });

    if (updateResult.count === 0) {
      throw new ApiError(402, 'Insufficient wallet balance', 'INSUFFICIENT_BALANCE');
    }

    const after = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });

    let transaction;
    try {
      transaction = await tx.transaction.create({
        data: {
          id: nanoid(),
          userId: params.userId,
          type: params.type,
          status: TransactionStatus.PENDING,
          amountKobo,
          balanceBeforeKobo: before.walletBalanceKobo,
          balanceAfterKobo: after.walletBalanceKobo,
          reference,
          idempotencyKey: params.idempotencyKey,
          description: params.description,
          metadata: params.metadata,
          costKobo: params.costKobo ?? null
        }
      });
    } catch (error) {
      // Unique constraint race: two requests with the same idempotency key arrived
      // at (almost) the same time and both passed the initial lookup above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Duplicate request', 'DUPLICATE_IDEMPOTENCY_KEY');
      }
      throw error;
    }

    return {
      transaction,
      reference,
      balanceAfter: koboToNaira(after.walletBalanceKobo),
      reused: false
    };
  });
}

/**
 * Records a wallet funding attempt as PENDING before redirecting the user to Paystack.
 * The balance is NOT touched here - it only changes once the payment is confirmed via
 * `creditWalletByReference`, which is called from the webhook (and can also be called
 * from a manual "verify payment" endpoint as a fallback if the webhook is ever missed).
 */
export async function createPendingFunding(params: {
  userId: string;
  amount: number;
  reference: string;
  /** Which gateway this attempt is going through - defaults to 'paystack' for callers that predate KatPay support. */
  provider?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const amountKobo = nairaToKobo(params.amount);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });

  return prisma.transaction.create({
    data: {
      id: nanoid(),
      userId: params.userId,
      type: TransactionType.WALLET_FUNDING,
      status: TransactionStatus.PENDING,
      amountKobo,
      balanceBeforeKobo: user.walletBalanceKobo,
      balanceAfterKobo: user.walletBalanceKobo, // unchanged until the payment is confirmed
      reference: params.reference,
      provider: params.provider ?? 'paystack',
      description: params.description ?? 'Wallet funding via Paystack',
      metadata: params.metadata
    }
  });
}

/**
 * Confirms a funding transaction and credits the wallet. Idempotent: if the transaction
 * is already SUCCESS (e.g. the webhook fired twice, which Paystack does not guarantee
 * against), this is a no-op and returns the existing record without crediting again.
 */
export async function creditWalletByReference(reference: string) {
  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({ where: { reference } });
    if (!transaction) throw new ApiError(404, 'Transaction not found', 'TRANSACTION_NOT_FOUND');
    if (transaction.status === TransactionStatus.SUCCESS) {
      return { transaction, finalBalanceKobo: transaction.balanceAfterKobo, alreadyCredited: true };
    }

    const user = await tx.user.update({
      where: { id: transaction.userId },
      data: { walletBalanceKobo: { increment: transaction.amountKobo } }
    });

    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: { status: TransactionStatus.SUCCESS, balanceAfterKobo: user.walletBalanceKobo }
    });

    const fee = await applyFundingFee(tx, {
      userId: updated.userId,
      fundingTransactionId: updated.id,
      fundingReference: updated.reference,
      fundingAmountKobo: updated.amountKobo,
      balanceAfterFunding: user.walletBalanceKobo
    });

    return { transaction: updated, finalBalanceKobo: fee?.balanceAfterKobo ?? updated.balanceAfterKobo, alreadyCredited: false };
  });

  // Fired only for THIS transaction's userId, and only once (skipped on the
  // idempotent replay branch above) - never a broadcast to every user.
  if (!result.alreadyCredited) {
    const feeNote = result.finalBalanceKobo !== result.transaction.balanceAfterKobo
      ? ` A ${env.WALLET_FUNDING_FEE_PERCENT}% (${formatNaira(fundingFeeKobo(result.transaction.amountKobo))}) transaction fee was applied.`
      : '';
    await notifyUser({
      userId: result.transaction.userId,
      type: 'WALLET',
      title: 'Wallet funded',
      body: `Your wallet was credited with ${formatNaira(result.transaction.amountKobo)}.${feeNote} New balance: ${formatNaira(result.finalBalanceKobo)}.`,
      data: { transactionId: result.transaction.id, reference: result.transaction.reference }
    });
  }

  // Every caller (wallet.routes.ts's /fund/verify response, admin tooling,
  // etc.) reads `.balanceAfterKobo` off the return value expecting "the
  // user's balance right now" - override it to the true POST-fee figure
  // here so that holds, without needing every call site to separately know
  // about the fee. The Transaction row itself in the DB is untouched (its
  // own balanceAfterKobo correctly reflects just that one funding credit,
  // in order, ahead of the separate WALLET_FUNDING_FEE row) - only this
  // in-memory returned copy carries the convenience override.
  return { ...result.transaction, balanceAfterKobo: result.finalBalanceKobo };
}

/**
 * Credits a wallet for a bank transfer that arrived with NO pre-created pending
 * transaction - i.e. the user transferred directly into their permanent Dedicated
 * Virtual Account out-of-band, rather than going through /wallet/fund or
 * /wallet/fund/dynamic. The webhook calls this once it's confirmed (via
 * `verifyTransaction`) that no existing transaction matches the reference.
 *
 * Idempotent: `reference` is Paystack's own transaction reference, which is
 * globally unique, and `Transaction.reference` has a unique constraint - so if
 * Paystack redelivers the same webhook, the second insert fails with P2002 and we
 * simply return the transaction the first delivery already created.
 */
export async function creditDirectDeposit(params: {
  reference: string;
  amountKobo: bigint;
  customerCode: string;
  channel: string;
}) {
  const user = await prisma.user.findFirst({ where: { paystackCustomerCode: params.customerCode } });
  if (!user) {
    throw new ApiError(404, 'No wallet matches this payment\'s customer', 'USER_NOT_FOUND_FOR_PAYMENT');
  }

  try {
    const { transaction, finalBalanceKobo } = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const after = await tx.user.update({
        where: { id: user.id },
        data: { walletBalanceKobo: { increment: params.amountKobo } }
      });

      const created = await tx.transaction.create({
        data: {
          id: nanoid(),
          userId: user.id,
          type: TransactionType.WALLET_FUNDING,
          status: TransactionStatus.SUCCESS,
          amountKobo: params.amountKobo,
          balanceBeforeKobo: before.walletBalanceKobo,
          balanceAfterKobo: after.walletBalanceKobo,
          provider: 'paystack',
          providerRef: params.reference,
          reference: params.reference,
          description: `Wallet funded via direct bank transfer (${params.channel})`,
          metadata: { channel: params.channel, customerCode: params.customerCode }
        }
      });

      const fee = await applyFundingFee(tx, {
        userId: user.id,
        fundingTransactionId: created.id,
        fundingReference: created.reference,
        fundingAmountKobo: created.amountKobo,
        balanceAfterFunding: after.walletBalanceKobo
      });

      return { transaction: created, finalBalanceKobo: fee?.balanceAfterKobo ?? created.balanceAfterKobo };
    });

    // Scoped to this one depositor (resolved above by their unique paystackCustomerCode)
    // - every other user's wallet and notification feed is untouched.
    const feeNote = finalBalanceKobo !== transaction.balanceAfterKobo
      ? ` A ${env.WALLET_FUNDING_FEE_PERCENT}% (${formatNaira(fundingFeeKobo(transaction.amountKobo))}) transaction fee was applied.`
      : '';
    await notifyUser({
      userId: transaction.userId,
      type: 'WALLET',
      title: 'Wallet funded',
      body: `Your wallet was credited with ${formatNaira(transaction.amountKobo)} via bank transfer.${feeNote} New balance: ${formatNaira(finalBalanceKobo)}.`,
      data: { transactionId: transaction.id, reference: transaction.reference }
    });

    return { ...transaction, balanceAfterKobo: finalBalanceKobo };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.transaction.findUniqueOrThrow({ where: { reference: params.reference } });
    }
    throw error;
  }
}

/**
 * KatPay equivalent of `creditDirectDeposit` above - credits a bank transfer that
 * arrived with NO pre-created pending transaction, i.e. straight into the user's
 * permanent KatPay virtual account rather than through /wallet/fund/dynamic.
 * Matched by `virtualAccountNumber` instead of a customer code, since KatPay's
 * virtual-account webhook payload identifies the account, not a customer id.
 *
 * Idempotent the same way: `reference` (KatPay's transaction reference/order_no) is
 * unique per `Transaction.reference`, so a redelivered webhook hits the P2002 branch
 * below and just returns what the first delivery already created.
 */
export async function creditDirectDepositByAccountNumber(params: {
  reference: string;
  amountKobo: bigint;
  accountNumber: string;
  channel: string;
}) {
  const accountNumber = params.accountNumber.trim();
  const user = await prisma.user.findFirst({ where: { virtualAccountNumber: accountNumber } });
  if (!user) {
    throw new ApiError(
      404,
      `No wallet matches virtual account number "${accountNumber}"`,
      'USER_NOT_FOUND_FOR_PAYMENT'
    );
  }

  // KatPay's transaction/reference value belongs to the payment provider.  It
  // is not safe to use as this application's globally-unique ledger reference:
  // an older transaction can legitimately already have the same text (for
  // example a name-and-account narration).  Keep it as the provider reference
  // and give our ledger entry a reference we own instead.
  const providerRef = `katpay:virtual-account:${params.reference}`;
  const existing = await prisma.transaction.findFirst({
    where: {
      userId: user.id,
      provider: 'katpay',
      providerRef,
      type: TransactionType.WALLET_FUNDING
    }
  });
  if (existing) return existing;

  try {
    const { transaction, finalBalanceKobo } = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const after = await tx.user.update({
        where: { id: user.id },
        data: { walletBalanceKobo: { increment: params.amountKobo } }
      });

      const created = await tx.transaction.create({
        data: {
          id: nanoid(),
          userId: user.id,
          type: TransactionType.WALLET_FUNDING,
          status: TransactionStatus.SUCCESS,
          amountKobo: params.amountKobo,
          balanceBeforeKobo: before.walletBalanceKobo,
          balanceAfterKobo: after.walletBalanceKobo,
          provider: 'katpay',
          providerRef,
          reference: `KATPAY-VA-${nanoid()}`,
          description: `Wallet funded via direct bank transfer (${params.channel})`,
          metadata: { channel: params.channel, accountNumber: params.accountNumber }
        }
      });

      const fee = await applyFundingFee(tx, {
        userId: user.id,
        fundingTransactionId: created.id,
        fundingReference: created.reference,
        fundingAmountKobo: created.amountKobo,
        balanceAfterFunding: after.walletBalanceKobo
      });

      return { transaction: created, finalBalanceKobo: fee?.balanceAfterKobo ?? created.balanceAfterKobo };
    });

    // Scoped to this one depositor (resolved above by their virtualAccountNumber) -
    // every other user's wallet and notification feed is untouched.
    const feeNote = finalBalanceKobo !== transaction.balanceAfterKobo
      ? ` A ${env.WALLET_FUNDING_FEE_PERCENT}% (${formatNaira(fundingFeeKobo(transaction.amountKobo))}) transaction fee was applied.`
      : '';
    await notifyUser({
      userId: transaction.userId,
      type: 'WALLET',
      title: 'Wallet funded',
      body: `Your wallet was credited with ${formatNaira(transaction.amountKobo)} via bank transfer.${feeNote} New balance: ${formatNaira(finalBalanceKobo)}.`,
      data: { transactionId: transaction.id, reference: transaction.reference }
    });

    return { ...transaction, balanceAfterKobo: finalBalanceKobo };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A concurrent redelivery may win the provider-reference unique index
      // between the lookup above and this create. It has already credited the
      // wallet atomically, so return it without a second credit/notification.
      const redelivered = await prisma.transaction.findFirst({
        where: {
          userId: user.id,
          provider: 'katpay',
          providerRef,
          type: TransactionType.WALLET_FUNDING
        }
      });
      if (redelivered) return redelivered;
    }
    throw error;
  }
}

/**
 * Redeems a prepaid "Fund with Coupon" code and credits its value to the user's
 * wallet. Atomic: the `updateMany` claim only succeeds if the coupon is still
 * unredeemed at write time, so two requests racing to redeem the same code can't
 * both succeed (same guard pattern as debitWallet's balance check).
 */
export async function redeemCoupon(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();

  const result = await prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.findUnique({ where: { code } });
    if (!coupon) throw new ApiError(404, 'Invalid coupon code', 'COUPON_NOT_FOUND');
    if (coupon.isRedeemed) throw new ApiError(409, 'This coupon has already been used', 'COUPON_ALREADY_REDEEMED');
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new ApiError(410, 'This coupon has expired', 'COUPON_EXPIRED');
    }

    const claim = await tx.coupon.updateMany({
      where: { code, isRedeemed: false },
      data: { isRedeemed: true, redeemedByUserId: userId, redeemedAt: new Date() }
    });
    if (claim.count === 0) {
      // Lost the race to another request redeeming the same code at the same time.
      throw new ApiError(409, 'This coupon has already been used', 'COUPON_ALREADY_REDEEMED');
    }

    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const after = await tx.user.update({
      where: { id: userId },
      data: { walletBalanceKobo: { increment: coupon.valueKobo } }
    });

    const transaction = await tx.transaction.create({
      data: {
        id: nanoid(),
        userId,
        type: TransactionType.COUPON_REDEMPTION,
        status: TransactionStatus.SUCCESS,
        amountKobo: coupon.valueKobo,
        balanceBeforeKobo: before.walletBalanceKobo,
        balanceAfterKobo: after.walletBalanceKobo,
        reference: `IDS-CPN-${Date.now()}-${nanoid(8).toUpperCase()}`,
        description: `Wallet funded via coupon ${code}`,
        metadata: { couponId: coupon.id }
      }
    });

    return { transaction, balanceAfter: koboToNaira(after.walletBalanceKobo) };
  });

  await notifyUser({
    userId,
    type: 'WALLET',
    title: 'Coupon redeemed',
    body: `${formatNaira(result.transaction.amountKobo)} was added to your wallet from coupon ${code}. New balance: ${formatNaira(result.transaction.balanceAfterKobo)}.`,
    data: { transactionId: result.transaction.id }
  });

  return result;
}

/** Marks a pending funding attempt as failed (payment declined, expired, etc). Idempotent. */
export async function markFundingFailed(reference: string) {
  return prisma.transaction.updateMany({
    where: { reference, status: TransactionStatus.PENDING },
    data: { status: TransactionStatus.FAILED }
  });
}

/**
 * Admin-initiated wallet credit or debit (e.g. compensating a customer, correcting an
 * error). Always creates a MANUAL_ADJUSTMENT transaction record for the audit trail -
 * this should never be called without a human-readable reason attached.
 */
export async function manualWalletAdjustment(params: {
  userId: string;
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
  adminId: string;
}) {
  const amountKobo = nairaToKobo(params.amount);

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: params.userId } });
    if (!before) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');

    let after;
    if (params.direction === 'debit') {
      const updateResult = await tx.user.updateMany({
        where: { id: params.userId, walletBalanceKobo: { gte: amountKobo } },
        data: { walletBalanceKobo: { decrement: amountKobo } }
      });
      if (updateResult.count === 0) {
        throw new ApiError(402, 'Insufficient wallet balance for this debit', 'INSUFFICIENT_BALANCE');
      }
      after = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
    } else {
      after = await tx.user.update({
        where: { id: params.userId },
        data: { walletBalanceKobo: { increment: amountKobo } }
      });
    }

    const transaction = await tx.transaction.create({
      data: {
        id: nanoid(),
        userId: params.userId,
        type: TransactionType.MANUAL_ADJUSTMENT,
        status: TransactionStatus.SUCCESS,
        amountKobo,
        balanceBeforeKobo: before.walletBalanceKobo,
        balanceAfterKobo: after.walletBalanceKobo,
        reference: `IDS-ADJ-${Date.now()}-${nanoid(8).toUpperCase()}`,
        description: `Manual ${params.direction} by admin: ${params.reason}`,
        metadata: { adminId: params.adminId, direction: params.direction, reason: params.reason }
      }
    });

    return { transaction, balanceAfter: after.walletBalanceKobo };
  });

  await notifyUser({
    userId: params.userId,
    type: 'WALLET',
    title: params.direction === 'credit' ? 'Wallet credited by support' : 'Wallet debited by support',
    body: `${formatNaira(amountKobo)} was ${params.direction === 'credit' ? 'added to' : 'deducted from'} your wallet: ${params.reason}. New balance: ${formatNaira(result.balanceAfter)}.`,
    data: { transactionId: result.transaction.id }
  });

  return result;
}

/**
 * Reverses a debit: credits the amount back to the user's wallet as a NEW,
 * separate REFUND transaction linked to the original via
 * relatedTransactionId - never by rewriting the original row's own
 * balanceBeforeKobo/balanceAfterKobo, which would corrupt the ability to
 * replay the ledger in order (a later reversal would retroactively change
 * what the ledger "looked like" at the time of the original debit). The
 * original transaction's `status` moves to REVERSED - a normal state
 * transition, not a rewrite of historical fact - so it's still immediately
 * obvious from the original row alone that it was reversed, while the actual
 * money movement gets its own accurate, chronologically-ordered entry.
 *
 * Safe to call more than once for the same transaction: if it's already
 * REVERSED, returns the existing REFUND entry instead of creating another
 * (checked both via the status flag and, as a belt-and-braces fallback, the
 * REFUND reference's uniqueness constraint - see the P2002 catch below).
 */
export async function refundWallet(params: {
  transactionId: string;
  userId: string;
  reason?: string;
  initiatedByAdminId?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const original = await tx.transaction.findFirst({
      where: { id: params.transactionId, userId: params.userId }
    });
    if (!original) throw new ApiError(404, 'Transaction not found', 'TRANSACTION_NOT_FOUND');

    if (original.status === TransactionStatus.REVERSED) {
      const existingRefund = await tx.transaction.findFirst({
        where: { relatedTransactionId: original.id, type: TransactionType.REFUND }
      });
      return { transaction: existingRefund ?? original, alreadyReversed: true };
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
    const updatedUser = await tx.user.update({
      where: { id: params.userId },
      data: { walletBalanceKobo: { increment: original.amountKobo } }
    });

    let refund;
    try {
      refund = await tx.transaction.create({
        data: {
          id: nanoid(),
          userId: params.userId,
          type: TransactionType.REFUND,
          status: TransactionStatus.SUCCESS,
          amountKobo: original.amountKobo,
          balanceBeforeKobo: user.walletBalanceKobo,
          balanceAfterKobo: updatedUser.walletBalanceKobo,
          reference: `RFND-${original.reference}`,
          relatedTransactionId: original.id,
          description: params.reason
            ? `Refund: ${params.reason} (was: "${original.description}")`
            : `Refund for "${original.description}"`,
          metadata: {
            originalTransactionId: original.id,
            initiatedByAdminId: params.initiatedByAdminId ?? null
          }
        }
      });
    } catch (error) {
      // Two concurrent refund attempts both passed the REVERSED check above
      // before either committed - the unique `reference` constraint on
      // `RFND-${original.reference}` catches the duplicate here. Whichever
      // request loses the race gets back the winner's row instead of erroring.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        refund = await tx.transaction.findUniqueOrThrow({ where: { reference: `RFND-${original.reference}` } });
      } else {
        throw error;
      }
    }

    await tx.transaction.update({
      where: { id: original.id },
      data: { status: TransactionStatus.REVERSED }
    });

    return { transaction: refund, alreadyReversed: false };
  });

  if (!result.alreadyReversed) {
    await notifyUser({
      userId: params.userId,
      type: 'WALLET',
      title: 'Transaction reversed',
      body: `${formatNaira(result.transaction.amountKobo)} was refunded to your wallet for "${result.transaction.description}". New balance: ${formatNaira(result.transaction.balanceAfterKobo)}.`,
      data: { transactionId: result.transaction.id }
    });
  }

  return result.transaction;
}
