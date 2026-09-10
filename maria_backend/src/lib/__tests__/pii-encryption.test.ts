import { describe, expect, it } from 'vitest';
import { decryptPII, encryptPII } from '../pii-encryption.js';

describe('encryptPII / decryptPII', () => {
  it('round-trips a plaintext string exactly', () => {
    const plaintext = JSON.stringify({ nin: '12345678901', first_name: 'JOHN', last_name: 'DOE' });
    const token = encryptPII(plaintext);
    expect(decryptPII(token)).toBe(plaintext);
  });

  it('round-trips unicode content (Hausa/Arabic names, etc.)', () => {
    const plaintext = 'Sunusi Ɗanjuma - محمد';
    const token = encryptPII(plaintext);
    expect(decryptPII(token)).toBe(plaintext);
  });

  it('produces a different token every time for the same plaintext (random IV)', () => {
    const plaintext = '12345678901';
    const tokenA = encryptPII(plaintext);
    const tokenB = encryptPII(plaintext);
    expect(tokenA).not.toBe(tokenB);
    // ...but both still decrypt to the same original value.
    expect(decryptPII(tokenA)).toBe(plaintext);
    expect(decryptPII(tokenB)).toBe(plaintext);
  });

  it('is versioned - the token starts with the current key version', () => {
    const token = encryptPII('anything');
    expect(token.startsWith('v1:')).toBe(true);
  });

  it('throws (rather than returning corrupted data) if the ciphertext is tampered with', () => {
    const token = encryptPII('12345678901');
    const parts = token.split(':');
    // Flip a character in the ciphertext segment - GCM's auth tag must catch this.
    const tamperedCiphertext = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join(':');

    expect(() => decryptPII(tampered)).toThrow();
  });

  it('throws on a malformed/unrecognized token', () => {
    expect(() => decryptPII('not-a-real-token')).toThrow('Unrecognized or corrupted PII token');
    expect(() => decryptPII('v1:onlytwoparts')).toThrow();
  });
});
