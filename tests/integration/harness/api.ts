import { Test } from '@nestjs/testing';
import type { Environment } from '@pharmacy/config';
import { parseEnvironment } from '@pharmacy/config';
import { createDatabase } from '@pharmacy/database';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';

import { AppModule } from '../../../apps/api/src/app.module.js';
import { RequestBoundaryPipe } from '../../../apps/api/src/common/request-boundary.pipe.js';
import { DATABASE, ENVIRONMENT } from '../../../apps/api/src/database.module.js';

export interface IntegrationApi {
  readonly app: NestFastifyApplication;
  close(): Promise<void>;
}

function testEnvironment(
  databaseUrl: string,
  overrides: Readonly<Record<string, string>> = {},
): Environment {
  return parseEnvironment({
    AI_ENABLED: 'false',
    DATABASE_URL: databaseUrl,
    FBR_MODE: 'DISABLED',
    NODE_ENV: 'test',
    RESERVATION_TTL_MINUTES: '8',
    SESSION_SECRET: 'integration-session-secret-at-least-32-bytes',
    TRUST_PROXY: 'false',
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    ...overrides,
  });
}

export async function createIntegrationApi(
  databaseUrl: string,
  environmentOverrides: Readonly<Record<string, string>> = {},
): Promise<IntegrationApi> {
  const applicationDatabase = createDatabase(databaseUrl);
  const environment = testEnvironment(databaseUrl, environmentOverrides);
  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(applicationDatabase)
    .overrideProvider(ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
  app.useGlobalPipes(new RequestBoundaryPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    async close(): Promise<void> {
      await app.close();
    },
  };
}
