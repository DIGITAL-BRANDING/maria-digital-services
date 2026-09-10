import { Router, type Request } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { z } from 'zod';
import { koboToNaira } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import { providerService, type ProviderPurchaseInput } from '../services/provider.service.js';
import * as bilalsadasub from '../services/bilalsadasub.service.js';
import { getPricingSettings } from '../services/pricing-settings.service.js';
import type { NormalizedProviderResponse } from '../services/provider-types.js';
import { debitWallet, refundWallet } from '../services/wallet.service.js';
import { recordProviderDebit } from '../services/provider-ledger.service.js';
import { awardReferralCommission } from '../services/referral.service.js';
import { flagPendingReconciliation } from '../services/provider-reconciliation.service.js';

export const vtuRoutes = Router();

vtuRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

/**
 * Which upstream handles data/airtime right now - PricingSettings.
 * dataAirtimeProvider, admin-editable at /admin/bulk-pricing, read fresh on
 * every call so a switch takes effect immediately with no redeploy. Falls
 * back to 'alrahuz' for any unrecognized value rather than throwing, so a
 * bad/blank DB value can never take purchasing down entirely.
 */
async function activeDataAirtimeProvider(): Promise<'alrahuz' | 'bilalsadasub'> {
  const settings = await getPricingSettings();
  return settings.dataAirtimeProvider === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';
}

/**
 * Shared purchase flow for anything that debits the wallet then calls the provider
 * (data, airtime, and later electricity/cable). Handles:
 *  - idempotent replay: if this request was already processed, return the cached result
 *    instead of debiting/calling the provider again
 *  - refund on provider failure: the debit always happens first (so balance can never go
 *    negative if the provider call times out mid-flight), and is reversed if the provider
 *    reports failure
 */
export async function processProviderPurchase(params: {
  userId: string;
  amount: number;
  type: TransactionType;
  description: string;
  metadata: Prisma.InputJsonValue;
  idempotencyKey?: string;
  provider: 'alrahuz' | 'bilalsadasub';
  /**
   * Our best-known cost basis at debit time (e.g. plan.providerAmount for
   * data). Omit for purchase types with no config-based cost available up
   * front (airtime) - `provider.costKobo`, the ACTUAL cost the provider's
   * response reports, always wins over this estimate on success; this is
   * only what gets stored if that actual figure isn't available. See the
   * costKobo doc-comment on debitWallet() in wallet.service.ts.
   */
  costKobo?: bigint;
  callProvider: (reference: string) => Promise<NormalizedProviderResponse>;
}) {
  const debit = await debitWallet({
    userId: params.userId,
    amount: params.amount,
    type: params.type,
    description: params.description,
    metadata: params.metadata,
    idempotencyKey: params.idempotencyKey,
    costKobo: params.costKobo
  });

  // Replaying a request we've already fully handled (success, failed+refunded, or reversed) —
  // don't call the provider again, just return what happened last time.
  if (debit.reused && debit.transaction.status !== TransactionStatus.PENDING) {
    return {
      status: debit.transaction.status === TransactionStatus.SUCCESS ? ('success' as const) : false,
      message: 'Transaction already processed',
      reference: debit.reference,
      balanceAfter: koboToNaira(debit.transaction.balanceAfterKobo)
    };
  }

  const provider = await params.callProvider(debit.reference);

  if (provider.status) {    const finalCostKobo = provider.costKobo ?? params.costKobo;

    await prisma.transaction.update({
      where: { id: debit.transaction.id },
      data: {
        status: TransactionStatus.SUCCESS,
        provider: params.provider,
        providerRef: provider.providerRef ?? null,
        // The provider's own reported balance delta, when present, is more
        // accurate than the config-based estimate debitWallet() stored above
        // (it's what we were ACTUALLY charged, this one time) - overwrite
        // with it. Otherwise leave the estimate (or null) as-is.
        ...(provider.costKobo !== undefined ? { costKobo: provider.costKobo } : {})
      }
    });

    // Best-effort - never blocks a successful purchase response. Only
    // recorded when a real cost figure exists (see recordProviderDebit's
    // own no-op-on-null-ish-amount guard) - an unknown-cost purchase must
    // never appear as a free (zero-cost) debit on the provider ledger.
    if (finalCostKobo !== undefined) {
      await recordProviderDebit({
        provider: params.provider,
        amountKobo: finalCostKobo,
        relatedTransactionId: debit.transaction.id,
        description: params.description
      }).catch((error) => {
        console.error('[provider-ledger] failed to record debit for', debit.transaction.id, error);
      });
    }

    // Best-effort by design (see the function's own doc comment) - never
    // throws, so it can't turn a successful purchase into a failed response.
    await awardReferralCommission({
      buyerId: params.userId,
      purchaseAmountKobo: debit.transaction.amountKobo,
      sourceTransactionId: debit.transaction.id
    });

    return {
      status: 'success' as const,
      message: provider.message ?? 'Transaction processed',
      reference: debit.reference,
      balanceAfter: debit.balanceAfter
    };
  }

  // A provider's ambiguous "in progress" status - not a confirmed failure,
  // so DON'T auto-refund (see flagPendingReconciliation()'s doc-comment for
  // why). Only BilalSadaSub sets `pending` today; Alrahuz's
  // provider.service.ts never does, so this branch is currently
  // unreachable when params.provider === 'alrahuz' - existing Alrahuz
  // behavior is unchanged.
  if (provider.pending) {
    await flagPendingReconciliation({
      transactionId: debit.transaction.id,
      provider: params.provider,
      providerRef: provider.providerRef,
      providerMessage: provider.message
    });
    return {
      status: false as const,
      message: 'Your purchase is still being confirmed by the provider. If it does not complete shortly, please contact support with your reference.',
      reference: debit.reference,
      balanceAfter: debit.balanceAfter
    };
  }

  // Provider failed: reverse the debit so the user isn't charged for nothing.
  await prisma.transaction.update({
    where: { id: debit.transaction.id },
    data: {
      status: TransactionStatus.FAILED,
      provider: params.provider,
      providerRef: provider.providerRef ?? null
    }
  });
  const refunded = await refundWallet({ transactionId: debit.transaction.id, userId: params.userId });

  return {
    status: false as const,
    message: provider.message ?? 'Transaction failed and was refunded',
    reference: debit.reference,
    balanceAfter: koboToNaira(refunded.balanceAfterKobo)
  };
}

