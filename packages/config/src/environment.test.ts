import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './index.js';

const BASE_ENVIRONMENT = {
  DATABASE_URL: 'postgres://pharmacy_app:test@127.0.0.1:5432/pharmacy_test',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-bytes',
};

describe('authentication environment policy', () => {
  it('defaults to a 30-minute idle session bounded by a 12-hour absolute lifetime', () => {
    const environment = parseEnvironment(BASE_ENVIRONMENT);
    expect(environment.SESSION_TTL_MINUTES).toBe(30);
    expect(environment.SESSION_ABSOLUTE_TTL_MINUTES).toBe(720);
    expect(environment.LOGIN_RATE_LIMIT_ATTEMPTS).toBe(10);
    expect(environment.ACCOUNT_LOCKOUT_FAILURES).toBe(5);
  });

  it('rejects an absolute lifetime shorter than the sliding idle lifetime', () => {
    expect(() =>
      parseEnvironment({
        ...BASE_ENVIRONMENT,
        SESSION_ABSOLUTE_TTL_MINUTES: '30',
        SESSION_TTL_MINUTES: '60',
      }),
    ).toThrow('SESSION_ABSOLUTE_TTL_MINUTES');
  });

  it('requires an API token for every enabled fiscal adapter', () => {
    expect(() => parseEnvironment({ ...BASE_ENVIRONMENT, FBR_MODE: 'SANDBOX' })).toThrow(
      'FBR_API_TOKEN',
    );
    expect(
      parseEnvironment({
        ...BASE_ENVIRONMENT,
        FBR_MODE: 'SANDBOX',
        FBR_API_TOKEN: 'sandbox-token-with-safe-length',
      }).FBR_MODE,
    ).toBe('SANDBOX');
  });
});
