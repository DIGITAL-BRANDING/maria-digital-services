import crypto from 'node:crypto';

/**
 * Verifies an inbound webhook from a partner whose exact signing scheme we
 * cannot read up front (K-Tech's partner docs sit behind a login).
 *
 * Instead of guessing ONE scheme and silently failing on every real delivery,
 * this accepts the handful of schemes almost every partner platform uses -
 * always requiring knowledge of the shared secret:
 *
 *   1. HMAC-SHA256 of the raw body            (hex or base64, optional "sha256=" prefix)
 *   2. HMAC-SHA256 of `${timestamp}.${body}`  (Stripe / KatPay style; timestamp from a
 *                                              header or from a `t=...,v1=...` header)
 *   3. The secret itself sent in a header     (X-Webhook-Secret / Authorization: Bearer ...)
 *
 * The result says WHICH scheme and header matched, so the first real delivery
 * tells us exactly what K-Tech uses (it is logged by the route).
 */

const SIGNATURE_HEADERS = [
  'x-ktech-signature',
  'x-k-tech-signature',
  'x-webhook-signature',
  'x-signature',
  'x-signature-256',
  'x-hub-signature-256',
  'signature'
];
const TIMESTAMP_HEADERS = ['x-ktech-timestamp', 'x-k-tech-timestamp', 'x-webhook-timestamp', 'x-timestamp'];
const PLAIN_SECRET_HEADERS = ['x-webhook-secret', 'x-ktech-secret', 'x-k-tech-secret', 'x-api-key'];

export type HeaderBag = Record<string, string | string[] | undefined>;

export type SignatureResult =
  | { valid: true; scheme: string; header: string }
  | { valid: false; reason: string; headersSeen: string[] };

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** `t=123,v1=abcd` (or `sha256=abcd`, or bare `abcd`) -> candidate signatures + optional timestamp. */
function parseSignatureHeader(value: string): { candidates: string[]; timestamp?: string } {
  if (!value.includes('=') || /^sha256=/i.test(value)) {
    return { candidates: [value.replace(/^sha256=/i, '')] };
  }
  const candidates: string[] = [];
  let timestamp: string | undefined;
  for (const part of value.split(',')) {
    const [key, ...rest] = part.split('=');
    const val = rest.join('=').trim();
    if (!val) continue;
    if (key.trim() === 't') timestamp = val;
    else candidates.push(val);
  }
  // Base64 values legitimately end in "=" - if nothing parsed as key=value, treat the whole thing as the signature.
  return candidates.length || timestamp ? { candidates, timestamp } : { candidates: [value] };
}

export function timestampWithinTolerance(timestamp: string, toleranceMs = 10 * 60_000, now = Date.now()) {
  const parsed = /^\d+$/.test(timestamp) ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1) : Date.parse(timestamp);
  return Number.isFinite(parsed) && Math.abs(now - parsed) <= toleranceMs;
}

export function verifyPartnerWebhook(params: { secret: string; rawBody: Buffer; headers: HeaderBag }): SignatureResult {
  const { secret, rawBody, headers } = params;
  const body = rawBody.toString('utf8');
  const headersSeen = [...SIGNATURE_HEADERS, ...TIMESTAMP_HEADERS, ...PLAIN_SECRET_HEADERS, 'authorization'].filter(
    (name) => header(headers, name) !== undefined
  );

  const headerTimestamp = TIMESTAMP_HEADERS.map((name) => header(headers, name)).find(Boolean);

  for (const name of SIGNATURE_HEADERS) {
    const raw = header(headers, name);
    if (!raw) continue;
    const { candidates, timestamp: embeddedTimestamp } = parseSignatureHeader(raw);
    const timestamp = embeddedTimestamp ?? headerTimestamp;

    const payloads: Array<{ scheme: string; data: string }> = [{ scheme: 'hmac-sha256(body)', data: body }];
    if (timestamp) payloads.push({ scheme: 'hmac-sha256(timestamp.body)', data: `${timestamp}.${body}` });

    for (const payload of payloads) {
      const digest = crypto.createHmac('sha256', secret).update(payload.data).digest();
      const expected = [digest.toString('hex'), digest.toString('base64')];
      for (const candidate of candidates) {
        const normalized = /^[0-9a-f]+$/i.test(candidate) ? candidate.toLowerCase() : candidate;
        if (expected.some((value) => safeEqual(normalized, value))) {
          if (payload.scheme.includes('timestamp') && timestamp && !timestampWithinTolerance(timestamp)) {
            return { valid: false, reason: 'Signature is valid but the timestamp is stale (possible replay)', headersSeen };
          }
          return { valid: true, scheme: payload.scheme, header: name };
        }
      }
    }
  }

  for (const name of PLAIN_SECRET_HEADERS) {
    const value = header(headers, name);
    if (value && safeEqual(value, secret)) return { valid: true, scheme: 'shared-secret-header', header: name };
  }
  const bearer = header(headers, 'authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer && safeEqual(bearer, secret)) return { valid: true, scheme: 'bearer-secret', header: 'authorization' };

  return {
    valid: false,
    reason: headersSeen.length ? 'No signature/secret header matched KTECH_WEBHOOK_SECRET' : 'No signature or secret header was sent',
    headersSeen
  };
}
