import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const settle = vi.fn();
const envMock: { KTECH_WEBHOOK_SECRET?: string } = { KTECH_WEBHOOK_SECRET: 'whsec_route_test' };

vi.mock('../../config/env.js', () => ({ env: new Proxy({}, { get: (_t, prop) => (envMock as Record<string, unknown>)[prop as string] }) }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../services/wallet.service.js', () => ({
  creditDirectDeposit: vi.fn(),
  creditDirectDepositByAccountNumber: vi.fn(),
  creditWalletByReference: vi.fn(),
  markFundingFailed: vi.fn()
}));
vi.mock('../../services/paystack.service.js', () => ({ paystackService: {} }));
vi.mock('../../services/katpay.service.js', () => ({ katpayService: {} }));
vi.mock('../../services/whatsapp-session.service.js', () => ({ advanceSession: vi.fn() }));
vi.mock('../../services/verification.service.js', () => ({ settleKtechTicket: (...args: unknown[]) => settle(...args) }));

const { webhookRoutes } = await import('../webhook.routes.js');

let server: ReturnType<express.Express['listen']>;
let base = '';

beforeAll(async () => {
  const app = express();
  // Same mounting as app.ts: raw body, no JSON parser in front.
  app.use('/api/webhooks', express.raw({ type: '*/*' }), webhookRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/ktech`;
});
afterAll(() => server.close());
beforeEach(() => {
  settle.mockReset();
  envMock.KTECH_WEBHOOK_SECRET = 'whsec_route_test';
});

const sign = (body: string) => crypto.createHmac('sha256', 'whsec_route_test').update(body).digest('hex');
const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('POST /api/webhooks/ktech', () => {
  it('GET reports readiness', async () => {
    const res = await fetch(base);
    expect(await res.json()).toMatchObject({ webhook: 'ktech', ready: true });
  });

  it('answers 503 (not a silent 404) when the secret is not configured', async () => {
    envMock.KTECH_WEBHOOK_SECRET = undefined;
    expect((await post('{}')).status).toBe(503);
  });

  it('answers 401 for a missing or wrong signature', async () => {
    expect((await post('{"event":"webhook.test"}')).status).toBe(401);
    expect((await post('{"event":"webhook.test"}', { 'x-webhook-signature': 'bad' })).status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });

  it('answers 200 for a correctly signed test event', async () => {
    const body = JSON.stringify({ event: 'webhook.test', data: { hello: 'world' } });
    const res = await post(body, { 'x-webhook-signature': sign(body) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, test: true });
    expect(settle).not.toHaveBeenCalled();
  });

  it('settles a ticket outcome, and only for a verified request', async () => {
    settle.mockResolvedValue({ handled: true, transactionId: 't1', status: 'failed' });
    const body = JSON.stringify({ event: 'ticket.updated', data: { ticket_id: 'TK-1', status: 'failed', response: { note: 'no record' } } });
    const res = await post(body, { 'x-ktech-signature': `sha256=${sign(body)}` });
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'TK-1', status: 'failed', response: { note: 'no record' } }));
  });

  it('acknowledges unknown events / unknown tickets with 200 so K-Tech stops retrying', async () => {
    const other = JSON.stringify({ event: 'something.else', data: {} });
    expect((await post(other, { 'x-signature': sign(other) })).status).toBe(200);

    settle.mockResolvedValue({ handled: false });
    const body = JSON.stringify({ data: { ticket_id: 'NOPE', status: 'success' } });
    const res = await post(body, { 'x-signature': sign(body) });
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  it('answers 500 when settling throws, so K-Tech retries', async () => {
    settle.mockRejectedValue(new Error('db down'));
    const body = JSON.stringify({ data: { ticket_id: 'TK-2', status: 'success' } });
    expect((await post(body, { 'x-signature': sign(body) })).status).toBe(500);
  });
});
