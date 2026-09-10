import { Prisma, TransactionStatus } from '@prisma/client';
import { ApiError } from '../middleware/error.js';
import { koboToNaira } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { refundWallet } from './wallet.service.js';
import { recordProviderDebit } from './provider-ledger.service.js';
import { awardReferralCommission } from './referral.service.js';
import { notifyUser } from './notification.service.js';

/**
 * Handles any provider's ambiguous "in progress" response status - not a
 * confirmed success, not a confirmed failure. Today only BilalSadaSub
 * produces one (its "process" status - see the doc-comment on normalize()
 * in bilalsadasub.service.ts), but this file is intentionally
 * provider-agnostic: Alrahuz's provider.service.ts treats ANY status text
 * it doesn't recognize as an outright failure (auto-refund) today, which
 * carries the exact same risk BilalSadaSub's "process" does if Alrahuz ever
 * starts returning its own "pending"/"queued" status - so `provider` is a
 * parameter everywhere here, never hardcoded, and this same flow can be
 * wired up for Alrahuz (or any future provider) the moment its normalize()
 * starts setting `pending: true` too.
 *
 * There is no requery/status-check endpoint confirmed for BilalSadaSub from
 * their docs (the two "validate" endpoints already in bilalsadasub.service.ts
 * are marked UNVERIFIED for the same reason - the integration was built from
 * partial doc screenshots). Rather than guess at a requery endpoint and risk
 * silently mis-polling, a transaction left in this state is surfaced here
 * for a human admin to resolve - by checking the provider's own merchant
 * dashboard/support for the real outcome - via /admin/provider-reconciliation.
 * If a provider's docs are later confirmed to include a real requery
 * endpoint, an automatic poller can be added in front of this without
 * changing anything downstream: it would just call resolveAsSuccess/
 * resolveAsFailed itself instead of leaving the row for a human.
 */

/**
 * Called from the purchase route (cable.routes.ts, electricity.routes.ts,
 * vtu.routes.ts's processProviderPurchase, result-pin.service.ts) the moment
 * a provider responds with `pending: true`. Leaves the transaction's status
 * as PENDING (its state right after debitWallet()) - just stamps it with
 * the provider info and a `reconciliation` metadata block so
 * /admin/provider-reconciliation can find and display it, and logs a
 * grep-able marker for anyone watching Railway logs in real time.
 */
export async function flagPendingReconciliation(params: {
  transactionId: string;
  provider: string;
  providerRef?: string;
  providerMessage?: string;
  rawStatus?: unknown;
}) {
  const existing = await prisma.transaction.findUniqueOrThrow({ where: { id: params.transactionId } });
  const existingMetadata = (existing.metadata as Record<string, unknown> | null) ?? {};

  await prisma.transaction.update({
    where: { id: params.transactionId },
    data: {
      provider: params.provider,
      providerRef: params.providerRef ?? null,
      metadata: {
        ...existingMetadata,
        reconciliation: {
          flaggedAt: new Date().toISOString(),
          providerMessage: params.providerMessage ?? null,
          rawStatus: params.rawStatus ?? null
        }
      } as Prisma.InputJsonValue
    }
  });

  console.error(
    `[reconcile][${params.provider}] transaction ${params.transactionId} left PENDING - provider returned an ambiguous in-progress status, needs manual review at /admin/provider-reconciliation`
  );
}

export type PendingReconciliationRow = Prisma.TransactionGetPayload<{
  include: { user: { select: { id: true; fullName: true; email: true; phone: true } } };
}>;

/**
 * Everything currently awaiting manual resolution, across every provider -
 * any PENDING transaction that flagPendingReconciliation() stamped with a
 * `reconciliation` metadata block. Deliberately does NOT filter by age - an
 * ambiguous result is ambiguous the moment it happens, not only once it's
 * been sitting a while, so the admin page shows all of them and lets a
 * human judge how stale each one is from `createdAt` itself.
 */
export async function listPendingReconciliations(): Promise<PendingReconciliationRow[]> {
  // `metadata.reconciliation` is only ever set by flagPendingReconciliation()
  // above, so this JSON-path filter is exactly "has been flagged" - across
  // any provider. This is the first place in the codebase filtering a JSON
  // column by path on Postgres; the syntax is correct for Prisma 5.x, but
  // since `prisma generate` couldn't run in the sandbox this was built in,
  // it's only been checked against Prisma's docs, not a live database -
  // worth confirming this returns the expected rows on first real use.
  return prisma.transaction.findMany({
    where: {
      status: TransactionStatus.PENDING,
      metadata: { path: ['reconciliation'], not: Prisma.JsonNull }
    },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } }
  });
}

async function loadResolvableTransaction(transactionId: string) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) throw new ApiError(404, 'Transaction not found', 'TRANSACTION_NOT_FOUND');
  return transaction;
}

