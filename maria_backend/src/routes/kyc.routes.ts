import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { getKycStatus, verifyBvnAndActivateWallet } from '../services/kyc.service.js';
// Bank list comes from whichever gateway PAYMENT_PROVIDER currently points at,
// not hardcoded to Paystack - see payment-provider.service.ts.
import { listSupportedBanks } from '../services/payment-provider.service.js';

export const kycRoutes = Router();

kycRoutes.use(requireAuth);

kycRoutes.get('/status', async (req, res) => {
  const status = await getKycStatus(req.user!.id);
  res.json({
    status: true,
    data: {
      kyc_status: status.kycStatus.toLowerCase(),
      kyc_failure_reason: status.kycFailureReason,
      bvn_last4: status.bvnLast4,
      bvn_verified_at: status.bvnVerifiedAt,
      // See VIRTUAL_ACCOUNT_FUNDING_ENABLED in env.ts - hides the account
      // number from every surface while the KatPay webhook crediting bug is
      // being fixed, without a redeploy.
      virtual_account_number: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? status.virtualAccountNumber : null,
      virtual_account_bank: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? status.virtualAccountBank : null,
      virtual_account_funding_paused: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? undefined : true
    }
  });
});

kycRoutes.get('/banks', async (_req, res) => {
  const banks = await listSupportedBanks();
  res.json({ status: true, data: banks });
});

// NOTE: this endpoint (verifyBvnAndActivateWallet) is Paystack-specific - KatPay's
// virtual-account creation has no BVN/bank-validation step to mirror it. It only
// matters if PAYMENT_PROVIDER=paystack AND PAYSTACK_INSTANT_DVA_ENABLED=false, so
// the app falls back to this BVN-gated path instead of the instant one.
kycRoutes.post('/bvn', async (req, res) => {
  const body = z
    .object({
      bvn: z.string().trim().length(11, 'BVN must be exactly 11 digits'),
      bank_code: z.string().trim().min(1, 'bank_code is required'),
      account_number: z.string().trim().length(10, 'Account number must be exactly 10 digits')
    })
    .parse(req.body);

  const result = await verifyBvnAndActivateWallet({
    userId: req.user!.id,
    bvn: body.bvn,
    bankCode: body.bank_code,
    accountNumber: body.account_number
  });

  res.json({
    status: true,
    message: 'Wallet activated successfully',
    data: {
      kyc_status: result.kycStatus.toLowerCase(),
      virtual_account_number: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? result.virtualAccountNumber : null,
      virtual_account_bank: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? result.virtualAccountBank : null,
      virtual_account_funding_paused: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? undefined : true
    }
  });
});
