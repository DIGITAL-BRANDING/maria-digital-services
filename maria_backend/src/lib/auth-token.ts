import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { prisma } from './prisma.js';

type TokenType = 'access' | 'refresh';

type TokenPayload = {
  sub: string;
  email: string;
  type: TokenType;
  exp: number;
  iat: number;
};

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string) {
  return crypto.createHmac('sha256', env.AUTH_TOKEN_SECRET).update(data).digest('base64url');
}

/** Refresh tokens are stored hashed (never in plaintext) so a DB leak alone can't be used to log in as anyone. */
function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createAuthToken(params: {
  userId: string;
  email: string;
  type: TokenType;
  ttlSeconds: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: params.userId,
      email: params.email,
      type: params.type,
      iat: now,
      exp: now + params.ttlSeconds
    } satisfies TokenPayload)
  );
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyAuthToken(token: string, expectedType: TokenType) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    throw new ApiError(401, 'Invalid auth token', 'INVALID_TOKEN');
  }

  const unsigned = `${header}.${payload}`;
  const expected = sign(unsigned);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new ApiError(401, 'Invalid auth token', 'INVALID_TOKEN');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
  if (decoded.type !== expectedType) {
    throw new ApiError(401, 'Invalid token type', 'INVALID_TOKEN_TYPE');
  }
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'Auth token expired', 'TOKEN_EXPIRED');
  }

  return decoded;
}

/**
 * Issues a fresh access+refresh token pair and persists a hash of the refresh token,
 * so it can be looked up and revoked later (on logout, or if it's ever suspected
 * compromised). The access token is intentionally NOT persisted — it's short-lived
 * and stateless by design, verified purely by signature.
 */
export async function issueAuthTokens(user: { id: string; email: string }) {
  const accessToken = createAuthToken({
    userId: user.id,
    email: user.email,
    type: 'access',
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS
  });
  const refreshToken = createAuthToken({
    userId: user.id,
    email: user.email,
    type: 'refresh',
    ttlSeconds: env.REFRESH_TOKEN_TTL_SECONDS
  });

  await prisma.refreshToken.create({
    data: {
      id: nanoid(),
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000)
    }
  });

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Verifies a refresh token's signature AND that it hasn't been revoked or already
 * used. Rotates it: the old one is revoked and a brand new pair is issued. Rotation
 * means a leaked refresh token is only useful once — if it's ever replayed after the
 * legitimate client already rotated it, this will fail (the stored hash is gone).
 */
export async function rotateRefreshToken(oldToken: string) {
  const payload = verifyAuthToken(oldToken, 'refresh');
  const tokenHash = hashToken(oldToken);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new ApiError(401, 'Refresh token is invalid or has been revoked', 'INVALID_REFRESH_TOKEN');
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  return { user, tokens: await issueAuthTokens(user) };
}

/** Called on logout — invalidates the refresh token so it can't be used again even if leaked. */
export async function revokeRefreshToken(token: string) {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
