import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

/**
 * One-off fix for the ServicePricing rows created BEFORE verification
 * .service.ts's DEFAULTS were corrected to match Techhub's actual
 * api_summary.php pricing (they were placeholder guesses before this).
 *
 * getOrCreateVerificationPricingRow() never overwrites an existing row's
 * providerCostKobo - by design, so an admin's already-configured
 * sellingPriceKobo is never silently reset. That's the right behavior for
 * routine reads, but it also means the old placeholder providerCostKobo
 * values are stuck in the DB forever unless something explicitly updates
 * them - this script is that one-time update.
 *
 * Only touches providerCostKobo. Never touches sellingPriceKobo or
 * isActive - if an admin already set a real selling price, it's left
 * exactly as-is; this only corrects the provider-cost floor rows fall back
 * to when no selling price has been set yet.
 *
 * Safe to run more than once - it's idempotent (sets the same values every
 * time). Run with: npx tsx src/scripts/sync-techhub-prices.ts
 */
const TECHHUB_PROVIDER_COSTS_NAIRA: Record<string, number> = {
  NIN_SLIP_PREMIUM: 120,
  NIN_SLIP_STANDARD: 120,
  NIN_SLIP_REGULAR: 120,
  NIN_SLIP_VNIN: 120,
  NIN_PHONE_SLIP_PREMIUM: 130,
  NIN_PHONE_SLIP_STANDARD: 130,
  NIN_PHONE_SLIP_REGULAR: 130,
  NIN_DEMOGRAPHIC: 130,
  BVN_SLIP_PREMIUM: 80,
  BVN_SLIP_STANDARD: 80,
  NIN_DELINKING: 3500,
  NIN_VALIDATION: 1000,
  NIN_PERSONALIZATION: 300,
  BVN_RETRIEVAL: 700,
  IPE_CLEARANCE: 450
};

function priceToKobo(amountNaira: number) {
  return BigInt(Math.round(amountNaira * 100));
}

async function main() {
  console.log('[sync-techhub-prices] Starting...');
  let updated = 0;
  let skipped = 0;

  for (const [service, priceNaira] of Object.entries(TECHHUB_PROVIDER_COSTS_NAIRA)) {
    const providerCostKobo = priceToKobo(priceNaira);
    const existing = await prisma.servicePricing.findUnique({ where: { service } });

    if (!existing) {
      // No row yet - nothing to fix here, getOrCreateVerificationPricingRow
      // will create it with the (already-corrected) code default on first use.
      console.log(`[sync-techhub-prices] ${service}: no row yet, skipping (will use code default on first use)`);
      skipped += 1;
      continue;
    }

    if (existing.providerCostKobo === providerCostKobo) {
      console.log(`[sync-techhub-prices] ${service}: already correct (₦${priceNaira}), skipping`);
      skipped += 1;
      continue;
    }

    const oldNaira = Number(existing.providerCostKobo) / 100;
    await prisma.servicePricing.update({
      where: { service },
      data: { provider: 'techhub', providerCostKobo }
    });
    console.log(`[sync-techhub-prices] ${service}: ₦${oldNaira} -> ₦${priceNaira} (updated)`);
    updated += 1;
  }

  console.log(`[sync-techhub-prices] Done. Updated: ${updated}, Skipped: ${skipped}`);
}

main()
  .catch((error) => {
    console.error('[sync-techhub-prices] Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
