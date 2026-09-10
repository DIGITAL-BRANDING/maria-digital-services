import { Router, type Request } from 'express';
import { TransactionStatus, TransactionType, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { koboToNaira, nairaToKobo } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import * as bilalsadasub from '../services/bilalsadasub.service.js';
import { getPricingSettings } from '../services/pricing-settings.service.js';
import { debitWallet, refundWallet } from '../services/wallet.service.js';
import { recordProviderDebit } from '../services/provider-ledger.service.js';
import { awardReferralCommission } from '../services/referral.service.js';
import { flagPendingReconciliation } from '../services/provider-reconciliation.service.js';

// Cable TV has no Alrahuz equivalent anywhere in this codebase - always
// BilalSadaSub, unlike data/airtime/result-pins which check PricingSettings.
// Request/response shapes here are dictated by the already-built Flutter UI
// (lib/features/cable_tv/presentation/providers/cable_provider.dart) - this
// file conforms to that contract, not the other way around.
export const cableRoutes = Router();

cableRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

function applyCableMarkup(providerPrice: number, markupPercent: number) {
  return Math.ceil(providerPrice + (providerPrice * markupPercent) / 100);
}

// GET /api/cable/plans/:provider -> CablePlan.fromJson reads id/name/
// (or plan_name)/price/validity - see cable_provider.dart.
cableRoutes.get('/plans/:provider', async (req, res) => {
  const [plans, settings] = await Promise.all([
    bilalsadasub.getCablePlans(req.params.provider),
    getPricingSettings()
  ]);
  const priced = plans.map((plan) => ({
    id: plan.planId,
    name: plan.planName,
    price: applyCableMarkup(plan.amount, settings.cableMarkupPercent)
  }));
  res.json({ status: true, data: priced });
});

// POST /api/cable/validate { provider, smartcard_number } -> { status,
// data: { customer_name } } - see cable_provider.dart's validateSmartcard().
cableRoutes.post('/validate', async (req, res) => {
  const body = z.object({ provider: z.string(), smartcard_number: z.string() }).parse(req.body);
  const result = await bilalsadasub.validateSmartcard({ cable: body.provider, iuc: body.smartcard_number });
  res.json({ status: result.isValid, data: { customer_name: result.customerName } });
});

// POST /api/cable/subscribe { provider, smartcard_number, plan_id, amount }
// -> { status: bool, ... } - see cable_provider.dart's subscribe(). `amount`
// is trusted from the client only as a display echo; the real charge is
// always recomputed server-side from the plan's current priced amount so a
// tampered client value can never change what's actually debited.
cableRoutes.post('/subscribe', async (req, res) => {
  const body = z
    .object({
      provider: z.string(),
      smartcard_number: z.string().min(10).max(10),
      plan_id: z.string(),
      amount: z.number().optional(),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);

  const [plans, settings] = await Promise.all([bilalsadasub.getCablePlans(body.provider), getPricingSettings()]);
  const plan = plans.find((p) => p.planId === body.plan_id);
  if (!plan) {
    return res.status(404).json({ status: false, message: 'Cable plan not found' });
  }
  const amount = applyCableMarkup(plan.amount, settings.cableMarkupPercent);
  const { pin: _pin, ...metadataBody } = body;

  const debit = await debitWallet({
    userId: req.user!.id,
    amount,
    type: TransactionType.CABLE_PURCHASE,
    description: `${plan.cableName} ${plan.planName} for IUC ${body.smartcard_number}`,
    metadata: { ...metadataBody, amount, plan_name: plan.planName, provider: 'bilalsadasub' } as Prisma.InputJsonValue,
    idempotencyKey: idempotencyKeyFrom(req),
    costKobo: nairaToKobo(plan.amount)
  });

  if (debit.reused && debit.transaction.status !== TransactionStatus.PENDING) {
    return res.json({
      status: debit.transaction.status === TransactionStatus.SUCCESS,
      message: 'Transaction already processed',
      reference: debit.reference,
      balance_after: koboToNaira(debit.transaction.balanceAfterKobo)
    });
  }

  const provider = await bilalsadasub.buyCable({
    cable: body.provider,
    iuc: body.smartcard_number,
    planId: body.plan_id,
    reference: debit.reference
  });

  if (provider.status) {
    await prisma.transaction.update({
      where: { id: debit.transaction.id },
      data: {
        status: TransactionStatus.SUCCESS,
        provider: 'bilalsadasub',
        providerRef: provider.providerRef ?? null,
        ...(provider.costKobo !== undefined ? { costKobo: provider.costKobo } : {})
      }
    });

    const finalCostKobo = provider.costKobo ?? nairaToKobo(plan.amount);
    await recordProviderDebit({
      provider: 'bilalsadasub',
      amountKobo: finalCostKobo,
      relatedTransactionId: debit.transaction.id,
      description: `${plan.cableName} ${plan.planName}`
    }).catch((error) => console.error('[provider-ledger] failed to record debit for', debit.transaction.id, error));

    await awardReferralCommission({
      buyerId: req.user!.id,
      purchaseAmountKobo: debit.transaction.amountKobo,
      sourceTransactionId: debit.transaction.id
    });

    return res.json({
      status: true,
      message: provider.message ?? 'Cable subscription renewed',
      reference: debit.reference,
      balance_after: debit.balanceAfter
    });
  }

  // BilalSadaSub's "process" status - not a confirmed failure, so DON'T
  // auto-refund (the provider might still fulfil it and the customer would
  // be paid twice). Leave the debit as PENDING for manual admin review at
  // /admin/provider-reconciliation. See flagPendingReconciliation()'s
  // doc-comment for why.
  if (provider.pending) {
    await flagPendingReconciliation({
      transactionId: debit.transaction.id,
      provider: 'bilalsadasub',
      providerRef: provider.providerRef,
      providerMessage: provider.message
    });
    return res.json({
      status: false,
      message: 'Your cable subscription is still being confirmed by the provider. If it is not resolved shortly, please contact support with your reference.',
      reference: debit.reference,
      balance_after: koboToNaira(debit.transaction.balanceAfterKobo)
    });
  }

  await prisma.transaction.update({
    where: { id: debit.transaction.id },
    data: { status: TransactionStatus.FAILED, provider: 'bilalsadasub', providerRef: provider.providerRef ?? null }
  });
  const refunded = await refundWallet({ transactionId: debit.transaction.id, userId: req.user!.id });

  res.json({
    status: false,
    message: provider.message ?? 'Cable subscription failed and was refunded',
    reference: debit.reference,
    balance_after: koboToNaira(refunded.balanceAfterKobo)
  });
});
