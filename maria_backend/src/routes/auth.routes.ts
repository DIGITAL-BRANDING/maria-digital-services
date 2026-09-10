import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { issueAuthTokens, revokeRefreshToken, rotateRefreshToken } from '../lib/auth-token.js';
import { publicUser } from '../lib/public-user.js';
import { prisma } from '../lib/prisma.js';
import { clearLockout, isLocked, recordFailure } from '../lib/lockout.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import { verifyLoginPin } from '../services/login-pin.service.js';
import { tryProvisionInstantVirtualAccount } from '../services/kyc.service.js';

export const authRoutes = Router();

// Mirrors the lockout already used for the transaction PIN and login PIN
// (see login-pin.service.ts / wallet.service.ts verifyPin) - previously the
// account password itself had no per-account brute-force protection at all.
// See src/lib/lockout.ts for the rolling-window failure-tracking behavior.
const MAX_PASSWORD_FAILURES = 5;
const PASSWORD_LOCKOUT_MINUTES = 30;

async function authResponse(
  user: Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
) {
  return {
    status: true,
    data: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      requires_pin_setup: !user.pinHash,
      requires_login_pin_setup: !user.loginPinHash,
      requires_password_change: user.mustChangePassword,
      user: await publicUser(user)
    }
  };
}

authRoutes.post('/register', async (req, res) => {
  const body = z
    .object({
      full_name: z.string().trim().min(2),
      email: z
        .string()
        .trim()
        .email()
        .transform((value) => value.toLowerCase()),
      phone: z.string().trim().min(6),
      password: z.string().min(8),
      referral_code: z.string().trim().optional()
    })
    .parse(req.body);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: body.email }, { phone: body.phone }] }
  });
  if (existing) {
    throw new ApiError(409, 'An account already exists with this email or phone', 'ACCOUNT_EXISTS');
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.create({
    data: {
      id: nanoid(),
      fullName: body.full_name,
      email: body.email,
      phone: body.phone,
      passwordHash,
      referredByCode: body.referral_code,
      referralCode: nanoid(8).toUpperCase(),
      emailVerified: false,
      phoneVerified: false
    }
  });

  // Best-effort - see tryProvisionInstantVirtualAccount for why this never
  // throws. Re-fetch afterwards so the register response (and the dashboard
  // the app shows immediately after) already includes the account number.
  await tryProvisionInstantVirtualAccount(user.id);
  const provisionedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  const tokens = await issueAuthTokens({ id: provisionedUser.id, email: provisionedUser.email });
  res.status(201).json(await authResponse(provisionedUser, tokens));
});

authRoutes.post('/login', async (req, res) => {
  const body = z
    .object({
      identifier: z.string().trim().min(3),
      password: z.string().min(1),
      // Only required once the account already has a login PIN set - see below.
      login_pin: z.string().optional()
    })
    .parse(req.body);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: body.identifier.toLowerCase() }, { phone: body.identifier }] }
  });
  if (!user) {
    // No app account for this identifier at all. If it happens to be an
    // active admin's email, say so explicitly instead of a generic
    // "invalid credentials" - an AdminUser has no phone number, so we
    // can't silently create a matching app account for them here; they
    // need to register one in-app once, after which either password works
    // (see the linkedAdmin block below).
    const admin = await prisma.adminUser.findFirst({
      where: { email: { equals: body.identifier.toLowerCase() }, isActive: true }
    });
    if (admin && (await bcrypt.compare(body.password, admin.passwordHash))) {
      throw new ApiError(
        404,
        'No app account exists for this admin email yet. Register in the app once with this email, and your admin password will work for both from then on.',
        'ADMIN_NEEDS_APP_ACCOUNT'
      );
    }
    throw new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS');
  }

  if (!user.passwordHash) {
    throw new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS');
  }

  // Checked before comparing the password so a locked account fails fast
  // (and consistently) regardless of what password is supplied.
  if (isLocked(user.passwordLockedUntil)) {
    throw new ApiError(
      423,
      'Too many failed login attempts. Try again in a bit, or reset your password.',
      'PASSWORD_LOCKED'
    );
  }

  let ok = await bcrypt.compare(body.password, user.passwordHash);

  // This app account's email is also an active admin's email, and the app
  // password didn't match - fall back to checking the admin panel password
  // too, so whichever one the person actually remembers works. If it
  // matches, sync it onto the app account so both stay unified from here
  // on (next time, the check above succeeds directly).
  if (!ok) {
    const linkedAdmin = await prisma.adminUser.findFirst({
      where: { email: { equals: user.email }, isActive: true }
    });
    if (linkedAdmin && (await bcrypt.compare(body.password, linkedAdmin.passwordHash))) {
      ok = true;
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: linkedAdmin.passwordHash }
      });
    }
  }

  if (!ok) {
    const next = recordFailure(
      { failures: user.passwordFailures, failureAt: user.passwordFailureAt },
      { maxFailures: MAX_PASSWORD_FAILURES, lockoutMinutes: PASSWORD_LOCKOUT_MINUTES }
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordFailures: next.failures, passwordLockedUntil: next.lockedUntil, passwordFailureAt: next.failureAt }
    });
    throw new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS');
  }

  // Successful password - clear any prior failure count/lockout so it
  // doesn't linger and affect a future legitimate attempt.
  if (user.passwordFailures > 0 || user.passwordLockedUntil) {
    const cleared = clearLockout();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordFailures: cleared.failures, passwordLockedUntil: cleared.lockedUntil, passwordFailureAt: cleared.failureAt }
    });
  }

  if (user.accountStatus === 'DEACTIVATED') {
    throw new ApiError(
      403,
      'Your account is deactivated. Contact support to reactivate it.',
      'ACCOUNT_DEACTIVATED'
    );
  }

  // Once a login PIN exists on the account, every call to /auth/login (i.e.
  // every login from a device that isn't already holding a valid session)
  // must also supply it - this is what makes "login on another device" ask
  // for password AND PIN. A trusted device with a live session never calls
  // this route again; it unlocks locally with the same PIN instead.
  if (user.loginPinHash) {
    // Login PIN is kept in the codebase for future re-enablement, but is
    // currently disabled so password login is sufficient.
    const LOGIN_PIN_ENABLED = false;
    if (LOGIN_PIN_ENABLED && !body.login_pin) {
      throw new ApiError(401, 'Enter your 6-digit login PIN to continue', 'LOGIN_PIN_REQUIRED');
    }
    // Propagates LOGIN_PIN_LOCKED / INVALID_LOGIN_PIN as-is on failure.
    if (LOGIN_PIN_ENABLED) await verifyLoginPin(user.id, body.login_pin!);
  }

  const tokens = await issueAuthTokens({ id: user.id, email: user.email });
  res.json(await authResponse(user, tokens));
});

