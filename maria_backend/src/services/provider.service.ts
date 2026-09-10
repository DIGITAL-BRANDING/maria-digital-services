import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';
import { dataPlanPricingService } from './data-plan-pricing.service.js';
import { DATA_PLANS, type DataPlan } from './data-plans.data.js';

export type ProviderFundingAccount = {
  accountNumber: string;
  accountName: string;
  bankName: string;
};

export type ProviderPurchaseInput = {
  network: string; // Alrahuz network ID, e.g. "1" for MTN - see NETWORK_IDS below
  phone: string;
  amount: number;
  planId?: string; // Alrahuz plan ID, required for data purchases
  reference: string;
};

/**
 * Confirmed from a real successful /api/data/ response on 2026-07-14 (HTTP 201):
 * {
 *   "id": 308232124,
 *   "ident": "Data19309363031182999583",
 *   "api_response": "Congrats! You have successfully gifted ...",
 *   "customer_ref": "",
 *   "network": 3,
 *   "balance_before": "65.0",
 *   "balance_after": "40.0",
 *   "mobile_number": "08012345678",
 *   "plan": 305,
 *   "Status": "successful",
 *   "plan_network": "9MOBILE",
 *   "plan_type": "CORPORATE GIFTING",
 *   "plan_name": "25.0MB",
 *   "plan_amount": "25.0",
 *   "create_date": "2026-07-14T11:15:48.723270",
 *   "Ported_number": true
 * }
 * The failure shape hasn't been observed yet (e.g. insufficient Alrahuz balance,
 * invalid plan/network combo, invalid phone) - if `Status` ever comes back as
 * something other than "successful", or the request fails outright, treat it as a
 * failure. Tighten this further once a real failure response is seen.
 */

export type ProviderResultPinInput = {
  examType: 'WAEC' | 'NECO' | 'NABTEB';
  quantity: number;
  reference: string;
};
type AlrahuzResponse = {
  id?: number | string;
  ident?: string;
  api_response?: string;
  Status?: string;
  status?: string | boolean;
  detail?: string; // present on auth errors, e.g. "Authentication credentials were not provided."
  // Present on real purchase responses (data/airtime) - see the confirmed
  // example above ProviderResultPinInput. Used to derive our actual cost for
  // that purchase - see actualCostFromBalanceDelta() below.
  balance_before?: number | string;
  balance_after?: number | string;
  [key: string]: unknown;
};

type PlanCacheEntry = {
  expiresAt: number;
  plans: Awaited<ReturnType<typeof dataPlanPricingService.applyPricing>>;
};

const planCache = new Map<string, PlanCacheEntry>();

// Guards against a "cache stampede": when the cache for a network is cold
// (fresh deploy, cache just expired, etc.) and several requests land at
// nearly the same instant - e.g. many users opening the app right after a
// new release - each of them used to independently kick off its own
// applyPricing() run (a chain of sequential DB upserts). Several of those
// chains running concurrently is exactly what exhausts a small Prisma
// connection pool and produces "Timed out fetching a new connection from the
// connection pool". This map ensures only ONE fetch+pricing run happens per
// network at a time; any request that arrives while one is already in
// flight just awaits that same promise instead of starting a new one.
const inFlightFetches = new Map<string, Promise<PlanCacheEntry['plans']>>();

/** Confirmed from your Alrahuz dashboard's Network List. */
export const NETWORK_IDS: Record<string, number> = {
  MTN: 1,
  GLO: 2,
  '9MOBILE': 3,
  AIRTEL: 4,
};

export class ProviderService {
  clearDataPlanCache(network?: string) {
    if (!network) {
      planCache.clear();
      return;
    }

    const networkId = NETWORK_IDS[network.toUpperCase()];
    if (networkId) planCache.delete(String(networkId));
  }

  async refreshDataPlans(network: string) {
    this.clearDataPlanCache(network);
    return this.getDataPlans(network);
  }

