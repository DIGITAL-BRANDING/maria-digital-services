import type { Request, Router } from 'express';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';
import { prisma } from '../lib/prisma.js';
import { dataPlanPricingService } from '../services/data-plan-pricing.service.js';
import { getPricingSettings, updatePricingSettings } from '../services/pricing-settings.service.js';
import { applyServiceMarkup } from '../services/result-pin.service.js';

// @adminjs/express stores the logged-in admin as `req.session.adminUser`
// (see buildAuthenticatedRouter's sessionOptions in setup.ts) but doesn't
// itself export a SessionData augmentation for it, so TypeScript doesn't
// know that field exists without this.
declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

// AdminJSExpress's buildAuthenticatedRouter() mounts `express-formidable` as
// router-level middleware (`router.use(formidableMiddleware(...))` inside
// buildAuthenticatedRouter.js) - BEFORE any route registered on this same
// router, including these custom ones. That means the request body has
// already been read off the socket and parsed into `req.fields` (formidable's
// own property, NOT Express's `req.body`) by the time a handler here runs.
// Adding a second body parser (e.g. express.urlencoded()) to try and read
// `req.body` throws "stream is not readable" - the stream was already
// consumed - which is why POST forms here must read `req.fields`, not
// `req.body`, and must NOT chain their own body-parsing middleware.
type FormidableFields = Record<string, string | string[] | undefined>;
function fields(req: Request): FormidableFields {
  return ((req as unknown as { fields?: FormidableFields }).fields ?? {}) as FormidableFields;
}
function field(req: Request, name: string): string {
  const v = fields(req)[name];
  return typeof v === 'string' ? v : '';
}

/**
 * A single page for bulk-repricing everything, instead of an admin hand-
 * editing sellingPriceKobo on ~250+ DataPlanPricing rows one at a time
 * through AdminJS's per-record edit form (the "wahala da bata lokaci" this
 * was built to fix). Deliberately plain server-rendered HTML - not an
 * AdminJS custom React action component - so there's nothing here that
 * depends on AdminJS's frontend bundle: it's a handful of <form> tags on
 * the SAME authenticated session/router AdminJS itself uses (see
 * buildAdminRouter() in setup.ts, which mounts this), reusing
 * req.session.adminUser the exact way @adminjs/express does internally.
 *
 * Three independent tools on one page:
 *  1. Default markup (PricingSettings) - the fallback used for any plan
 *     with no price override at all.
 *  2. Bulk reprice Data Plans - set sellingPrice = cost + %  + ₦ for every
 *     plan (optionally filtered to one network) in a single click.
 *  3. Bulk reprice Techhub/Alrahuz services - same idea for the much
 *     shorter NIN/BVN + WAEC/NECO/NABTEB list.
 */
