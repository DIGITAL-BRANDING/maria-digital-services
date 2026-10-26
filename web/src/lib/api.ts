// Thin fetch wrapper for the MARIA Digital Solutions backend API.
// In dev, requests to /api/* are proxied to VITE_API_PROXY_TARGET (see vite.config.ts).
// In production, use the Railway backend on the primary domain by default.
// VITE_API_BASE_URL can override this for previews or another backend host.
const DEFAULT_API_BASE = import.meta.env.PROD ? 'https://mariadigital.com.ng' : '';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE).trim().replace(/\/+$/, '');

const TOKEN_KEY = 'mdl_access_token';
const REFRESH_KEY = 'mdl_refresh_token';

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
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
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
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
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'POST', body, auth }),
  document: async (path: string) => {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { message = ((await res.json()) as { message?: string }).message ?? message; } catch { /* non-JSON error */ }
      throw new ApiError(message, res.status);
    }
    return res.blob();
  },
};

