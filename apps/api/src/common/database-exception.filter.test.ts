import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { mapDatabaseException } from './database-exception.filter.js';

function databaseError(code: string): Error & { code: string } {
  return Object.assign(new Error('private database detail'), { code });
}

describe('mapDatabaseException', () => {
  it('maps uniqueness violations to conflict without leaking database details', () => {
    const mapped = mapDatabaseException(databaseError('23505'));

    expect(mapped).toBeInstanceOf(ConflictException);
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).not.toContain('private database detail');
  });

  it.each(['23514', '22003'])('maps PostgreSQL %s to a bad request', (code) => {
    const mapped = mapDatabaseException(databaseError(code));

    expect(mapped).toBeInstanceOf(BadRequestException);
    expect(mapped?.getStatus()).toBe(400);
  });

  it('delegates errors that do not have an explicit safe mapping', () => {
    expect(mapDatabaseException(databaseError('40P01'))).toBeUndefined();
    expect(mapDatabaseException(new Error('ordinary failure'))).toBeUndefined();
  });
});
