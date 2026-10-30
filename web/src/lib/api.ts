// Thin fetch wrapper for the MARIA Digital Solutions backend API.
// In dev, requests to /api/* are proxied to VITE_API_PROXY_TARGET (see vite.config.ts).
// In production, use the Railway backend on the primary domain by default.
// VITE_API_BASE_URL can override this for previews or another backend host.
const DEFAULT_API_BASE = import.meta.env.PROD ? 'https://mariadigital.com.ng' : '';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE).trim().replace(/\/+$/, '');

const TOKEN_KEY = 'mdl_access_token';
const REFRESH_KEY = 'mdl_refresh_token';
let memoryAccessToken: string | null = null;

function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* Continue with in-memory credentials when browser storage is blocked. */ }
}

function timeoutSignal(timeoutMs: number): { signal?: AbortSignal; clear: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), clear: () => undefined };
  }
  if (typeof AbortController === 'undefined') return { clear: () => undefined };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

export function getAccessToken() {
  return memoryAccessToken ?? readStorage(TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  memoryAccessToken = accessToken;
  writeStorage(TOKEN_KEY, accessToken);
  writeStorage(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  memoryAccessToken = null;
  writeStorage(TOKEN_KEY, null);
  writeStorage(REFRESH_KEY, null);
}

/** Slip/verification calls can legitimately take over a minute at the provider. */
export const SLIP_REQUEST_TIMEOUT_MS = 110_000;

export const REQUEST_INTERRUPTED = 'REQUEST_INTERRUPTED';

export const INTERRUPTED_MESSAGE =
  'This is taking longer than usual, but your request may still complete. Please do NOT submit it again - check "Recent requests" below in a minute (it refreshes automatically), and your document will appear there once it is ready.';

/** Browsers word a cancelled/timed-out fetch differently ("The user aborted a request", "signal timed out", "Load failed"...). */
function isInterruption(error: unknown) {
  if (!(error instanceof Error) || error instanceof ApiError) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError';
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number; idempotencyKey?: string; interruptible?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 20_000, idempotencyKey, interruptible = false } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const timeout = timeoutSignal(timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(timeout.signal ? { signal: timeout.signal } : {})
    });

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // non-JSON response body — leave payload null
    }

    if (!res.ok) {
      const message =
        (payload as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
      const code = (payload as { code?: string } | null)?.code;
      throw new ApiError(message, res.status, code);
    }

    return payload as T;
  } catch (error) {
    // The request may well have reached the server and succeeded - never show
    // the browser's raw "user aborted a request" wording as if it had failed.
    if (interruptible && isInterruption(error)) throw new ApiError(INTERRUPTED_MESSAGE, 0, REQUEST_INTERRUPTED);
    throw error;
  } finally {
    timeout.clear();
  }
}

/** True when a request was cut off on our side (timeout/network) - the outcome is unknown, not a failure. */
export function wasInterrupted(error: unknown) {
  return error instanceof ApiError && error.code === REQUEST_INTERRUPTED;
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = true, timeoutMs = 20_000, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, auth, timeoutMs, idempotencyKey }),
  /**
   * For purchases that call a slow upstream provider (NIN/BVN slips...): waits
   * long enough for the provider, and reports a cut-off as "outcome unknown"
   * (see wasInterrupted) rather than a failure.
   */
  postSlip: <T>(path: string, body: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, timeoutMs: SLIP_REQUEST_TIMEOUT_MS, idempotencyKey, interruptible: true }),
  document: async (path: string) => {
    const token = getAccessToken();
    const timeout = timeoutSignal(90_000);
    try {
      const res = await fetch(`${API_BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(timeout.signal ? { signal: timeout.signal } : {}) });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try { message = ((await res.json()) as { message?: string }).message ?? message; } catch { /* non-JSON error */ }
        throw new ApiError(message, res.status);
      }
      return res.blob();
    } finally {
      timeout.clear();
    }
  },
};

