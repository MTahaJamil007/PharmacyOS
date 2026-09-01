import type { LoggerService } from '@nestjs/common';
import type { FastifyBaseLogger } from 'fastify';

export class StructuredLogger implements LoggerService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  log(message: unknown, context?: string): void {
    if (typeof message === 'string') this.logger.info({ context }, message);
    else this.logger.info({ context, message }, 'Nest application event');
  }

  error(message: unknown, stack?: string, context?: string): void {
    if (typeof message === 'string') this.logger.error({ context, stack }, message);
    else this.logger.error({ context, message, stack }, 'Nest application error');
  }

  warn(message: unknown, context?: string): void {
    if (typeof message === 'string') this.logger.warn({ context }, message);
    else this.logger.warn({ context, message }, 'Nest application warning');
  }

  debug(message: unknown, context?: string): void {
    if (typeof message === 'string') this.logger.debug({ context }, message);
    else this.logger.debug({ context, message }, 'Nest application debug event');
  }

  verbose(message: unknown, context?: string): void {
    if (typeof message === 'string') this.logger.trace({ context }, message);
    else this.logger.trace({ context, message }, 'Nest application trace event');
  }
}
