import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Admin-editable minimum-app-version gate - see the AppConfig AdminJS
 * resource. Same self-seeding singleton pattern as getReferralSettings()
 * in referral.service.ts (a plain findUnique-then-create, NOT
 * prisma.appConfig.upsert() - upsert throws on an empty `update` object,
 * which it would be here since a routine read must never touch an
 * existing row).
 */
export async function getAppConfig() {
  const existing = await prisma.appConfig.findUnique({ where: { id: 'default' } });
  if (existing) return existing;

  try {
    return await prisma.appConfig.create({ data: { id: 'default' } });
  } catch (error) {
    // Two concurrent first-ever callers both see "no row exists" and both
    // attempt to create it - only one create can win. Re-fetch and use
    // whichever row actually landed rather than surfacing a spurious error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.appConfig.findUniqueOrThrow({ where: { id: 'default' } });
    }
    throw error;
  }
}
