import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { requireAuth } from '../middleware/auth.js';

export const transactionRoutes = Router();

transactionRoutes.use(requireAuth);

transactionRoutes.get('/', async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  res.json({
    status: true,
    data: transactions.map((tx) => ({
      id: tx.id,
      reference: tx.reference,
      type: tx.type.toLowerCase(),
      status: tx.status.toLowerCase(),
      amount: koboToNaira(tx.amountKobo),
      balance_after: koboToNaira(tx.balanceAfterKobo),
      description: tx.description,
      created_at: tx.createdAt.toISOString(),
      metadata: tx.metadata
    }))
  });
});

transactionRoutes.get('/:id', async (req, res) => {
  const tx = await prisma.transaction.findFirstOrThrow({
    where: { id: req.params.id, userId: req.user!.id }
  });

  res.json({
    id: tx.id,
    reference: tx.reference,
    type: tx.type.toLowerCase(),
    status: tx.status.toLowerCase(),
    amount: koboToNaira(tx.amountKobo),
    balance_after: koboToNaira(tx.balanceAfterKobo),
    description: tx.description,
    created_at: tx.createdAt.toISOString(),
    metadata: tx.metadata
  });
});
