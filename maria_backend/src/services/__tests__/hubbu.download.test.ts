import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the Hubbu slip download link handling behind "Request failed (502)"
 * on NIN-by-phone: the link Hubbu returns must be fetched in the form it was
 * sent (token, path, or full URL), and the API key must never leave Hubbu's origin.
 */
vi.mock('../../config/env.js', () => ({ env: { HUBBU_API_KEY: 'test-key', HUBBU_BASE_URL: 'https://hubbu.test' } }));

const { hubbuService } = await import('../hubbu.service.js');

const PDF = Buffer.from('%PDF-1.4\n% test slip\n');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('hubbu slip download', () => {
  it('fetches an opaque token through /slips/download', async () => {
    const fetchMock = stubFetch(() => new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const pdf = await hubbuService.downloadSlip('TOKEN123');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://hubbu.test/slips/download?file=TOKEN123');
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('test-key');
  });

  it('keeps the path of a relative download link instead of turning it into a token', async () => {
    const fetchMock = stubFetch(() => new Response(PDF, { status: 200 }));
    await hubbuService.downloadSlip('/download/slip/abc.pdf');
    expect(String((fetchMock.mock.calls[0] as unknown as [URL])[0])).toBe('https://hubbu.test/download/slip/abc.pdf');
  });

  it('refuses a full URL on another host and never sends the API key there', async () => {
    const fetchMock = stubFetch(() => new Response(PDF, { status: 200 }));
    await expect(hubbuService.downloadSlip('https://evil.example/x.pdf')).rejects.toThrow(/unsupported/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response that is not a PDF', async () => {
    stubFetch(() => new Response('<html>err</html>', { status: 200 }));
    await expect(hubbuService.downloadSlip('TOKEN123')).rejects.toThrow(/non-PDF/);
  });
});

describe('hubbu phone lookup returns a usable download link', () => {
  it('exposes the resolved absolute URL and the link exactly as sent', async () => {
    stubFetch(() => json({ status: true, message: 'ok', data: { result: { first_name: 'A' }, download_url: '/download/slip/abc.pdf' } }));
    const r = await hubbuService.ninByPhone('08000000000', 'regular');
    expect(r.ok).toBe(true);
    expect(r.downloadUrl).toBe('https://hubbu.test/download/slip/abc.pdf');
    expect(r.downloadToken).toBe('/download/slip/abc.pdf');
    expect(r.pdfBase64).toBeUndefined();
  });
});
