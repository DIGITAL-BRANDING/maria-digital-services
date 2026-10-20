/**
 * Pure helpers for the per-bank BVN Modification price rows.
 *
 * Each bank has its own ServicePricing row, keyed
 * `BVN_MODIFICATION_<TYPE>_BANK_<BANK_KEY>` (e.g.
 * `BVN_MODIFICATION_UPDATE_NAME_BANK_ACCESS_BANK`). Kept free of any imports
 * so the service, the admin bulk-pricing page and result-pin.service.ts's
 * bulk markup can all share one definition of "bank key" without creating an
 * import cycle between those modules.
 */

/** "Access Bank" -> "ACCESS_BANK", "Micro Finance Bank" -> "MICRO_FINANCE_BANK". */
export function bankKeyFor(bankName: string): string {
  return bankName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * True when `service` is a per-bank BVN Modification row belonging to one of
 * `bankKeys`. An empty/undefined `bankKeys` means "every bank".
 *
 * The match is on the exact `_BANK_<KEY>` suffix, so "ACCESS_BANK" never
 * matches a different bank whose key merely contains it.
 */
export function serviceMatchesBankKeys(service: string, bankKeys?: readonly string[]): boolean {
  if (!service.startsWith('BVN_MODIFICATION_') || !service.includes('_BANK_')) return false;
  if (!bankKeys || bankKeys.length === 0) return true;
  return bankKeys.some((key) => service.endsWith(`_BANK_${key}`));
}
