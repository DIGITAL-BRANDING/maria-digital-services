import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { assistantWorkflows, parseAssistantIntent } from '../services/assistant-workflow.service.js';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { TransactionStatus, TransactionType } from '@prisma/client';

export const assistantRoutes = Router();
assistantRoutes.use(requireAuth);

assistantRoutes.get('/workflows', (_req, res) => res.json({ status: true, data: assistantWorkflows }));
assistantRoutes.post('/parse', (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(1).max(500) }).parse(req.body);
  res.json({ status: true, data: parseAssistantIntent(message) });
});

/** Recent successful recipients are derived from the user's own transactions.
 * No PINs or full transaction payloads are returned. */
assistantRoutes.get('/beneficiaries', async (req, res) => {
  const rows = await prisma.transaction.findMany({
    where: {
      userId: req.user!.id,
      status: TransactionStatus.SUCCESS,
      type: { in: [TransactionType.DATA_PURCHASE, TransactionType.AIRTIME_PURCHASE] }
    },
    orderBy: { createdAt: 'desc' },
    take: 30
  });
  const seen = new Set<string>();
  const data = rows.flatMap((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const phone = typeof metadata.phone === 'string' ? metadata.phone : undefined;
    if (!phone || seen.has(phone)) return [];
    seen.add(phone);
    return [{ phone, network: typeof metadata.network === 'string' ? metadata.network : undefined, type: row.type === TransactionType.DATA_PURCHASE ? 'data' : 'airtime', last_used_at: row.createdAt.toISOString() }];
  });
  res.json({ status: true, data });
});

assistantRoutes.post('/events', async (req, res) => {
  const body = z.object({
    intent: z.string().trim().max(80).optional(),
    stage: z.string().trim().min(1).max(80),
    outcome: z.enum(['started', 'waiting', 'success', 'failed', 'fallback', 'cancelled']),
    error_code: z.string().trim().max(80).optional(),
    transaction_ref: z.string().trim().max(160).optional(),
    metadata: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional()
  }).parse(req.body);
  const forbidden = /pin|password|otp|secret/i;
  if ([body.intent, body.stage, body.error_code, body.transaction_ref, ...Object.keys(body.metadata ?? {})].some((value) => value && forbidden.test(value))) {
    return res.status(400).json({ status: false, message: 'Sensitive fields are not accepted in assistant audit events' });
  }
  await prisma.assistantAuditEvent.create({ data: { userId: req.user!.id, intent: body.intent, stage: body.stage, outcome: body.outcome, errorCode: body.error_code, transactionRef: body.transaction_ref, metadata: body.metadata } });
  return res.status(201).json({ status: true });
});

assistantRoutes.post('/fallback', async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3).max(240), stage: z.string().trim().max(80).default('unknown') }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const ticket = await prisma.supportTicket.create({ data: {
    userId: user.id,
    subject: 'MAJOR Assistant handoff',
    messages: { create: { senderType: 'USER', senderId: user.id, senderName: user.fullName, message: `Assistant handoff requested at stage "${body.stage}": ${body.reason}` } }
  } });
  await prisma.assistantAuditEvent.create({ data: { userId: user.id, stage: body.stage, outcome: 'fallback', errorCode: 'HUMAN_HANDOFF' } });
  return res.status(201).json({ status: true, data: { ticket_id: ticket.id } });
});

/**
 * "Why did my transaction fail?" - the assistant's answer, safe to show a
 * customer. Deliberately does NOT return `metadata` or `providerRef` (both
 * present on the raw Transaction row and included in GET /transactions) -
 * those can carry upstream provider payloads, internal error codes, and
 * other implementation detail that means nothing to a customer and
 * shouldn't be exposed to one. Only `type`, `status`, `amount`, our own
 * human-composed `description` (e.g. "MTN 1GB data purchase for
 * 08012345678" - written by our own code at purchase time, never raw
 * provider text), and `created_at` go out. The client is expected to turn
 * this into a bilingual sentence itself (same pattern as every other
 * assistant response) - see the doc-comment where this is consumed in
 * major_ai_assistant_screen.dart / MajorAssistant.tsx for the exact
 * per-status wording and when `escalate` should be offered.
 */
assistantRoutes.get('/last-transaction', async (req, res) => {
  const tx = await prisma.transaction.findFirst({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' }
  });
  if (!tx) return res.json({ status: true, data: { found: false } });
  res.json({
    status: true,
    data: {
      found: true,
      type: tx.type.toLowerCase(),
      status: tx.status.toLowerCase(),
      amount: koboToNaira(tx.amountKobo),
      description: tx.description,
      created_at: tx.createdAt.toISOString()
    }
  });
});
