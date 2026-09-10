import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * payment-provider.service.ts is the single switch point between Paystack and
 * KatPay (see PAYMENT_PROVIDER in env.ts). These tests verify the *routing*
 * logic — that each exported function calls the right underlying gateway
 * service, with the right arguments, and normalizes each gateway's response
 * into the same shape — not the gateways' own HTTP behavior (that's
 * katpay.service.ts / paystack.service.ts's job, and they call real APIs so
 * aren't unit-tested here).
 *
 * `env` is mocked as a plain mutable object so each test can flip
 * `env.PAYMENT_PROVIDER` between 'paystack' and 'katpay' independently.
 */

const mockEnv: Record<string, unknown> = {
  PAYMENT_PROVIDER: 'paystack',
  KATPAY_SECRET_KEY: 'katpay-secret',
  KATPAY_PUBLIC_KEY: 'katpay-public',
  KATPAY_MERCHANT_ID: 'merchant-1',
  KATPAY_INSTANT_VA_ENABLED: true
};

vi.mock('../../config/env.js', () => ({ env: mockEnv }));

const provisionPaystackVirtualAccount = vi.fn().mockResolvedValue(undefined);
vi.mock('../kyc.service.js', () => ({
  tryProvisionInstantVirtualAccount: (...args: unknown[]) => provisionPaystackVirtualAccount(...args)
}));

const katpayCreateVirtualAccount = vi.fn();
const katpayCreateTransferPayment = vi.fn();
const katpayGetTransferPaymentStatus = vi.fn();
const katpayListBanks = vi.fn();
vi.mock('../katpay.service.js', () => ({
  katpayService: {
    createVirtualAccount: (...args: unknown[]) => katpayCreateVirtualAccount(...args),
    createTransferPayment: (...args: unknown[]) => katpayCreateTransferPayment(...args),
    getTransferPaymentStatus: (...args: unknown[]) => katpayGetTransferPaymentStatus(...args),
    listBanks: (...args: unknown[]) => katpayListBanks(...args)
  }
}));

const paystackCreateTemporaryTransferAccount = vi.fn();
const paystackVerifyTransaction = vi.fn();
const paystackListBanks = vi.fn();
vi.mock('../paystack.service.js', () => ({
  paystackService: {
    createTemporaryTransferAccount: (...args: unknown[]) => paystackCreateTemporaryTransferAccount(...args),
    verifyTransaction: (...args: unknown[]) => paystackVerifyTransaction(...args),
    listBanks: (...args: unknown[]) => paystackListBanks(...args)
  }
}));

vi.mock('../../lib/prisma.js', async () => {
  const { createFakePrisma } = await import('../../test-utils/fake-prisma.js');
  const fake = createFakePrisma();
  return { prisma: fake.api };
});

const { prisma } = await import('../../lib/prisma.js');
const {
  provisionInstantVirtualAccount,
  createDynamicFundingAccount,
  verifyDynamicFunding,
  listSupportedBanks
} = await import('../payment-provider.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.PAYMENT_PROVIDER = 'paystack';
  mockEnv.KATPAY_SECRET_KEY = 'katpay-secret';
  mockEnv.KATPAY_PUBLIC_KEY = 'katpay-public';
  mockEnv.KATPAY_MERCHANT_ID = 'merchant-1';
  mockEnv.KATPAY_INSTANT_VA_ENABLED = true;
});

describe('provisionInstantVirtualAccount', () => {
  it('delegates to the Paystack implementation when PAYMENT_PROVIDER=paystack', async () => {
    await provisionInstantVirtualAccount('user-1');

    expect(provisionPaystackVirtualAccount).toHaveBeenCalledWith('user-1');
    expect(katpayCreateVirtualAccount).not.toHaveBeenCalled();
  });

  it('creates a KatPay virtual account and stamps virtualAccountProvider when PAYMENT_PROVIDER=katpay', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    await prisma.user.create({
      data: { id: 'user-2', walletBalanceKobo: 0n, fullName: 'Sadeeq Doe', email: 's@example.test', phone: '+2348000000000', referralCode: 'REF002' }
    });
    katpayCreateVirtualAccount.mockResolvedValue({
      account_number: '8012345678',
      account_name: 'KatPay Sadeeq',
      bank_name: 'PalmPay'
    });

    await provisionInstantVirtualAccount('user-2');

    expect(katpayCreateVirtualAccount).toHaveBeenCalledWith({
      email: 's@example.test',
      name: 'Sadeeq Doe',
      phoneNumber: '+2348000000000'
    });
    expect(provisionPaystackVirtualAccount).not.toHaveBeenCalled();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-2' } });
    expect(user.virtualAccountNumber).toBe('8012345678');
    expect(user.virtualAccountBank).toBe('PalmPay');
    expect(user.virtualAccountProvider).toBe('katpay');
  });

  it('does not call KatPay again for a user who already has a virtual account', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    await prisma.user.create({
      data: {
        id: 'user-3',
        walletBalanceKobo: 0n,
        fullName: 'Already Provisioned',
        email: 'a@example.test',
        phone: '+2348000000001', referralCode: 'REF003',
        virtualAccountNumber: '9999999999'
      }
    });

    await provisionInstantVirtualAccount('user-3');

    expect(katpayCreateVirtualAccount).not.toHaveBeenCalled();
  });

  it('never throws when KatPay credentials are missing - it just skips provisioning', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    mockEnv.KATPAY_MERCHANT_ID = undefined;
    await prisma.user.create({
      data: { id: 'user-4', walletBalanceKobo: 0n, fullName: 'No Merchant Id', email: 'n@example.test', phone: '+2348000000002', referralCode: 'REF004' }
    });

    await expect(provisionInstantVirtualAccount('user-4')).resolves.toBeUndefined();
    expect(katpayCreateVirtualAccount).not.toHaveBeenCalled();
  });

  it('never throws when the KatPay API call itself fails', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    await prisma.user.create({
      data: { id: 'user-5', walletBalanceKobo: 0n, fullName: 'API Fails', email: 'f@example.test', phone: '+2348000000003', referralCode: 'REF005' }
    });
    katpayCreateVirtualAccount.mockRejectedValue(new Error('KatPay is down'));

    await expect(provisionInstantVirtualAccount('user-5')).resolves.toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-5' } });
    expect(user.virtualAccountNumber).toBeUndefined();
  });
});

