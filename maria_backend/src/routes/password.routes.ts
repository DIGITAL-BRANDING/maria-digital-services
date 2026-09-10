import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { clearLockout } from '../lib/lockout.js';
import { ApiError } from '../middleware/error.js';

// Mounted at /api/password in app.ts - a separate top-level namespace from
// /api/auth because AppEndpoints.forgotPassword/resetPassword in the
// Flutter app (lib/core/config/app_endpoints.dart) were already written as
// `$_base/password/forgot` and `$_base/password/reset`, not under /auth/*.
export const passwordRoutes = Router();

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

function generateSixDigitCode() {
  // crypto.randomInt is uniform over the range (unlike Math.random()), and
  // padStart keeps a code like "042917" from becoming "42917" and silently
  // failing every compare.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Always responds the same way whether or not the email belongs to an
 * account, and whether or not sending actually succeeded - anything else
 * would let a caller enumerate registered emails by watching the response.
 * Real failures (no RESEND_API_KEY, Resend rejecting the send) are only
 * ever logged server-side by sendPasswordResetEmail, never surfaced here.
 */
passwordRoutes.post('/forgot', async (req, res) => {
  const body = z.object({ email: z.string().trim().email() }).parse(req.body);
  const email = body.email.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const code = generateSixDigitCode();
    const codeHash = await bcrypt.hash(code, 12);

    await prisma.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)
      }
    });

    await sendPasswordResetEmail(email, code);
  }

  res.json({
    status: true,
    message: "If that email has an account, we've sent a 6-digit reset code to it."
  });
});

/**
 * Verifies the most recent unconsumed code for this email, then updates
 * the password. Mirrors the lockout pattern login-pin.service.ts and
 * /auth/login-pin/reset already use elsewhere (attempts counter,
 * expiresAt, consumedAt) rather than inventing a new one.
 */
passwordRoutes.post('/reset', async (req, res) => {
  const body = z
    .object({
      email: z.string().trim().email(),
      // Called `token` end-to-end through the Flutter app's repository/
      // usecase layers (a pre-existing name from before this was a
      // 6-digit code), but it's the code from the email.
      token: z.string().trim().length(6),
      new_password: z.string().min(8)
    })
    .parse(req.body);

  const email = body.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic message regardless of *why* it failed (wrong code, no
  // such user, expired, already used, too many attempts) - specifics would
  // help an attacker narrow down what to try next.
  const genericError = () => new ApiError(400, 'That code is invalid or has expired.', 'INVALID_RESET_CODE');

  if (!user) throw genericError();

  const resetCode = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: 'desc' }
  });

  if (!resetCode) throw genericError();
  if (resetCode.expiresAt < new Date()) throw genericError();
  if (resetCode.attempts >= MAX_CODE_ATTEMPTS) throw genericError();

  const matches = await bcrypt.compare(body.token, resetCode.codeHash);
  if (!matches) {
    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { attempts: { increment: 1 } }
    });
    throw genericError();
  }

  const passwordHash = await bcrypt.hash(body.new_password, 12);
  const cleared = clearLockout();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // A password reset is a strong enough proof of ownership to also
        // clear the login-lockout counters, same as /auth/login-pin/reset
        // already does after a verified password check. Uses the same
        // rolling-window helper the lockout itself is tracked with - see
        // src/lib/lockout.ts. Also clears any pending admin-issued temp
        // password flag (see mustChangePassword in schema.prisma) - this
        // path is proof enough of ownership on its own.
        passwordFailures: cleared.failures,
        passwordLockedUntil: cleared.lockedUntil,
        passwordFailureAt: cleared.failureAt,
        mustChangePassword: false
      }
    }),
    prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { consumedAt: new Date() }
    })
  ]);

  res.json({ status: true, message: 'Your password has been reset. You can now log in.' });
});
