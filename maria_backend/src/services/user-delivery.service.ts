import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { openPII, sealPII } from '../lib/pii.js';

const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);

function config() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase Storage is not configured');
  return { url: env.SUPABASE_URL.replace(/\/$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
}

export async function createUserDelivery(input: { userId: string; adminId: string; title: string; description?: string; fileName: string; mimeType: string; base64: string; reference?: string }) {
  if (!allowed.has(input.mimeType)) throw new Error('Unsupported delivery file type');
  const bytes = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('File must be between 1 byte and 10MB');
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Store new manual documents in MySQL, encrypted at rest. This avoids
  // dependence on Supabase and is durable across Railway redeploys. Existing
  // Supabase deliveries remain supported below for backward compatibility.
  const delivery = await prisma.userDelivery.create({ data: { userId: input.userId, createdByAdminId: input.adminId, title: input.title, description: input.description, fileName: safeName, mimeType: input.mimeType, filePath: `database:${crypto.randomUUID()}`, inlineData: sealPII({ base64: bytes.toString('base64') }), fileSize: bytes.length, reference: input.reference } });
  return delivery;
}

export async function listUserDeliveries(userId: string) {
  return prisma.userDelivery.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function signedDeliveryUrl(userId: string, id: string) {
  const row = await prisma.userDelivery.findFirst({ where: { id, userId } });
  if (!row) return null;
  const inline = openPII<{ base64?: unknown }>(row.inlineData);
  if (typeof inline?.base64 === 'string' && inline.base64.length > 0) {
    return { row, url: `data:${row.mimeType};base64,${inline.base64}` };
  }
  const c = config();
  const response = await fetch(`${c.url}/storage/v1/object/sign/${c.bucket}/${row.filePath}`, { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) });
  if (!response.ok) throw new Error(`Supabase signing failed (${response.status})`);
  const body = await response.json() as { signedURL?: string };
  return { row, url: body.signedURL ? `${c.url}/storage/v1${body.signedURL}` : null };
}
