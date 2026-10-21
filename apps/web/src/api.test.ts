import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSaleDraft, readableError, reserveSaleDraft } from './api';

function captureFetch(): { readonly calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ init, url });
      return Promise.resolve(new Response(JSON.stringify({ id: '1' }), { status: 201 }));
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client requests', () => {
  it('sends no JSON content type on a command without a body', async () => {
    // Fastify answers 400 to an empty body declared as JSON; checkout reserve has no body.
    const { calls } = captureFetch();
    await reserveSaleDraft('20');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('declares JSON when it sends a body', async () => {
    const { calls } = captureFetch();
    await createSaleDraft('1', [{ medicineId: '101', quantity: '1' }]);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      items: [{ medicineId: '101', quantity: '1' }],
      terminalId: '1',
    });
  });
});

describe('readable API errors', () => {
  it('prefers the server message, then field errors, then a status explanation', () => {
    expect(readableError({ message: 'Insufficient stock' }, 409)).toBe('Insufficient stock');
    expect(readableError({ fieldErrors: { amount: ['Too big'] } }, 400)).toBe('amount: Too big');
    expect(readableError(null, 0)).toMatch(/could not be reached/);
    expect(readableError(null, 403)).toMatch(/not allowed/);
  });
});
