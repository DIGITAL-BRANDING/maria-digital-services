import { KycStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';
import { paystackService } from './paystack.service.js';
import { notifyUser } from './notification.service.js';

/** Splits "Sunusi Usama" -> { firstName: "Sunusi", lastName: "Usama" }. Paystack requires both separately. */
function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

/**
 * The full BVN verification flow:
 *   1. Resolve the BVN on its own (identity sanity-check).
 *   2. Create (or reuse) a Paystack customer for this user.
 *   3. Validate that customer with BVN + bank account (required by Paystack for
 *      Financial Services / Betting / General Services categories before a DVA
 *      can be issued).
 *   4. Create the Dedicated Virtual Account and persist it on the user.
 *
 * We deliberately do NOT store the raw BVN anywhere - only the last 4 digits
 * (for support/reference purposes) once the flow succeeds.
 */
export async function verifyBvnAndActivateWallet(params: {
  userId: string;
  bvn: string;
  bankCode: string;
  accountNumber: string;
}) {
  const { userId, bvn, bankCode, accountNumber } = params;

  if (!/^\d{11}$/.test(bvn)) {
    throw new ApiError(422, 'BVN must be exactly 11 digits', 'INVALID_BVN');
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError(422, 'Account number must be exactly 10 digits', 'INVALID_ACCOUNT_NUMBER');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.kycStatus === KycStatus.VERIFIED && user.virtualAccountNumber) {
    // Already done - return the existing account rather than re-running (and re-billing) verification.
    return {
      kycStatus: user.kycStatus,
      virtualAccountNumber: user.virtualAccountNumber,
      virtualAccountBank: user.virtualAccountBank
    };
  }

  await prisma.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.PENDING } });

  const { firstName, lastName } = splitFullName(user.fullName);

  try {
    // Step 1: confirm the BVN itself resolves to a real identity. Non-fatal on its
    // own beyond this check - we don't block on a name-mismatch here since legal
    // name formatting (middle names, maiden names, etc.) varies too much to hard-fail on.
    await paystackService.resolveBvn(bvn);

    // Step 2: reuse an existing Paystack customer_code if we already made one for
    // this user (e.g. a retry after a failed validation), otherwise create one.
    let customerCode = user.paystackCustomerCode;
    if (!customerCode) {
      const customer = await paystackService.createCustomer({
        email: user.email,
        firstName,
        lastName,
        phone: user.phone
      });
      customerCode = customer.customer_code;
      await prisma.user.update({ where: { id: userId }, data: { paystackCustomerCode: customerCode } });
    }

    // Step 3: validate identity - this is the step that actually requires BVN + bank account.
    await paystackService.validateCustomer(customerCode, {
      firstName,
      lastName,
      bvn,
      bankCode,
      accountNumber
    });

    // Step 4: issue the actual Dedicated Virtual Account.
    const dva = await paystackService.createDedicatedVirtualAccount({ customerCode });

    const bvnLast4 = bvn.slice(-4);

    await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: KycStatus.VERIFIED,
        virtualAccountNumber: dva.account_number,
        virtualAccountBank: dva.bank.name,
        virtualAccountProvider: 'paystack',
        bvnLast4,
        bvnVerifiedAt: new Date(),
        kycFailureReason: null
      }
    });

    await notifyUser({
      userId,
      type: 'KYC',
      title: 'Verification successful',
      body: `Your identity has been verified. Your funding account is ${dva.account_number} (${dva.bank.name}).`,
      data: { virtualAccountNumber: dva.account_number }
    });

    return {
      kycStatus: KycStatus.VERIFIED,
      virtualAccountNumber: dva.account_number,
      virtualAccountBank: dva.bank.name
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Verification failed unexpectedly';
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: KycStatus.REJECTED, kycFailureReason: message }
    });

    await notifyUser({
      userId,
      type: 'KYC',
      title: 'Verification failed',
      body: `We couldn't verify your identity: ${message}. Please review your details and try again.`,
      data: { reason: message }
    });

    throw error;
  }
}

/**
 * Best-effort: creates a Dedicated Virtual Account for a brand-new user
 * immediately at signup, WITHOUT the BVN/bank-account validation step — so the
 * user sees a funding account the moment they log in, matching Alrahuz's UX.
 *
 * This works because Paystack only requires customer validation (BVN + bank
 * account) for businesses under the Financial Services / Betting / General
 * Services categories — everyone else can issue a DVA with just the
 * customer's name, phone, and email. If your Paystack business IS one of
 * those regulated categories, this call fails with an "unvalidated customer"
 * error — expected, and handled silently below; `verifyBvnAndActivateWallet`
 * above remains the correct (BVN-gated) path for the Static Account tier in
 * that case. This must never throw and must never block signup.
 *
 * This is the Paystack-specific half of instant provisioning. Route handlers call
 * `provisionInstantVirtualAccount` in payment-provider.service.ts instead of this
 * function directly — that wrapper picks this or the KatPay equivalent based on
 * PAYMENT_PROVIDER, so callers don't need to know which gateway is active.
 */
export async function tryProvisionInstantVirtualAccount(userId: string) {
  if (!env.PAYSTACK_INSTANT_DVA_ENABLED || !env.PAYSTACK_SECRET_KEY) return;

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.virtualAccountNumber) return; // already has one - nothing to do

    const { firstName, lastName } = splitFullName(user.fullName);

    let customerCode = user.paystackCustomerCode;
    if (!customerCode) {
      const customer = await paystackService.createCustomer({
        email: user.email,
        firstName,
        lastName,
        phone: user.phone
      });
      customerCode = customer.customer_code;
      await prisma.user.update({ where: { id: userId }, data: { paystackCustomerCode: customerCode } });
    }

    const dva = await paystackService.createDedicatedVirtualAccount({ customerCode });

    await prisma.user.update({
      where: { id: userId },
      data: {
        virtualAccountNumber: dva.account_number,
        virtualAccountBank: dva.bank.name,
        virtualAccountProvider: 'paystack'
      }
    });
  } catch (error) {
    // Non-fatal by design. Logged so it's visible in Railway logs if your Paystack
    // category actually requires validation — in which case, consider setting
    // PAYSTACK_INSTANT_DVA_ENABLED=false so this stops trying (and failing) on
    // every signup, and rely on the BVN-based Static Account flow instead.
    console.warn(
      `[kyc] Instant DVA provisioning skipped for user ${userId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function getKycStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    kycStatus: user.kycStatus,
    kycFailureReason: user.kycFailureReason,
    bvnLast4: user.bvnLast4,
    bvnVerifiedAt: user.bvnVerifiedAt,
    virtualAccountNumber: user.virtualAccountNumber,
    virtualAccountBank: user.virtualAccountBank
  };
}

export async function listSupportedBanks() {
  return paystackService.listBanks();
}