export function registerBulkPricingRoutes(router: Router) {
  router.get('/bulk-pricing', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const [settings, networks] = await Promise.all([
      getPricingSettings(),
      prisma.dataPlanPricing.findMany({
        distinct: ['network'],
        select: { network: true },
        orderBy: { network: 'asc' }
      })
    ]);

    res.type('html').send(renderPage({ admin, settings, networks: networks.map((n: { network: string }) => n.network), flash: flashFromQuery(req.query) }));
  });

  router.post('/bulk-pricing/default-markup', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const percent = parseNonNegativeNumber(field(req, 'dataPlanMarkupPercent'));
    const naira = parseNonNegativeNumber(field(req, 'dataPlanMarkupNaira'));
    if (percent === null || naira === null) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Markup % and ₦ must both be valid numbers ≥ 0.'));
    }

    try {
      await updatePricingSettings({ dataPlanMarkupPercent: percent, dataPlanMarkupNaira: naira });
      await logAdminAction({
        adminId: admin.id,
        action: 'UPDATE_DEFAULT_MARKUP',
        targetType: 'PricingSettings',
        targetId: 'default',
        metadata: { dataPlanMarkupPercent: percent, dataPlanMarkupNaira: naira }
      });
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Default markup updated: ${percent}% + ₦${naira}.`));
    } catch (error) {
      console.error('[bulk-pricing] default-markup update failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Something went wrong updating the default markup. Check the server logs.'));
    }
  });

  router.post('/bulk-pricing/provider-switch', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const dataAirtimeProviderRaw = field(req, 'dataAirtimeProvider');
    const resultPinProviderRaw = field(req, 'resultPinProvider');
    const cableMarkupPercent = parseNonNegativeNumber(field(req, 'cableMarkupPercent'));
    const electricityMarkupPercent = parseNonNegativeNumber(field(req, 'electricityMarkupPercent'));

    const dataAirtimeProvider = dataAirtimeProviderRaw === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';
    const resultPinProvider = resultPinProviderRaw === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';

    if (cableMarkupPercent === null || electricityMarkupPercent === null) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Cable and electricity markup % must both be valid numbers ≥ 0.'));
    }

    try {
      await updatePricingSettings({ dataAirtimeProvider, resultPinProvider, cableMarkupPercent, electricityMarkupPercent });
      await logAdminAction({
        adminId: admin.id,
        action: 'UPDATE_PROVIDER_SWITCH',
        targetType: 'PricingSettings',
        targetId: 'default',
        metadata: { dataAirtimeProvider, resultPinProvider, cableMarkupPercent, electricityMarkupPercent }
      });
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Providers updated - Data/Airtime: ${dataAirtimeProvider}, Result Pins: ${resultPinProvider}.`));
    } catch (error) {
      console.error('[bulk-pricing] provider-switch update failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Something went wrong updating the provider switch. Check the server logs.'));
    }
  });

  router.post('/bulk-pricing/data-plans', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const percent = parseNonNegativeNumber(field(req, 'markupPercent'));
    const naira = parseNonNegativeNumber(field(req, 'markupNaira'));
    const networkRaw = field(req, 'network').trim();
    const network = networkRaw ? networkRaw : undefined;
    const providerRaw = field(req, 'dataPlanProvider');
    const provider = providerRaw === 'bilalsadasub' ? 'bilalsadasub' : providerRaw === 'alrahuz' ? 'alrahuz' : undefined;
    if (percent === null || naira === null) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Markup % and ₦ must both be valid numbers ≥ 0.'));
    }

    try {
      const result = await dataPlanPricingService.applyMarkup({ network, provider, markupNaira: naira, markupPercent: percent });
      await logAdminAction({
        adminId: admin.id,
        action: 'BULK_REPRICE_DATA_PLANS',
        targetType: 'DataPlanPricing',
        metadata: { network: network ?? 'ALL', provider: provider ?? 'ALL', markupPercent: percent, markupNaira: naira, updated: result.updated }
      });

      const scope = network ? `${network} plans` : 'ALL networks';
      const providerScope = provider ? ` (${provider} only)` : '';
      const skippedNote = result.skipped > 0 ? ` (${result.skipped} skipped - non-positive computed price, check their provider cost)` : '';
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Repriced ${result.updated} data plan(s) (${scope}${providerScope}) at cost + ${percent}% + ₦${naira}.${skippedNote}`));
    } catch (error) {
      console.error('[bulk-pricing] data-plans bulk markup failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Something went wrong repricing data plans. Some rows may already be updated - check the server logs.'));
    }
  });

  router.post('/bulk-pricing/services', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const percent = parseNonNegativeNumber(field(req, 'markupPercent'));
    const naira = parseNonNegativeNumber(field(req, 'markupNaira'));
    const providerRaw = field(req, 'provider');
    const provider = providerRaw === 'alrahuz' ? 'alrahuz' : providerRaw === 'techhub' ? 'techhub' : null;
    if (percent === null || naira === null || !provider) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Markup % and ₦ must both be valid numbers ≥ 0, and a provider must be selected.'));
    }

    try {
      const result = await applyServiceMarkup({ provider, markupNaira: naira, markupPercent: percent });
      await logAdminAction({
        adminId: admin.id,
        action: 'BULK_REPRICE_SERVICES',
        targetType: 'ServicePricing',
        metadata: { provider, markupPercent: percent, markupNaira: naira, updated: result.updated }
      });

      const label = provider === 'techhub' ? 'NIN/BVN verification services' : 'WAEC/NECO/NABTEB result-pin services';
      const skippedNote = result.skipped > 0 ? ` (${result.skipped} skipped - non-positive computed price)` : '';
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Repriced ${result.updated} ${label} at cost + ${percent}% + ₦${naira}.${skippedNote}`));
    } catch (error) {
      console.error('[bulk-pricing] services bulk markup failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Something went wrong repricing services. Some rows may already be updated - check the server logs.'));
    }
  });
}

