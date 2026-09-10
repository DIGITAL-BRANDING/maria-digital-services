import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';

type SupabaseJwtPayload = {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
};

function base64UrlJson(value: string) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
}

function assertSupabaseJwtSecret() {
  if (!env.SUPABASE_JWT_SECRET) {
    throw new ApiError(500, 'SUPABASE_JWT_SECRET is required for Supabase auth', 'AUTH_NOT_CONFIGURED');
  }
  return env.SUPABASE_JWT_SECRET;
}

export function verifySupabaseAccessToken(token: string): SupabaseJwtPayload & { sub: string; exp: number } {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new ApiError(401, 'Invalid Supabase auth token', 'INVALID_TOKEN');
  }

  const header = base64UrlJson(encodedHeader) as { alg?: string };
  if (header.alg !== 'HS256') {
    throw new ApiError(401, 'Unsupported Supabase token algorithm', 'INVALID_TOKEN_ALGORITHM');
  }

  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto
    .createHmac('sha256', assertSupabaseJwtSecret())
    .update(unsigned)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new ApiError(401, 'Invalid Supabase auth token', 'INVALID_TOKEN');
  }

  const payload = base64UrlJson(encodedPayload) as SupabaseJwtPayload;
  if (!payload.sub) {
    throw new ApiError(401, 'Supabase auth token is missing a user id', 'INVALID_TOKEN_SUBJECT');
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'Supabase auth token expired', 'TOKEN_EXPIRED');
  }

  return payload as SupabaseJwtPayload & { sub: string; exp: number };
}

export function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}
