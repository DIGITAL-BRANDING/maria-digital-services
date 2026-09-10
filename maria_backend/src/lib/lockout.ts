/**
 * Shared brute-force lockout logic for the three secrets a user can fail to
 * enter: account password (auth.routes.ts), login PIN (login-pin.service.ts),
 * and transaction PIN (wallet.service.ts's verifyPin). All three used to
 * track failures as a plain counter that only ever reset on a SUCCESSFUL
 * attempt - meaning a handful of stale failures from days or weeks earlier
 * (that the person forgot about, or that came from someone else mistyping
 * their own login once) would silently combine with a couple of fresh typos
 * today and lock the account, even though "today" they only got it wrong
 * once or twice. That's what this fixes: a failure only counts toward the
 * lockout if it happened within FAILURE_RESET_MINUTES of the previous one -
 * otherwise the streak is treated as starting fresh.
 *
 * This does NOT change how many wrong attempts are allowed (still
 * maxFailures, still locks for lockoutMinutes) - only how long a partial
 * streak of failures is remembered before it stops counting against you.
 */

/** How long a streak of failures is remembered before a new failure starts a fresh count instead of adding to the old one. */
export const FAILURE_RESET_MINUTES = 15;

export type LockoutFields = {
  failures: number;
  lockedUntil: Date | null;
  failureAt: Date | null;
};

/** Call when a secret check FAILS. Returns the new column values to persist. */
export function recordFailure(
  current: Pick<LockoutFields, 'failures' | 'failureAt'>,
  opts: { maxFailures: number; lockoutMinutes: number }
): LockoutFields {
  const now = new Date();
  const streakExpired =
    !current.failureAt || now.getTime() - current.failureAt.getTime() > FAILURE_RESET_MINUTES * 60_000;

  const failures = streakExpired ? 1 : current.failures + 1;
  const lockedUntil = failures >= opts.maxFailures ? new Date(now.getTime() + opts.lockoutMinutes * 60_000) : null;

  return { failures, lockedUntil, failureAt: now };
}

/** Call when a secret check SUCCEEDS (or the secret is reset/changed) - clears any streak entirely. */
export function clearLockout(): LockoutFields {
  return { failures: 0, lockedUntil: null, failureAt: null };
}

/** True if `lockedUntil` represents an active (not-yet-expired) lock. */
export function isLocked(lockedUntil: Date | null | undefined): boolean {
  return !!lockedUntil && lockedUntil > new Date();
}
