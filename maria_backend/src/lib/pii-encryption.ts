import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env.js';

/**
 * Field-level encryption for PII at rest (NIN, BVN, names, phone numbers,
 * generated identity-slip PDFs, and raw provider responses that carry the
 * same). This is separate from - and in addition to - TLS in transit and
 * Postgres disk encryption: it protects the data even if the database
 * itself, a backup, or an admin-panel session is ever compromised, and it's
 * what keeps a casual `SELECT * FROM "Transaction"` from being a privacy
 * incident.
 *
 * AES-256-GCM: authenticated encryption (tampering with the ciphertext makes
 * decryption fail loudly, rather than silently returning corrupted data) and
 * needs no extra dependency - it's built into Node's crypto module.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV - the size GCM is designed for.
const CURRENT_KEY_VERSION = 'v1';

function deriveKey(): Buffer {
  const secret = env.PII_ENCRYPTION_KEY;
  // A 64-hex-char string is used as raw 32 bytes directly (this is what
  // `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  // produces, and what the README asks you to set PII_ENCRYPTION_KEY to).
  // Anything else is hashed down to 32 bytes so a plain passphrase still
  // works without silently truncating/padding it in an unobvious way.
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string into a single self-contained, versioned token:
 * `v1:<iv>:<authTag>:<ciphertext>` (all base64, colon-joined - safe to store
 * directly in a Postgres `text`/`jsonb` string field).
 *
 * The `v1:` prefix is a key/algorithm version marker, not a display detail -
 * decrypt() dispatches on it. If PII_ENCRYPTION_KEY is ever rotated, bump
 * CURRENT_KEY_VERSION, add the old key as a fallback in decrypt() keyed by
 * version, and re-encrypt existing rows in the background at your leisure
 * instead of needing a hard cutover.
 */
export function encryptPII(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [CURRENT_KEY_VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    ':'
  );
}

export function decryptPII(token: string): string {
  const parts = token.split(':');
  const [version, ivB64, authTagB64, ciphertextB64] = parts;
  if (parts.length !== 4 || version !== CURRENT_KEY_VERSION || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Unrecognized or corrupted PII token');
  }

  const key = deriveKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws (auth tag mismatch) if the token was tampered with or the wrong
  // key is in play - never returns silently-garbled plaintext.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
