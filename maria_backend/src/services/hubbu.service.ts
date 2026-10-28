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

function configured() {
  if (!env.HUBBU_API_KEY) throw new ApiError(503, 'Hubbu verification provider is not configured.', 'PROVIDER_NOT_CONFIGURED');
}

async function post(
  path: string,
  body: Record<string, unknown>,
  context: { reference?: string; method?: string } = {}
): Promise<TechhubSlipResult & { downloadToken?: string }> {
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
    const ambiguous = response.ok;
    return { ok: false, ambiguous, message: ambiguous
      ? 'Hubbu may have completed this request, but returned an unreadable response. Check your transaction history before trying again.'
      : 'The verification provider returned an invalid response.', raw: null };
  }
  const payload = asRecord(rawPayload);
  if (!payload) {
    const ambiguous = response.ok;
    console.error('[hubbu] unexpected response body', { path, method: context.method ?? body.method, reference: context.reference, httpStatus: response.status, bodyType: rawPayload === null ? 'null' : Array.isArray(rawPayload) ? 'array' : typeof rawPayload, elapsedMs: Date.now() - startedAt });
    return { ok: false, ambiguous, message: ambiguous
      ? 'Hubbu may have completed this request, but returned an empty or unexpected response. Check your transaction history before trying again.'
      : 'The verification provider returned an invalid response.', raw: rawPayload };
  }
  const data = payload.data ?? {};
  const providerSucceeded = payload.status === true || (typeof payload.status === 'string' && payload.status.toLowerCase() === 'success');
  const ok = response.ok && providerSucceeded;
  const downloadUrl = typeof data.download_url === 'string' ? data.download_url : undefined;
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
  return {
    ok,
    message: payload.message || (ok ? 'Verification successful' : 'The verification provider could not complete this request.'),
    userData: data.result,
    pdfBase64: typeof data.pdf_base64 === 'string' ? data.pdf_base64 : undefined,
    downloadToken: typeof data.download_url === 'string' ? (() => {
      try { return new URL(data.download_url!, env.HUBBU_BASE_URL).searchParams.get('file') ?? data.download_url!; }
      catch { return data.download_url!; }
    })() : undefined,
    raw: payload
  };
}

function tier(value: TechhubSlipTier | TechhubBvnTier) {
  return value;
}

export const hubbuService = {
  assertConfigured: configured,
  async downloadSlip(fileToken: string) {
    configured();
    const baseUrl = env.HUBBU_BASE_URL.replace(/\/$/, '');
    let downloadUrl: URL;
    try {
      const suppliedUrl = new URL(fileToken, `${baseUrl}/`);
      const base = new URL(baseUrl);
      // Hubbu sometimes returns a complete download URL, sometimes only the
      // opaque `file` token. Preserve its query string when it's a same-host
      // Hubbu download link; never send the API key to another host.
      if (suppliedUrl.origin === base.origin && /\/slips\/download\/?$/.test(suppliedUrl.pathname)) {
        downloadUrl = suppliedUrl;
      } else if (/^https?:\/\//i.test(fileToken)) {
        throw new Error('Hubbu returned an unsupported slip download URL');
      } else {
        downloadUrl = new URL(`${baseUrl}/slips/download?file=${encodeURIComponent(fileToken)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('unsupported')) throw error;
      downloadUrl = new URL(`${baseUrl}/slips/download?file=${encodeURIComponent(fileToken)}`);
    }

    const response = await fetch(downloadUrl, {
      headers: { 'X-API-KEY': env.HUBBU_API_KEY! }, signal: AbortSignal.timeout(45_000)
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
