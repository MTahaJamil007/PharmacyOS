import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { parseEnvironment } from '@pharmacy/config';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment();
  const adapter = new FastifyAdapter({
    logger: environment.NODE_ENV === 'development',
    trustProxy: environment.TRUST_PROXY,
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  const allowedOrigins =
    environment.NODE_ENV === 'development'
      ? [environment.WEB_ORIGIN, 'http://127.0.0.1:5173']
      : environment.WEB_ORIGIN;
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  await app.listen(environment.API_PORT, environment.HOST);
  Logger.log(`API listening on ${environment.HOST}:${environment.API_PORT}`, 'Bootstrap');
}

await bootstrap();