vtuRoutes.get('/data/plans/:network/categories', async (req, res) => {
  const provider = await activeDataAirtimeProvider();
  const categories =
    provider === 'bilalsadasub'
      ? await bilalsadasub.getDataPlanCategories(req.params.network)
      : await providerService.getDataPlanCategories(req.params.network);
  res.json({ status: true, data: categories });
});

vtuRoutes.get('/data/plans/:network', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const provider = await activeDataAirtimeProvider();
  const plans =
    provider === 'bilalsadasub'
      ? await bilalsadasub.getDataPlans(req.params.network, category)
      : await providerService.getDataPlans(req.params.network, category);
  // Cheapest first, regardless of which provider/category this came from -
  // sorted here (not inside each provider service) so it's guaranteed
  // consistent no matter which one is active. Sorts on sellingAmount (what
  // the customer actually pays), not providerAmount (our cost) - those two
  // can rank differently once markup varies per plan.
  const sorted = [...plans].sort((a, b) => a.sellingAmount - b.sellingAmount);
  res.json({ status: true, data: sorted });
});

vtuRoutes.post('/data/purchase', async (req, res) => {
  const body = z.object({
    network: z.string(),
    plan_id: z.string(),
    phone: z.string(),
    amount: z.number().positive().optional(),
    ...pinField
  }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);

  const provider = await activeDataAirtimeProvider();
  const plan =
    provider === 'bilalsadasub'
      ? await bilalsadasub.getDataPlan(body.network, body.plan_id)
      : await providerService.getDataPlan(body.network, body.plan_id);

  // Never persist the PIN - `body` is spread into Transaction.metadata below,
  // so it's stripped out explicitly rather than trusting every future edit
  // here to remember not to include it.
  const { pin: _pin, ...metadataBody } = body;

  const result = await processProviderPurchase({
    userId: req.user!.id,
    amount: plan.amount,
    type: TransactionType.DATA_PURCHASE,
    description: `${plan.name} data purchase for ${body.phone}`,
    metadata: { ...metadataBody, amount: plan.amount, plan_name: plan.name, validity: plan.validity, provider },
    idempotencyKey: idempotencyKeyFrom(req),
    provider,
    // What this plan cost us according to our last pricing sync
    // (DataPlanPricing.providerCostKobo) - overwritten with the provider's
    // actual reported balance delta on success, see processProviderPurchase above.
    costKobo: BigInt(Math.round(plan.providerAmount * 100)),
    callProvider: (reference) =>
      provider === 'bilalsadasub'
        ? bilalsadasub.buyData({ network: body.network, planId: body.plan_id, phone: body.phone, reference })
        : providerService.buyData({
            network: body.network,
            planId: body.plan_id,
            phone: body.phone,
            amount: plan.amount,
            reference
          } satisfies ProviderPurchaseInput)
  });

  res.json({
    status: result.status,
    message: result.message,
    data: { reference: result.reference, balance_after: result.balanceAfter }
  });
});

vtuRoutes.post('/airtime/purchase', async (req, res) => {
  const body = z.object({
    network: z.string(),
    phone: z.string(),
    amount: z.number().positive(),
    ...pinField
  }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);

  const { pin: _pin, ...metadataBody } = body;
  const provider = await activeDataAirtimeProvider();

  const result = await processProviderPurchase({
    userId: req.user!.id,
    amount: body.amount,
    type: TransactionType.AIRTIME_PURCHASE,
    description: `Airtime purchase for ${body.phone}`,
    metadata: { ...metadataBody, provider },
    // No `costKobo` here on purpose - unlike data plans, airtime has no
    // pricing-config table to estimate from (neither provider quotes a
    // fixed discount rate up front). Our real cost is only knowable from
    // the provider's own balance_before/balance_after delta once they
    // respond - see provider.costKobo in processProviderPurchase above. In
    // MOCK_PROVIDER mode (no real balance movement), this stays null -
    // "unknown", not "0 margin" - see the costKobo comment on the
    // Transaction model.
    idempotencyKey: idempotencyKeyFrom(req),
    provider,
    callProvider: (reference) =>
      provider === 'bilalsadasub'
        ? bilalsadasub.buyAirtime({ network: body.network, phone: body.phone, amount: body.amount, reference })
        : providerService.buyAirtime({
            network: body.network,
            phone: body.phone,
            amount: body.amount,
            reference
          } satisfies ProviderPurchaseInput)
  });

  res.json({
    status: result.status,
    message: result.message,
    data: { reference: result.reference, balance_after: result.balanceAfter }
  });
});
