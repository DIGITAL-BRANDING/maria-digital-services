import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timestampWithinTolerance, verifyPartnerWebhook } from '../webhook-signature.js';

const secret = 'whsec_test_secret';
const body = JSON.stringify({ event: 'webhook.test', data: { ok: true } });
const raw = Buffer.from(body);
const hmac = (data: string, enc: 'hex' | 'base64' = 'hex') => crypto.createHmac('sha256', secret).update(data).digest(enc);

describe('verifyPartnerWebhook', () => {
  it('accepts hex HMAC of the raw body', () => {
    const r = verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-webhook-signature': hmac(body) } });
    expect(r).toMatchObject({ valid: true, scheme: 'hmac-sha256(body)', header: 'x-webhook-signature' });
  });

  it('accepts sha256= prefix and base64 encoding', () => {
    expect(verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-signature': `sha256=${hmac(body)}` } }).valid).toBe(true);
    expect(verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-ktech-signature': hmac(body, 'base64') } }).valid).toBe(true);
  });

  it('accepts timestamp.body scheme with a separate timestamp header', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = verifyPartnerWebhook({
      secret,
      rawBody: raw,
      headers: { 'x-ktech-signature': hmac(`${ts}.${body}`), 'x-ktech-timestamp': ts }
    });
    expect(r).toMatchObject({ valid: true, scheme: 'hmac-sha256(timestamp.body)' });
  });

  it('accepts a t=...,v1=... header', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-signature': `t=${ts},v1=${hmac(`${ts}.${body}`)}` } });
    expect(r.valid).toBe(true);
  });

  it('rejects a replayed (stale) timestamped signature', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const r = verifyPartnerWebhook({
      secret,
      rawBody: raw,
      headers: { 'x-webhook-signature': hmac(`${ts}.${body}`), 'x-webhook-timestamp': ts }
    });
    expect(r.valid).toBe(false);
  });

  it('accepts the secret itself in a header or as a bearer token', () => {
    expect(verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-webhook-secret': secret } }).valid).toBe(true);
    expect(verifyPartnerWebhook({ secret, rawBody: raw, headers: { authorization: `Bearer ${secret}` } }).valid).toBe(true);
  });

  it('rejects a wrong secret, a tampered body and a missing header - and reports header names seen', () => {
    const wrong = crypto.createHmac('sha256', 'other').update(body).digest('hex');
    expect(verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-webhook-signature': wrong } }).valid).toBe(false);
    expect(verifyPartnerWebhook({ secret, rawBody: Buffer.from(body + ' '), headers: { 'x-webhook-signature': hmac(body) } }).valid).toBe(false);
    const none = verifyPartnerWebhook({ secret, rawBody: raw, headers: {} });
    expect(none).toMatchObject({ valid: false, headersSeen: [] });
    const some = verifyPartnerWebhook({ secret, rawBody: raw, headers: { 'x-signature': 'nope' } });
    expect(some).toMatchObject({ valid: false, headersSeen: ['x-signature'] });
  });
});

describe('timestampWithinTolerance', () => {
  it('handles seconds, milliseconds and ISO strings', () => {
    const now = Date.now();
    expect(timestampWithinTolerance(String(Math.floor(now / 1000)))).toBe(true);
    expect(timestampWithinTolerance(String(now))).toBe(true);
    expect(timestampWithinTolerance(new Date(now).toISOString())).toBe(true);
    expect(timestampWithinTolerance('garbage')).toBe(false);
  });
});
