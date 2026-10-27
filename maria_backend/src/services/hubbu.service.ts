import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import type { TechhubSlipResult, TechhubSlipTier, TechhubBvnTier } from './techhub.service.js';

type HubbuResponse = {
  status?: string;
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

async function post(path: string, body: Record<string, unknown>): Promise<TechhubSlipResult & { downloadToken?: string }> {
  configured();
  let response: Response;
  try {
    response = await fetch(`${env.HUBBU_BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.HUBBU_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000)
    });
  } catch (error) {
    console.error('[hubbu] request failed:', error);
    return { ok: false, message: 'The verification service could not process this request right now.', raw: null };
  }
  let payload: HubbuResponse;
  try { payload = await response.json() as HubbuResponse; }
  catch { return { ok: false, message: 'The verification provider returned an invalid response.', raw: null }; }
  const data = payload.data ?? {};
  const ok = response.ok && payload.status?.toLowerCase() === 'success';
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
  ninByNin(nin: string, slipType: TechhubSlipTier) {
    return post('/nin/verify', { method: 'nin', nin, slip_type: tier(slipType) });
  },
  ninByPhone(phone: string, slipType: TechhubSlipTier) {
    return post('/nin/verify', { method: 'phone', phone, slip_type: tier(slipType) });
  },
  ninByDemographic(input: { first_name: string; last_name: string; dob: string; gender: string }) {
    return post('/nin/verify', { method: 'demo', ...input, slip_type: 'premium' });
  },
  bvnSlip(bvn: string, slipType: TechhubBvnTier) {
    return post('/bvn/verify', { bvn, slip_type: tier(slipType) });
  }
};
