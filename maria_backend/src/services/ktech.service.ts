import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';
import type { TechhubSlipResult, TechhubSlipTier, TechhubBvnTier } from './techhub.service.js';
import type { NormalizedProviderResponse } from './provider-types.js';
import type { DataPlan } from './data-plans.data.js';
import { dataPlanPricingService } from './data-plan-pricing.service.js';

const PROVIDER = 'ktech';

/**
 * Mirrors ProviderBalanceStatus.upsert in bilalsadasub.service.ts - keeps
 * the admin's "Provider Ledger" page (ProviderBalanceStatus, surfaced via
 * getProviderLedgerSummaries() in provider-ledger.service.ts) showing a
 * live K-Tech balance next to Alrahuz/BilalSadaSub/Techhub's, instead of
 * "— not checked yet" forever. Called both after every successful slip/data/
 * airtime purchase (K-Tech's own `balance_after` in the response, when
 * present) and on-demand from the admin "Refresh live balance" button (see
 * refreshWalletBalance() below).
 */
async function recordKtechBalance(rawBalance: unknown) {
  const balance =
    typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
  if (balance === undefined || !Number.isFinite(balance)) return null;
  return prisma.providerBalanceStatus.upsert({
    where: { provider: PROVIDER },
    create: { provider: PROVIDER, lastKnownBalance: balance },
    update: { lastKnownBalance: balance }
  });
}

/**
 * K-Tech Solutions ("MAJOR DATA-LINK") — a second NIN/BVN identity
 * verification provider, documented at
 * https://k-tech.up.railway.app/partner-docs. Same role as
 * techhub.service.ts (both are picked between via
 * PricingSettings.identityVerificationProvider, see
 * verification.service.ts), deliberately returning the exact same
 * `TechhubSlipResult` shape so either provider is a drop-in replacement for
 * the other from the caller's point of view.
 *
 * Documented request/response shape (all endpoints, per the docs):
 *   Auth:     header "X-API-Key: <key>" on every request.
 *   Idempotency: header "Idempotency-Key" required on every purchase/submit
 *     endpoint (8-128 chars, unique per order on our side - re-sending the
 *     exact same request with the same key never charges twice). We reuse
 *     our own internal transaction reference for this, so a retried request
 *     on our side is automatically idempotent on K-Tech's side too.
 *   Success:  {"status": true, "message": "...", "data": {"reference": "...",
 *              "balance_after": ..., "pdf_base64": "..."}}
 *   Failure:  {"status": false, "message": "...", "code": "..."}
 *
 * SCOPE NOTE: the docs only showed full parameter tables + response
 * examples for NIN-by-NIN and NIN-by-phone. BVN slip's parameter table
 * wasn't visible in what was captured, so `bvn`+`tier` below is inferred
 * from the same pattern every other tiered endpoint here uses - confirm
 * against the live docs (Authentication tab expanded, "BVN Slips" section)
 * before relying on it in production. NIN-by-demographic and the async
 * services (NIN Validation, Personalization, IPE Clearance) are NOT
 * implemented here at all - their request bodies were never captured, so
 * regardless of which provider is selected, those five continue to run
 * through Techhub only (see verification.service.ts).
 *
 * Also unconfirmed: the docs page never states its API host explicitly
 * (only relative paths like "/api/v1/data/purchase"). KTECH_BASE_URL
 * defaults to the docs' own host + /api/v1 - correct this via the
 * KTECH_BASE_URL env var if the real API lives on a different host.
 */

