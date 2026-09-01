import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { parseEnvironment } from '@pharmacy/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { AppModule } from './app.module.js';
import { RequestBoundaryPipe } from './common/request-boundary.pipe.js';
import { StructuredLogger } from './common/structured-logger.js';

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment();
  const adapter = new FastifyAdapter({
    logger:
      environment.NODE_ENV === 'test'
        ? false
        : {
            level: environment.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
              ],
              censor: '[REDACTED]',
            },
          },
    genReqId: (request: IncomingMessage) => {
      const supplied = request.headers['x-request-id'];
      return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)
        ? supplied
        : randomUUID();
    },
    trustProxy: environment.TRUST_PROXY,
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(new StructuredLogger(adapter.getInstance().log));
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  const allowedOrigins =
    environment.NODE_ENV === 'development'
      ? [environment.WEB_ORIGIN, 'http://127.0.0.1:5173']
      : environment.WEB_ORIGIN;
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new RequestBoundaryPipe());
  app.enableShutdownHooks();

  await app.listen(environment.API_PORT, environment.HOST);
  adapter
    .getInstance()
    .log.info(
      { context: 'Bootstrap', host: environment.HOST, port: environment.API_PORT },
      'API listening',
    );
}

await bootstrap();
