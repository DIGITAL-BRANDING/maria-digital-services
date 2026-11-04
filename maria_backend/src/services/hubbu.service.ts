import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import type { TechhubSlipResult, TechhubSlipTier, TechhubBvnTier } from './techhub.service.js';

type HubbuResponse = {
  status?: string | boolean;
  message?: string;
  code?: string;
  data?: {
    price?: number;
    pdf_base64?: string | null;
    download_url?: string | null;
    result?: Record<string, unknown>;
  };
};

function asRecord(value: unknown): HubbuResponse | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as HubbuResponse
    : undefined;
}

/** Provider statuses that mean "accepted, still working" - never a rejection. */
const IN_PROGRESS_STATUSES = new Set(['pending', 'processing', 'queued', 'in_progress', 'in-progress', 'submitted', 'accepted', 'awaiting']);
/** Statuses the provider uses when it deliberately rejected the request. */
const REJECTED_STATUSES = new Set(['error', 'failed', 'failure', 'rejected', 'declined']);
const IN_PROGRESS_MESSAGE = 'Your request is still being processed by the provider. It will appear under Recent requests as soon as it completes - please do not submit it again yet.';

/** A gateway/proxy error (502/504/524...) says nothing about whether the provider finished the job. */
function isGatewayFailure(httpStatus: number) {
  return httpStatus >= 500 || httpStatus === 408;
}

function configured() {
  if (!env.HUBBU_API_KEY) throw new ApiError(503, 'Hubbu verification provider is not configured.', 'PROVIDER_NOT_CONFIGURED');
}

async function post(
  path: string,
  body: Record<string, unknown>,
  context: { reference?: string; method?: string } = {}
): Promise<TechhubSlipResult & { downloadToken?: string; downloadUrl?: string }> {
  configured();
  const requestFields = Object.keys(body).filter((key) => !['nin', 'phone', 'bvn', 'first_name', 'last_name', 'dob'].includes(key));
  console.info('[hubbu] request started', {
    path,
    method: context.method ?? (typeof body.method === 'string' ? body.method : undefined),
    reference: context.reference,
    fields: requestFields
  });
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${env.HUBBU_BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.HUBBU_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000)
    });
  } catch (error) {
    console.error('[hubbu] network request failed', { path, method: context.method ?? body.method, reference: context.reference, elapsedMs: Date.now() - startedAt, error });
    return { ok: false, ambiguous: true, message: 'Hubbu may have completed this request, but our server did not receive its response. Check your transaction history before trying again.', raw: null };
  }
  let rawPayload: unknown;
  try { rawPayload = await response.json(); }
  catch {
    console.error('[hubbu] invalid JSON response', { path, method: context.method ?? body.method, reference: context.reference, httpStatus: response.status, elapsedMs: Date.now() - startedAt });
    const ambiguous = response.ok || isGatewayFailure(response.status);
    return { ok: false, ambiguous, message: ambiguous
      ? 'Hubbu may have completed this request, but returned an unreadable response. Check your transaction history before trying again.'
      : 'The verification provider returned an invalid response.', raw: null };
  }
  const payload = asRecord(rawPayload);
  if (!payload) {
    const ambiguous = response.ok || isGatewayFailure(response.status);
    console.error('[hubbu] unexpected response body', { path, method: context.method ?? body.method, reference: context.reference, httpStatus: response.status, bodyType: rawPayload === null ? 'null' : Array.isArray(rawPayload) ? 'array' : typeof rawPayload, elapsedMs: Date.now() - startedAt });
    return { ok: false, ambiguous, message: ambiguous
      ? 'Hubbu may have completed this request, but returned an empty or unexpected response. Check your transaction history before trying again.'
      : 'The verification provider returned an invalid response.', raw: rawPayload };
  }
  const data = payload.data ?? {};
  const providerSucceeded = payload.status === true || (typeof payload.status === 'string' && payload.status.toLowerCase() === 'success');
  const ok = response.ok && providerSucceeded;
  const statusText = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
  const explicitlyRejected = payload.status === false || REJECTED_STATUSES.has(statusText);
  // Never refund (and tell the customer "failed") when the provider only said
  // "pending/processing", or when a gateway error hides the real outcome - the
  // slip may well be delivered a moment later. Those stay PENDING for reconciliation.
  const inProgress = !ok && !explicitlyRejected && (IN_PROGRESS_STATUSES.has(statusText) || isGatewayFailure(response.status));
  const rawDownload = typeof data.download_url === 'string' && data.download_url.trim() ? data.download_url.trim() : undefined;
  const downloadUrl = rawDownload ? resolveDownloadUrl(rawDownload) : undefined;
  console.info('[hubbu] response received', {
    path,
    method: context.method ?? (typeof body.method === 'string' ? body.method : undefined),
    reference: context.reference,
    httpStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    providerStatus: payload.status,
    providerCode: payload.code,
    ok,
    hasResult: Boolean(data.result && Object.keys(data.result).length),
    hasPdf: typeof data.pdf_base64 === 'string' && data.pdf_base64.length > 0,
    hasDownloadUrl: Boolean(downloadUrl)
  });
  if (!ok) {
    console.error('[hubbu] verification rejected', {
      path,
      method: context.method ?? body.method,
      reference: context.reference,
      httpStatus: response.status,
      providerStatus: payload.status,
      providerCode: payload.code,
      message: payload.message
    });
  }
  if (inProgress) {
    return { ok: false, ambiguous: true, message: IN_PROGRESS_MESSAGE, raw: payload };
  }
  return {
    ok,
    message: payload.message || (ok ? 'Verification successful' : 'The verification provider could not complete this request.'),
    userData: data.result,
    pdfBase64: typeof data.pdf_base64 === 'string' ? data.pdf_base64 : undefined,
    // Keep the link exactly as Hubbu sent it (relative path, full URL or opaque
    // token). downloadSlip() works out how to fetch each form; stripping it down
    // to a `file` query value here used to lose the path and 502 later.
    downloadToken: rawDownload,
    downloadUrl,
    raw: payload
  };
}

