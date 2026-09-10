import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { publicUser } from '../lib/public-user.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import { setPin, verifyPin } from '../services/wallet.service.js';
import { setLoginPin, verifyLoginPin } from '../services/login-pin.service.js';
import { tryProvisionInstantVirtualAccount } from '../services/kyc.service.js';

export const userRoutes = Router();

/** Verifies the transaction PIN if one is set, otherwise falls back to the
 *  account password - used to gate destructive actions (deactivate/delete)
 *  for users who haven't set up a PIN yet. */
async function verifyPinOrPassword(userId: string, credential: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.pinHash) {
    await verifyPin(userId, credential);
    return;
  }
  if (user.passwordHash) {
    const ok = await bcrypt.compare(credential, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Incorrect password', 'INVALID_PASSWORD');
    return;
  }
  throw new ApiError(400, 'Unable to verify identity for this action', 'VERIFICATION_UNAVAILABLE');
}

userRoutes.use(requireAuth);

userRoutes.get('/profile', async (req, res) => {
  let user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  if (!user.virtualAccountNumber) {
    await tryProvisionInstantVirtualAccount(user.id);
    user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  }

  res.json(await publicUser(user));
});

userRoutes.post('/profile/sync', async (req, res) => {
  const body = z
    .object({
      full_name: z.string().trim().min(2),
      email: z
        .string()
        .trim()
        .email()
        .transform((value) => value.toLowerCase()),
      phone: z.string().trim().min(6)
    })
    .parse(req.body);

  const conflict = await prisma.user.findFirst({
    where: {
      id: { not: req.user!.id },
      OR: [{ email: body.email }, { phone: body.phone }]
    }
  });
  if (conflict) {
    throw new ApiError(409, 'That email or phone is already in use by another account', 'PROFILE_CONFLICT');
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      fullName: body.full_name,
      email: body.email,
      phone: body.phone,
      // Changing the contact detail invalidates the previous verification —
      // a real verification flow (email link / SMS OTP) should re-confirm it,
      // not carry the old verified=true forward.
      emailVerified: body.email === req.user!.email ? undefined : false,
      phoneVerified: body.phone === req.user!.phone ? undefined : false
    }
  });

  res.json({
    status: true,
    message: 'Profile updated',
    data: {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      phone: user.phone,
      email_verified: user.emailVerified,
      phone_verified: user.phoneVerified
    }
  });
});

userRoutes.post('/pin/set', async (req, res) => {
  const body = z.object({ pin: z.string() }).parse(req.body);
  await setPin(req.user!.id, body.pin);
  res.json({ status: true, message: 'PIN set successfully' });
});

userRoutes.post('/pin/verify', async (req, res) => {
  const body = z.object({ pin: z.string() }).parse(req.body);
  await verifyPin(req.user!.id, body.pin);
  res.json({ status: true, data: { valid: true } });
});

userRoutes.post('/pin/change', async (req, res) => {
  const body = z
    .object({
      old_pin: z.string(),
      new_pin: z.string()
    })
    .parse(req.body);

  // Re-uses the same verification path as /pin/verify, including its lockout logic —
  // a PIN change attempt with the wrong old PIN counts as a failed attempt too.
  await verifyPin(req.user!.id, body.old_pin);
  await setPin(req.user!.id, body.new_pin);
  res.json({ status: true, message: 'PIN changed successfully' });
});
// ── Login PIN (6-digit) ──────────────────────────────────────
// Distinct from the 4-digit transaction PIN above. Once set, /auth/login
// requires it for every future login from a device without a live session.
userRoutes.post('/login-pin/set', async (req, res) => {
  const body = z.object({ pin: z.string() }).parse(req.body);
  await setLoginPin(req.user!.id, body.pin);
  res.json({ status: true, message: 'Login PIN set successfully' });
});

userRoutes.post('/login-pin/change', async (req, res) => {
  const body = z
    .object({
      old_pin: z.string(),
      new_pin: z.string()
    })
    .parse(req.body);

  // A change attempt with the wrong old PIN counts as a failed attempt too,
  // same as the transaction PIN's change flow.
  await verifyLoginPin(req.user!.id, body.old_pin);
  await setLoginPin(req.user!.id, body.new_pin);
  res.json({ status: true, message: 'Login PIN changed successfully' });
});

// ── Password ──────────────────────────────────────────────────
userRoutes.post('/password/change', async (req, res) => {
  const body = z
    .object({
      old_password: z.string().min(1),
      new_password: z.string().min(8)
    })
    .parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.passwordHash) {
    throw new ApiError(400, 'This account has no password set', 'PASSWORD_NOT_SET');
  }

  const ok = await bcrypt.compare(body.old_password, user.passwordHash);
  if (!ok) {
    throw new ApiError(401, 'Current password is incorrect', 'INVALID_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(body.new_password, 12);
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash, mustChangePassword: false }
  });

  res.json({ status: true, message: 'Password changed successfully' });
});

userRoutes.post('/deactivate', async (req, res) => {
  const body = z.object({ credential: z.string().min(1), reason: z.string().trim().max(500).optional() }).parse(req.body);
  await verifyPinOrPassword(req.user!.id, body.credential);

  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
      deletionReason: body.reason
    }
  });

  res.json({
    status: true,
    message: 'Your account has been deactivated. Contact support any time to reactivate it.'
  });
});

userRoutes.delete('/account', async (req, res) => {
  const body = z.object({ credential: z.string().min(1), reason: z.string().trim().max(500).optional() }).parse(req.body);
  await verifyPinOrPassword(req.user!.id, body.credential);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (koboToNaira(user.walletBalanceKobo) > 0) {
    throw new ApiError(
      422,
      'Please use or withdraw your remaining wallet balance before deleting your account.',
      'WALLET_BALANCE_NOT_ZERO'
    );
  }

  const suffix = `deleted-${req.user!.id}-${Date.now()}`;

  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() }
    }),
    prisma.user.update({
      where: { id: req.user!.id },
      data: {
        accountStatus: 'DELETED',
        deletionReason: body.reason,
        fullName: 'Deleted User',
        email: `${suffix}@deleted.majordatalink.local`,
        phone: suffix,
        passwordHash: null,
        photoUrl: null,
        pinHash: null,
        emailVerified: false,
        phoneVerified: false
      }
    })
  ]);

  res.json({ status: true, message: 'Account deleted successfully' });
});
