import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { koboToNaira } from './money.js';

/**
 * The one place a User row gets turned into what the client sees. Every
 * route that returns a user object (/auth/login, /auth/register, /auth/me,
 * /user/profile, etc.) must call this - do not inline a copy of this object
 * anywhere else. A previous duplicate in /user/profile silently drifted out
 * of sync with this one and was missing is_admin/admin_role entirely, which
 * meant the app showed admin users as regular users almost immediately
 * after login (the moment anything re-fetched /user/profile).
 */
export async function publicUser(user: Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>) {
  const admin = await prisma.adminUser.findFirst({
    where: {
      email: { equals: user.email },
      isActive: true
    },
    select: { role: true }
  });

  return {
    id: user.id,
    full_name: user.fullName,
    email: user.email,
    phone: user.phone,
    photo_url: user.photoUrl,
    wallet_balance: koboToNaira(user.walletBalanceKobo),
    referral_code: user.referralCode,
    referral_earnings: koboToNaira(user.referralEarningsKobo),
    kyc_status: user.kycStatus.toLowerCase(),
    email_verified: user.emailVerified,
    phone_verified: user.phoneVerified,
    // VIRTUAL_ACCOUNT_FUNDING_ENABLED=false hides these from every client
    // (Flutter app + web) without a redeploy - see the comment on that env
    // var. The Flutter app already treats a null account number as a normal
    // "not provisioned yet" state (wallet_screen.dart / fund_wallet_screen.dart
    // both null-check it), so this is a safe value to hand it, not a new case
    // it has to learn to handle.
    virtual_account_number: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountNumber : null,
    virtual_account_bank: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? user.virtualAccountBank : null,
    virtual_account_funding_paused: env.VIRTUAL_ACCOUNT_FUNDING_ENABLED ? undefined : true,
    is_admin: !!admin,
    admin_role: admin?.role ?? null,
    created_at: user.createdAt.toISOString()
  };
}