describe('createDynamicFundingAccount', () => {
  it('routes to Paystack and passes through its own reference', async () => {
    paystackCreateTemporaryTransferAccount.mockResolvedValue({
      reference: 'PSK_REF_123',
      account_number: '0123456789',
      account_name: 'MAJOR DATA-LINK',
      bank: { name: 'Wema Bank' },
      account_expires_at: '2026-01-01T00:00:00Z'
    });

    const result = await createDynamicFundingAccount({ email: 'x@example.test', fullName: 'X User', amount: 5000 });

    expect(paystackCreateTemporaryTransferAccount).toHaveBeenCalledWith({
      email: 'x@example.test',
      amountKobo: 500000n
    });
    expect(result).toMatchObject({
      provider: 'paystack',
      reference: 'PSK_REF_123',
      accountNumber: '0123456789',
      accountName: 'MAJOR DATA-LINK',
      bankName: 'Wema Bank'
    });
    expect(result.providerReference).toBeUndefined();
    expect(katpayCreateTransferPayment).not.toHaveBeenCalled();
  });

  it('routes to KatPay, minting its own reference as merchant_reference and surfacing the uuid as providerReference', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    katpayCreateTransferPayment.mockResolvedValue({
      uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      payment_account: { account_number: '8012345678', account_name: 'KatPay John', bank_name: 'PalmPay' },
      expires_at: '2026-03-21T10:30:00+00:00'
    });

    const result = await createDynamicFundingAccount({ email: 'y@example.test', fullName: 'Y User', amount: 3000 });

    expect(katpayCreateTransferPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3000,
        customerName: 'Y User',
        customerEmail: 'y@example.test',
        merchantReference: expect.any(String)
      })
    );
    expect(result).toMatchObject({
      provider: 'katpay',
      providerReference: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accountNumber: '8012345678',
      accountName: 'KatPay John',
      bankName: 'PalmPay'
    });
    // We mint the reference ourselves (not returned by KatPay) - it must be a
    // non-empty string distinct from the provider's uuid.
    expect(result.reference).toEqual(expect.any(String));
    expect(result.reference.length).toBeGreaterThan(0);
    expect(result.reference).not.toBe(result.providerReference);
  });
});

describe('verifyDynamicFunding', () => {
  it('checks Paystack when the transaction has no provider recorded (legacy rows) or provider=paystack', async () => {
    paystackVerifyTransaction.mockResolvedValue({ status: 'success' });

    const status = await verifyDynamicFunding({ provider: null, reference: 'PSK_REF_1', metadata: null });

    expect(paystackVerifyTransaction).toHaveBeenCalledWith('PSK_REF_1');
    expect(status).toBe('success');
    expect(katpayGetTransferPaymentStatus).not.toHaveBeenCalled();
  });

  it('normalizes Paystack "abandoned" to "failed"', async () => {
    paystackVerifyTransaction.mockResolvedValue({ status: 'abandoned' });
    const status = await verifyDynamicFunding({ provider: 'paystack', reference: 'r', metadata: null });
    expect(status).toBe('failed');
  });

  it('checks KatPay by uuid when the transaction was created under provider=katpay', async () => {
    katpayGetTransferPaymentStatus.mockResolvedValue({ status: 'success' });

    const status = await verifyDynamicFunding({
      provider: 'katpay',
      reference: 'IDS-FUND-1',
      metadata: { provider_reference: 'the-uuid' }
    });

    expect(katpayGetTransferPaymentStatus).toHaveBeenCalledWith('the-uuid');
    expect(status).toBe('success');
    expect(paystackVerifyTransaction).not.toHaveBeenCalled();
  });

  it('reports "pending" for a KatPay transaction that is missing its provider_reference rather than throwing', async () => {
    const status = await verifyDynamicFunding({ provider: 'katpay', reference: 'IDS-FUND-2', metadata: null });
    expect(status).toBe('pending');
    expect(katpayGetTransferPaymentStatus).not.toHaveBeenCalled();
  });

  it('normalizes KatPay "expired" to "failed"', async () => {
    katpayGetTransferPaymentStatus.mockResolvedValue({ status: 'expired' });
    const status = await verifyDynamicFunding({
      provider: 'katpay',
      reference: 'r',
      metadata: { provider_reference: 'u' }
    });
    expect(status).toBe('failed');
  });
});

describe('listSupportedBanks', () => {
  it('lists Paystack banks by default', async () => {
    paystackListBanks.mockResolvedValue([{ name: 'GTBank', code: '058' }]);
    const banks = await listSupportedBanks();
    expect(paystackListBanks).toHaveBeenCalled();
    expect(banks).toEqual([{ name: 'GTBank', code: '058' }]);
  });

  it('lists KatPay banks when PAYMENT_PROVIDER=katpay', async () => {
    mockEnv.PAYMENT_PROVIDER = 'katpay';
    katpayListBanks.mockResolvedValue([{ name: 'PalmPay', code: 'PALMPAY' }]);
    const banks = await listSupportedBanks();
    expect(katpayListBanks).toHaveBeenCalled();
    expect(banks).toEqual([{ name: 'PalmPay', code: 'PALMPAY' }]);
  });
});
