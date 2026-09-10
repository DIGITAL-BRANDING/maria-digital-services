import { describe, expect, it, vi } from 'vitest';
import { FAILURE_RESET_MINUTES, clearLockout, isLocked, recordFailure } from '../lockout.js';

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 30;

describe('recordFailure', () => {
  it('starts a fresh streak at 1 when there is no prior failure', () => {
    const result = recordFailure({ failures: 0, failureAt: null }, { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES });
    expect(result.failures).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });

  it('increments an active streak (failure within the reset window)', () => {
    const recentFailure = new Date(Date.now() - 60_000); // 1 minute ago
    const result = recordFailure(
      { failures: 2, failureAt: recentFailure },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    expect(result.failures).toBe(3);
  });

  it('locks the account once failures reach maxFailures', () => {
    const recentFailure = new Date(Date.now() - 60_000);
    const result = recordFailure(
      { failures: 4, failureAt: recentFailure },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    expect(result.failures).toBe(5);
    expect(result.lockedUntil).not.toBeNull();
    expect(result.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + (LOCKOUT_MINUTES - 1) * 60_000);
  });

  it('this is the bug fix: a failure streak older than FAILURE_RESET_MINUTES starts over at 1, not 5', () => {
    // The scenario a user reported: 3 stale failures from a much earlier
    // session, then 2 fresh wrong attempts today. Under the old
    // never-decays counter this would hit 5 and lock the account even
    // though "today" only saw 2 wrong attempts. With the rolling window,
    // the stale failure aged out and today's streak starts fresh.
    const staleFailure = new Date(Date.now() - (FAILURE_RESET_MINUTES + 5) * 60_000);
    const afterFirstFreshFailure = recordFailure(
      { failures: 3, failureAt: staleFailure },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    expect(afterFirstFreshFailure.failures).toBe(1);
    expect(afterFirstFreshFailure.lockedUntil).toBeNull();

    const afterSecondFreshFailure = recordFailure(
      { failures: afterFirstFreshFailure.failures, failureAt: afterFirstFreshFailure.failureAt },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    expect(afterSecondFreshFailure.failures).toBe(2);
    expect(afterSecondFreshFailure.lockedUntil).toBeNull();
  });

  it('a failure exactly at the reset-window boundary still counts as part of the old streak (boundary is exclusive on the fresh side)', () => {
    const boundaryFailure = new Date(Date.now() - FAILURE_RESET_MINUTES * 60_000 + 1000); // 1s inside the window
    const result = recordFailure(
      { failures: 1, failureAt: boundaryFailure },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    expect(result.failures).toBe(2);
  });

  it('always refreshes failureAt to now, so a live streak keeps extending its own window', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-01-01T00:00:00Z');
      vi.setSystemTime(start);
      const first = recordFailure({ failures: 0, failureAt: null }, { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES });
      expect(first.failureAt).toEqual(start);

      vi.setSystemTime(new Date(start.getTime() + 60_000));
      const second = recordFailure(
        { failures: first.failures, failureAt: first.failureAt },
        { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
      );
      expect(second.failures).toBe(2);
      expect(second.failureAt).toEqual(new Date(start.getTime() + 60_000));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('clearLockout', () => {
  it('resets all three fields to their empty state', () => {
    expect(clearLockout()).toEqual({ failures: 0, lockedUntil: null, failureAt: null });
  });
});

describe('isLocked', () => {
  it('is true for a future lockedUntil', () => {
    expect(isLocked(new Date(Date.now() + 60_000))).toBe(true);
  });

  it('is false for a past lockedUntil (expired lock)', () => {
    expect(isLocked(new Date(Date.now() - 60_000))).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isLocked(null)).toBe(false);
    expect(isLocked(undefined)).toBe(false);
  });
});
