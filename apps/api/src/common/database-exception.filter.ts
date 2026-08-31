import { BadRequestException, Catch, ConflictException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

interface PostgreSqlError extends Error {
  readonly code: string;
}

function isPostgreSqlError(error: unknown): error is PostgreSqlError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

export function mapDatabaseException(error: unknown): HttpException | undefined {
  if (!isPostgreSqlError(error)) return undefined;

  if (error.code === '23505') {
    return new ConflictException('A record with the same unique key already exists');
  }
  if (error.code === '23514') {
    return new BadRequestException('Request violates a database constraint');
  }
  if (error.code === '22003') {
    return new BadRequestException('Numeric value is outside the allowed range');
  }
  return undefined;
}

@Catch()
@Injectable()
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(mapDatabaseException(exception) ?? exception, host);
  }
}
