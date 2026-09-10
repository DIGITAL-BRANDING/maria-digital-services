import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import { BVN_CRM_FIELDS, getBvnCrmPrice, listBvnCrmHistory, submitBvnCrmRequest } from '../services/bvn-crm.service.js';

export const bvnCrmRoutes = Router();

bvnCrmRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

const submitSchema = z.object({
  ticket_id: z
    .string()
    .trim()
    .length(8, 'Must be exactly 8 digits')
    .regex(/^\d{8}$/, 'Must be 8 digits'),
  ...pinField
});

bvnCrmRoutes.get('/fields', (_req, res) => {
  res.json({ status: true, data: BVN_CRM_FIELDS });
});

bvnCrmRoutes.get('/price', async (_req, res) => {
  const price = await getBvnCrmPrice();
  res.json({ status: true, data: { unit_price: price.unitPrice } });
});

bvnCrmRoutes.get('/history', async (req, res) => {
  const data = await listBvnCrmHistory({ userId: req.user!.id });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

bvnCrmRoutes.post('/submit', async (req, res) => {
  const body = submitSchema.parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin, ...values } = body;
  void pin;
  const result = await submitBvnCrmRequest({
    userId: req.user!.id,
    values,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({
    status: true,
    message: 'Your BVN CRM request has been submitted. It will be processed within 24 - 48hrs.',
    data: { reference: result.reference, balance_after: result.balanceAfter }
  });
});
