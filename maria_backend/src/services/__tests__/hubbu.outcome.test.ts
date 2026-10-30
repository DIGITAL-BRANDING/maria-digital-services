import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for "provider dashboard says success, customer is told it
 * failed": a response that does not prove failure (still processing, gateway
 * timeout, unreadable body) must come back `ambiguous` - which keeps the
 * transaction PENDING and un-refunded - never as a plain failure.
 */
vi.mock('../../config/env.js', () => ({ env: { HUBBU_API_KEY: 'test-key', HUBBU_BASE_URL: 'https://hubbu.test' } }));

const { hubbuService } = await import('../hubbu.service.js');

function mockFetch(response: Response | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('hubbu outcome mapping', () => {
  it('success with data is ok', async () => {
    mockFetch(json({ status: true, message: 'ok', data: { result: { a: 1 }, pdf_base64: 'JVBERi0=' } }));
    const r = await hubbuService.ninByNin('12345678901', 'premium');
    expect(r.ok).toBe(true);
    expect(r.ambiguous).toBeUndefined();
  });

  it.each(['pending', 'processing', 'queued', 'In_Progress'])('status "%s" is ambiguous, not a failure', async (status) => {
    mockFetch(json({ status, message: 'working' }));
    const r = await hubbuService.ninByNin('12345678901', 'premium');
    expect(r.ok).toBe(false);
    expect(r.ambiguous).toBe(true);
  });

  it.each([502, 504, 524, 408])('HTTP %i with an HTML body is ambiguous', async (code) => {
    mockFetch(new Response('<html>gateway timeout</html>', { status: code }));
    const r = await hubbuService.bvnSlip('12345678901', 'premium');
    expect(r.ambiguous).toBe(true);
  });

  it('HTTP 504 with a JSON body that has no status is ambiguous', async () => {
    mockFetch(json({ message: 'upstream timeout' }, 504));
    expect((await hubbuService.ninByNin('12345678901', 'premium')).ambiguous).toBe(true);
  });

  it('a network timeout is ambiguous', async () => {
    mockFetch(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect((await hubbuService.ninByNin('12345678901', 'premium')).ambiguous).toBe(true);
  });

  it('an explicit rejection stays a plain failure (refundable)', async () => {
    mockFetch(json({ status: false, message: 'NIN not found' }, 422));
    const r = await hubbuService.ninByNin('12345678901', 'premium');
    expect(r.ok).toBe(false);
    expect(r.ambiguous).toBeFalsy();
    expect(r.message).toBe('NIN not found');
  });

  it('an explicit rejection delivered with HTTP 500 is still a plain failure', async () => {
    mockFetch(json({ status: false, message: 'Provider error' }, 500));
    expect((await hubbuService.ninByNin('12345678901', 'premium')).ambiguous).toBeFalsy();
  });

  it('status "error" with a 4xx is a plain failure', async () => {
    mockFetch(json({ status: 'error', message: 'Invalid slip type' }, 400));
    expect((await hubbuService.ninByNin('12345678901', 'premium')).ambiguous).toBeFalsy();
  });
});
