import { Router } from 'express';
import { getResultPinPrice, type ExamPinType } from '../services/result-pin.service.js';
import { listVerificationPrices } from '../services/verification.service.js';
import { getAppConfig } from '../services/app-config.service.js';

export const publicRoutes = Router();

const RESULT_EXAM_TYPES: ExamPinType[] = ['WAEC', 'NECO', 'NABTEB'];

/**
 * Deliberately NOT behind requireAuth — this exists so the marketing
 * landing page (web/src/pages/LandingPage.tsx) can show real, current
 * result-checker prices to visitors who haven't signed up yet. Reuses
 * getResultPinPrice() (the same function the authenticated
 * /api/result/:exam/price route uses), which already returns only
 * { service, label, unitPrice } — never providerCost/margin, so this
 * cannot leak anything sensitive. Checked individually (not via
 * listResultPinPrices()'s Promise.all) so that one exam type being
 * toggled off in the admin Service Pricing panel just omits that one
 * card instead of blanking the whole section for a visitor.
 */
publicRoutes.get('/result-prices', async (_req, res) => {
  const results = await Promise.allSettled(RESULT_EXAM_TYPES.map((exam) => getResultPinPrice(exam)));
  const prices = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof getResultPinPrice>>>).value)
    .map((p) => ({ service: p.service, label: p.label, unit_price: p.unitPrice }));

  res.json({ status: true, data: prices });
});

/**
 * Same reasoning as /result-prices above, for the NIN/BVN verification
 * catalog: lets the landing page's featured "NIN & BVN" section show real
 * selling prices to a visitor who hasn't registered yet. Reuses
 * listVerificationPrices() - the same function every authenticated
 * verification screen reads from - which already only returns
 * { service, label, unitPrice, isActive }, never providerCostKobo, so this
 * can't leak margin. Inactive services are filtered out here rather than
 * left for the frontend to check, so a service an admin has paused just
 * disappears from the public page instead of showing a dead "unavailable"
 * card to a visitor who hasn't signed up yet.
 */
publicRoutes.get('/verification-prices', async (_req, res) => {
  const prices = await listVerificationPrices();
  res.json({
    status: true,
    data: prices.filter((p) => p.isActive).map((p) => ({ service: p.service, label: p.label, unit_price: p.unitPrice }))
  });
});

/**
 * Read by the Flutter app's splash screen on every cold start, BEFORE any
 * auth/onboarding check - deliberately public (no requireAuth) since a
 * signed-out user on an outdated APK must still be told to update. See the
 * AppConfig Prisma model's doc comment for why this exists: an old client
 * calling a purchase endpoint that now requires `pin` gets a raw, confusing
 * ZodError instead of ever finding out it just needs to update.
 */
publicRoutes.get('/app-config', async (_req, res) => {
  const config = await getAppConfig();
  res.json({
    status: true,
    data: {
      min_android_version: config.minAndroidVersion,
      latest_android_version: config.latestAndroidVersion,
      android_download_url: config.androidDownloadUrl,
      update_message: config.updateMessage
    }
  });
});
