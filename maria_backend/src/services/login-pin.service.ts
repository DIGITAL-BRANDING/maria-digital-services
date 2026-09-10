import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { clearLockout, isLocked, recordFailure } from '../lib/lockout.js';

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 30;

/** Sets (or overwrites) the user's 6-digit login PIN and clears any lockout. */
export async function setLoginPin(userId: string, pin: string) {
  if (!/^\d{6}$/.test(pin)) {
    throw new ApiError(422, 'Login PIN must be 6 digits', 'INVALID_LOGIN_PIN');
  }
  const loginPinHash = await bcrypt.hash(pin, 12);
  const cleared = clearLockout();
  await prisma.user.update({
    where: { id: userId },
    data: {
      loginPinHash,
      loginPinFailures: cleared.failures,
      loginPinLockedUntil: cleared.lockedUntil,
      loginPinFailureAt: cleared.failureAt
    }
  });
}

/**
 * Verifies a login PIN, tracking failures and locking out after
 * MAX_FAILURES - mirrors the transaction PIN's verifyPin() lockout behavior
 * in wallet.service.ts, kept separate since these are different secrets
 * with different lockout counters. Both (and the account password in
 * auth.routes.ts) share the same rolling-window failure logic - see
 * src/lib/lockout.ts.
 */
export async function verifyLoginPin(userId: string, pin: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (isLocked(user.loginPinLockedUntil)) {
    throw new ApiError(423, 'Login PIN is temporarily locked', 'LOGIN_PIN_LOCKED');
  }
  if (!user.loginPinHash) {
    throw new ApiError(400, 'Login PIN has not been set', 'LOGIN_PIN_NOT_SET');
  }

  const ok = await bcrypt.compare(pin, user.loginPinHash);
  if (!ok) {
    const next = recordFailure(
      { failures: user.loginPinFailures, failureAt: user.loginPinFailureAt },
      { maxFailures: MAX_FAILURES, lockoutMinutes: LOCKOUT_MINUTES }
    );
    await prisma.user.update({
      where: { id: userId },
      data: { loginPinFailures: next.failures, loginPinLockedUntil: next.lockedUntil, loginPinFailureAt: next.failureAt }
    });
    throw new ApiError(401, 'Invalid login PIN', 'INVALID_LOGIN_PIN');
  }

  const cleared = clearLockout();
  await prisma.user.update({
    where: { id: userId },
    data: { loginPinFailures: cleared.failures, loginPinLockedUntil: cleared.lockedUntil, loginPinFailureAt: cleared.failureAt }
  });
  return true;
}
