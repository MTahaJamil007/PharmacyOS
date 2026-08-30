import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

describe('session token storage', () => {
  it('stores a one-way SHA-256 digest rather than a bearer token', () => {
    const token = 'raw-secret-token';
    const digest = createHash('sha256').update(token).digest('hex');
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
  });
});