  async getDataPlans(network: string, category?: string) {
    if (category && env.ALRAHUZ_DATA_PLANS_PATH.includes('{dataType}')) {
      const networkId = NETWORK_IDS[network.toUpperCase()];
      if (!networkId) throw new ApiError(422, `Unsupported network: ${network}`, 'UNSUPPORTED_NETWORK');
      const providerCategory = this.providerCategory(category);
      const live = await this.fetchLiveDataPlans(network, networkId, providerCategory);
      if (live.length > 0) {
        return dataPlanPricingService.applyPricing(live, network.toUpperCase());
      }
    }
    const plans = await this.getAllDataPlans(network);
    if (!category) return plans;
    const normalized = this.providerCategory(category);
    return plans.filter((plan) => (plan.planType ?? '').trim().toUpperCase() === normalized);
  }

  private providerCategory(category: string) {
    const requested = category.trim().toUpperCase().replace(/\s+/g, ' ');
    return requested === 'CORPORATE' ? 'CORPORATE GIFTING'
      : requested === 'DATA COUPON' ? 'DATA COUPONS'
      : requested === 'SME 2' ? 'SME2'
      : requested;
  }

  /** Distinct Data Types (SME, SME2, GIFTING, etc.) that currently have at least
   *  one plan for this network - drives the "Select Data Type" step, matching
   *  Alrahuz's own app UX. Computed from data, not hardcoded, so it stays
   *  correct even if a network temporarily has fewer/more categories. */
  async getDataPlanCategories(network: string) {
    const plans = await this.getAllDataPlans(network);
    const counts = new Map<string, number>();

    for (const plan of plans) {
      const type = plan.planType?.trim();
      if (!type) continue;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([category, planCount]) => ({ category, planCount }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  private async getAllDataPlans(network: string) {
    if (env.MOCK_PROVIDER) {
      return dataPlanPricingService.applyPricing([
        { id: `${network}-1gb`, name: '1GB - 30 Days', amount: 500, validity: '30 days' },
        { id: `${network}-2gb`, name: '2GB - 30 Days', amount: 900, validity: '30 days' },
        { id: `${network}-5gb`, name: '5GB - 30 Days', amount: 2000, validity: '30 days' }
      ].map((plan) => ({ ...plan, networkId: NETWORK_IDS[network.toUpperCase()] ?? 1 })), network.toUpperCase());
    }

    const networkId = NETWORK_IDS[network.toUpperCase()];
    if (!networkId) {
      throw new ApiError(422, `Unsupported network: ${network}`, 'UNSUPPORTED_NETWORK');
    }

    const cacheKey = String(networkId);
    const cached = planCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.plans;
    }

    // If a fetch+pricing run for this network is already in progress (another
    // request beat us here while the cache was cold), just ride along on that
    // one instead of starting a second concurrent run.
    const existing = inFlightFetches.get(cacheKey);
    if (existing) {
      return existing;
    }

    const fetchPromise = (async () => {
      const livePlans = await this.fetchLiveDataPlans(network, networkId).catch((err) => {
        console.error(`[provider] live data plan fetch failed for ${network} (networkId=${networkId}):`, err);
        return [];
      });
      console.log(`[provider] ${network} (networkId=${networkId}): live=${livePlans.length} plans`);

      const staticPlans = DATA_PLANS.filter((plan) => plan.networkId === networkId);

      // A live result that's a small fraction of what we know Alrahuz actually
      // offers for this network (per the static snapshot) almost always means the
      // response came back in a shape fetchLiveDataPlans/extractPlans didn't
      // recognize - e.g. plans grouped by category - rather than Alrahuz genuinely
      // having only one plan. Treat that as untrustworthy rather than showing an
      // incomplete catalog. See fetchLiveDataPlans() for the raw-body log that
      // pins down which case it actually was.
      const liveLooksIncomplete = livePlans.length > 0 && staticPlans.length > 0 && livePlans.length < staticPlans.length / 4;

      const rawPlans = livePlans.length > 0 && !liveLooksIncomplete
        ? livePlans.map((live) => {
            const snapshot = staticPlans.find((item) => item.id === live.id);
            // Some provider responses expose only size/price and omit the
            // catalog name or validity. Enrich by plan ID so categories and
            // validity are never replaced with "Validity varies".
            return snapshot
              ? { ...snapshot, ...live, name: live.name.includes('Plan ') ? snapshot.name : live.name, validity: live.validity === 'Validity varies' ? snapshot.validity : live.validity }
              : live;
          })
        : staticPlans;
      if (livePlans.length === 0) {
        console.warn(`[provider] ${network} (networkId=${networkId}): live fetch returned nothing usable, falling back to static snapshot, ${rawPlans.length} plans`);
      } else if (liveLooksIncomplete) {
        console.warn(
          `[provider] ${network} (networkId=${networkId}): live fetch only returned ${livePlans.length} plan(s), ` +
            `expected roughly ${staticPlans.length} based on the static snapshot - likely a response-shape mismatch, falling back to static snapshot instead`
        );
      }
      const plans = await dataPlanPricingService.applyPricing(rawPlans, network.toUpperCase());
      console.log(`[provider] ${network} (networkId=${networkId}): ${plans.length} plans after pricing/isActive filter (out of ${rawPlans.length} raw)`);

      planCache.set(cacheKey, {
        expiresAt: Date.now() + env.ALRAHUZ_DATA_PLANS_CACHE_SECONDS * 1000,
        plans
      });

      return plans;
    })();

    inFlightFetches.set(cacheKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      // Always clear the in-flight marker, success or failure, so the next
      // request (whether cache-expiry or a genuine retry after an error)
      // is free to start a fresh run rather than being stuck awaiting a
      // promise that's already settled.
      inFlightFetches.delete(cacheKey);
    }
  }

  async getDataPlan(network: string, planId: string) {
    const plans = await this.getDataPlans(network);
    const plan = plans.find((item) => item.id === planId);
    if (!plan) {
      throw new ApiError(422, 'Selected data plan is no longer available', 'DATA_PLAN_UNAVAILABLE');
    }
    return plan;
  }

  getFundingAccount(): ProviderFundingAccount {
    return {
      accountNumber: env.ALRAHUZ_FUNDING_ACCOUNT_NUMBER,
      accountName: env.ALRAHUZ_FUNDING_ACCOUNT_NAME,
      bankName: env.ALRAHUZ_FUNDING_BANK_NAME
    };
  }

  async refreshBalance() {
    if (env.MOCK_PROVIDER) {
      // In mock mode there's no real balance to fetch, so this intentionally
      // stays at 0 and only bumps lastCheckedAt. If the admin dashboard is
      // showing NGN 0 and "Refresh" doesn't change it, MOCK_PROVIDER is on -
      // see the production warning logged at startup in server.ts.
      return prisma.providerBalanceStatus.upsert({
        where: { provider: 'alrahuz' },
        create: { provider: 'alrahuz', lastKnownBalance: 0 },
        update: { lastCheckedAt: new Date() }
      });
    }

    const baseUrl = env.ALRAHUZ_BASE_URL.replace(/\/$/, '');
    const path = env.ALRAHUZ_BALANCE_PATH.startsWith('/')
      ? env.ALRAHUZ_BALANCE_PATH
      : `/${env.ALRAHUZ_BALANCE_PATH}`;
    const response = await fetch(`${baseUrl}${path}`, { headers: this.headers() });
    const body = (await response.json().catch(() => ({}))) as AlrahuzResponse;

    if (!response.ok) {
      console.error(`[alrahuz-balance] live refresh failed (http=${response.status}):`, JSON.stringify(body));
      throw new ApiError(502, body.detail ?? body.api_response ?? 'Unable to refresh Alrahuz balance', 'ALRAHUZ_BALANCE_REFRESH_FAILED');
    }

    const balance = this.findBalance(body);
    if (balance === undefined) {
      console.error('[alrahuz-balance] live refresh response did not include a recognizable balance:', JSON.stringify(body).slice(0, 4000));
      throw new ApiError(502, 'Alrahuz balance response did not include a recognizable balance', 'ALRAHUZ_BALANCE_NOT_FOUND');
    }

    return this.recordProviderBalance(balance);
  }

  async buyData(input: ProviderPurchaseInput) {
    if (env.MOCK_PROVIDER) {
      // No real balance movement to observe in mock mode - costKobo stays
      // undefined ("unknown"), same as when Alrahuz's real response is
      // missing balance fields. Whatever estimate the caller passed to
      // debitWallet() up front (e.g. plan.providerAmount) is what sticks.
      return { status: true, providerRef: `MOCK-${input.reference}`, message: 'Data purchase queued', costKobo: undefined };
    }
    if (!input.planId) {
      throw new ApiError(422, 'planId is required for data purchases', 'MISSING_PLAN_ID');
    }

    const response = await fetch(`${env.ALRAHUZ_BASE_URL}/data/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        network: this.networkId(input.network),
        mobile_number: input.phone,
        plan: Number(input.planId),
        Ported_number: true
      })
    });

    return this.normalize(response, input.reference);
  }

  async buyAirtime(input: ProviderPurchaseInput) {
    if (env.MOCK_PROVIDER) {
      return { status: true, providerRef: `MOCK-${input.reference}`, message: 'Airtime purchase queued', costKobo: undefined };
    }

    const response = await fetch(`${env.ALRAHUZ_BASE_URL}/topup/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        network: this.networkId(input.network),
        amount: input.amount,
        mobile_number: input.phone,
        Ported_number: true,
        'request-id': input.reference,
        airtime_type: 'VTU'
      })
    });

