import { Router } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { transactionDirection } from '../lib/transaction-direction.js';
import { requireAuth } from '../middleware/auth.js';

export const transactionRoutes = Router();

transactionRoutes.use(requireAuth);

type TransactionRow = Prisma.TransactionGetPayload<Record<string, never>>;

/**
 * One shape for the list and the single-transaction endpoint.
 *
 * `balance_before` / `balance_after` are the wallet balance immediately before
 * and after THIS row moved money. `direction` tells the client whether the row
 * added money (credit - funding, refund, coupon, referral...) or took it out
 * (debit), so no client has to keep its own list of "credit types" again.
 *
 * `balance_changed` is false for rows that never touched the wallet - e.g. a
 * funding attempt that is still PENDING or FAILED - so the UI can say "no
 * change" instead of showing a before/after pair that are simply equal.
 */
function serialize(tx: TransactionRow) {
  const type = tx.type;
  return {
    id: tx.id,
    reference: tx.reference,
    type: type.toLowerCase(),
    status: tx.status.toLowerCase(),
    direction: transactionDirection(type, tx.metadata),
    amount: koboToNaira(tx.amountKobo),
    balance_before: koboToNaira(tx.balanceBeforeKobo),
    balance_after: koboToNaira(tx.balanceAfterKobo),
    balance_changed: tx.balanceBeforeKobo !== tx.balanceAfterKobo,
    related_transaction_id: tx.relatedTransactionId,
    description: tx.description,
    created_at: tx.createdAt.toISOString(),
    metadata: tx.metadata
  };
}

transactionRoutes.get('/', async (req, res) => {
  const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
  const take = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;

  const transactions = await prisma.transaction.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take
  });

  res.json({ status: true, data: transactions.map(serialize) });
});

/**
 * Lifetime totals for the wallet summary cards. Computed in the database over
 * ALL of the user's transactions - the client used to add up whatever 50 rows
 * it happened to have loaded, so "Total spent" drifted from reality as soon as
 * history grew past one page (and it counted refunds as spending).
 *
 * Only SUCCESS rows count: a debit that was later reversed has status
 * REVERSED, so it drops out of "spent" on its own and the REFUND row that
 * returned the money is a credit, never spend.
 */
transactionRoutes.get('/summary', async (req, res) => {
  const userId = req.user!.id;

  const [byType, adjustments] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, status: TransactionStatus.SUCCESS, type: { not: TransactionType.MANUAL_ADJUSTMENT } },
      _sum: { amountKobo: true }
    }),
    // Admin adjustments can be credits or debits - the direction lives in metadata.
    prisma.transaction.findMany({
      where: { userId, status: TransactionStatus.SUCCESS, type: TransactionType.MANUAL_ADJUSTMENT },
      select: { amountKobo: true, metadata: true }
    })
  ]);

  let fundedKobo = 0n;
  let spentKobo = 0n;
  let refundedKobo = 0n;

  for (const row of byType) {
    const total = row._sum.amountKobo ?? 0n;
    if (row.type === TransactionType.WALLET_FUNDING) fundedKobo += total;
    else if (row.type === TransactionType.REFUND) refundedKobo += total;
    else if (transactionDirection(row.type) === 'debit') spentKobo += total;
  }
  for (const adjustment of adjustments) {
    if (transactionDirection(TransactionType.MANUAL_ADJUSTMENT, adjustment.metadata) === 'debit') {
      spentKobo += adjustment.amountKobo;
    }
  }

  res.json({
    status: true,
    data: {
      total_funded: koboToNaira(fundedKobo),
      total_spent: koboToNaira(spentKobo),
      total_refunded: koboToNaira(refundedKobo)
    }
  });
});

transactionRoutes.get('/:id', async (req, res) => {
  const tx = await prisma.transaction.findFirstOrThrow({
    where: { id: req.params.id, userId: req.user!.id }
  });

  res.json(serialize(tx));
});