// Recovery for someone who forgot their 6-digit login PIN. There's no way
// to prove identity with the PIN itself if you don't remember it, so this
// falls back to the account password (the same credential /login already
// trusts, including the lockout tracking above) - if it matches, the old
// login PIN is cleared and the response comes back with
// requires_login_pin_setup: true, so the client naturally lands on the same
// "create your login PIN" screen a first-time login uses.
authRoutes.post('/login-pin/reset', async (req, res) => {
  const body = z
    .object({
      identifier: z.string().trim().min(3),
      password: z.string().min(1)
    })
    .parse(req.body);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: body.identifier.toLowerCase() }, { phone: body.identifier }] }
  });
  if (!user || !user.passwordHash) {
    throw new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS');
  }

  if (isLocked(user.passwordLockedUntil)) {
    throw new ApiError(
      423,
      'Too many failed attempts. Try again in a bit.',
      'PASSWORD_LOCKED'
    );
  }

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    const next = recordFailure(
      { failures: user.passwordFailures, failureAt: user.passwordFailureAt },
      { maxFailures: MAX_PASSWORD_FAILURES, lockoutMinutes: PASSWORD_LOCKOUT_MINUTES }
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordFailures: next.failures, passwordLockedUntil: next.lockedUntil, passwordFailureAt: next.failureAt }
    });
    throw new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS');
  }

  if (user.accountStatus === 'DEACTIVATED') {
    throw new ApiError(
      403,
      'Your account is deactivated. Contact support to reactivate it.',
      'ACCOUNT_DEACTIVATED'
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordFailures: 0,
      passwordLockedUntil: null,
      passwordFailureAt: null,
      loginPinHash: null,
      loginPinFailures: 0,
      loginPinLockedUntil: null,
      loginPinFailureAt: null
    }
  });

  const tokens = await issueAuthTokens({ id: user.id, email: user.email });
  const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  res.json(await authResponse(freshUser, tokens));
});

authRoutes.post('/token/refresh', async (req, res) => {
  const body = z.object({ refresh_token: z.string().min(1) }).parse(req.body);
  const { user, tokens } = await rotateRefreshToken(body.refresh_token);
  res.json(await authResponse(user, tokens));
});

authRoutes.post('/logout', async (req, res) => {
  const body = z.object({ refresh_token: z.string().min(1) }).parse(req.body);
  await revokeRefreshToken(body.refresh_token);
  res.json({ status: true, message: 'Logged out' });
});

authRoutes.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({
    status: true,
    data: {
      requires_pin_setup: !user.pinHash,
      requires_login_pin_setup: !user.loginPinHash,
      requires_password_change: user.mustChangePassword,
      user: await publicUser(user)
    }
  });
});
