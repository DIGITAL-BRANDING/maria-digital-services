import { describe, expect, it } from 'vitest';
import { koboToNaira, nairaToKobo } from '../money.js';

describe('nairaToKobo', () => {
  it('converts a whole naira amount', () => {
    expect(nairaToKobo(100)).toBe(10_000n);
  });

  it('converts a fractional (kobo-level) naira amount', () => {
    expect(nairaToKobo(99.5)).toBe(9950n);
  });

  it('rounds to the nearest kobo instead of truncating (floating point safety)', () => {
    // 19.999 * 100 = 1999.9000000000003 in raw floating point - must round to 2000, not truncate to 1999.
    expect(nairaToKobo(19.999)).toBe(2000n);
  });

  it('rejects zero', () => {
    expect(() => nairaToKobo(0)).toThrow('Amount must be greater than zero');
  });

  it('rejects negative amounts', () => {
    expect(() => nairaToKobo(-50)).toThrow('Amount must be greater than zero');
  });

  it('rejects NaN and Infinity', () => {
    expect(() => nairaToKobo(NaN)).toThrow();
    expect(() => nairaToKobo(Infinity)).toThrow();
  });
});

describe('koboToNaira', () => {
  it('converts kobo back to naira', () => {
    expect(koboToNaira(10_000n)).toBe(100);
  });

  it('handles fractional kobo amounts', () => {
    expect(koboToNaira(9950n)).toBe(99.5);
  });

  it('round-trips through nairaToKobo without drift for typical amounts', () => {
    for (const amount of [1, 50, 99.99, 500.5, 12_345.67]) {
      expect(koboToNaira(nairaToKobo(amount))).toBe(amount);
    }
  });
});
