import type { Request, Router } from 'express';
import { logAdminAction } from './audit.js';
import type { AdminSessionUser } from './auth.js';
import { bankKeyFor } from '../lib/bvn-modification-banks.js';
import { prisma } from '../lib/prisma.js';
import { dataPlanPricingService } from '../services/data-plan-pricing.service.js';
import { getPricingSettings, updatePricingSettings } from '../services/pricing-settings.service.js';
import { applyServiceMarkup } from '../services/result-pin.service.js';
import { listTinCertificatePrices } from '../services/tin-certificate.service.js';
import { BVN_MODIFICATION_BANKS, BVN_MODIFICATION_CONFIG, listBvnModificationPrices } from '../services/bvn-modification.service.js';

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

    // Ensure every BVN Modification option has a distinct editable price row,
    // including each bank (banks can have different selling prices).
    await listBvnModificationPrices();
    // Same for TIN Certificate so its Individual/Corporate prices are editable from first load.
    await listTinCertificatePrices();
    const [settings, networks, servicePrices] = await Promise.all([
      getPricingSettings(),
      prisma.dataPlanPricing.findMany({
        distinct: ['network'],
        select: { network: true },
        orderBy: { network: 'asc' }
      }),
      prisma.servicePricing.findMany({ orderBy: [{ provider: 'asc' }, { label: 'asc' }] })
    ]);

    res.type('html').send(renderPage({ admin, settings, networks: networks.map((n: { network: string }) => n.network), servicePrices, flash: flashFromQuery(req.query) }));
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
    const identityVerificationProviderRaw = field(req, 'identityVerificationProvider');
    const cableMarkupPercent = parseNonNegativeNumber(field(req, 'cableMarkupPercent'));
    const electricityMarkupPercent = parseNonNegativeNumber(field(req, 'electricityMarkupPercent'));

    const dataAirtimeProvider =
      dataAirtimeProviderRaw === 'bilalsadasub' ? 'bilalsadasub' : dataAirtimeProviderRaw === 'ktech' ? 'ktech' : 'alrahuz';
    const resultPinProvider = resultPinProviderRaw === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';
    const identityVerificationProvider = identityVerificationProviderRaw === 'ktech' ? 'ktech' : identityVerificationProviderRaw === 'techhub' ? 'techhub' : undefined;

    if (cableMarkupPercent === null || electricityMarkupPercent === null) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Cable and electricity markup % must both be valid numbers ≥ 0.'));
    }

    try {
      await updatePricingSettings({ dataAirtimeProvider, resultPinProvider, ...(identityVerificationProvider ? { identityVerificationProvider } : {}), cableMarkupPercent, electricityMarkupPercent });
      await logAdminAction({
        adminId: admin.id,
        action: 'UPDATE_PROVIDER_SWITCH',
        targetType: 'PricingSettings',
        targetId: 'default',
        metadata: { dataAirtimeProvider, resultPinProvider, ...(identityVerificationProvider ? { identityVerificationProvider } : {}), cableMarkupPercent, electricityMarkupPercent }
      });
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Providers updated - Data/Airtime: ${dataAirtimeProvider}, Result Pins: ${resultPinProvider}. NIN/BVN providers are configured per service above.`));
    } catch (error) {
      console.error('[bulk-pricing] provider-switch update failed:', error);
      res.redirect(
        '/admin/bulk-pricing?flash=' +
          encodeFlash(
            'error',
            `Provider switch was NOT saved: ${(error as Error).message}.`
          )
      );
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
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Data plan prices were not changed because the batch failed. Check the server logs.'));
    }
  });

  router.post('/bulk-pricing/services', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const percent = parseNonNegativeNumber(field(req, 'markupPercent'));
    const naira = parseNonNegativeNumber(field(req, 'markupNaira'));
    const providerRaw = field(req, 'provider');
    const provider = providerRaw === 'alrahuz' ? 'alrahuz' : providerRaw === 'bvn_modification_agency' ? 'bvn_modification_agency' : providerRaw === 'bvn_modification_bank' ? 'bvn_modification_bank' : providerRaw === 'techhub' ? 'techhub' : null;
    if (percent === null || naira === null || !provider) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Markup % and ₦ must both be valid numbers ≥ 0, and a provider must be selected.'));
    }

    // Which banks a "BVN Modification — Banks/NIBSS" bulk reprice touches. Only
    // known bank keys are accepted; an admin unticks e.g. Access Bank to leave
    // its own price alone while repricing the remaining banks, or ticks only
    // Access Bank to reprice it by itself.
    let bankKeys: string[] | undefined;
    if (provider === 'bvn_modification_bank') {
      const rawKeys = fields(req).bankKeys;
      const known = new Set(BVN_MODIFICATION_BANKS.map(bankKeyFor));
      bankKeys = [...new Set((Array.isArray(rawKeys) ? rawKeys : rawKeys ? [rawKeys] : []).filter((key): key is string => typeof key === 'string' && known.has(key)))];
      if (bankKeys.length === 0) {
        return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Select at least one bank to reprice.'));
      }
    }

    try {
      const result = await applyServiceMarkup({ provider, markupNaira: naira, markupPercent: percent, bankKeys });
      await logAdminAction({
        adminId: admin.id,
        action: 'BULK_REPRICE_SERVICES',
        targetType: 'ServicePricing',
        metadata: { provider, markupPercent: percent, markupNaira: naira, updated: result.updated, ...(bankKeys ? { banks: bankKeys } : {}) }
      });

      const bankScope = bankKeys && bankKeys.length < BVN_MODIFICATION_BANKS.length
        ? ` (${bankKeys.map((key) => BVN_MODIFICATION_BANKS.find((bank) => bankKeyFor(bank) === key) ?? key).join(', ')})`
        : '';
      const label = provider === 'techhub' ? 'NIN/BVN verification services' : provider === 'bvn_modification_agency' ? 'Agency BVN modification services' : provider === 'bvn_modification_bank' ? `Bank BVN modification services${bankScope}` : 'WAEC/NECO/NABTEB result-pin services';
      const skippedNote = result.skipped > 0 ? ` (${result.skipped} skipped - non-positive computed price)` : '';
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Repriced ${result.updated} ${label} at cost + ${percent}% + ₦${naira}.${skippedNote}`));
    } catch (error) {
      console.error('[bulk-pricing] services bulk markup failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Service prices were not changed because the batch failed. Check the server logs.'));
    }
  });

  router.post('/bulk-pricing/service-prices', async (req, res) => {
    const admin = requireFinanceOrSuper(req);
    if (!admin) return res.redirect('/admin/login');

    const rawIds = fields(req).serviceIds;
    const serviceIds = [...new Set((Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : []).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (serviceIds.length === 0) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Select at least one service and enter its selling price.'));
    }

    const prices = serviceIds.map((id) => ({ id, price: parseNonNegativeNumber(field(req, `price_${id}`)) }));
    if (prices.some(({ price }) => price !== null && !Number.isSafeInteger(Math.round(price * 100)))) {
      return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Every entered price must be a valid amount of ₦0 or more.'));
    }

    try {
      const existing = await prisma.servicePricing.findMany({ where: { id: { in: serviceIds } }, select: { id: true, service: true } });
      if (existing.length !== serviceIds.length) {
        return res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Some selected services were not found. Refresh the page and try again.'));
      }
      await prisma.$transaction(async (tx) => {
        for (const { id, price } of prices) {
          const providerRaw = field(req, `provider_${id}`);
          const row = existing.find((item) => item.id === id)!;
          const hubbuSupported = /^(NIN_SLIP_(PREMIUM|STANDARD|REGULAR|VNIN)|NIN_PHONE_SLIP_(PREMIUM|STANDARD|REGULAR)|NIN_DEMOGRAPHIC|BVN_SLIP_(PREMIUM|STANDARD))$/.test(row.service);
          const ktechSupported = /^(NIN_SLIP_(PREMIUM|STANDARD|REGULAR|VNIN|INFORMATION)|NIN_PHONE_SLIP_(PREMIUM|STANDARD|REGULAR)|BVN_SLIP_(PREMIUM|STANDARD)|NIN_VALIDATION_.+|NIN_PERSONALIZATION|IPE_CLEARANCE)$/.test(row.service);
          const provider = row.service === 'NIN_SLIP_INFORMATION' ? 'ktech' : providerRaw === 'ktech' && ktechSupported ? 'ktech' : providerRaw === 'hubbu' && hubbuSupported ? 'hubbu' : 'techhub';
          await tx.servicePricing.update({ where: { id }, data: { sellingPriceKobo: price === null ? null : BigInt(Math.round(price * 100)), provider } });
        }
      }, { maxWait: 10_000, timeout: 120_000 });
      await logAdminAction({
        adminId: admin.id,
        action: 'BULK_SET_SERVICE_PRICES',
        targetType: 'ServicePricing',
        metadata: { services: existing.map(({ id, service }) => ({ id, service, priceNaira: prices.find((price) => price.id === id)?.price ?? null })), updated: serviceIds.length }
      });
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('success', `Saved selling prices for ${serviceIds.length} service(s).`));
    } catch (error) {
      console.error('[bulk-pricing] direct service price update failed:', error);
      res.redirect('/admin/bulk-pricing?flash=' + encodeFlash('error', 'Prices were not changed because the batch failed. Check the server logs.'));
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
    identityVerificationProvider: string;
    cableMarkupPercent: number;
    electricityMarkupPercent: number;
  };
  networks: string[];
  servicePrices: Array<{ id: string; provider: string; service: string; label: string; providerCostKobo: bigint; sellingPriceKobo: bigint | null; isActive: boolean }>;
  flash: { type: 'success' | 'error'; message: string } | null;
}) {
  const { admin, settings, networks, servicePrices, flash } = params;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const networkOptions = networks.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join('');
  const bvnTypeLabels = Object.fromEntries(Object.entries(BVN_MODIFICATION_CONFIG).map(([key, config]) => [key.toUpperCase(), config.title]));
  const bankKeys = BVN_MODIFICATION_BANKS.map(bankKeyFor);
  const bankCheckboxes = BVN_MODIFICATION_BANKS.map((bank) => `<label class="bank-option"><input type="checkbox" name="bankKeys" value="${escape(bankKeyFor(bank))}" checked> ${escape(bank)}</label>`).join('');
  const serviceRows = servicePrices.map((row) => {
    const bvnMatch = row.service.match(/^BVN_MODIFICATION_(UPDATE_[A-Z_]+)_(AGENCY|BANK_(.+))$/);
    let label = row.label;
    if (bvnMatch) {
      const modificationType = bvnTypeLabels[bvnMatch[1]] ?? bvnMatch[1].replaceAll('_', ' ');
      const bankKey = bvnMatch[3];
      const bankIndex = bankKey ? bankKeys.indexOf(bankKey) : -1;
      const enrollment = bvnMatch[2] === 'AGENCY' ? 'Agency' : bankIndex >= 0 ? BVN_MODIFICATION_BANKS[bankIndex] : bankKey?.replaceAll('_', ' ') ?? 'Bank';
      label = `BVN Modification — ${enrollment} — ${modificationType}`;
    }
    const sellingPrice = row.sellingPriceKobo === null ? '' : (Number(row.sellingPriceKobo) / 100).toFixed(2);
    const hubbuSupported = /^(NIN_SLIP_(PREMIUM|STANDARD|REGULAR|VNIN)|NIN_PHONE_SLIP_(PREMIUM|STANDARD|REGULAR)|NIN_DEMOGRAPHIC|BVN_SLIP_(PREMIUM|STANDARD))$/.test(row.service);
    const ktechSupported = /^(NIN_SLIP_(PREMIUM|STANDARD|REGULAR|VNIN|INFORMATION)|NIN_PHONE_SLIP_(PREMIUM|STANDARD|REGULAR)|BVN_SLIP_(PREMIUM|STANDARD)|NIN_VALIDATION_.+|NIN_PERSONALIZATION|IPE_CLEARANCE)$/.test(row.service);
    return `<tr><td><input type="checkbox" name="serviceIds" value="${escape(row.id)}" aria-label="Select ${escape(label)}"></td><td>${escape(label)}<br><small>${escape(row.service)}</small></td><td><select name="provider_${escape(row.id)}"><option value="techhub" ${row.provider === 'techhub' && row.service !== 'NIN_SLIP_INFORMATION' ? 'selected' : ''} ${row.service === 'NIN_SLIP_INFORMATION' ? 'disabled' : ''}>Techhub</option><option value="ktech" ${row.provider === 'ktech' || row.service === 'NIN_SLIP_INFORMATION' ? 'selected' : ''} ${ktechSupported ? '' : 'disabled'}>K-Tech${ktechSupported ? '' : ' (unsupported)'}</option><option value="hubbu" ${row.provider === 'hubbu' ? 'selected' : ''} ${hubbuSupported ? '' : 'disabled'}>Hubbu${hubbuSupported ? '' : ' (unsupported)'}</option></select><small>Current provider cost ₦${(Number(row.providerCostKobo) / 100).toFixed(2)}</small></td><td><input class="price-input" type="number" name="price_${escape(row.id)}" min="0" step="0.01" value="${sellingPrice}" placeholder="Use cost: ₦${(Number(row.providerCostKobo) / 100).toFixed(2)}"></td><td>${row.isActive ? 'Active' : 'Inactive'}</td></tr>`;
  }).join('');

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
  .bank-scope { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
  .bank-scope[hidden] { display: none; }
  .bank-scope legend { font-weight: 600; padding: 0 6px; }
  .bank-option { display: inline-flex; align-items: center; gap: 6px; margin: 4px 14px 4px 0; }
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
  .wide { max-width: 100%; overflow-x: auto; }
  .price-table { width: 100%; border-collapse: collapse; min-width: 700px; margin-top: 12px; }
  .price-table th, .price-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); text-align: left; font-size: 13px; }
  .price-table th { background: #f6f0dc; }
  .price-table input[type=checkbox] { width: 18px; height: 18px; }
  input.price-input { width: 150px; padding: 8px; border: 1px solid var(--border); border-radius: 7px; }
  small { color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Bulk Pricing</h1>
    <a href="/admin/resources/DataPlanPricing">&larr; Back to admin panel</a>
  </header>

  ${flashHtml}

  <div class="card wide">
    <h2>Set exact service prices</h2>
    <p class="hint">Select one or more services, enter each selling price in naira, then save once. BVN Modification prices are separate for Agency and every bank, including Access Bank. Leave an input blank to use its provider cost.</p>
    <form method="POST" action="/admin/bulk-pricing/service-prices" onsubmit="return document.querySelectorAll('input[name=serviceIds]:checked').length > 0 || (alert('Select at least one service.'), false);">
      <p><label style="display:inline"><input type="checkbox" onclick="document.querySelectorAll('input[name=serviceIds]').forEach((item) => item.checked = this.checked)"> Select all listed services</label></p>
      <table class="price-table"><thead><tr><th>Select</th><th>Service</th><th>Provider &amp; cost</th><th>Selling price (₦)</th><th>Status</th></tr></thead><tbody>${serviceRows || '<tr><td colspan="5">No service prices found yet.</td></tr>'}</tbody></table>
      <button type="submit">Save selected prices and providers</button>
    </form>
  </div>

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
        <option value="ktech" ${settings.dataAirtimeProvider === 'ktech' ? 'selected' : ''}>K-Tech Solutions</option>
      </select>
      <label>Result Pin (WAEC/NECO/NABTEB) provider</label>
      <select name="resultPinProvider">
        <option value="alrahuz" ${settings.resultPinProvider === 'alrahuz' ? 'selected' : ''}>Alrahuz</option>
        <option value="bilalsadasub" ${settings.resultPinProvider === 'bilalsadasub' ? 'selected' : ''}>BilalSadaSub</option>
      </select>
      <p class="hint">Choose the NIN/BVN API separately for each service in the table above. Hubbu can be selected only for services its API documents support.</p>
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
    <p class="hint">Reprice NIN/BVN verification (Techhub), WAEC/NECO/NABTEB result pins (Alrahuz), Agency BVN modifications, or Bank BVN modifications. Agency and Bank prices are managed separately.</p>
    <form method="POST" action="/admin/bulk-pricing/services" onsubmit="return confirm('This overwrites the selling price on every matching service. Continue?');">
      <div class="provider-choice" onchange="document.getElementById('bank-scope').hidden = !document.querySelector('input[name=provider][value=bvn_modification_bank]').checked;">
        <label><input type="radio" name="provider" value="techhub" checked> NIN/BVN (Techhub)</label>
        <label><input type="radio" name="provider" value="alrahuz"> WAEC/NECO/NABTEB (Alrahuz)</label>
        <label><input type="radio" name="provider" value="bvn_modification_agency"> BVN Modification — Agency Banking</label>
        <label><input type="radio" name="provider" value="bvn_modification_bank"> BVN Modification — Banks/NIBSS</label>
      </div>
      <fieldset id="bank-scope" class="bank-scope" hidden>
        <legend>Banks to reprice</legend>
        <p class="hint">Every bank has its own price. Untick a bank (e.g. Access Bank) to leave its price untouched, or tick only Access Bank to reprice it alone.</p>
        ${bankCheckboxes}
      </fieldset>
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
