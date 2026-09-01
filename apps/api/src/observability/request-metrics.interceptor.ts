import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { catchError, finalize, throwError } from 'rxjs';

import { MetricsService } from './metrics.service.js';

@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    let failedStatus: number | undefined;
    return next.handle().pipe(
      catchError((error: unknown) => {
        failedStatus = error instanceof HttpException ? error.getStatus() : 500;
        request.log.error(
          {
            err: error,
            correlationId: request.id,
            method: request.method,
            route: request.routeOptions?.url ?? request.url,
            statusCode: failedStatus,
          },
          'Request failed',
        );
        return throwError(() => error);
      }),
      finalize(() => {
        const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        this.metrics.recordRequest(
          request.method,
          request.routeOptions?.url ?? request.url,
          failedStatus ?? reply.statusCode,
          elapsedSeconds,
        );
      }),
    );
  }
}
