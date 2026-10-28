import { Router } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { transactionDirection } from '../lib/transaction-direction.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptTransactionPII } from '../services/verification.service.js';
import { hubbuService } from '../services/hubbu.service.js';

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
function serialize(tx: TransactionRow, includeMetadata = false) {
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
    ...(includeMetadata ? { metadata: tx.metadata } : {}),
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

  res.json({ status: true, data: transactions.map((tx) => serialize(tx)) });
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

  res.json(serialize(tx, true));
});

// Document bytes are deliberately fetched only when the customer opens or
// reprints a record. History/list responses contain transaction metadata and
// a lightweight document URL, never an embedded PDF or uploaded file.
transactionRoutes.get('/:id/document', async (req, res) => {
  const tx = await prisma.transaction.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: { id: true, reference: true, metadata: true }
  });
  if (!tx) return res.status(404).json({ status: false, message: 'Transaction not found' });
  const metadata = tx.metadata as Record<string, unknown> | null;
  const pii = decryptTransactionPII(tx.metadata) ?? {};
  const hubbuToken = typeof (pii as Record<string, unknown>).hubbu_download_token === 'string'
    ? (pii as Record<string, unknown>).hubbu_download_token as string
    : undefined;
  if (hubbuToken) {
    try {
      const pdf = await hubbuService.downloadSlip(hubbuToken);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${tx.reference}.pdf"`, 'Cache-Control': 'private, no-store' });
      return res.send(pdf);
    } catch (error) {
      console.error('[hubbu] owner slip download failed:', { transactionId: tx.id, reference: tx.reference, error });
      return res.status(502).json({ status: false, message: 'The slip could not be retrieved from the provider right now.' });
    }
  }
  const findArtifact = (keys: Set<string>) => {
    const visit = (value: unknown, seen = new Set<object>()): string | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return null;
      seen.add(value);
      const record = value as Record<string, unknown>;
      for (const [key, candidate] of Object.entries(record)) {
        if (keys.has(key.toLowerCase()) && typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
      for (const child of Object.values(record)) {
        const found = visit(child, seen);
        if (found) return found;
      }
      return null;
    };
    return visit(pii);
  };
  const encoded = (typeof metadata?.pdf_base64 === 'string' && metadata.pdf_base64) || findArtifact(new Set(['pdf_base64', 'certificate_pdf_base64', 'attestation_pdf_base64', 'publication_pdf_base64', 'submission_pdf_base64', 'file_base64']));
  if (encoded) {
    const base64 = encoded.replace(/^data:application\/pdf;base64,/i, '');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${tx.reference}.pdf"`, 'Cache-Control': 'private, no-store' });
    return res.send(Buffer.from(base64, 'base64'));
  }
  const externalUrl = (typeof metadata?.pdf_url === 'string' && metadata.pdf_url) || findArtifact(new Set(['pdf_url', 'slip_url', 'download_url', 'file_url', 'document_url']));
  if (externalUrl && !/^https:\/\//i.test(externalUrl)) return res.status(404).json({ status: false, message: 'No document is available for this transaction' });
  if (externalUrl) return res.redirect(302, externalUrl);
  return res.status(404).json({ status: false, message: 'No document is available for this transaction' });
});
