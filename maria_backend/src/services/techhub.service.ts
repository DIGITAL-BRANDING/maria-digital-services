import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';

/**
 * Techhubltd — NIN / BVN identity verification provider.
 *
 * Completely independent of provider.service.ts (Alrahuz, which handles
 * VTU: data/airtime/result pins). Two providers, two services, matching
 * the split the app is built around:
 *   - Alrahuz  -> data / airtime / recharge card / result pins
 *   - Techhub  -> NIN / BVN identity verification
 *
 * Two families of endpoint here, both documented at
 * https://techhubltd.co/documentation.php:
 *
 *  1. Slip lookups (synchronous) - one POST, one PDF back immediately.
 *     Response: {"status":"success"|"error", "response_code", "message",
 *     "user_data"?, "pdf_base64"?, "error_code"?}.
 *
 *  2. Async services (Delinking, NIN Validation, Personalization,
 *     BVN Retrieval, IPE Clearance) - submit now, an admin at Techhub
 *     processes it later, poll for the outcome with the returned ticket_id.
 *     Submit response: {"success":true, "ticket_id", "status":"pending",
 *     "amount_charged", "balance", ...}.
 *     Status response: {"success":true, "ticket_id", "status", "response",
 *     "created_at"}.
 *
 * Note the inconsistent field name Techhub itself uses: slip endpoints key
 * their success flag off `status` (a *string*, "success"/"error"); the five
 * async endpoints key it off `success` (a *boolean*). Not a typo here -
 * mirrors their actual API, see the Error Handling section of the docs.
 */

export type TechhubSlipTier = 'premium' | 'standard' | 'regular' | 'vnin';
export type TechhubBvnTier = 'premium' | 'standard';

type TechhubSlipResponse = {
  status?: string | boolean;
  success?: boolean;
  response_code?: string;
  message?: string;
  error_code?: string;
  user_data?: Record<string, unknown>;
  pdf_base64?: string;
  pdf_url?: string;
  slip_url?: string;
  data?: {
    user_data?: Record<string, unknown>;
    pdf_base64?: string;
    pdf_url?: string;
    slip_url?: string;
    [key: string]: unknown;
  };
};

type TechhubAsyncSubmitResponse = {
  success?: boolean;
  message?: string;
  transaction_id?: string;
  ticket_id?: string;
  status?: string;
  amount_charged?: number;
  balance?: number;
};

type TechhubAsyncStatusResponse = {
  success?: boolean;
  message?: string;
  ticket_id?: string;
  status?: string;
  response?: Record<string, unknown> | null;
  created_at?: string;
};

export type TechhubSlipResult = {
  ok: boolean;
  message: string;
  userData?: Record<string, unknown>;
  pdfBase64?: string;
  pdfUrl?: string;
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstNonEmptyString(records: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  }
  return undefined;
}

export type TechhubAsyncSubmitResult = {
  ok: boolean;
  ticketId?: string;
  message: string;
  raw: unknown;
};

export type TechhubAsyncStatus = 'pending' | 'success' | 'failed';

export type TechhubAsyncStatusResult = {
  ticketId: string;
  status: TechhubAsyncStatus;
  response: Record<string, unknown> | null;
  raw: unknown;
};

// Tier -> filename, exactly as documented. VNIN has no "by phone" equivalent
// (frontend already reflects this - see SlipTier.availableFor in
// verification_provider.dart) and BVN only ever had two tiers.
const NIN_BY_NIN_PATH: Record<TechhubSlipTier, string> = {
  premium: 'nin_by_nin.php',
  standard: 'nin_standard_slip.php',
  regular: 'nin_regular_slip.php',
  vnin: 'vnin_slip.php'
};

const NIN_BY_PHONE_PATH: Record<Exclude<TechhubSlipTier, 'vnin'>, string> = {
  premium: 'nin_by_phone_premium.php',
  standard: 'nin_by_phone_standard.php',
  regular: 'nin_by_phone_regular.php'
};

// Confirmed against https://techhubltd.co/documentation.php#sec-bvn:
// Premium -> bvn_premium_slip.php, Standard -> bvn_full_details_slip.php.
// (Standard was previously guessed as 'bvn_standard_slip.php', following
// the naming pattern every other tiered endpoint above uses - that guess
// was wrong and caused every BVN Standard slip request to 404.)
const BVN_SLIP_PATH: Record<TechhubBvnTier, string> = {
  premium: 'bvn_premium_slip.php',
  standard: 'bvn_full_details_slip.php'
};

function mockPdfBase64() {
  // Not a real PDF - just enough for MOCK_TECHHUB=true dev/staging runs to
  // exercise the save/share/print code paths without a live Techhub key.
  return Buffer.from('%PDF-1.4\n% MAJOR DATA-LINK mock slip - MOCK_TECHHUB is on\n').toString('base64');
}

