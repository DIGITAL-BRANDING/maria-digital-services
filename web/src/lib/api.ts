// Thin fetch wrapper for the MARIA Digital Solutions backend API.
// In dev, requests to /api/* are proxied to VITE_API_PROXY_TARGET (see vite.config.ts).
// In production, set VITE_API_BASE_URL to the deployed backend origin
// (leave empty if this app is served from the same origin as the API).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

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
};

