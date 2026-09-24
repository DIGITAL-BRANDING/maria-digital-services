import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

const { userSafeProviderMessage, PROVIDER_UNAVAILABLE_MESSAGE } = await import('../ktech.service.js');

describe('userSafeProviderMessage', () => {
  it('hides integrator-only wording such as the api_key error the customer saw', () => {
    expect(userSafeProviderMessage('Missing required parameters: api_key and/or nin', 'x')).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(userSafeProviderMessage('Invalid API key', 'x')).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(userSafeProviderMessage('Unauthorized', 'x')).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
  });

  it('keeps messages that are useful to the customer', () => {
    expect(userSafeProviderMessage('NIN not found', 'x')).toBe('NIN not found');
    expect(userSafeProviderMessage('Insufficient provider balance', 'x')).toBe('Insufficient provider balance');
  });

  it('uses the fallback when there is no message', () => {
    expect(userSafeProviderMessage(undefined, 'fallback')).toBe('fallback');
  });
});
