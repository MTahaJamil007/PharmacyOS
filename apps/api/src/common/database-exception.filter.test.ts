import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { mapDatabaseException } from './database-exception.filter.js';

function databaseError(code: string): Error & { code: string } {
  return Object.assign(new Error('private database detail'), { code });
}

describe('mapDatabaseException', () => {
  it.each(['23505', '23503'])('maps PostgreSQL %s to conflict without leaking details', (code) => {
    const mapped = mapDatabaseException(databaseError(code));

    expect(mapped).toBeInstanceOf(ConflictException);
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).not.toContain('private database detail');
  });

  it.each(['23514', '23502', '22001', '22P02', '22003'])(
    'maps PostgreSQL %s to a bad request',
    (code) => {
      const mapped = mapDatabaseException(databaseError(code));

      expect(mapped).toBeInstanceOf(BadRequestException);
      expect(mapped?.getStatus()).toBe(400);
    },
  );

  it.each(['40001', '40P01'])('maps retryable PostgreSQL %s to conflict', (code) => {
    expect(mapDatabaseException(databaseError(code))?.getStatus()).toBe(409);
  });

  it('maps a cancelled database statement to service unavailable', () => {
    expect(mapDatabaseException(databaseError('57014'))?.getStatus()).toBe(503);
  });

  it('delegates errors that do not have an explicit safe mapping', () => {
    expect(mapDatabaseException(databaseError('XX000'))).toBeUndefined();
    expect(mapDatabaseException(new Error('ordinary failure'))).toBeUndefined();
  });
});
