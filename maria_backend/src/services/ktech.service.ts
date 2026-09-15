import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import type { TechhubSlipResult, TechhubSlipTier, TechhubBvnTier } from './techhub.service.js';

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