type KtechResponse = {
  status?: boolean;
  message?: string;
  code?: string;
  data?: {
    reference?: string;
    balance_after?: number;
    pdf_base64?: string;
    pdf_url?: string;
    user_data?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

function mockPdfBase64() {
  return Buffer.from('%PDF-1.4\n% MAJOR DATA-LINK mock slip - MOCK_KTECH is on\n').toString('base64');
}

export class KtechService {
  private baseUrl() {
    return env.KTECH_BASE_URL.replace(/\/$/, '');
  }

  private apiKey() {
    if (!env.KTECH_API_KEY) {
      throw new ApiError(500, 'K-Tech API key is not configured', 'KTECH_NOT_CONFIGURED');
    }
    return env.KTECH_API_KEY;
  }

  async ninByNin(nin: string, tier: TechhubSlipTier, idempotencyKey: string) {
    return this.postSlip('/verification/nin/by-nin', { nin, tier }, idempotencyKey);
  }

  async ninByPhone(phone: string, tier: Exclude<TechhubSlipTier, 'vnin'>, idempotencyKey: string) {
    return this.postSlip('/verification/nin/by-phone', { phone, tier }, idempotencyKey);
  }

  async bvnSlip(bvn: string, tier: TechhubBvnTier, idempotencyKey: string) {
    return this.postSlip('/verification/bvn/slip', { bvn, tier }, idempotencyKey);
  }

  private async postSlip(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<TechhubSlipResult> {
    if (env.MOCK_KTECH) {
      return {
        ok: true,
        message: 'PDF generated successfully (mock)',
        userData: { first_name: 'JOHN', last_name: 'DOE', gender: 'MALE', ...body },
        pdfBase64: mockPdfBase64(),
        raw: { mock: true }
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey(),
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      console.error(`[ktech] network error calling ${path}:`, error);
      return { ok: false, message: 'Could not reach the verification provider - please try again shortly', raw: null };
    }

    const data = (await response.json().catch(() => ({}))) as KtechResponse;

    if (!response.ok || data.status !== true) {
      console.error(`[ktech] slip lookup failed (path=${path}, http=${response.status}):`, JSON.stringify(data));
      return {
        ok: false,
        message: data.message ?? `Verification provider returned HTTP ${response.status}`,
        raw: data
      };
    }

    if (typeof data.data?.balance_after === 'number') {
      void recordKtechBalance(data.data.balance_after).catch((error) =>
        console.error('[ktech-balance] failed to record post-slip balance:', error)
      );
    }

    return {
      ok: true,
      message: data.message ?? 'PDF generated successfully',
      // The one response example the docs showed (NIN by NIN/by phone) did
      // not include `user_data` at all - only reference/balance_after/
      // pdf_base64. Passed through if K-Tech does include it (BVN slip or a
      // fuller response than the doc excerpt showed); the in-app slip
      // preview (DigitalSlipPreview) simply shows the PDF-download action
      // instead of the name/photo card when it's absent, same as it already
      // does for any Techhub response with no user_data.
      userData: data.data?.user_data,
      pdfBase64: data.data?.pdf_base64,
      pdfUrl: data.data?.pdf_url,
      raw: data
    };
  }
}

export const ktechService = new KtechService();

// ---- Data & Airtime ----
//
// Same admin-switchable role as bilalsadasub.service.ts/provider.service.ts
// (Alrahuz) for these two - see activeDataAirtimeProvider() in
// vtu.routes.ts, which now also accepts 'ktech'.
//
// CONFIDENCE NOTE - read before relying on this in production: the docs
// captured a full curl example + parameter names for the *request* side of
// Buy Data (`{"network":"MTN","plan_id":"mtn-1gb-30d","phone":"..."}`), so
// buyData()/buyAirtime() below are on solid ground. The *response* body for
// a data/airtime purchase specifically was never shown (only NIN slip
// responses were) - normalize() below assumes it follows the same
// {status,message,data:{...}} envelope documented as universal ("All API
// responses share a consistent shape"), which is a safe bet, but the exact
// field names inside `data` (balance/cost reporting fields in particular)
// aren't confirmed. List Data Plan Categories and List Data Plans
// (GET /data/plans/:network[/categories]) were shown only as bare endpoint
// entries - no parameter table, no response example was captured at all -
// so fetchLiveDataPlans()/getDataPlanCategories() below are a best-effort
// guess at typical field names (plan_id/id, plan_name/name, amount/price,
// validity/duration), same spirit as validateSmartcard()/validateMeter()
// above for BilalSadaSub. Test each of these three against the real API
// (or re-check the docs with those accordions expanded) before switching
// PricingSettings.dataAirtimeProvider to 'ktech' in production - a field
// name mismatch here fails safely (empty plan list / a clear error), it
// just won't silently produce wrong data.

type KtechListResponse = { status?: boolean; message?: string; data?: unknown };

async function ktechRequest(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: Record<string, unknown>; idempotencyKey?: string } = {}
): Promise<KtechListResponse> {
  if (!env.KTECH_API_KEY) {
    throw new ApiError(500, 'K-Tech API key is not configured', 'KTECH_NOT_CONFIGURED');
  }
  const headers: Record<string, string> = { 'X-API-Key': env.KTECH_API_KEY };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const response = await fetch(`${env.KTECH_BASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  return (await response.json().catch(() => ({}))) as KtechListResponse;
}

function normalizePurchase(body: KtechListResponse): NormalizedProviderResponse {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const success = body.status === true;
  return {
    status: success,
    providerRef: typeof data.reference === 'string' ? data.reference : undefined,
    message: body.message ?? (success ? 'Transaction processed' : 'Transaction failed')
    // No costKobo here on purpose - K-Tech's docs never showed a
    // balance-BEFORE figure for a purchase response (only balance_after, in
    // the NIN slip example), so there's no reliable delta to compute an
    // actual cost from. Left undefined ("unknown", not "free" - see the
    // identical note on NormalizedProviderResponse.costKobo);
    // processProviderPurchase falls back to the config-based estimate
    // (plan.providerAmount) it already has for data, and stays null for
    // airtime, same as every other provider without a delta available.
  };
}

async function fetchLiveDataPlans(network: string): Promise<DataPlan[]> {
  const body = await ktechRequest('GET', `/data/plans/${encodeURIComponent(network.toUpperCase())}`);
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  if (body.status !== true || !Array.isArray(body.data)) {
    console.error('[ktech] unexpected data-plans response shape', { network, body });
  }
  return rows.map((row) => ({
    id: String(row.plan_id ?? row.id ?? ''),
    networkId: 0, // K-Tech addresses networks by name (e.g. "MTN"), not a numeric ID - never read for this provider.
    name: String(row.plan_name ?? row.name ?? row.title ?? 'Data plan'),
    amount: Number(row.amount ?? row.price ?? 0),
    validity: String(row.validity ?? row.duration ?? '30 days')
  })).filter((plan) => plan.id && plan.amount > 0);
}

const planCache = new Map<string, { expiresAt: number; plans: Awaited<ReturnType<typeof dataPlanPricingService.applyPricing>> }>();
const CACHE_MS = 15 * 60 * 1000;

async function getAllDataPlans(network: string) {
  const key = network.toUpperCase();
  const cached = planCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.plans;

  const rawPlans = await fetchLiveDataPlans(network);
  console.log(`[ktech] ${key}: ${rawPlans.length} plan(s) loaded`);
  const priced = await dataPlanPricingService.applyPricing(rawPlans, key, PROVIDER);
  planCache.set(key, { expiresAt: Date.now() + CACHE_MS, plans: priced });
  return priced;
}

export async function getDataPlans(network: string, category?: string) {
  const plans = await getAllDataPlans(network);
  if (!category) return plans;
  const normalized = category.trim().toUpperCase();
  return plans.filter((plan) => (plan.planType ?? '').toUpperCase() === normalized);
}

export async function getDataPlanCategories(network: string) {
  const body = await ktechRequest('GET', `/data/plans/${encodeURIComponent(network.toUpperCase())}/categories`);
  if (body.status === true && Array.isArray(body.data)) {
    // Defensive against either shape: a plain string list, or objects like
    // { category, count } (the latter matches what this app's own
    // /data/plans/:network/categories endpoint returns for BilalSadaSub -
    // see getDataPlanCategories in bilalsadasub.service.ts - a reasonable
    // guess for K-Tech's own dashboard to follow the same convention).
    const rows = body.data as unknown[];
    if (rows.every((row) => typeof row === 'string')) {
      return (rows as string[]).map((category) => ({ category, count: 0 }));
    }
    return (rows as Record<string, unknown>[])
      .map((row) => ({ category: String(row.category ?? row.name ?? ''), count: Number(row.count ?? 0) }))
      .filter((row) => row.category);
  }
  // Endpoint shape didn't match what we guessed - fall back to deriving
  // categories from the full plan list client-side, same approach
  // bilalsadasub.service.ts uses (see BILAL_CATEGORY_ORDER/getDataPlanCategories
  // there), so the category filter still works even if the dedicated
  // categories endpoint's response shape turns out to differ from this guess.
  const plans = await getAllDataPlans(network);
  const counts = new Map<string, number>();
  for (const plan of plans) {
    const type = plan.planType?.trim();
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
}

export async function getDataPlan(network: string, planId: string) {
  const plans = await getAllDataPlans(network);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new ApiError(404, 'Data plan not found', 'PLAN_NOT_FOUND');
  return plan;
}

export async function buyData(input: { network: string; phone: string; planId: string; reference: string }) {
  if (env.MOCK_KTECH) {
    return { status: true, message: 'Transaction processed (mock)', providerRef: input.reference } satisfies NormalizedProviderResponse;
  }
  const body = await ktechRequest('POST', '/data/purchase', {
    body: { network: input.network.toUpperCase(), plan_id: input.planId, phone: input.phone },
    idempotencyKey: input.reference
  });
  return normalizePurchase(body);
}

export async function buyAirtime(input: { network: string; phone: string; amount: number; reference: string }) {
  if (env.MOCK_KTECH) {
    return { status: true, message: 'Transaction processed (mock)', providerRef: input.reference } satisfies NormalizedProviderResponse;
  }
  // Buy Airtime's parameter table wasn't captured in the docs (only the bare
  // endpoint entry was) - this mirrors Buy Data's confirmed shape
  // (network/phone + the type-specific field, here `amount` instead of
  // `plan_id`), which is the standard shape for this kind of API. Confirm
  // against the live docs before relying on it.
  const body = await ktechRequest('POST', '/airtime/purchase', {
    body: { network: input.network.toUpperCase(), phone: input.phone, amount: input.amount },
    idempotencyKey: input.reference
  });
  return normalizePurchase(body);
}

// ---- Wallet & Funding ----
//
// Backs the "K-Tech Solutions — Wallet" section on the admin Provider
// Ledger page (see admin/provider-ledger.ts). Per the docs: "Every purchase
// debits your partner wallet directly - fund it via a permanent virtual
// account or a one-off Exact Transfer."
//
// CONFIDENCE NOTE: GET /wallet/balance was a documented endpoint (seen as a
// bare "GET /wallet/balance" entry), but its response body was never
// captured, so getWalletBalance() below guesses the balance lives at
// `data.balance` (a number or numeric string) - the same shape convention
// every other confirmed K-Tech response uses for numeric wallet figures
// (`data.balance_after` on a slip purchase). POST /wallet/funding-account
// and POST /wallet/fund/dynamic were seen only as bare endpoint entries too
// - no parameter table or response example at all - so their exact request
// body (especially fund/dynamic's amount field name) and response field
// names (account_number/bank_name/etc.) are unconfirmed guesses. Because of
// that, requestFundingInstructions() below returns the ENTIRE raw `data`
// object rather than picking out named fields, and the admin page renders
// whatever comes back generically (label: value rows) - so even if the
// guessed field names are wrong, nothing returned by K-Tech is hidden from
// the admin acting on it. Confirm against the live docs before depending on
// specific field names here.

export async function getWalletBalance(): Promise<{ balance: number | null; raw: unknown }> {
  const body = await ktechRequest('GET', '/wallet/balance');
  const data = (body.data ?? {}) as Record<string, unknown>;
  const rawBalance = data.balance ?? data.wallet_balance;
  const balance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
  return { balance: balance !== undefined && Number.isFinite(balance) ? balance : null, raw: body };
}

/** GET /wallet/balance, then persists the result to ProviderBalanceStatus
 *  (see recordKtechBalance above) so the admin ledger page reflects it
 *  immediately - used by the "Refresh live balance" button. */
export async function refreshWalletBalance() {
  const { balance, raw } = await getWalletBalance();
  if (balance !== null) await recordKtechBalance(balance);
  return { balance, raw };
}

/** POST /wallet/funding-account - a reusable, permanent virtual account
 *  number the admin can transfer into at any time to top up the K-Tech
 *  wallet. Returns K-Tech's raw `data` object (see CONFIDENCE NOTE above). */
export async function createFundingAccount(idempotencyKey: string): Promise<Record<string, unknown>> {
  const body = await ktechRequest('POST', '/wallet/funding-account', { body: {}, idempotencyKey });
  return (body.data ?? { message: body.message, status: body.status }) as Record<string, unknown>;
}

/** POST /wallet/fund/dynamic - a one-off "Exact Transfer" (an amount +
 *  account number good for a single payment) for a specific top-up amount.
 *  Returns K-Tech's raw `data` object (see CONFIDENCE NOTE above). */
export async function requestDynamicFunding(amount: number, idempotencyKey: string): Promise<Record<string, unknown>> {
  const body = await ktechRequest('POST', '/wallet/fund/dynamic', { body: { amount }, idempotencyKey });
  return (body.data ?? { message: body.message, status: body.status }) as Record<string, unknown>;
}
