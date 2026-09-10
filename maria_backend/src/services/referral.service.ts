import { nanoid } from 'nanoid';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { ApiError } from '../middleware/error.js';
import { koboToNaira, nairaToKobo } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { notifyUser } from './notification.service.js';

function formatNaira(kobo: bigint) {
  return `NGN${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Admin-editable referral program settings (rate, minimum withdrawal,
 * on/off switch) - see the ReferralSettings AdminJS resource. Creates the
 * singleton row on first read so there's no separate seed step; every
 * caller below reads this fresh rather than caching it, so a change the
 * admin makes takes effect on the very next purchase/withdrawal.
 *
 * Deliberately NOT prisma.referralSettings.upsert(): Prisma throws
 * ("Argument `update` must not be empty") if upsert's `update` object is
 * empty, which it was here since a routine read must never touch an
 * existing row. That meant the very first call ever (row doesn't exist ->
 * CREATE path) succeeded, but every call after that (row exists -> UPDATE
 * path -> throws on the empty update) failed with a 500 - on every referral
 * stats fetch, every commission award, and every withdrawal attempt.
 */
export async function getReferralSettings() {
  const existing = await prisma.referralSettings.findUnique({ where: { id: 'default' } });
  if (existing) return existing;

  try {
    return await prisma.referralSettings.create({ data: { id: 'default' } });
  } catch (error) {
    // Two concurrent first-ever callers both see "no row exists" and both
    // attempt to create it - only one create can win. Re-fetch and use
    // whichever row actually landed rather than surfacing a spurious error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.referralSettings.findUniqueOrThrow({ where: { id: 'default' } });
    }
    throw error;
  }
}

/**
 * Credits the referrer with a commission on a referee's successful purchase.
 * Best-effort by design (see callers in vtu.routes.ts): a bug here must never
 * roll back or fail the purchase itself, so this never throws - it logs and
 * returns instead.
 */
export async function awardReferralCommission(params: {
  buyerId: string;
  purchaseAmountKobo: bigint;
  sourceTransactionId: string;
}) {
  try {
    const settings = await getReferralSettings();
    if (!settings.isEnabled) return;

    const buyer = await prisma.user.findUnique({ where: { id: params.buyerId } });
    if (!buyer?.referredByCode) return;

    const referrer = await prisma.user.findUnique({
      where: { referralCode: buyer.referredByCode }
    });
    // Referrer may not exist if the code was stale/invalid at signup, or a
    // user somehow ended up with their own code - either way, skip silently.
    if (!referrer || referrer.id === buyer.id) return;

    const commissionKobo = BigInt(
      Math.round(Number(params.purchaseAmountKobo) * settings.commissionRate)
    );
    if (commissionKobo <= 0n) return;

    const updatedReferrer = await prisma.user.update({
      where: { id: referrer.id },
      data: { referralEarningsKobo: { increment: commissionKobo } }
    });

    // Recorded against the referrer's transaction history for visibility/audit,
    // but doesn't touch walletBalanceKobo yet - it's "pending" until the
    // referrer explicitly withdraws it (see withdrawReferralCommission below).
    await prisma.transaction.create({
      data: {
        id: nanoid(),
        userId: referrer.id,
        type: TransactionType.REFERRAL_COMMISSION,
        status: TransactionStatus.SUCCESS,
        amountKobo: commissionKobo,
        balanceBeforeKobo: updatedReferrer.walletBalanceKobo,
        balanceAfterKobo: updatedReferrer.walletBalanceKobo,
        reference: `IDS-REF-${Date.now()}-${nanoid(8).toUpperCase()}`,
        description: `Referral commission from ${buyer.fullName}`,
        metadata: {
          refereeId: buyer.id,
          refereeName: buyer.fullName,
          sourceTransactionId: params.sourceTransactionId,
          rate: settings.commissionRate
        }
      }
    });

    await notifyUser({
      userId: referrer.id,
      type: 'WALLET',
      title: 'Referral commission earned',
      body: `You earned ${formatNaira(commissionKobo)} commission from ${buyer.fullName}'s purchase.`,
      data: {}
    });
  } catch (error) {
    console.error('[referral] Failed to award commission', error);
  }
}

