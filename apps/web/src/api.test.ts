import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeApiError,
  getCurrentCashSession,
  reserveSaleDraft,
  sendToCashCounter,
  approveCashVariance,
} from './api';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP request bodies', () => {
  it('omits the JSON content type for a bodyless reservation and GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    await reserveSaleDraft('token', '20');
    await getCurrentCashSession('token');
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('content-type')).toBeNull();
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
      expect(init.body).toBeUndefined();
    }
  });

  it('sends JSON and authentication for routing and variance approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    await sendToCashCounter('token', '20');
    await approveCashVariance('token', '10', 'Count reviewed by manager');
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
      expect(typeof init.body).toBe('string');
    }
  });
});

describe('describeApiError', () => {
  it('reports the field rules a validated endpoint rejected', () => {
    expect(
      describeApiError(
        {
          formErrors: [],
          fieldErrors: { password: ['Too small: expected string to have >=12 characters'] },
        },
        400,
      ),
    ).toBe('password: Too small: expected string to have >=12 characters');
  });

  it('reports every field and form error together', () => {
    expect(
      describeApiError(
        {
          formErrors: ['At least one field is required'],
          fieldErrors: { username: ['Too small'], roles: ['Invalid option'] },
        },
        400,
      ),
    ).toBe('At least one field is required; username: Too small; roles: Invalid option');
  });

  it('falls back to the message of an ordinary failure', () => {
    expect(describeApiError({ message: 'Invalid credentials or terminal' }, 401)).toBe(
      'Invalid credentials or terminal',
    );
  });

  it('joins a message array', () => {
    expect(describeApiError({ message: ['first problem', 'second problem'] }, 400)).toBe(
      'first problem; second problem',
    );
  });

  it('falls back to the status when the body carries nothing usable', () => {
    expect(describeApiError(null, 500)).toBe('Request failed (500)');
    expect(describeApiError({ fieldErrors: {} }, 503)).toBe('Request failed (503)');
  });
});
