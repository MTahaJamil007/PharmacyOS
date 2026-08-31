import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { RequestBoundaryPipe } from './request-boundary.pipe.js';

const BODY_METADATA: ArgumentMetadata = { data: undefined, metatype: undefined, type: 'body' };

describe('RequestBoundaryPipe', () => {
  const pipe = new RequestBoundaryPipe();

  it('preserves ordinary JSON input', () => {
    const value = { items: [{ quantity: '1.000' }] };
    expect(pipe.transform(value, BODY_METADATA)).toBe(value);
  });

  it('rejects prototype-pollution keys before controller parsing', () => {
    const value: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => pipe.transform(value, BODY_METADATA)).toThrow(BadRequestException);
  });

  it('rejects excessive nesting at the global boundary', () => {
    let value: unknown = 'leaf';
    for (let depth = 0; depth < 14; depth += 1) value = { child: value };
    expect(() => pipe.transform(value, BODY_METADATA)).toThrow('too deeply nested');
  });
});
