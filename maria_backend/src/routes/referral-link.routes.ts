import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const referralLinkRoutes = Router();

// Android application ID - see imam_datasub/android/app/build.gradle's
// applicationId. Update this alongside that if it ever changes.
const PLAY_STORE_PACKAGE_ID = 'com.majordatalink.app';

/**
 * Entry point for referral share links (ReferralEntity.shareLink in the
 * Flutter app builds these as {referralLinkBaseUrl}/ref/CODE). Redirects to
 * the Play Store listing with a `referrer` param carrying the code -
 * Google Play's Install Referrer API delivers that string back to the app
 * after install, and main.dart's _capturePendingReferralCode reads it so
 * register_screen.dart can pre-fill it automatically.
 *
 * Per Google's own docs, this attribution path only actually works for
 * installs that go through the real Play Store (including internal/closed
 * testing tracks) - it silently does nothing for sideloaded/debug builds,
 * which is a Play Store platform limitation, not something fixable here.
 *
 * The code is validated so a mistyped/expired link doesn't silently carry
 * garbage into an install - invalid codes redirect to the Play Store with
 * no referrer at all rather than a broken one.
 */
referralLinkRoutes.get('/:code', async (req, res) => {
  const code = req.params.code.trim();

  const referrer = await prisma.user
    .findUnique({ where: { referralCode: code }, select: { id: true } })
    .then((user: { id: string } | null) => (user ? `ref_code=${encodeURIComponent(code)}` : null))
    .catch(() => null); // A DB hiccup here should never break the redirect itself.

  const playStoreUrl = new URL('https://play.google.com/store/apps/details');
  playStoreUrl.searchParams.set('id', PLAY_STORE_PACKAGE_ID);
  if (referrer) {
    playStoreUrl.searchParams.set('referrer', referrer);
  }

  res.redirect(302, playStoreUrl.toString());
});
