import {
  BadRequestException,
  Catch,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  if (error.code === '23503') {
    return new ConflictException('A related record is missing or still in use');
  }
  if (['23514', '23502', '22001', '22P02'].includes(error.code)) {
    return new BadRequestException('Request violates a database constraint');
  }
  if (error.code === '22003') {
    return new BadRequestException('Numeric value is outside the allowed range');
  }
  if (error.code === '40001' || error.code === '40P01') {
    return new ConflictException('Transaction conflicted; retry with the same client request ID');
  }
  if (error.code === '57014') {
    return new ServiceUnavailableException('Database operation timed out');
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
