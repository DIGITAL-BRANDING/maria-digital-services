import { afterEach, describe, expect, it, vi } from 'vitest';

// Same stub as the other service tests: the generated Prisma client is not needed
// for status mapping, only for the modules ktech.service imports.
vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const echoEnum = new Proxy({}, { get: (_target, prop) => prop });
  return { ...actual, TransactionStatus: echoEnum, TransactionType: echoEnum };
});
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

/**
 * K-Tech async status mapping. The IPE ticket stayed "Processing" in our app while
 * K-Tech showed Success, because only a fixed list of words counted as success.
 * These pin the mapping so a provider status is never silently dropped.
 */
vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();
  return {
    ...actual,
    env: { ...actual.env, KTECH_BASE_URL: 'https://ktech.test/api/v1', KTECH_API_KEY: 'test-key', MOCK_KTECH: false }
  };
});

const { ktechService } = await import('../ktech.service.js');

function stubStatus(providerStatus: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    status: true,
    data: { status: providerStatus, ticket_id: 'T-1' }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}

afterEach(() => vi.unstubAllGlobals());

describe('K-Tech async status mapping', () => {
  it.each(['success', 'completed', 'processed', 'resolved', 'verified', 'cleared'])('maps "%s" to success', async (s) => {
    stubStatus(s);
    expect((await ktechService.checkIpeClearance('T-1')).status).toBe('success');
  });

  it.each(['rejected', 'failed', 'reversed'])('maps "%s" to failed', async (s) => {
    stubStatus(s);
    expect((await ktechService.checkIpeClearance('T-1')).status).toBe('failed');
  });

  it.each(['processing', 'queued', 'inprocessing', 'something-new'])('keeps "%s" pending, never a failure', async (s) => {
    stubStatus(s);
    expect((await ktechService.checkIpeClearance('T-1')).status).toBe('pending');
  });
});