/** Resolves Hubbu's download link against its base URL; undefined if it cannot be parsed. */
function resolveDownloadUrl(value: string): string | undefined {
  try {
    return new URL(value, `${env.HUBBU_BASE_URL.replace(/\/$/, '')}/`).toString();
  } catch {
    return undefined;
  }
}

function tier(value: TechhubSlipTier | TechhubBvnTier) {
  return value;
}

export const hubbuService = {
  assertConfigured: configured,
  /**
   * Fetches a slip PDF from Hubbu. `source` is whatever Hubbu returned: a full
   * URL, a path starting with "/", or an opaque `file` token. The API key is
   * only ever sent to Hubbu's own origin.
   */
  async downloadSlip(source: string, timeoutMs = 45_000) {
    configured();
    const baseUrl = env.HUBBU_BASE_URL.replace(/\/$/, '');
    const base = new URL(baseUrl);
    let downloadUrl: URL;
    if (/^https?:\/\//i.test(source) || source.startsWith('/')) {
      downloadUrl = new URL(source, `${baseUrl}/`);
      if (downloadUrl.origin !== base.origin) {
        throw new Error('Hubbu returned an unsupported slip download URL');
      }
    } else {
      downloadUrl = new URL(`${baseUrl}/slips/download?file=${encodeURIComponent(source)}`);
    }

    const response = await fetch(downloadUrl, {
      headers: { 'X-API-KEY': env.HUBBU_API_KEY! }, signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      console.error('[hubbu] slip download rejected', { httpStatus: response.status, contentType: response.headers.get('content-type') });
      throw new Error(`Hubbu slip download returned HTTP ${response.status}`);
    }
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      console.error('[hubbu] slip download response was not a PDF', { contentType: response.headers.get('content-type'), bytes: pdf.length });
      throw new Error('Hubbu returned a non-PDF response for the slip download');
    }
    return pdf;
  },
  ninByNin(nin: string, slipType: TechhubSlipTier, reference?: string) {
    return post('/nin/verify', { method: 'nin', nin, slip_type: tier(slipType) }, { reference, method: 'nin' });
  },
  ninByPhone(phone: string, slipType: TechhubSlipTier, reference?: string) {
    return post('/nin/verify', { method: 'phone', phone, slip_type: tier(slipType) }, { reference, method: 'phone' });
  },
  ninByDemographic(input: { first_name: string; last_name: string; dob: string; gender: string }) {
    return post('/nin/verify', { method: 'demo', ...input, slip_type: 'premium' });
  },
  bvnSlip(bvn: string, slipType: TechhubBvnTier) {
    return post('/bvn/verify', { bvn, slip_type: tier(slipType) });
  }
};