    return this.normalize(response, input.reference);
  }


  async buyResultPin(input: ProviderResultPinInput) {
    if (env.MOCK_PROVIDER) {
      return {
        status: true,
        providerRef: `MOCK-${input.reference}`,
        message: `${input.examType} PIN purchase queued`,
        pin: `MOCK-${input.examType}-${input.reference}`,
        pins: [`MOCK-${input.examType}-${input.reference}`],
        serial: input.reference,
        raw: {}
      };
    }

    const baseUrl = env.ALRAHUZ_BASE_URL.replace(/\/$/, '');
    const path = env.ALRAHUZ_EXAM_PIN_PATH.startsWith('/')
      ? env.ALRAHUZ_EXAM_PIN_PATH
      : `/${env.ALRAHUZ_EXAM_PIN_PATH}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        exam_name: this.examId(input.examType),
        // Alrahuz's /exam/ endpoint validates its payload more strictly than
        // its data/airtime endpoints. Its documented schema has only these
        // two fields; sending our otherwise-useful request-id aliases makes
        // NECO requests fail with HTTP 400 on strict provider deployments.
        // Our own debitWallet idempotency key/reference already prevents a
        // duplicate local purchase, so no provider-side extra field is needed.
        quantity: input.quantity
      })
    });

    return this.normalizeResultPin(response, input.reference);
  }
  /**
   * Alrahuz returns HTTP 200/201 with a body `Status` field ("successful" on success),
   * separate from HTTP status. A non-2xx HTTP response (e.g. 401 with a `detail` field)
   * is also treated as a failure. `ident` (Alrahuz's own transaction ID) is preferred as
   * providerRef when present, since it's what you'd use to query the transaction status
   * back from Alrahuz later - falls back to our own reference if it's missing.
   *
   * Also opportunistically records `balance_after` - this is YOUR OWN remaining
   * balance at Alrahuz, not anything related to the customer's in-app wallet.
   * It's the one number Alrahuz actually exposes for "am I about to run dry",
   * so every response (success or failure) that includes it updates
   * ProviderBalanceStatus and fires a one-time-per-cooldown low-balance alert.
   */
  private async normalize(response: Response, reference: string) {
    const body = (await response.json().catch(() => ({}))) as AlrahuzResponse;

    if (body.balance_after !== undefined) {
      await this.recordProviderBalance(body.balance_after).catch((err) =>
        console.error('[alrahuz-balance] failed to record balance:', err)
      );
    }

    // Our ACTUAL cost for this one purchase - the exact amount Alrahuz's own
    // ledger moved, straight from their response. Preferred over any
    // pre-configured providerCostKobo (DataPlanPricing/ServicePricing) since
    // it can never drift out of sync with what we were really charged, and
    // it's the ONLY cost signal at all for airtime (which has no pricing
    // config table). Only set on a genuinely successful, well-formed
    // response - see the `succeeded` check below; a failed/malformed
    // response must not produce a bogus cost figure.
    const costKobo = this.actualCostFromBalanceDelta(body);

    if (!response.ok) {
      console.error(
        `[alrahuz] purchase failed (reference=${reference}, http=${response.status}):`,
        JSON.stringify(body)
      );
      return {
        status: false,
        providerRef: reference,
        message: this.isLikelyBalanceIssue(body)
          ? 'Service temporarily unavailable - please try again shortly'
          : (body.detail ?? body.api_response ?? `Provider returned HTTP ${response.status}`),
        costKobo: undefined
      };
    }

    const statusText = String(body.Status ?? body.status ?? '').toLowerCase();
    const succeeded = ['successful', 'success'].includes(statusText) || body.status === true;
    if (!succeeded) {
      console.error(`[alrahuz] purchase not successful (reference=${reference}):`, JSON.stringify(body));
    }

    return {
      status: succeeded,
      providerRef: body.ident ?? reference,
      message: succeeded
        ? (body.api_response ?? 'Transaction successful')
        : this.isLikelyBalanceIssue(body)
          ? 'Service temporarily unavailable - please try again shortly'
          : (body.api_response ?? `Provider status: ${body.Status ?? 'unknown'}`),
      costKobo: succeeded ? costKobo : undefined,
      raw: body
    };
  }

  /**
   * Derives our real cost for one purchase from Alrahuz's own before/after
   * balance figures on that same response (see the confirmed real /data/
   * response shape documented above ProviderResultPinInput - `balance_before:
   * "65.0"`, `balance_after: "40.0"`). Returns undefined (never a wrong
   * number) whenever either figure is missing, non-numeric, or the delta
   * isn't a sane positive amount - e.g. MOCK_PROVIDER mode returns neither
   * field at all, so this correctly yields "unknown" rather than a fabricated
   * zero or face-value guess.
   */
  private actualCostFromBalanceDelta(body: AlrahuzResponse): bigint | undefined {
    const before = this.numberValue(body.balance_before);
    const after = this.numberValue(body.balance_after);
    if (before === undefined || after === undefined) return undefined;

    const delta = before - after;
    if (!Number.isFinite(delta) || delta <= 0) return undefined;

    return BigInt(Math.round(delta * 100));
  }


  private async normalizeResultPin(response: Response, reference: string) {
    const body = (await response.json().catch(() => ({}))) as AlrahuzResponse;

    if (body.balance_after !== undefined) {
      await this.recordProviderBalance(body.balance_after).catch((err) =>
        console.error('[alrahuz-balance] failed to record balance:', err)
      );
    }

    if (!response.ok) {
      console.error(`[alrahuz] exam pin failed (reference=${reference}, http=${response.status}):`, JSON.stringify(body));
      return {
        status: false,
        providerRef: reference,
        message: body.detail ?? body.api_response ?? `Provider returned HTTP ${response.status}`,
        raw: body
      };
    }

    const statusText = String(body.Status ?? body.status ?? '').toLowerCase();
    const succeeded = ['successful', 'success'].includes(statusText) || body.status === true;
    if (!succeeded) {
      console.error(`[alrahuz] exam pin not successful (reference=${reference}):`, JSON.stringify(body));
    }

    const rawPins = body.pins ?? body.pin ?? (body.description as any)?.trueResponse;
    const pins = Array.isArray(rawPins)
      ? rawPins.map((item) => String(item))
      : rawPins && typeof rawPins === 'object'
        ? Object.values(rawPins as Record<string, unknown>).map((item) => String(item))
        : rawPins
          ? [String(rawPins)]
          : [];

    return {
      status: succeeded,
      providerRef: body.ident ?? String(body.id ?? reference),
      message: succeeded ? (body.api_response ?? 'Transaction successful') : (body.api_response ?? `Provider status: ${body.Status ?? body.status ?? 'unknown'}`),
      pin: pins[0],
      pins,
      serial: this.stringValue(body.serial ?? body.Serial ?? body.serial_number),
      raw: body
    };
  }
  /**
   * Keeps customer-facing messaging generic when the real cause is YOUR
   * Alrahuz balance running low - telling a customer "insufficient balance"
   * reads as their own wallet being the problem, which it isn't. The real
   * detail is always still logged above and captured in ProviderBalanceStatus
   * for you to see. Tighten this once you've seen a real low-balance failure
   * body and know Alrahuz's exact wording.
   */
  private isLikelyBalanceIssue(body: AlrahuzResponse) {
    const text = `${body.api_response ?? ''} ${body.detail ?? ''}`.toLowerCase();
    return text.includes('balance') || text.includes('insufficient') || text.includes('fund');
  }

  /**
   * Persists Alrahuz's own reported balance and fires a low-balance alert (a
   * log line, throttled by ALRAHUZ_LOW_BALANCE_ALERT_COOLDOWN_MINUTES so it
   * doesn't spam on every transaction once you're under the threshold).
   * Visible in the admin panel via ProviderBalanceStatus. Never throws - a
   * failure to record this must never break an actual purchase.
   */
  private async recordProviderBalance(rawBalance: unknown) {
    const balance =
      typeof rawBalance === 'number'
        ? rawBalance
        : typeof rawBalance === 'string'
          ? Number(rawBalance)
          : undefined;
    if (balance === undefined || !Number.isFinite(balance)) return null;

    const status = await prisma.providerBalanceStatus.upsert({
      where: { provider: 'alrahuz' },
      create: { provider: 'alrahuz', lastKnownBalance: balance },
      update: { lastKnownBalance: balance }
    });

    if (balance >= env.ALRAHUZ_LOW_BALANCE_THRESHOLD) return status;

    const cooldownMs = env.ALRAHUZ_LOW_BALANCE_ALERT_COOLDOWN_MINUTES * 60 * 1000;
    const alreadyAlerted =
      status.lowBalanceAlertSentAt && Date.now() - status.lowBalanceAlertSentAt.getTime() < cooldownMs;
    if (alreadyAlerted) return status;

    console.error(
      `[alrahuz-balance] LOW BALANCE ALERT: only NGN${balance} left at Alrahuz ` +
        `(threshold NGN${env.ALRAHUZ_LOW_BALANCE_THRESHOLD}) - top up now to avoid failed customer purchases.`
    );
    return prisma.providerBalanceStatus.update({
      where: { provider: 'alrahuz' },
      data: { lowBalanceAlertSentAt: new Date() }
    });
  }

  private findBalance(value: unknown): number | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const preferredKeys = ['balance', 'wallet_balance', 'account_balance', 'Account_Balance', 'user_balance', 'available_balance'];
    for (const key of preferredKeys) {
      const parsed = this.numberValue(record[key]);
      if (parsed !== undefined) return parsed;
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key.toLowerCase().includes('balance')) {
        const parsed = this.numberValue(nested);
        if (parsed !== undefined) return parsed;
      }
      const nestedBalance = this.findBalance(nested);
      if (nestedBalance !== undefined) return nestedBalance;
    }
    return undefined;
  }

  private headers() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Token ${env.ALRAHUZ_API_TOKEN ?? ''}`
    };
  }

  private async fetchLiveDataPlans(network: string, networkId: number, dataType?: string) {
    const path = env.ALRAHUZ_DATA_PLANS_PATH.replace('{network}', encodeURIComponent(String(networkId)))
      .replace('{networkName}', encodeURIComponent(network.toUpperCase()));
    const pathWithType = path.replace('{dataType}', encodeURIComponent(dataType ?? ''));
    const baseUrl = env.ALRAHUZ_BASE_URL.replace(/\/$/, '');
    const cleanPath = pathWithType.startsWith('/') ? pathWithType : `/${pathWithType}`;
    const url = new URL(`${baseUrl}${cleanPath}`);
    if (!env.ALRAHUZ_DATA_PLANS_PATH.includes('{network}')) {
      url.searchParams.set('network', String(networkId));
    }
    if (!env.ALRAHUZ_DATA_PLANS_PATH.includes('{dataType}') && dataType) {
      url.searchParams.set('data_type', dataType);
    }

    // Without an explicit timeout, a slow/hanging Alrahuz response used to
    // stall this request (and everyone else's, since getAllDataPlans() waits
    // on it before the cache is populated) for however long Node's default
    // socket timeout is. Capped at 8s: comfortably more than a normal
    // response, short enough that a genuinely stuck provider fails fast and
    // falls back to the static plan snapshot below instead of leaving the
    // user staring at a spinner.
    const bodies: unknown[] = [];
    let nextUrl: string | null = url.toString();
    for (let page = 0; nextUrl && page < 50; page += 1) {
      let response: Response;
      try {
        response = await fetch(nextUrl, { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      } catch (err) {
        console.error(`[provider] ${network} plans endpoint timed out or failed for ${nextUrl}:`, err);
        return [];
      }
      if (!response.ok) {
        console.error(`[provider] ${network} plans endpoint returned HTTP ${response.status} for ${nextUrl}`);
        return [];
      }
      const body = (await response.json().catch(() => null)) as unknown;
      bodies.push(body);
      if (!body || typeof body !== 'object') break;
      const candidate = (body as Record<string, unknown>).next;
      nextUrl = typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
    }
    const plans = bodies.flatMap((body) => this.extractPlans(body, networkId));

    // A count this low is almost always a parsing problem, not Alrahuz's real
    // catalog - log the raw shape so it's diagnosable from Railway logs
    // instead of guessing. Capped to keep log lines from getting enormous.
    if (plans.length <= 1) {
      console.warn(
        `[provider] ${network} (networkId=${networkId}): only extracted ${plans.length} plan(s) from ${url.toString()}. Raw response:`,
        JSON.stringify(bodies[bodies.length - 1]).slice(0, 4000)
      );
    }

    return plans;
  }

  private extractPlans(body: unknown, networkId: number): DataPlan[] {
    const list = this.findPlanArray(body);
    if (!list) return [];

    return list
      .map((item) => this.normalizePlan(item, networkId))
      .filter((plan): plan is DataPlan => Boolean(plan));
  }

  private findPlanArray(body: unknown): unknown[] | undefined {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return undefined;

    const record = body as Record<string, unknown>;
    for (const key of ['data', 'plans', 'results', 'plan', 'DataPlan']) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }

    // Alrahuz's own app UI groups plans by category (SME, GIFTING, SME2, DATA
    // SHARE, ...) - the plans endpoint may return that same shape: an object
    // whose values are each an array of plans, keyed by category name rather
    // than one of the generic keys checked above. Flatten all array values
    // found on the object as a fallback, so this isn't missed.
    const nestedArrays = Object.values(record).filter((value): value is unknown[] => Array.isArray(value));
    if (nestedArrays.length > 0) {
      return nestedArrays.flat();
    }

    return undefined;
  }

  private normalizePlan(item: unknown, fallbackNetworkId: number): DataPlan | undefined {
    if (!item || typeof item !== 'object') return undefined;
    const record = item as Record<string, unknown>;
    // /api/data/ is the provider's purchase/transaction endpoint, not a plan
    // catalog. Its rows contain mobile_number, Status and api_response. Never
    // mistake those historical transactions for sellable plans just because
    // they also contain a plan id and amount.
    if (record.mobile_number !== undefined || record.Status !== undefined || record.api_response !== undefined) {
      return undefined;
    }

    const id = this.stringValue(record.id ?? record.plan_id ?? record.plan);
    const amount = this.numberValue(record.amount ?? record.price ?? record.plan_amount);
    if (!id || !amount) return undefined;

    const networkId = this.numberValue(record.network ?? record.network_id ?? record.networkId) ?? fallbackNetworkId;
    if (networkId !== fallbackNetworkId) return undefined;

    const planType = this.stringValue(record.plan_type ?? record.type ?? record.category);
    const planName = this.stringValue(record.plan_name ?? record.name ?? record.data_size ?? record.size) || `Plan ${id}`;
    const validity = this.stringValue(record.validity ?? record.duration ?? record.validity_period) || 'Validity varies';
    const name = planType && !planName.toUpperCase().includes(planType.toUpperCase())
      ? `${planType} - ${planName}`
      : planName;

    return { networkId, id, name, amount, validity };
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }

  private numberValue(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }


  private examId(examType: ProviderResultPinInput['examType']) {
    switch (examType) {
      case 'WAEC':
        return env.ALRAHUZ_WAEC_EXAM_ID;
      case 'NECO':
        return env.ALRAHUZ_NECO_EXAM_ID;
      case 'NABTEB':
        return env.ALRAHUZ_NABTEB_EXAM_ID;
    }
  }
  private networkId(network: string) {
    const mapped = NETWORK_IDS[network.toUpperCase()];
    if (mapped) return mapped;

    const numeric = Number(network);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;

    throw new ApiError(422, `Unsupported network: ${network}`, 'UNSUPPORTED_NETWORK');
  }
}

export const providerService = new ProviderService();

