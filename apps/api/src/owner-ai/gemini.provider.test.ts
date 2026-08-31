import type { Environment } from '@pharmacy/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from './gemini.provider.js';

const request = {
  dataBasis: 'Finalized sales',
  facts: { grossSales: '10.00', invoiceCount: '2' },
  question: 'How did sales perform?',
  toolName: 'get_sales_summary',
};

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    AI_REQUEST_TIMEOUT_MS: 1_000,
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'test-model',
    ...overrides,
  } as Environment;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GeminiProvider failure boundaries', () => {
  it('fails closed without a configured key or model and never calls the network', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const provider = new GeminiProvider(environment({ GEMINI_API_KEY: '' }));

    await expect(provider.explain(request)).rejects.toThrow('AI_PROVIDER_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes provider 429 and malformed responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const provider = new GeminiProvider(environment());

    await expect(provider.explain(request)).rejects.toThrow('AI_RATE_LIMITED');
    await expect(provider.explain(request)).rejects.toThrow('AI_MALFORMED_RESPONSE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a provider request at the configured timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('private network detail');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const provider = new GeminiProvider(environment());
    const response = provider.explain(request);
    const rejection = expect(response).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});
