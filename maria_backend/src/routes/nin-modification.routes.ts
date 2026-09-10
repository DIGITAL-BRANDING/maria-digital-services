import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import {
  MODIFICATION_CONFIG,
  MODIFICATION_TYPES,
  type ModificationField,
  type ModificationType,
  listModificationHistory,
  listModificationPrices,
  submitModificationRequest
} from '../services/nin-modification.service.js';

export const ninModificationRoutes = Router();

ninModificationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

// A cap generous enough for a scanned attestation letter while still
// bounding what gets stored (encrypted) in a single Postgres row - matches
// the ~5MB ballpark a phone camera photo compresses to as a base64 JPEG/PDF.
const MAX_DOCUMENT_BASE64_LENGTH = 7_000_000;

function zodFor(field: ModificationField): ZodTypeAny {
  let schema: ZodTypeAny;
  switch (field.input) {
    case 'nin':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits');
      break;
    case 'phone':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits').regex(/^0\d{10}$/, 'Must start with 0');
      break;
    case 'date':
      schema = z.string().trim().min(1);
      break;
    case 'select':
      schema = field.options ? z.enum(field.options as [string, ...string[]]) : z.string().trim().min(1);
      break;
    case 'document':
      schema = z.string().trim().max(MAX_DOCUMENT_BASE64_LENGTH, 'Document is too large');
      break;
    default:
      schema = z.string().trim().min(1).max(200);
  }
  return field.required ? schema : schema.optional().or(z.literal(''));
}

/** Builds { first_name: z..., last_name: z..., ... } straight from the type's field config, so a new field only ever needs updating in nin-modification.service.ts. */
function schemaFor(type: ModificationType) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of MODIFICATION_CONFIG[type].fields) {
    shape[field.key] = zodFor(field);
  }
  return z.object({ ...shape, ...pinField });
}

// ── Config + prices ─────────────────────────────────────────────

ninModificationRoutes.get('/types', (_req, res) => {
  const data = MODIFICATION_TYPES.map((type) => ({
    id: type,
    title: MODIFICATION_CONFIG[type].title,
    fields: MODIFICATION_CONFIG[type].fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      input: field.input,
      options: field.options ?? null
    }))
  }));
  res.json({ status: true, data });
});

ninModificationRoutes.get('/prices', async (_req, res) => {
  const prices = await listModificationPrices();
  res.json({ status: true, data: prices });
});

// ── History (matches verification.routes.ts's /history shape so the web/
// Flutter UI can reuse the same "recent requests" view) ────────────────────

ninModificationRoutes.get('/history', async (req, res) => {
  const type = req.query.type ? z.enum(MODIFICATION_TYPES).parse(req.query.type) : undefined;
  const data = await listModificationHistory({ userId: req.user!.id, type });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

// ── Submit (one route per type, each validated against that type's own
// field config) ─────────────────────────────────────────────────────────

for (const type of MODIFICATION_TYPES) {
  ninModificationRoutes.post(`/${type}/submit`, async (req, res) => {
    const body = schemaFor(type).parse(req.body);
    await requirePinConfirmation(req.user!.id, body.pin);
    const { pin, ...values } = body;
    void pin;
    const result = await submitModificationRequest({
      userId: req.user!.id,
      type,
      values,
      idempotencyKey: idempotencyKeyFrom(req)
    });
    res.json({
      status: true,
      message: 'Your request has been submitted and is being reviewed. You will be notified once it is complete.',
      data: { reference: result.reference, balance_after: result.balanceAfter }
    });
  });
}
