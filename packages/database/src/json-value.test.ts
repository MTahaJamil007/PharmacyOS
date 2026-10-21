import { describe, expect, it } from 'vitest';

import { toJsonValue } from './index.js';

describe('toJsonValue', () => {
  it('keeps objects as objects so jsonb object checks hold', () => {
    expect(toJsonValue({ count: 2, nested: { ok: true } })).toEqual({
      count: 2,
      nested: { ok: true },
    });
  });

  it('writes bigint identifiers as strings and drops undefined fields', () => {
    expect(toJsonValue({ id: 12n, missing: undefined })).toEqual({ id: '12' });
  });

  it('maps a value JSON cannot represent to null instead of throwing', () => {
    expect(toJsonValue(undefined)).toBeNull();
  });
});
