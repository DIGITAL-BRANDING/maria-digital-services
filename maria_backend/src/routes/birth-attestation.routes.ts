import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import {
  BIRTH_ATTESTATION_FIELDS,
  type BirthAttestationField,
  getBirthAttestationPrice,
  listBirthAttestationHistory,
  submitBirthAttestationRequest
} from '../services/birth-attestation.service.js';

export const birthAttestationRoutes = Router();

birthAttestationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

// Same ballpark as nin-modification.routes.ts's MAX_DOCUMENT_BASE64_LENGTH -
// generous enough for a phone-camera photo compressed to base64 JPEG/PNG,
// while still bounding what gets stored (encrypted) in one Postgres row.
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;

function zodFor(field: BirthAttestationField): ZodTypeAny {
  let schema: ZodTypeAny;
  switch (field.input) {
    case 'nin':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits').regex(/^\d{11}$/, 'Must be 11 digits');
      break;
    case 'date':
      schema = z.string().trim().min(1);
      break;
    case 'select':
      schema = field.options ? z.enum(field.options as [string, ...string[]]) : z.string().trim().min(1);
      break;
    case 'image':
      schema = z
        .string()
        .trim()
        .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Must be a photo (PNG, JPEG, or WEBP)')
        .max(MAX_IMAGE_BASE64_LENGTH, 'Photo is too large - please use a smaller image');
      break;
    default:
      schema = z.string().trim().min(1).max(500);
  }
  return field.required ? schema : schema.optional().or(z.literal(''));
}

function buildSchema() {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of BIRTH_ATTESTATION_FIELDS) {
    shape[field.key] = zodFor(field);
  }
  return z.object({ ...shape, ...pinField });
}

birthAttestationRoutes.get('/fields', (_req, res) => {
  res.json({
    status: true,
    data: BIRTH_ATTESTATION_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      input: field.input,
      options: field.options ?? null,
      section: field.section ?? null
    }))
  });
});

birthAttestationRoutes.get('/price', async (_req, res) => {
  const price = await getBirthAttestationPrice();
  res.json({ status: true, data: { unit_price: price.unitPrice } });
});

birthAttestationRoutes.get('/history', async (req, res) => {
  const data = await listBirthAttestationHistory({ userId: req.user!.id });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

birthAttestationRoutes.post('/submit', async (req, res) => {
  const body = buildSchema().parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin, ...values } = body as Record<string, unknown> & { pin: string };
  void pin;
  const result = await submitBirthAttestationRequest({
    userId: req.user!.id,
    values,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({
    status: true,
    message: 'Your Birth Attestation request has been submitted and is being reviewed. You will be notified once it is complete.',
    data: { reference: result.reference, balance_after: result.balanceAfter }
  });
});
