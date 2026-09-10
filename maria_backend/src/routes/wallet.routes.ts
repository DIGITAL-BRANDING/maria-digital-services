import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { requireAuth } from '../middleware/auth.js';
import { paystackService } from '../services/paystack.service.js';
import { createPendingFunding, creditWalletByReference, redeemCoupon } from '../services/wallet.service.js';
// Provider-agnostic - picks Paystack or KatPay based on PAYMENT_PROVIDER in env.
// See payment-provider.service.ts for how to fail over from one to the other.
import {
  createDynamicFundingAccount,
  provisionInstantVirtualAccount,
  verifyDynamicFunding
} from '../services/payment-provider.service.js';

export const walletRoutes = Router();

walletRoutes.use(requireAuth);

walletRoutes.get('/balance', async (req, res) => {
  let user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  // Covers users created before this feature existed, and anyone whose
  // signup-time attempt failed transiently. No-ops instantly if already provisioned.
  // Skipped entirely while VIRTUAL_ACCOUNT_FUNDING_ENABLED=false - no point
  // provisioning new accounts (or spending an API call on KatPay/Paystack) for
  // a number we're about to hide from the response anyway. See env.ts.
  if (!user.virtualAccountNumber && env.VIRTUAL_ACCOUNT_FUNDING_ENABLED) {
    await provisionInstantVirtualAccount(user.id);
    user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  }

  res.json({
    balance: koboToNaira(user.walletBalanceKobo),
    currency: 'NGN',
    virtual_account_number: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountNumber : null,
    virtual_account_bank: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountBank : null,
    virtual_account_funding_paused: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? undefined : true
  });
});

walletRoutes.get('/virtual-account', async (req, res) => {
  let user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  if (!user.virtualAccountNumber && env.VIRTUAL_ACCOUNT_FUNDING_ENABLED) {
    await provisionInstantVirtualAccount(user.id);
    user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  }

  res.json({
    balance: koboToNaira(user.walletBalanceKobo),
    currency: 'NGN',
    virtual_account_number: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountNumber : null,
    virtual_account_bank: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountBank : null,
    virtual_account_funding_paused: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? undefined : true
  });
});

walletRoutes.post('/fund', async (req, res) => {
  const body = z.object({
    amount: z.number().positive(),
    payment_method: z.string().optional()
  }).parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const reference = `IDS-FUND-${Date.now()}-${nanoid(8).toUpperCase()}`;

  // Record the attempt as PENDING first — the wallet balance only changes once
  // Paystack confirms payment via webhook (or the /fund/verify fallback below).
  await createPendingFunding({
    userId: user.id,
    amount: body.amount,
    reference,
    metadata: { payment_method: body.payment_method ?? 'card' }
  });

  const paystack = await paystackService.initializeTransaction({
    email: user.email,
    amountKobo: BigInt(Math.round(body.amount * 100)),
    reference
  });

  res.json({
    status: true,
    message: 'Payment initialized',
    data: {
      amount: body.amount,
      reference,
      authorization_url: paystack.authorization_url
    }
  });
});

/**
 * Fallback for the rare case a Paystack webhook doesn't arrive (network blip, server
 * restart mid-delivery). The Flutter app should call this after the payment webview
 * redirects back, so the wallet is credited even if the webhook is delayed or lost.
 * Safe to call repeatedly — creditWalletByReference is idempotent.
 */
walletRoutes.post('/fund/verify', async (req, res) => {
  const body = z.object({ reference: z.string() }).parse(req.body);

  const transaction = await prisma.transaction.findFirst({
    where: { reference: body.reference, userId: req.user!.id }
  });
  if (!transaction) {
    return res.status(404).json({ status: false, message: 'Transaction not found' });
  }

  const status = await verifyDynamicFunding(transaction);
  if (status === 'success') {
    const updated = await creditWalletByReference(body.reference);
    return res.json({
      status: true,
      message: 'Wallet funded',
      data: { balance: koboToNaira(updated.balanceAfterKobo) }
    });
  }

  res.json({ status: false, message: `Payment ${status}` });
});

/**
 * "Dynamic Account" — a one-time account number tied to this exact amount,
 * matching the Alrahuz "Dynamic Account" tab (temporary, dies after use/expiry).
 * Routes through whichever gateway PAYMENT_PROVIDER points at (Paystack's Pay with
 * Transfer, or KatPay's Pay with Transfer) — see payment-provider.service.ts.
 */
walletRoutes.post('/fund/dynamic', async (req, res) => {
  const body = z.object({ amount: z.number().positive() }).parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  const funding = await createDynamicFundingAccount({
    email: user.email,
    fullName: user.fullName,
    amount: body.amount
  });

  // Record the attempt as PENDING using the funding reference above — the webhook
  // (or /fund/verify) credits the wallet once the transfer lands.
  await createPendingFunding({
    userId: user.id,
    amount: body.amount,
    reference: funding.reference,
    provider: funding.provider,
    description: `Wallet funding via ${funding.provider === 'katpay' ? 'KatPay' : 'Paystack'} (dynamic transfer)`,
    metadata: {
      payment_method: 'dynamic_transfer',
      account_number: funding.accountNumber,
      provider_reference: funding.providerReference ?? null
    }
  });

  res.json({
    status: true,
    message: 'Transfer this exact amount to the account below to fund your wallet',
    data: {
      amount: body.amount,
      reference: funding.reference,
      account_number: funding.accountNumber,
      account_name: funding.accountName,
      bank_name: funding.bankName,
      expires_at: funding.expiresAt
    }
  });
});

/** "Fund with Coupon" — redeems a prepaid code for its face value. */
walletRoutes.post('/coupon/redeem', async (req, res) => {
  const body = z.object({ code: z.string().trim().min(4) }).parse(req.body);
  const result = await redeemCoupon(req.user!.id, body.code);
  res.json({
    status: true,
    message: 'Coupon redeemed',
    data: { balance: result.balanceAfter }
  });
});

// NOTE: transfer-to-another-user was removed (both the /wallet/transfer
// endpoint that used to live here and its dashboard button) - it was only
// ever a scaffold that validated the PIN and returned a fake "success"
// without moving any money, reachable directly by anyone calling the API
// even after the UI button was pulled. If this feature comes back, it needs
// a real implementation (recipient lookup, atomic debit+credit in one
// transaction, idempotency) - not resurrecting this stub.
