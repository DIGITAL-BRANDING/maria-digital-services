import { nanoid } from 'nanoid';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { katpayService } from './katpay.service.js';
import { paystackService } from './paystack.service.js';
import { zenithpayService } from './zenithpay.service.js';
import { tryProvisionInstantVirtualAccount as provisionPaystackVirtualAccount } from './kyc.service.js';

/**
 * Single switch point for "which payment gateway is live right now". Both
 * PAYSTACK_* and KATPAY_* credentials can sit in .env at the same time — only
 * PAYMENT_PROVIDER decides which one actually gets called. Every route/service
 * outside this file should go through the functions below rather than importing
 * paystackService or katpayService directly, so flipping the env var is enough to
 * fail over from one gateway to the other with no code changes.
 *
 * ZenithPay is special: it has no instant (BVN-less) provisioning tier. Its
 * assignDedicatedAccount() is only wired into the BVN-gated flow in kyc.service.ts,
 * never here. When PAYMENT_PROVIDER=zenithpay, provisionInstantVirtualAccount()
 * skips (users get accounts only after BVN verification).
 */

async function provisionKatpayVirtualAccount(userId: string) {
  if (!env.KATPAY_INSTANT_VA_ENABLED || !env.KATPAY_SECRET_KEY || !env.KATPAY_PUBLIC_KEY || !env.KATPAY_MERCHANT_ID) {
    return;
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.virtualAccountNumber) return; // already has one - nothing to do

    const account = await katpayService.createVirtualAccount({
      email: user.email,
      name: user.fullName,
      phoneNumber: user.phone
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        virtualAccountNumber: account.account_number,
        virtualAccountBank: account.bank_name,
        virtualAccountProvider: 'katpay'
      }
    });
  } catch (error) {
    // Non-fatal by design, same as the Paystack instant-DVA path this mirrors -
    // must never throw and must never block signup/login.
    console.warn(
      `[payment-provider] KatPay instant virtual account provisioning skipped for user ${userId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Best-effort instant funding-account provisioning at signup/login. Delegates to
 * whichever gateway PAYMENT_PROVIDER points at. Safe to call repeatedly - both
 * branches no-op instantly once the user already has a virtualAccountNumber.
 *
 * ZenithPay has no instant tier (requires BVN), so this skips entirely when
 * PAYMENT_PROVIDER=zenithpay - users get accounts only after BVN verification
 * in kyc.service.ts's verifyBvnAndActivateWallet.
 */
export async function provisionInstantVirtualAccount(userId: string) {
  if (env.PAYMENT_PROVIDER === 'zenithpay') {
    // ZenithPay requires BVN verification - no instant provisioning available.
    // Virtual accounts are assigned later in verifyBvnAndActivateWallet (kyc.service.ts).
    return;
  }
  if (env.PAYMENT_PROVIDER === 'katpay') {
    return provisionKatpayVirtualAccount(userId);
  }
  return provisionPaystackVirtualAccount(userId);
}

export type DynamicFundingAccount = {
  provider: 'paystack' | 'katpay' | 'zenithpay';
  /** Stored as Transaction.reference - what the webhook and /fund/verify match against. */
  reference: string;
  /** Extra id needed to poll the gateway's own status endpoint. Only KatPay needs this today. */
  providerReference?: string;
  accountNumber: string;
  accountName: string;
  bankName?: string;
  expiresAt?: string;
};

/**
 * "Dynamic Account" — a one-time, amount-locked funding account (matches the
 * "Dynamic Account" tab in the Fund Wallet menu). Returns a shape unified across
 * both gateways so wallet.routes.ts doesn't need to branch on the provider itself.
 *
 * ZenithPay does not support dynamic accounts - only permanent dedicated accounts
 * issued after BVN verification (in kyc.service.ts). Calling this with
 * PAYMENT_PROVIDER=zenithpay will throw an error.
 */
export async function createDynamicFundingAccount(params: {
  email: string;
  fullName: string;
  amount: number;
}): Promise<DynamicFundingAccount> {
  if (env.PAYMENT_PROVIDER === 'zenithpay') {
    throw new Error(
      'ZenithPay does not support dynamic (one-time) funding accounts. ' +
      'Only permanent dedicated accounts after BVN verification are available. ' +
      'Users should complete BVN KYC to receive their account.'
    );
  }

  if (env.PAYMENT_PROVIDER === 'katpay') {
    // Unlike Paystack (which generates its own charge reference for us), KatPay's
    // transfer-payments endpoint takes OUR reference as merchant_reference - so we
    // mint it up front and use it as the Transaction.reference throughout.
    const reference = `IDS-FUND-${Date.now()}-${nanoid(8).toUpperCase()}`;
    const payment = await katpayService.createTransferPayment({
      amount: params.amount,
      customerName: params.fullName,
      customerEmail: params.email,
      merchantReference: reference
    });

    return {
      provider: 'katpay',
      reference,
      providerReference: payment.uuid,
      accountNumber: payment.payment_account.account_number,
      accountName: payment.payment_account.account_name,
      bankName: payment.payment_account.bank_name,
      expiresAt: payment.expires_at
    };
  }

  const charge = await paystackService.createTemporaryTransferAccount({
    email: params.email,
    amountKobo: BigInt(Math.round(params.amount * 100))
  });

  return {
    provider: 'paystack',
    reference: charge.reference,
    accountNumber: charge.account_number,
    accountName: charge.account_name,
    bankName: charge.bank?.name,
    expiresAt: charge.account_expires_at
  };
}

/**
 * Server-to-server status check for a dynamic funding attempt (used by the
 * /wallet/fund/verify fallback, the same "never trust the webhook payload alone"
 * principle Paystack's own verifyTransaction follows). Branches on the
 * transaction's own `provider` column, so it works regardless of which gateway is
 * currently active in env - a transaction started under one provider is still
 * verifiable even after PAYMENT_PROVIDER is later flipped to the other.
 *
 * ZenithPay does not support dynamic funding, so transactions should never have
 * provider='zenithpay'. If one arrives, it's treated as failed (unknown provider).
 */
export async function verifyDynamicFunding(transaction: {
  provider: string | null;
  reference: string;
  metadata: unknown;
}): Promise<'success' | 'pending' | 'failed'> {
  if (transaction.provider === 'zenithpay') {
    // ZenithPay doesn't issue dynamic funding accounts, so this should never happen.
    // Treat it as failed to prevent the transaction from lingering in 'pending'.
    console.warn(
      `[payment-provider] Received verifyDynamicFunding call for ZenithPay transaction ${transaction.reference}. ` +
      `ZenithPay does not support dynamic funding - returning failed.`
    );
    return 'failed';
  }

  if (transaction.provider === 'katpay') {
    const metadata = transaction.metadata as { provider_reference?: string } | null;
    if (!metadata?.provider_reference) return 'pending';

    const status = await katpayService.getTransferPaymentStatus(metadata.provider_reference);
    // See the comment on KatpayTransferPayment['status'] in katpay.service.ts -
    // KatPay's docs don't confirm whether the terminal value is 'success' or
    // 'completed', so both are accepted here rather than guessing one.
    if (status.status === 'success' || status.status === 'completed') return 'success';
    if (status.status === 'failed' || status.status === 'expired') return 'failed';
    return 'pending';
  }

  const verified = await paystackService.verifyTransaction(transaction.reference);
  if (verified.status === 'success') return 'success';
  return verified.status === 'failed' || verified.status === 'abandoned' ? 'failed' : 'pending';
}

/**
 * Public list of Nigerian banks + their codes, from whichever gateway is active.
 *
 * ZenithPay does not expose a bank selection API - it works directly with BVN
 * and is not used for dynamic account creation. If this is called with
 * PAYMENT_PROVIDER=zenithpay, it indicates a code path that shouldn't be reachable,
 * so we throw an error.
 */
export async function listSupportedBanks() {
  if (env.PAYMENT_PROVIDER === 'zenithpay') {
    throw new Error(
      'ZenithPay does not support bank selection via an API. ' +
      'Virtual accounts are created after BVN verification with no bank choice involved.'
    );
  }
  if (env.PAYMENT_PROVIDER === 'katpay') return katpayService.listBanks();
  return paystackService.listBanks();
}
