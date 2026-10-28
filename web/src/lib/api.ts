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
  options: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number; idempotencyKey?: string } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 20_000, idempotencyKey } = options;

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
  } finally {
    timeout.clear();
  }
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = true, timeoutMs = 20_000, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, auth, timeoutMs, idempotencyKey }),
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

