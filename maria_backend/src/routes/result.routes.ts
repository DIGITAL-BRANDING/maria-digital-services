import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import { getResultPinPrice, listResultPinPrices, purchaseResultPin, type ExamPinType } from '../services/result-pin.service.js';

export const resultRoutes = Router();

resultRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

function parseExam(value: string): ExamPinType {
  const exam = value.toUpperCase();
  if (exam === 'WAEC' || exam === 'NECO' || exam === 'NABTEB') return exam;
  throw new Error(`Unsupported exam type: ${value}`);
}

resultRoutes.get('/prices', async (_req, res) => {
  const prices = await listResultPinPrices();
  res.json({ status: true, data: prices });
});

resultRoutes.get('/:exam/price', async (req, res) => {
  const price = await getResultPinPrice(parseExam(req.params.exam));
  res.json({ status: true, data: price });
});

resultRoutes.post('/:exam/pin', async (req, res) => {
  const body = z.object({ quantity: z.coerce.number().int().min(1).max(10), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseResultPin({
    userId: req.user!.id,
    examType: parseExam(req.params.exam),
    quantity: body.quantity,
    idempotencyKey: idempotencyKeyFrom(req)
  });

  res.json({
    status: result.status,
    message: result.message,
    data: {
      reference: result.reference,
      pin: result.pin,
      serial: result.serial,
      balance_after: result.balanceAfter
    }
  });
});
