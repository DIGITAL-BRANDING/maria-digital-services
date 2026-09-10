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

// Electricity has no Alrahuz equivalent anywhere in this codebase - always
// BilalSadaSub, same as cable.routes.ts. Request/response shapes here are
// dictated by the already-built Flutter UI
// (lib/features/electricity/presentation/providers/electricity_provider.dart)
// - `meter_number`/`meter_type` (not `meter`), top-level `status`, etc.
export const electricityRoutes = Router();

electricityRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

electricityRoutes.get('/providers', async (_req, res) => {
  const providers = await bilalsadasub.listDiscos();
  res.json({ status: true, data: providers });
});

// Lets ElectricityScreen show "Service fee: ₦X" / "Total: ₦Y" BEFORE the
// user confirms, instead of silently debiting more than the amount they
// typed - see the doc comment on `sellingAmount` in the /purchase handler
// below for why this matters once electricityMarkupPercent is ever > 0.
electricityRoutes.get('/fee', async (_req, res) => {
  const settings = await getPricingSettings();
  res.json({ status: true, data: { percent: settings.electricityMarkupPercent } });
});

// POST /api/electricity/validate { disco, meter_number, meter_type } ->
// { status, data: { customer_name, address } } - see
// electricity_provider.dart's validateMeter().
electricityRoutes.post('/validate', async (req, res) => {
  const body = z
    .object({ disco: z.string(), meter_number: z.string(), meter_type: z.enum(['prepaid', 'postpaid']) })
    .parse(req.body);
  const result = await bilalsadasub.validateMeter({
    disco: body.disco,
    meter: body.meter_number,
    meterType: body.meter_type
  });
  res.json({ status: result.isValid, data: { customer_name: result.customerName, address: result.address } });
});

electricityRoutes.post('/purchase', async (req, res) => {
  const body = z
    .object({
      disco: z.string(),
      meter_number: z.string().min(1),
      meter_type: z.enum(['prepaid', 'postpaid']),
      // The amount the CUSTOMER'S METER should be topped up by - this goes
      // to BilalSadaSub unchanged. The wallet is debited this plus
      // electricityMarkupPercent (default 0 - see the doc comment below on
      // why a nonzero value here needs a UI change too), so the customer's
      // meter gets exactly what they asked for while our margin (if any)
      // comes out of their wallet balance, not out of their units.
      amount: z.number().min(500).max(500000),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);

  const settings = await getPricingSettings();
  // NOTE: ElectricityScreen's form only ever shows/asks for `body.amount`
  // itself - it has no "your total charge including our fee is ₦X" line.
  // That's fine at the default 0% markup (sellingAmount === body.amount,
  // nothing hidden) but if electricityMarkupPercent is ever raised above
  // 0, the customer would be debited MORE than the number they typed with
  // no on-screen indication why - the Flutter screen needs a
  // "service fee" line added before that setting is used for real.
  const sellingAmount = Math.ceil(body.amount + (body.amount * settings.electricityMarkupPercent) / 100);
  const { pin: _pin, ...metadataBody } = body;

  const debit = await debitWallet({
    userId: req.user!.id,
    amount: sellingAmount,
    type: TransactionType.ELECTRICITY_PURCHASE,
    description: `${body.disco} ${body.meter_type} electricity for meter ${body.meter_number}`,
    metadata: { ...metadataBody, amount: sellingAmount, provider: 'bilalsadasub' } as Prisma.InputJsonValue,
    idempotencyKey: idempotencyKeyFrom(req),
    costKobo: nairaToKobo(body.amount)
  });

  if (debit.reused && debit.transaction.status !== TransactionStatus.PENDING) {
    return res.json({
      status: debit.transaction.status === TransactionStatus.SUCCESS,
      message: 'Transaction already processed',
      reference: debit.reference,
      balance_after: koboToNaira(debit.transaction.balanceAfterKobo)
    });
  }

  const provider = await bilalsadasub.buyElectricity({
    disco: body.disco,
    meterType: body.meter_type,
    meter: body.meter_number,
    amount: body.amount,
    reference: debit.reference
  });

  if (provider.status) {
    await prisma.transaction.update({
      where: { id: debit.transaction.id },
      data: {
        status: TransactionStatus.SUCCESS,
        provider: 'bilalsadasub',
        providerRef: provider.providerRef ?? null,
        metadata: {
          ...metadataBody,
          amount: sellingAmount,
          provider: 'bilalsadasub',
          token: provider.token,
          units: provider.units
        } as Prisma.InputJsonValue,
        ...(provider.costKobo !== undefined ? { costKobo: provider.costKobo } : {})
      }
    });

    const finalCostKobo = provider.costKobo ?? nairaToKobo(body.amount);
    await recordProviderDebit({
      provider: 'bilalsadasub',
      amountKobo: finalCostKobo,
      relatedTransactionId: debit.transaction.id,
      description: `${body.disco} ${body.meter_type} electricity`
    }).catch((error) => console.error('[provider-ledger] failed to record debit for', debit.transaction.id, error));

    await awardReferralCommission({
      buyerId: req.user!.id,
      purchaseAmountKobo: debit.transaction.amountKobo,
      sourceTransactionId: debit.transaction.id
    });

    return res.json({
      status: true,
      message: provider.message ?? 'Electricity token sent',
      reference: debit.reference,
      balance_after: debit.balanceAfter,
      token: provider.token,
      units: provider.units
    });
  }

  // Same reasoning as cable.routes.ts's equivalent branch - "process" is not
  // a confirmed failure, so don't auto-refund. Left PENDING for
  // /admin/provider-reconciliation.
  if (provider.pending) {
    await flagPendingReconciliation({
      transactionId: debit.transaction.id,
      provider: 'bilalsadasub',
      providerRef: provider.providerRef,
      providerMessage: provider.message
    });
    return res.json({
      status: false,
      message: 'Your electricity purchase is still being confirmed by the provider. If your token does not arrive shortly, please contact support with your reference.',
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
    message: provider.message ?? 'Electricity purchase failed and was refunded',
    reference: debit.reference,
    balance_after: koboToNaira(refunded.balanceAfterKobo)
  });
});
