import {
  createDatabase,
  runMigrations,
  type Database,
  type DatabaseTransaction,
} from '@pharmacy/database';
import { inject } from 'vitest';

const APPLICATION_PASSWORD = 'pharmacy_integration_app';
let databaseSequence = 0;

export interface IsolatedDatabase {
  readonly admin: Database;
  readonly application: Database;
  readonly applicationUrl: string;
  readonly name: string;
  readonly url: string;
  dispose(): Promise<void>;
}

class RollbackSignal extends Error {
  constructor(readonly value: unknown) {
    super('Expected integration-test rollback');
  }
}

function databaseUrl(
  baseUrl: string,
  databaseName: string,
  username = 'postgres',
  password?: string,
): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.username = username;
  if (password !== undefined) {
    url.password = password;
  }
  return url.toString();
}

function safeDatabaseName(label: string): string {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  databaseSequence += 1;
  return `pharmacy_test_${safeLabel || 'case'}_${process.pid}_${databaseSequence}`.slice(0, 63);
}

export async function createIsolatedDatabase(label: string): Promise<IsolatedDatabase> {
  const serverUrl = inject('postgresAdminUrl');
  const serverAdmin = createDatabase(serverUrl, { max: 1 });
  const name = safeDatabaseName(label);
  await serverAdmin`create database ${serverAdmin(name)} template template0 encoding 'UTF8'`;

  const url = databaseUrl(serverUrl, name);
  try {
    await runMigrations(url);
  } catch (error) {
    await serverAdmin`drop database ${serverAdmin(name)} with (force)`;
    await serverAdmin.end();
    throw error;
  }

  const admin = createDatabase(url);
  const applicationUrl = databaseUrl(serverUrl, name, 'pharmacy_app', APPLICATION_PASSWORD);
  const application = createDatabase(applicationUrl);

  return {
    admin,
    application,
    applicationUrl,
    name,
    url,
    async dispose(): Promise<void> {
      await Promise.all([admin.end(), application.end()]);
      await serverAdmin`drop database ${serverAdmin(name)} with (force)`;
      await serverAdmin.end();
    },
  };
}

export async function withRollback<T>(
  database: Database,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  try {
    await database.begin(async (transaction) => {
      const value = await operation(transaction);
      throw new RollbackSignal(value);
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return error.value as T;
    }
    throw error;
  }

  throw new Error('Rollback transaction completed unexpectedly');
}
