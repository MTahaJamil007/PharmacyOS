import { describe, expect, it } from 'vitest';

import { retryDelaySeconds } from './backoff.js';

describe('outbox retry backoff', () => {
  it('increases exponentially and caps at one hour', () => {
    expect(retryDelaySeconds(1)).toBe(10);
    expect(retryDelaySeconds(4)).toBe(80);
    expect(retryDelaySeconds(100)).toBe(3_600);
  });
});
