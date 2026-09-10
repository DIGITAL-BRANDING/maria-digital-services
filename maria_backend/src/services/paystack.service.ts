import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function headers() {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new ApiError(500, 'Paystack is not configured on this server', 'PAYSTACK_NOT_CONFIGURED');
  }
  return {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: { status: string; amount: number; currency: string; reference: string };
};

export const paystackService = {
  /**
   * Starts a payment. `amountKobo` is the amount in kobo — Paystack's NGN base unit
   * matches our wallet storage unit exactly, so no conversion is needed here.
   */
  async initializeTransaction(params: { email: string; amountKobo: bigint; reference: string }) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        email: params.email,
        amount: params.amountKobo.toString(),
        reference: params.reference,
        callback_url: env.PAYSTACK_CALLBACK_URL
      })
    });

    const data = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !data.status) {
      throw new ApiError(502, data.message ?? 'Failed to initialize payment', 'PAYSTACK_INIT_FAILED');
    }
    return data.data;
  },

  /**
   * Server-to-server verification. Never trust a webhook payload's amount/status alone —
   * always re-check directly with Paystack before crediting a wallet.
   */
  async verifyTransaction(reference: string) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: headers()
    });

    const data = (await response.json()) as PaystackVerifyResponse;
    if (!response.ok || !data.status) {
      throw new ApiError(502, data.message ?? 'Failed to verify payment', 'PAYSTACK_VERIFY_FAILED');
    }
    return data.data;
  },

  /**
   * Standalone identity lookup - takes ONLY a BVN and returns the name/dob/phone
   * registered against it. This does NOT validate a customer or unlock a Dedicated
   * Virtual Account on its own; it's a lighter check we use to confirm the BVN is
   * real and (loosely) matches the name on the account before asking the user for
   * their bank details in the next step.
   */
  async resolveBvn(bvn: string) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/bank/resolve_bvn/${encodeURIComponent(bvn)}`, {
      headers: headers()
    });
    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { bvn: string; first_name: string; last_name: string; mobile: string; dob?: string };
    };
    if (!response.ok || !data.status || !data.data) {
      throw new ApiError(422, data.message ?? 'Could not resolve BVN', 'BVN_RESOLVE_FAILED');
    }
    return data.data;
  },

  /**
   * Creates a Paystack Customer record for this user if one doesn't already exist.
   * A customer_code is required before we can validate identity or create a DVA.
   */
  async createCustomer(params: { email: string; firstName: string; lastName: string; phone: string }) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/customer`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        phone: params.phone
      })
    });
    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { customer_code: string; id: number };
    };
    if (!response.ok || !data.status || !data.data) {
      throw new ApiError(502, data.message ?? 'Failed to create customer', 'PAYSTACK_CUSTOMER_FAILED');
    }
    return data.data;
  },

  /**
   * Required by Paystack before a Dedicated Virtual Account can be created for
   * businesses in the Financial Services / Betting / General Services categories.
   * Needs the BVN AND a bank account number tied to that BVN - a bare BVN is not
   * sufficient on its own for this step.
   */
  async validateCustomer(customerCode: string, params: {
    firstName: string;
    lastName: string;
    bvn: string;
    bankCode: string;
    accountNumber: string;
  }) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/customer/${encodeURIComponent(customerCode)}/identification`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        country: 'NG',
        type: 'bank_account',
        account_number: params.accountNumber,
        bvn: params.bvn,
        bank_code: params.bankCode,
        first_name: params.firstName,
        last_name: params.lastName
      })
    });
    const data = (await response.json()) as { status: boolean; message: string };
    if (!response.ok || !data.status) {
      throw new ApiError(422, data.message ?? 'Identity validation failed', 'PAYSTACK_VALIDATION_FAILED');
    }
    return data;
  },

  /**
   * Creates the actual bank account number the user will fund their wallet from.
   * Must be called AFTER validateCustomer succeeds for regulated business categories -
   * calling this first will fail with a Paystack error about unvalidated customers.
   */
  async createDedicatedVirtualAccount(params: { customerCode: string }) {
    const response = await fetch(`${PAYSTACK_BASE_URL}/dedicated_account`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        customer: params.customerCode,
        preferred_bank: env.PAYSTACK_DVA_PREFERRED_BANK
      })
    });
    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { account_number: string; account_name: string; bank: { name: string; slug: string } };
    };
    if (!response.ok || !data.status || !data.data) {
      throw new ApiError(502, data.message ?? 'Failed to create virtual account', 'PAYSTACK_DVA_FAILED');
    }
    return data.data;
  },

  /**
   * "Pay with Transfer" — creates a ONE-TIME account number tied to this exact
   * amount, matching the "Dynamic Account" option in the Fund Wallet menu. It
   * expires automatically (Paystack enforces a 15min-8hr window) and can only
   * be used once. Unlike the Dedicated Virtual Account, no reference needs to
   * be pre-created - Paystack generates and returns one, which the caller
   * should store as the funding attempt's reference so the webhook can match it.
   */
  async createTemporaryTransferAccount(params: { email: string; amountKobo: bigint; expiresInMinutes?: number }) {
    const expiresAt = new Date(Date.now() + (params.expiresInMinutes ?? 30) * 60 * 1000).toISOString();

    const response = await fetch(`${PAYSTACK_BASE_URL}/charge`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        email: params.email,
        amount: params.amountKobo.toString(),
        bank_transfer: { account_expires_at: expiresAt }
      })
    });

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: {
        reference: string;
        status: string;
        account_name: string;
        account_number: string;
        bank: { slug: string; name: string; id: number };
        account_expires_at: string;
      };
    };
    if (!response.ok || !data.status || !data.data) {
      throw new ApiError(502, data.message ?? 'Failed to create a transfer account', 'PAYSTACK_PWT_FAILED');
    }
    return data.data;
  },

  /** Public list of Nigerian banks + their codes, used to populate the bank picker in the app. */
  async listBanks() {
    const response = await fetch(`${PAYSTACK_BASE_URL}/bank?country=nigeria&currency=NGN`, {
      headers: headers()
    });
    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: Array<{ name: string; code: string; slug: string }>;
    };
    if (!response.ok || !data.status || !data.data) {
      throw new ApiError(502, data.message ?? 'Failed to fetch bank list', 'PAYSTACK_BANK_LIST_FAILED');
    }
    return data.data.map((bank) => ({ name: bank.name, code: bank.code }));
  }
};