function requireFinanceOrSuper(req: Request): AdminSessionUser | null {
  const admin = req.session?.adminUser;
  if (!admin || admin.role === 'SUPPORT') return null;
  return admin;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function encodeFlash(type: 'success' | 'error', message: string): string {
  return encodeURIComponent(`${type}:${message}`);
}

function flashFromQuery(query: Record<string, unknown>): { type: 'success' | 'error'; message: string } | null {
  const raw = query.flash;
  if (typeof raw !== 'string') return null;
  const [type, ...rest] = raw.split(':');
  if (type !== 'success' && type !== 'error') return null;
  return { type, message: rest.join(':') };
}

function renderPage(params: {
  admin: AdminSessionUser;
  settings: {
    dataPlanMarkupPercent: number;
    dataPlanMarkupNaira: number;
    dataAirtimeProvider: string;
    resultPinProvider: string;
    cableMarkupPercent: number;
    electricityMarkupPercent: number;
  };
  networks: string[];
  flash: { type: 'success' | 'error'; message: string } | null;
}) {
  const { admin, settings, networks, flash } = params;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const networkOptions = networks.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join('');

  const flashHtml = flash
    ? `<div class="flash ${flash.type}">${escape(flash.message)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bulk Pricing — MAJOR DATA-LINK Admin</title>
<style>
  :root { --gold: #D4AF37; --gold-dark: #9C7A17; --bg: #FAF7EF; --card: #FFFFFF; --text: #1A1508; --muted: #6B6248; --border: #E9E1C8; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  header h1 { font-size: 20px; margin: 0; }
  header a { color: var(--gold-dark); text-decoration: none; font-size: 14px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 4px; }
  .card p.hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; margin-top: 12px; }
  input[type=number], select { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; background: #FFFDF5; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  button { margin-top: 18px; background: var(--gold); color: #1A1508; border: none; padding: 11px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; }
  button:hover { background: var(--gold-dark); color: #fff; }
  .flash { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
  .flash.success { background: #EAF7EE; color: #1E7B34; border: 1px solid #BFE6C8; }
  .flash.error { background: #FDECEC; color: #B3261E; border: 1px solid #F3C6C4; }
  .current { font-size: 13px; color: var(--muted); margin-top: 4px; }
  .provider-choice { display: flex; gap: 16px; margin-top: 12px; }
  .provider-choice label { display: flex; align-items: center; gap: 6px; font-weight: 500; margin: 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Bulk Pricing</h1>
    <a href="/admin/resources/DataPlanPricing">&larr; Back to admin panel</a>
  </header>

  ${flashHtml}

  <div class="card">
    <h2>1. Default markup</h2>
    <p class="hint">Applied automatically to any data plan that has no price set of its own. Takes effect immediately — no redeploy needed.</p>
    <p class="current">Current: ${settings.dataPlanMarkupPercent}% + ₦${settings.dataPlanMarkupNaira}</p>
    <form method="POST" action="/admin/bulk-pricing/default-markup">
      <div class="row">
        <div>
          <label>Markup %</label>
          <input type="number" name="dataPlanMarkupPercent" step="0.01" min="0" value="${settings.dataPlanMarkupPercent}" required>
        </div>
        <div>
          <label>Markup ₦ (flat)</label>
          <input type="number" name="dataPlanMarkupNaira" step="0.01" min="0" value="${settings.dataPlanMarkupNaira}" required>
        </div>
      </div>
      <button type="submit">Save default markup</button>
    </form>
  </div>

  <div class="card">
    <h2>0. Provider switch</h2>
    <p class="hint">Which upstream fulfills each purchase type. Switches instantly, no redeploy - a live customer's very next request uses the new provider. Cable TV and Electricity always use BilalSadaSub (Alrahuz doesn't offer them).</p>
    <form method="POST" action="/admin/bulk-pricing/provider-switch">
      <label>Data &amp; Airtime provider</label>
      <select name="dataAirtimeProvider">
        <option value="alrahuz" ${settings.dataAirtimeProvider === 'alrahuz' ? 'selected' : ''}>Alrahuz</option>
        <option value="bilalsadasub" ${settings.dataAirtimeProvider === 'bilalsadasub' ? 'selected' : ''}>BilalSadaSub</option>
      </select>
      <label>Result Pin (WAEC/NECO/NABTEB) provider</label>
      <select name="resultPinProvider">
        <option value="alrahuz" ${settings.resultPinProvider === 'alrahuz' ? 'selected' : ''}>Alrahuz</option>
        <option value="bilalsadasub" ${settings.resultPinProvider === 'bilalsadasub' ? 'selected' : ''}>BilalSadaSub</option>
      </select>
      <div class="row">
        <div>
          <label>Cable TV markup %</label>
          <input type="number" name="cableMarkupPercent" step="0.01" min="0" value="${settings.cableMarkupPercent}" required>
        </div>
        <div>
          <label>Electricity markup %</label>
          <input type="number" name="electricityMarkupPercent" step="0.01" min="0" value="${settings.electricityMarkupPercent}" required>
        </div>
      </div>
      <button type="submit">Save provider switch</button>
    </form>
  </div>

  <div class="card">
    <h2>2. Bulk reprice data plans</h2>
    <p class="hint">Sets selling price = provider cost + % + ₦ for every plan in the chosen network (or all networks). Overwrites any price already set on those plans.</p>
    <form method="POST" action="/admin/bulk-pricing/data-plans" onsubmit="return confirm('This overwrites the selling price on every matching data plan. Continue?');">
      <label>Network</label>
      <select name="network">
        <option value="">All networks</option>
        ${networkOptions}
      </select>
      <label>Provider</label>
      <select name="dataPlanProvider">
        <option value="">Both providers</option>
        <option value="alrahuz">Alrahuz only</option>
        <option value="bilalsadasub">BilalSadaSub only</option>
      </select>
      <div class="row">
        <div>
          <label>Markup %</label>
          <input type="number" name="markupPercent" step="0.01" min="0" value="0" required>
        </div>
        <div>
          <label>Markup ₦ (flat)</label>
          <input type="number" name="markupNaira" step="0.01" min="0" value="0" required>
        </div>
      </div>
      <button type="submit">Apply to data plans</button>
    </form>
  </div>

  <div class="card">
    <h2>3. Bulk reprice services</h2>
    <p class="hint">Same idea for the NIN/BVN verification list (Techhub) or the WAEC/NECO/NABTEB result-pin list (Alrahuz).</p>
    <form method="POST" action="/admin/bulk-pricing/services" onsubmit="return confirm('This overwrites the selling price on every matching service. Continue?');">
      <div class="provider-choice">
        <label><input type="radio" name="provider" value="techhub" checked> NIN/BVN (Techhub)</label>
        <label><input type="radio" name="provider" value="alrahuz"> WAEC/NECO/NABTEB (Alrahuz)</label>
      </div>
      <div class="row">
        <div>
          <label>Markup %</label>
          <input type="number" name="markupPercent" step="0.01" min="0" value="0" required>
        </div>
        <div>
          <label>Markup ₦ (flat)</label>
          <input type="number" name="markupNaira" step="0.01" min="0" value="0" required>
        </div>
      </div>
      <button type="submit">Apply to services</button>
    </form>
  </div>

  <p class="current">Signed in as ${escape(admin.fullName)} (${escape(admin.role)})</p>
</div>
</body>
</html>`;
}
