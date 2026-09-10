import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import {
  BVN_MODIFICATION_CONFIG,
  BVN_MODIFICATION_TYPES,
  type BvnModificationField,
  type BvnModificationType,
  listBvnModificationHistory,
  listBvnModificationPrices,
  submitBvnModificationRequest,
  verifyBvnNinMatch
} from '../services/bvn-modification.service.js';

export const bvnModificationRoutes = Router();

bvnModificationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

function zodFor(field: BvnModificationField): ZodTypeAny {
  let schema: ZodTypeAny;
  switch (field.input) {
    case 'bvn':
    case 'nin':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits').regex(/^\d{11}$/, 'Must be 11 digits');
      break;
    case 'phone':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits').regex(/^0\d{10}$/, 'Must start with 0');
      break;
    case 'email':
      schema = z.string().trim().email();
      break;
    case 'date':
      schema = z.string().trim().min(1);
      break;
    case 'image':
      // A data URL string (e.g. "data:image/jpeg;base64,...") - the
      // frontend reads the selected file client-side and sends it this way,
      // same as everywhere else in this codebase that stores an image/PDF
      // inline rather than to separate file storage. Capped well under
      // express.json()'s 8mb body limit (see app.ts) to leave room for the
      // rest of the request.
      schema = z
        .string()
        .trim()
        .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Must be a photo (PNG, JPEG, or WEBP)')
        .max(7_000_000, 'Image is too large - please use a smaller photo');
      break;
    case 'select':
      schema = field.options ? z.enum(field.options as [string, ...string[]]) : z.string().trim().min(1);
      break;
    default:
      schema = z.string().trim().min(1).max(200);
  }
  // A `dependsOn` field (currently only `bank_name`, shown/required only
  // when `enrollment_type` is "Bank") is always optional at the per-field
  // level - the conditional "actually required when X" check happens once,
  // object-wide, in schemaFor()'s `.superRefine()` below, since that's the
  // only place multiple fields can be compared against each other.
  return field.required && !field.dependsOn ? schema : schema.optional().or(z.literal(''));
}

/** Builds { bvn: z..., account_number: z..., ... } straight from the type's field config, so a new field only ever needs updating in bvn-modification.service.ts. */
function schemaFor(type: BvnModificationType) {
  const fields = BVN_MODIFICATION_CONFIG[type].fields;
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = zodFor(field);
  }
  const base = z.object({ ...shape, ...pinField });

  const conditional = fields.filter((f) => f.dependsOn && f.required);
  if (conditional.length === 0) return base;

  return base.superRefine((value, ctx) => {
    const record = value as Record<string, unknown>;
    for (const field of conditional) {
      const dependsOn = field.dependsOn!;
      if (record[dependsOn.key] !== dependsOn.value) continue;
      const current = record[field.key];
      if (typeof current !== 'string' || current.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field.key], message: `${field.label} is required` });
      }
    }
  });
}

// ── Config + prices ─────────────────────────────────────────────

bvnModificationRoutes.get('/types', (_req, res) => {
  const data = BVN_MODIFICATION_TYPES.map((type) => ({
    id: type,
    title: BVN_MODIFICATION_CONFIG[type].title,
    fields: BVN_MODIFICATION_CONFIG[type].fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      input: field.input,
      options: field.options,
      dependsOn: field.dependsOn
    }))
  }));
  res.json({ status: true, data });
});

bvnModificationRoutes.get('/prices', async (_req, res) => {
  const prices = await listBvnModificationPrices();
  res.json({ status: true, data: prices });
});

// ── History ──────────────────────────────────────────────────────

bvnModificationRoutes.get('/history', async (req, res) => {
  const type = req.query.type ? z.enum(BVN_MODIFICATION_TYPES).parse(req.query.type) : undefined;
  const data = await listBvnModificationHistory({ userId: req.user!.id, type });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

// ── "Not sure what's wrong?" BVN/NIN date-of-birth match check ─────
// See the long comment above verifyBvnNinMatch() in
// bvn-modification.service.ts for what this actually does and why it costs
// real money (two real Techhub purchases, same price as BVN Verification +
// NIN Verification individually - nothing extra).

bvnModificationRoutes.post('/verify-match', async (req, res) => {
  const body = z
    .object({
      bvn: z.string().trim().length(11, 'Must be exactly 11 digits'),
      nin: z.string().trim().length(11, 'Must be exactly 11 digits'),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await verifyBvnNinMatch({
    userId: req.user!.id,
    bvn: body.bvn,
    nin: body.nin,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: result });
});

// ── Submit (one route per type, each validated against that type's own
// field config) ─────────────────────────────────────────────────────────

for (const type of BVN_MODIFICATION_TYPES) {
  bvnModificationRoutes.post(`/${type}/submit`, async (req, res) => {
    const body = schemaFor(type).parse(req.body);
    await requirePinConfirmation(req.user!.id, body.pin);
    const { pin, ...values } = body;
    void pin;
    const result = await submitBvnModificationRequest({
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
