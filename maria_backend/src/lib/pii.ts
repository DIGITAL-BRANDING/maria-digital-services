import { decryptPII, encryptPII } from './pii-encryption.js';

/**
 * Shape stored inside `Transaction.metadata.pii`. The `_sealed: true` marker
 * lets openPII() (and anything eyeballing raw JSON in a DB client) tell at a
 * glance that this is ciphertext, not an empty/malformed object.
 */
export type SealedPII = { _sealed: true; data: string };

export function isSealedPII(value: unknown): value is SealedPII {
  return typeof value === 'object' && value !== null && (value as { _sealed?: unknown })._sealed === true;
}

/** Encrypts an arbitrary JSON-serializable payload for storage under `metadata.pii`. */
export function sealPII(payload: Record<string, unknown>): SealedPII {
  return { _sealed: true, data: encryptPII(JSON.stringify(payload)) };
}

/** Decrypts a previously-sealed payload. Returns null for missing/malformed input rather than throwing, so callers reading old rows or a null field don't need a try/catch at every call site. */
export function openPII<T = Record<string, unknown>>(sealed: unknown): T | null {
  if (!isSealedPII(sealed)) return null;
  try {
    return JSON.parse(decryptPII(sealed.data)) as T;
  } catch (error) {
    console.error('[pii] failed to decrypt a sealed PII blob:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Merges a new set of fields into an already-sealed PII blob and re-seals -
 * used when a record's identity data arrives in stages (e.g. the NIN/BVN
 * submitted at request time, then the provider's returned slip/response
 * data added once the purchase or async ticket resolves). Everything ends
 * up under the one `metadata.pii` field rather than scattered plaintext
 * fields added at each stage.
 */
export function mergeSealedPII(existing: unknown, extra: Record<string, unknown>): SealedPII {
  const current = openPII(existing) ?? {};
  return sealPII({ ...current, ...extra });
}

/**
 * Last-4-digits masking for contexts that need to *show* an identifier
 * without decrypting it (support UI hints, log lines) - same convention the
 * app already uses for `User.bvnLast4` in kyc.service.ts.
 */
export function maskIdentifier(value: string | undefined | null): string {
  if (!value) return '';
  return value.length <= 4 ? '*'.repeat(value.length) : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}
