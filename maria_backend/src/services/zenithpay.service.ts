import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';

/**
 * ZenithPay (docs: https://documenter.getpostman.com/view/13400303/2sB2x9krVa) -
 * a third dedicated-virtual-account provider, alongside Paystack and KatPay (see
 * paystack.service.ts / katpay.service.ts). Unlike those two, ZenithPay has a
 * single endpoint that both validates identity AND issues the account in one
 * call - there is no separate "resolve BVN" / "create customer" / "validate
 * customer" dance like Paystack's, and no BVN-less "instant" tier like KatPay's.
 * That's why it's wired into the BVN-gated flow in kyc.service.ts rather than
 * payment-provider.service.ts's instant/no-BVN provisioning switch.
 */

function authHeader() {
  if (!env.ZENITHPAY_AUTH_TOKEN) {
    throw new ApiError(500, 'ZenithPay is not configured on this server', 'ZENITHPAY_NOT_CONFIGURED');
  }
  return {
    Authorization: `Bearer ${env.ZENITHPAY_AUTH_TOKEN}`,
    Accept: 'application/json',
    // The docs' own PHP/cURL example posts CURLOPT_POSTFIELDS as an associative
    // array with no explicit Content-Type override, which makes cURL default to
    // this - matching that exactly (rather than JSON) avoids a format mismatch
    // the docs never actually show failing, but also never show as optional.
    'Content-Type': 'application/x-www-form-urlencoded'
  };
}

export type ZenithpayDedicatedAccount = {
  status: boolean;
  response_code: string;
  accountReference: string;
  accountName: string;
  customerEmail: string;
  customerName: string;
  bankName: string;
  accountNumber: string;
  identityType: string;
  BVN: string;
  accountStatus: string;
  createdOn: string;
  processed_by: string;
};

export const zenithpayService = {
  /**
   * POST /api/dedicated_account/assign - issues a permanent virtual account tied
   * to the given BVN. Success is `status: true` AND `response_code: "00"` (the
   * docs' example response shows both together; neither alone is documented as
   * sufficient on its own, so both are required here to avoid crediting/activating
   * a wallet off a response that is only half-successful).
   */
  async assignDedicatedAccount(params: {
    bvn: string;
    accountName: string;
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<ZenithpayDedicatedAccount> {
    const response = await fetch(`${env.ZENITHPAY_BASE_URL}/api/dedicated_account/assign`, {
      method: 'POST',
      headers: authHeader(),
      body: new URLSearchParams({
        bvn: params.bvn,
        account_name: params.accountName,
        first_name: params.firstName,
        last_name: params.lastName,
        email: params.email
      })
    });

    let data: Partial<ZenithpayDedicatedAccount> & { message?: string };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new ApiError(502, 'ZenithPay returned an unreadable response', 'ZENITHPAY_BAD_RESPONSE');
    }

    if (!response.ok || data.status !== true || data.response_code !== '00' || !data.accountNumber) {
      throw new ApiError(
        502,
        data.message ?? 'Failed to assign a ZenithPay dedicated virtual account',
        'ZENITHPAY_ASSIGN_FAILED'
      );
    }

    return data as ZenithpayDedicatedAccount;
  }
};