/**
 * Admin has confirmed (via BilalSadaSub's dashboard/support) that the
 * purchase actually went through. Mirrors the same success path every
 * purchase route takes on `provider.status === true` - transaction ->
 * SUCCESS, provider ledger debited, referral commission awarded - just
 * triggered by a human instead of the live request. Idempotent: calling
 * this twice (e.g. two admins racing) is a no-op the second time.
 */
export async function resolveReconciliationAsSuccess(params: {
  transactionId: string;
  adminId: string;
  providerRef?: string;
  costKobo?: bigint;
  note?: string;
  /** Result-pin PINs have no requery source - the admin must copy the real
   * pin/serial from BilalSadaSub's own dashboard when confirming success. */
  pin?: string;
  serial?: string;
}) {
  const transaction = await loadResolvableTransaction(params.transactionId);
  if (transaction.status !== TransactionStatus.PENDING) {
    return { transaction, alreadyResolved: true as const };
  }

  const existingMetadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  const finalCostKobo = params.costKobo ?? transaction.costKobo ?? undefined;
  // transaction.provider was already stamped by flagPendingReconciliation()
  // when the purchase route first flagged this row - trust it over
  // re-guessing, since it's the provider that actually returned "pending".
  const resolvedProvider = transaction.provider ?? 'unknown';

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: TransactionStatus.SUCCESS,
      provider: resolvedProvider,
      providerRef: params.providerRef ?? transaction.providerRef,
      ...(finalCostKobo !== undefined ? { costKobo: finalCostKobo } : {}),
      metadata: {
        ...existingMetadata,
        ...(params.pin ? { pin: params.pin } : {}),
        ...(params.serial ? { serial: params.serial } : {}),
        reconciliation: {
          ...((existingMetadata.reconciliation as Record<string, unknown> | undefined) ?? {}),
          resolvedAt: new Date().toISOString(),
          resolvedByAdminId: params.adminId,
          resolvedAs: 'success',
          note: params.note ?? null
        }
      } as Prisma.InputJsonValue
    }
  });

  if (finalCostKobo !== undefined && finalCostKobo > 0n) {
    await recordProviderDebit({
      provider: resolvedProvider,
      amountKobo: finalCostKobo,
      relatedTransactionId: transaction.id,
      description: `${transaction.description} (reconciled manually)`
    }).catch((error) => console.error('[provider-ledger] failed to record debit for', transaction.id, error));
  }

  // Best-effort, same as the live purchase path - never blocks resolution.
  await awardReferralCommission({
    buyerId: transaction.userId,
    purchaseAmountKobo: transaction.amountKobo,
    sourceTransactionId: transaction.id
  }).catch((error) => console.error('[referral] failed to award commission for', transaction.id, error));

  await notifyUser({
    userId: transaction.userId,
    type: 'TRANSACTION',
    title: 'Transaction confirmed',
    body: `${transaction.description} has been confirmed successful.`,
    data: { transactionId: transaction.id, reference: transaction.reference }
  }).catch((error) => console.error('[notification] failed to notify user for', transaction.id, error));

  return { transaction: updated, alreadyResolved: false as const };
}

/**
 * Admin has confirmed the purchase did NOT go through - refund the
 * customer. Mirrors the same failure path every purchase route takes on
 * `provider.status === false`: FAILED + refundWallet(). Idempotent for the
 * same reason as resolveReconciliationAsSuccess above.
 */
export async function resolveReconciliationAsFailed(params: { transactionId: string; adminId: string; reason: string }) {
  const transaction = await loadResolvableTransaction(params.transactionId);
  if (transaction.status !== TransactionStatus.PENDING) {
    return { transaction, alreadyResolved: true as const };
  }

  const existingMetadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  // Same as resolveReconciliationAsSuccess - keep the provider that was
  // already stamped on this row rather than guessing.
  const resolvedProvider = transaction.provider ?? 'unknown';

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: TransactionStatus.FAILED,
      provider: resolvedProvider,
      metadata: {
        ...existingMetadata,
        reconciliation: {
          ...((existingMetadata.reconciliation as Record<string, unknown> | undefined) ?? {}),
          resolvedAt: new Date().toISOString(),
          resolvedByAdminId: params.adminId,
          resolvedAs: 'failed',
          note: params.reason
        }
      } as Prisma.InputJsonValue
    }
  });

  // refundWallet() sends its own "Transaction reversed" notification to the
  // user - no separate notifyUser() call needed here.
  const refunded = await refundWallet({
    transactionId: transaction.id,
    userId: transaction.userId,
    reason: params.reason,
    initiatedByAdminId: params.adminId
  });

  return { transaction: refunded, alreadyResolved: false as const, balanceAfter: koboToNaira(refunded.balanceAfterKobo) };
}
