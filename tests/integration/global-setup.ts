import { createDatabase } from '@pharmacy/database';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';

const POSTGRES_IMAGE = 'postgres:18.4-alpine3.23';
const POSTGRES_PASSWORD = 'pharmacy_integration_admin';
const APPLICATION_PASSWORD = 'pharmacy_integration_app';

function connectionUrl(container: StartedTestContainer): string {
  const url = new URL('postgres://postgres@localhost/postgres');
  url.hostname = container.getHost();
  url.port = String(container.getMappedPort(5432));
  url.password = POSTGRES_PASSWORD;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_DB: 'postgres',
      POSTGRES_PASSWORD,
      POSTGRES_USER: 'postgres',
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      interval: 1_000,
      retries: 30,
      startPeriod: 2_000,
      test: ['CMD-SHELL', 'pg_isready -U postgres -d postgres'],
      timeout: 3_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(120_000)
    .start();

  const adminUrl = connectionUrl(container);
  const database = createDatabase(adminUrl, { max: 1 });

  try {
    await database.unsafe(`
      do $role$
      begin
        if not exists (select 1 from pg_roles where rolname = 'pharmacy_app') then
          create role pharmacy_app login password '${APPLICATION_PASSWORD}';
        else
          alter role pharmacy_app login password '${APPLICATION_PASSWORD}';
        end if;
      end
      $role$;
    `);
  } catch (error) {
    await container.stop();
    throw error;
  } finally {
    await database.end();
  }

  project.provide('postgresAdminUrl', adminUrl);

  return async () => {
    await container.stop();
  };
}