export async function getReferralStats(userId: string) {
  const [user, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getReferralSettings()
  ]);

  const [refereeCount, referees, commissionTx] = await Promise.all([
    prisma.user.count({ where: { referredByCode: user.referralCode } }),
    prisma.user.findMany({
      where: { referredByCode: user.referralCode },
      select: { id: true, fullName: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.transaction.findMany({
      where: { userId, type: TransactionType.REFERRAL_COMMISSION, status: TransactionStatus.SUCCESS }
    })
  ]);

  // Per-referee transaction count + commission earned from them specifically,
  // derived from the metadata stamped on each commission record above.
  const refereeIds = referees.map((r) => r.id);
  const [txCounts, commissionByReferee] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['userId'],
      where: { userId: { in: refereeIds }, status: TransactionStatus.SUCCESS },
      _count: { _all: true }
    }),
    (() => {
      const totals = new Map<string, bigint>();
      for (const tx of commissionTx) {
        const refereeId = (tx.metadata as Prisma.JsonObject | null)?.refereeId;
        if (typeof refereeId !== 'string') continue;
        totals.set(refereeId, (totals.get(refereeId) ?? 0n) + tx.amountKobo);
      }
      return totals;
    })()
  ]);
  const txCountByUser = new Map(txCounts.map((c) => [c.userId, c._count._all]));

  return {
    referral_code: user.referralCode,
    total_referrals: refereeCount,
    total_earned: koboToNaira(user.referralEarningsKobo + user.referralWithdrawnKobo),
    pending_commission: koboToNaira(user.referralEarningsKobo),
    paid_commission: koboToNaira(user.referralWithdrawnKobo),
    commission_rate: settings.commissionRate,
    min_withdrawal: koboToNaira(settings.minWithdrawalKobo),
    is_enabled: settings.isEnabled,
    referees: referees.map((r) => ({
      name: r.fullName,
      joined_at: r.createdAt.toISOString(),
      total_transactions: txCountByUser.get(r.id) ?? 0,
      commission_earned: koboToNaira(commissionByReferee.get(r.id) ?? 0n)
    }))
  };
}

/**
 * Moves some or all of the pending referral commission into the spendable
 * wallet balance. Mirrors manualWalletAdjustment's transaction pattern in
 * wallet.service.ts.
 */
export async function withdrawReferralCommission(userId: string, amountNaira: number) {
  const settings = await getReferralSettings();
  if (!settings.isEnabled) {
    throw new ApiError(403, 'The referral program is currently unavailable', 'REFERRAL_DISABLED');
  }

  const amountKobo = nairaToKobo(amountNaira);
  if (amountKobo < settings.minWithdrawalKobo) {
    throw new ApiError(
      422,
      `Minimum withdrawal is ${formatNaira(settings.minWithdrawalKobo)}`,
      'BELOW_MIN_WITHDRAWAL'
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.user.updateMany({
      where: { id: userId, referralEarningsKobo: { gte: amountKobo } },
      data: {
        referralEarningsKobo: { decrement: amountKobo },
        referralWithdrawnKobo: { increment: amountKobo },
        walletBalanceKobo: { increment: amountKobo }
      }
    });
    if (updateResult.count === 0) {
      throw new ApiError(402, 'Insufficient pending commission for this withdrawal', 'INSUFFICIENT_COMMISSION');
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    const transaction = await tx.transaction.create({
      data: {
        id: nanoid(),
        userId,
        type: TransactionType.REFERRAL_COMMISSION,
        status: TransactionStatus.SUCCESS,
        amountKobo,
        balanceBeforeKobo: user.walletBalanceKobo - amountKobo,
        balanceAfterKobo: user.walletBalanceKobo,
        reference: `IDS-REFW-${Date.now()}-${nanoid(8).toUpperCase()}`,
        description: 'Referral commission withdrawn to wallet',
        metadata: { withdrawal: true }
      }
    });

    return { transaction, user };
  });

  await notifyUser({
    userId,
    type: 'WALLET',
    title: 'Commission withdrawn',
    body: `${formatNaira(amountKobo)} was moved from your referral commission into your wallet. New balance: ${formatNaira(result.user.walletBalanceKobo)}.`,
    data: { transactionId: result.transaction.id }
  });

  return result;
}
