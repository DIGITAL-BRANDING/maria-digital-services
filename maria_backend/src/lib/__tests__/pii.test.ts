import { describe, expect, it } from 'vitest';
import { isSealedPII, maskIdentifier, mergeSealedPII, openPII, sealPII } from '../pii.js';

describe('sealPII / openPII', () => {
  it('round-trips an object through seal then open', () => {
    const payload = { nin: '12345678901', first_name: 'JOHN', last_name: 'DOE' };
    const sealed = sealPII(payload);
    expect(openPII(sealed)).toEqual(payload);
  });

  it('marks the sealed value so isSealedPII can identify it', () => {
    const sealed = sealPII({ bvn: '10987654321' });
    expect(isSealedPII(sealed)).toBe(true);
    expect(isSealedPII({ bvn: '10987654321' })).toBe(false); // plain object, never sealed
    expect(isSealedPII(null)).toBe(false);
    expect(isSealedPII(undefined)).toBe(false);
  });

  it('returns null (not a throw) for null/undefined/malformed input', () => {
    expect(openPII(null)).toBeNull();
    expect(openPII(undefined)).toBeNull();
    expect(openPII({ not: 'sealed' })).toBeNull();
    expect(openPII('a plain string')).toBeNull();
  });

  it('does not leak the plaintext anywhere in the sealed representation', () => {
    const sealed = sealPII({ nin: '12345678901', phone: '08012345678' });
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain('12345678901');
    expect(serialized).not.toContain('08012345678');
  });
});

describe('mergeSealedPII', () => {
  it('merges new fields into a fresh seal when nothing existed before', () => {
    const merged = mergeSealedPII(undefined, { nin: '12345678901' });
    expect(openPII(merged)).toEqual({ nin: '12345678901' });
  });

  it('merges new fields into an already-sealed blob, keeping the earlier fields', () => {
    const stage1 = sealPII({ nin: '12345678901' });
    const stage2 = mergeSealedPII(stage1, { user_data: { first_name: 'JOHN' } });

    expect(openPII(stage2)).toEqual({
      nin: '12345678901',
      user_data: { first_name: 'JOHN' }
    });
  });

  it('lets a later merge overwrite an earlier field with the same key', () => {
    const stage1 = sealPII({ status: 'pending' });
    const stage2 = mergeSealedPII(stage1, { status: 'success' });
    expect(openPII(stage2)).toEqual({ status: 'success' });
  });
});

describe('maskIdentifier', () => {
  it('shows only the last 4 characters of an 11-digit NIN/BVN', () => {
    expect(maskIdentifier('12345678901')).toBe('*******8901');
  });

  it('masks everything for a value of 4 characters or fewer', () => {
    expect(maskIdentifier('1234')).toBe('****');
    expect(maskIdentifier('12')).toBe('**');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(maskIdentifier(null)).toBe('');
    expect(maskIdentifier(undefined)).toBe('');
    expect(maskIdentifier('')).toBe('');
  });
});
