import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Environment } from '@pharmacy/config';

import { RequestBoundaryPipe } from './common/request-boundary.pipe.js';

/**
 * HTTP behaviour shared by the server and the integration harness, so the tests exercise
 * the same security headers, CORS rules, routing prefix and request limits as production.
 */
export async function configureHttp(
  app: NestFastifyApplication,
  environment: Pick<Environment, 'NODE_ENV' | 'WEB_ORIGIN'>,
): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });
  const allowedOrigins =
    environment.NODE_ENV === 'development'
      ? [environment.WEB_ORIGIN, 'http://127.0.0.1:5173']
      : environment.WEB_ORIGIN;
  // @fastify/cors only allows GET, HEAD and POST unless told otherwise; edits use PATCH/PUT.
  app.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin: allowedOrigins,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
  app.useGlobalPipes(new RequestBoundaryPipe());
}
