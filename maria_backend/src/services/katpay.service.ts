import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';

const KATPAY_BASE_URL = 'https://api.katpay.co/v1';

function headers() {
  if (!env.KATPAY_SECRET_KEY || !env.KATPAY_PUBLIC_KEY) {
    throw new ApiError(500, 'KatPay is not configured on this server', 'KATPAY_NOT_CONFIGURED');
  }
  return {
    Authorization: `Bearer ${env.KATPAY_SECRET_KEY}`,
    'Content-Type': 'application/json',
    'api-key': env.KATPAY_PUBLIC_KEY
  };
}

/**
 * KatPay wraps every response the same way: `{ success, message, data }`. This
 * mirrors that shape rather than Paystack's `{ status, message, data }` — the two
 * services are intentionally NOT identical, callers go through
 * payment-provider.service.ts to paper over the difference.
 */
type KatpayEnvelope<T> = { success?: boolean; status?: boolean; message?: string; data?: T };

function unwrap<T>(response: Response, data: KatpayEnvelope<T>, errorCode: string, fallbackMessage: string): T {
  const ok = data.success ?? data.status ?? false;
  if (!response.ok || !ok || !data.data) {
    throw new ApiError(502, data.message ?? fallbackMessage, errorCode);
  }
  return data.data;
}

type KatpayVirtualAccount = {
  account_number: string;
  account_name: string;
  bank_name: string;
};

type KatpayTransferPayment = {
  uuid: string;
  merchant_reference: string;
  internal_reference: string;
  // KatPay's docs show the GET /v1/transfer-payments/{uuid} status enum starting
  // 'pending' -> 'processing' -> ... but cut off before showing the terminal
  // success value. The matching webhook event is named `transfer_payment.completed`
  // (not `.success`) and other events use the same "completed"/"processed"
  // terminology throughout the docs, so 'completed' is at least as likely as
  // 'success' here. Both are treated as success everywhere this type is checked -
  // see the comment on verifyDynamicFunding in payment-provider.service.ts.
  status: 'pending' | 'processing' | 'success' | 'completed' | 'failed' | 'expired' | string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  currency: string;
  payment_account: { account_number: string; account_name: string; bank_name: string };
  checkout_url: string;
  customer: { name: string; email: string };
  expires_at: string;
  created_at: string;
};

type KatpayPayout = {
  uuid: string;
  merchant_reference?: string;
  internal_reference: string;
  status: string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  currency: string;
  payment_account: { account_number: string; account_name: string; bank_name: string };
};

export const katpayService = {
  /**
   * Creates a permanent, customer-tied static virtual account — KatPay's equivalent
   * of Paystack's Dedicated Virtual Account, but with no BVN/customer-validation step
   * required first (see /v1/virtual-accounts in the docs). Used by
   * payment-provider.service.ts for instant provisioning at signup/login, exactly
   * like tryProvisionInstantVirtualAccount does for Paystack.
   */
  async createVirtualAccount(params: { email: string; name: string; phoneNumber: string; bankCode?: string[] }) {
    if (!env.KATPAY_MERCHANT_ID) {
      throw new ApiError(500, 'KATPAY_MERCHANT_ID is not configured', 'KATPAY_NOT_CONFIGURED');
    }
    const response = await fetch(`${KATPAY_BASE_URL}/virtual-accounts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        email: params.email,
        name: params.name,
        phoneNumber: params.phoneNumber,
        bankCode: params.bankCode ?? [env.KATPAY_VIRTUAL_ACCOUNT_BANK_CODE],
        merchantID: env.KATPAY_MERCHANT_ID
      })
    });
    const data = (await response.json()) as KatpayEnvelope<KatpayVirtualAccount>;
    return unwrap(response, data, 'KATPAY_VA_FAILED', 'Failed to create virtual account');
  },

  /**
   * "Pay with Transfer" — KatPay's equivalent of Paystack's temporary
   * Pay-with-Transfer charge. Creates a ONE-TIME account tied to this exact amount
   * (matches the "Dynamic Account" option in the Fund Wallet menu). Returns a
   * checkout_url too (KatPay's hosted payment page), which we don't currently use
   * since the app builds its own UI from `payment_account`, but it's there if needed.
   */
  async createTransferPayment(params: {
    amount: number;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    merchantReference: string;
    description?: string;
    expiresInMinutes?: number;
    metadata?: Record<string, unknown>;
  }) {
    if (!env.KATPAY_CALLBACK_URL) {
      throw new ApiError(500, 'KATPAY_CALLBACK_URL is not configured', 'KATPAY_NOT_CONFIGURED');
    }
    const response = await fetch(`${KATPAY_BASE_URL}/transfer-payments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        amount: params.amount,
        customer_name: params.customerName,
        customer_email: params.customerEmail,
        customer_phone: params.customerPhone,
        callback_url: env.KATPAY_CALLBACK_URL,
        merchant_reference: params.merchantReference,
        description: params.description,
        expires_in: params.expiresInMinutes ?? 30,
        metadata: params.metadata
      })
    });
    const data = (await response.json()) as KatpayEnvelope<KatpayTransferPayment>;
    return unwrap(response, data, 'KATPAY_TRANSFER_PAYMENT_FAILED', 'Failed to create a transfer payment');
  },

  /**
   * Server-to-server status check. Same "never trust the webhook payload alone"
   * principle as paystackService.verifyTransaction — used as the /fund/verify
   * fallback and before crediting a wallet from a webhook event.
   */
  async getTransferPaymentStatus(uuid: string) {
    const response = await fetch(`${KATPAY_BASE_URL}/transfer-payments/${encodeURIComponent(uuid)}`, {
      headers: headers()
    });
    const data = (await response.json()) as KatpayEnvelope<KatpayTransferPayment>;
    return unwrap(response, data, 'KATPAY_TRANSFER_PAYMENT_STATUS_FAILED', 'Failed to fetch transfer payment status');
  },

  /**
   * Sends money OUT to a Nigerian bank account. Not currently wired into any route —
   * this app doesn't offer cash withdrawals today (see wallet.routes.ts's note on why
   * user-to-user transfer was removed) — but kept here ready for when/if a payout
   * feature (e.g. referral cash-out) is added.
   */
  async createPayout(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    description?: string;
    reference?: string;
  }) {
    const response = await fetch(`${KATPAY_BASE_URL}/payouts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        amount: params.amount,
        bank_code: params.bankCode,
        account_number: params.accountNumber,
        account_name: params.accountName,
        description: params.description,
        reference: params.reference
      })
    });
    const data = (await response.json()) as KatpayEnvelope<KatpayPayout>;
    return unwrap(response, data, 'KATPAY_PAYOUT_FAILED', 'Failed to create payout');
  },

  /**
   * Public list of Nigerian banks + their codes, used to populate the bank picker
   * in the app. NOTE: unlike every other KatPay endpoint in this file, the docs
   * show this one living under `/api/bank-list` (root-level), NOT under `/v1` like
   * `/v1/virtual-accounts`, `/v1/transfer-payments` and `/v1/payouts` — so this
   * deliberately does NOT use KATPAY_BASE_URL.
   */
  async listBanks() {
    const response = await fetch('https://api.katpay.co/api/bank-list', { headers: headers() });
    const data = (await response.json()) as KatpayEnvelope<Array<{ bankCode: string; bankName: string }>>;
    const banks = unwrap(response, data, 'KATPAY_BANK_LIST_FAILED', 'Failed to fetch bank list');
    return banks.map((bank) => ({ name: bank.bankName, code: bank.bankCode }));
  }
};
