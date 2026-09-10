import { Router } from 'express';
import { z } from 'zod';
import { koboToNaira } from '../lib/money.js';
import { requireAuth } from '../middleware/auth.js';
import { getReferralStats, withdrawReferralCommission } from '../services/referral.service.js';

export const referralRoutes = Router();

referralRoutes.use(requireAuth);

referralRoutes.get('/stats', async (req, res) => {
  const stats = await getReferralStats(req.user!.id);
  res.json({ status: true, data: stats });
});

referralRoutes.post('/withdraw', async (req, res) => {
  const body = z.object({ amount: z.number().positive() }).parse(req.body);
  const result = await withdrawReferralCommission(req.user!.id, body.amount);
  res.json({
    status: true,
    message: 'Commission withdrawn to your wallet',
    data: {
      reference: result.transaction.reference,
      balance: koboToNaira(result.user.walletBalanceKobo)
    }
  });
});