export class TechhubService {
  private baseUrl() {
    return env.TECHHUB_BASE_URL.replace(/\/$/, '');
  }

  private apiKey() {
    if (!env.TECHHUB_API_KEY) {
      throw new ApiError(500, 'Techhub API key is not configured', 'TECHHUB_NOT_CONFIGURED');
    }
    return env.TECHHUB_API_KEY;
  }

  // ---- Slip lookups (synchronous) ----

  async ninByNin(nin: string, tier: TechhubSlipTier) {
    return this.postSlip(NIN_BY_NIN_PATH[tier], { nin });
  }

  async ninByPhone(phone: string, tier: Exclude<TechhubSlipTier, 'vnin'>) {
    return this.postSlip(NIN_BY_PHONE_PATH[tier], { phone });
  }

  async ninByDemographic(params: { firstname: string; lastname: string; dob: string; gender?: string }) {
    return this.postSlip('nin_by_demo.php', params);
  }

  async bvnSlip(bvn: string, tier: TechhubBvnTier) {
    return this.postSlip(BVN_SLIP_PATH[tier], { bvn });
  }

  private async postSlip(path: string, body: Record<string, unknown>): Promise<TechhubSlipResult> {
    if (env.MOCK_TECHHUB) {
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
      response = await fetch(`${this.baseUrl()}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey(), ...body })
      });
    } catch (error) {
      console.error(`[techhub] network error calling ${path}:`, error);
      return { ok: false, message: 'Could not reach the verification provider - please try again shortly', raw: null };
    }

    const data = (await response.json().catch(() => ({}))) as TechhubSlipResponse;

    // Techhub has returned both "success" and "successful" from its
    // dashboard/API over time.  Treat either spelling (and a boolean
    // `success: true`) as a completed, chargeable request.  A mismatch here
    // used to trigger a wallet refund even when Techhub had already produced
    // and charged for a Premium slip.
    const providerStatus = typeof data.status === 'string' ? data.status.trim().toLowerCase() : data.status;
    const isSuccess =
      data.success === true ||
      providerStatus === true ||
      providerStatus === 'success' ||
      providerStatus === 'successful';

    if (!response.ok || !isSuccess) {
      console.error(`[techhub] slip lookup failed (path=${path}, http=${response.status}):`, JSON.stringify(data));
      return {
        ok: false,
        message: data.message ?? `Verification provider returned HTTP ${response.status}`,
        raw: data
      };
    }

    const nested = data.data;
    // Premium-slip responses have appeared in both shapes below:
    // { pdf_base64: ... } and { user_data: { pdf_base64: ... } }. The latter
    // must become a downloadable document, not a raw field in the UI.
    const userData = data.user_data ?? nested?.user_data ?? nested;
    const userDataRecord = asRecord(userData);
    const records = [data as Record<string, unknown>, nested, userDataRecord];
    const pdfBase64 = firstNonEmptyString(records, ['pdf_base64', 'pdf', 'pdf_data']);
    // Some Techhub slip variants return a ready-to-download URL instead of
    // embedding the PDF.  Preserve it for the user dashboard rather than
    // showing a misleading success without a document.
    const pdfUrl = firstNonEmptyString(records, ['pdf_url', 'slip_url', 'download_url']);

    return {
      ok: true,
      message: data.message ?? 'PDF generated successfully',
      userData: userDataRecord,
      pdfBase64,
      pdfUrl,
      raw: data
    };
  }

  // ---- Async services (submit + poll) ----

  async submitDelinking(nin: string, email: string) {
    return this.postAsync('delinking.php', { nin, email });
  }
  async checkDelinking(ticketId: string) {
    return this.getAsync('delinking.php', ticketId);
  }

  async submitNinValidation(nin: string, validationType?: string) {
    return this.postAsync('nin_validation.php', {
      nin,
      ...(validationType ? { validation_type: validationType } : {})
    });
  }
  async checkNinValidation(ticketId: string) {
    return this.getAsync('nin_validation.php', ticketId);
  }

  async submitPersonalization(trackingId: string) {
    return this.postAsync('personalization.php', { tracking_id: trackingId });
  }
  async checkPersonalization(ticketId: string) {
    return this.getAsync('personalization.php', ticketId);
  }

  async submitBvnRetrieval(params: { first_name: string; last_name: string; phone_number: string }) {
    return this.postAsync('bvn_retrieval.php', params);
  }
  async checkBvnRetrieval(ticketId: string) {
    return this.getAsync('bvn_retrieval.php', ticketId);
  }

  async submitIpeClearance(trackingId: string) {
    return this.postAsync('ipe_clearance.php', { tracking_id: trackingId });
  }
  async checkIpeClearance(ticketId: string) {
    return this.getAsync('ipe_clearance.php', ticketId);
  }

  /**
   * Returns a boolean-flagged result rather than throwing on failure -
   * mirrors provider.service.ts's normalize()/normalizeResultPin(), since
   * the caller (verification.service.ts) needs to decide whether to refund
   * the user's wallet, not just propagate an exception.
   */
  private async postAsync(path: string, body: Record<string, unknown>): Promise<TechhubAsyncSubmitResult> {
    if (env.MOCK_TECHHUB) {
      return { ok: true, ticketId: `MOCK-${Date.now()}`, message: 'Request submitted successfully (mock)', raw: { mock: true } };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey(), ...body })
      });
    } catch (error) {
      console.error(`[techhub] network error calling ${path}:`, error);
      return { ok: false, message: 'Could not reach the verification provider - please try again shortly', raw: null };
    }

    const data = (await response.json().catch(() => ({}))) as TechhubAsyncSubmitResponse;

    if (data.balance !== undefined) {
      this.recordProviderBalance(data.balance).catch((err) =>
        console.error('[techhub-balance] failed to record balance:', err)
      );
    }

    if (!response.ok || data.success !== true || !data.ticket_id) {
      console.error(`[techhub] async submit failed (path=${path}, http=${response.status}):`, JSON.stringify(data));
      return {
        ok: false,
        message: data.message ?? `Verification provider returned HTTP ${response.status}`,
        raw: data
      };
    }

    return { ok: true, ticketId: data.ticket_id, message: data.message ?? 'Request submitted successfully', raw: data };
  }

  /**
   * Persists Techhub's own reported balance (returned on every async-submit
   * call — see TechhubAsyncSubmitResponse.balance above) and fires a
   * low-balance alert, same pattern and same reasoning as
   * provider.service.ts's recordProviderBalance for Alrahuz. Visible in the
   * admin panel via ProviderBalanceStatus, keyed by provider: 'techhub' so
   * it shows up alongside the existing Alrahuz row rather than overwriting
   * it. Never throws — a failure to record this must never break an actual
   * verification request.
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
      where: { provider: 'techhub' },
      create: { provider: 'techhub', lastKnownBalance: balance },
      update: { lastKnownBalance: balance }
    });

    if (balance >= env.TECHHUB_LOW_BALANCE_THRESHOLD) return status;

    const cooldownMs = env.TECHHUB_LOW_BALANCE_ALERT_COOLDOWN_MINUTES * 60 * 1000;
    const alreadyAlerted =
      status.lowBalanceAlertSentAt && Date.now() - status.lowBalanceAlertSentAt.getTime() < cooldownMs;
    if (alreadyAlerted) return status;

    console.error(
      `[techhub-balance] LOW BALANCE ALERT: only NGN${balance} left at Techhub ` +
        `(threshold NGN${env.TECHHUB_LOW_BALANCE_THRESHOLD}) - top up now to avoid failed verification requests.`
    );
    return prisma.providerBalanceStatus.update({
      where: { provider: 'techhub' },
      data: { lowBalanceAlertSentAt: new Date() }
    });
  }

  /**
   * Unlike submit, a failed status check IS thrown as an ApiError - it can
   * only fail here because of a bad/unknown ticket_id or a transient
   * provider error, neither of which involves a wallet debit/refund
   * decision, so there's nothing for the caller to conditionally do with a
   * boolean result. The route handler's express-async-errors + errorHandler
   * turns this straight into the right HTTP response.
   */
  private async getAsync(path: string, ticketId: string): Promise<TechhubAsyncStatusResult> {
    if (env.MOCK_TECHHUB) {
      return {
        ticketId,
        status: 'success',
        response: { note: 'Auto-approved - MOCK_TECHHUB is on' },
        raw: { mock: true }
      };
    }

    const url = new URL(`${this.baseUrl()}/${path}`);
    url.searchParams.set('api_key', this.apiKey());
    url.searchParams.set('ticket_id', ticketId);

    let response: Response;
    try {
      response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      console.error(`[techhub] network error checking ${path} (ticket=${ticketId}):`, error);
      throw new ApiError(502, 'Could not reach the verification provider - please try again shortly', 'TECHHUB_UNREACHABLE');
    }

    const data = (await response.json().catch(() => ({}))) as TechhubAsyncStatusResponse;

    if (response.status === 404) {
      throw new ApiError(404, 'Unknown ticket_id', 'TICKET_NOT_FOUND');
    }
    if (!response.ok) {
      console.error(`[techhub] status check failed (path=${path}, ticket=${ticketId}, http=${response.status}):`, JSON.stringify(data));
      throw new ApiError(502, data.message ?? `Verification provider returned HTTP ${response.status}`, 'TECHHUB_STATUS_FAILED');
    }

    const status: TechhubAsyncStatus = data.status === 'success' || data.status === 'failed' ? data.status : 'pending';
    return { ticketId: data.ticket_id ?? ticketId, status, response: data.response ?? null, raw: data };
  }
}

export const techhubService = new TechhubService();
