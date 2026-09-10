import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import {
  NEWSPAPER_PUBLICATION_FIELDS,
  type NewspaperPublicationField,
  getNewspaperPublicationPrice,
  listNewspaperPublicationHistory,
  submitNewspaperPublicationRequest
} from '../services/newspaper-publication.service.js';

export const newspaperPublicationRoutes = Router();

newspaperPublicationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

function zodFor(field: NewspaperPublicationField): ZodTypeAny {
  const schema = z.string().trim().min(1).max(200);
  return field.required ? schema : schema.optional().or(z.literal(''));
}

function buildSchema() {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of NEWSPAPER_PUBLICATION_FIELDS) {
    shape[field.key] = zodFor(field);
  }
  return z.object({ ...shape, ...pinField });
}

newspaperPublicationRoutes.get('/fields', (_req, res) => {
  res.json({ status: true, data: NEWSPAPER_PUBLICATION_FIELDS });
});

newspaperPublicationRoutes.get('/price', async (_req, res) => {
  const price = await getNewspaperPublicationPrice();
  res.json({ status: true, data: { unit_price: price.unitPrice } });
});

newspaperPublicationRoutes.get('/history', async (req, res) => {
  const data = await listNewspaperPublicationHistory({ userId: req.user!.id });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

newspaperPublicationRoutes.post('/submit', async (req, res) => {
  const body = buildSchema().parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin, ...values } = body as Record<string, unknown> & { pin: string };
  void pin;
  const result = await submitNewspaperPublicationRequest({
    userId: req.user!.id,
    values,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({
    status: true,
    message: 'Your Newspaper Publication request has been submitted and is being reviewed. You will be notified once it is complete.',
    data: { reference: result.reference, balance_after: result.balanceAfter }
  });
});
