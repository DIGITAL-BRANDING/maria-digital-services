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
  let response: Response;
  try {
    response = await fetch(`${env.HUBBU_BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.HUBBU_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000)
    });
  } catch (error) {
    console.error('[hubbu] network request failed', { path, method: context.method ?? body.method, reference: context.reference, error });
    return { ok: false, message: 'The verification service could not process this request right now.', raw: null };
  }
  let payload: HubbuResponse;
  try { payload = await response.json() as HubbuResponse; }
  catch {
    console.error('[hubbu] invalid JSON response', { path, method: context.method ?? body.method, reference: context.reference, httpStatus: response.status });
    return { ok: false, message: 'The verification provider returned an invalid response.', raw: null };
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
    const response = await fetch(`${env.HUBBU_BASE_URL.replace(/\/$/, '')}/slips/download?file=${encodeURIComponent(fileToken)}`, {
      headers: { 'X-API-KEY': env.HUBBU_API_KEY! }, signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`Hubbu slip download returned HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
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
