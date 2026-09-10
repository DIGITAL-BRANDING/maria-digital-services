import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

/**
 * Global default markup applied to any DataPlanPricing row without its own
 * sellingPriceKobo override. Previously only configurable via the
 * DATA_PLAN_MARKUP_PERCENT/DATA_PLAN_MARKUP_NAIRA env vars, which meant
 * changing it needed a developer and a Railway redeploy. Same getOrCreate
 * self-seeding pattern as getReferralSettings() in referral.service.ts - the
 * env vars now only matter as the one-time seed value for a fresh database.
 */
export async function getPricingSettings() {
  const existing = await prisma.pricingSettings.findUnique({ where: { id: 'default' } });
  if (existing) return existing;

  try {
    return await prisma.pricingSettings.create({
      data: {
        id: 'default',
        dataPlanMarkupPercent: env.DATA_PLAN_MARKUP_PERCENT,
        dataPlanMarkupNaira: env.DATA_PLAN_MARKUP_NAIRA
      }
    });
  } catch (error) {
    // Two concurrent first-ever callers both see "no row exists" - see the
    // identical comment in getReferralSettings() for why this is safe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.pricingSettings.findUniqueOrThrow({ where: { id: 'default' } });
    }
    throw error;
  }
}

export async function updatePricingSettings(input: {
  dataPlanMarkupPercent?: number;
  dataPlanMarkupNaira?: number;
  dataAirtimeProvider?: 'alrahuz' | 'bilalsadasub';
  resultPinProvider?: 'alrahuz' | 'bilalsadasub';
  cableMarkupPercent?: number;
  electricityMarkupPercent?: number;
}) {
  await getPricingSettings(); // ensure the row exists before updating it
  return prisma.pricingSettings.update({
    where: { id: 'default' },
    data: {
      ...(input.dataPlanMarkupPercent !== undefined ? { dataPlanMarkupPercent: input.dataPlanMarkupPercent } : {}),
      ...(input.dataPlanMarkupNaira !== undefined ? { dataPlanMarkupNaira: input.dataPlanMarkupNaira } : {}),
      ...(input.dataAirtimeProvider !== undefined ? { dataAirtimeProvider: input.dataAirtimeProvider } : {}),
      ...(input.resultPinProvider !== undefined ? { resultPinProvider: input.resultPinProvider } : {}),
      ...(input.cableMarkupPercent !== undefined ? { cableMarkupPercent: input.cableMarkupPercent } : {}),
      ...(input.electricityMarkupPercent !== undefined ? { electricityMarkupPercent: input.electricityMarkupPercent } : {})
    }
  });
}
