import postgres, { type Sql, type TransactionSql } from 'postgres';

export type Database = Sql<Record<string, never>>;
export type DatabaseTransaction = TransactionSql<Record<string, never>>;

export interface DatabaseOptions {
  readonly max?: number;
  readonly idleTimeoutSeconds?: number;
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  return postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    prepare: false,
    transform: {
      undefined: null,
    },
    onnotice: () => undefined,
  });
}

/** A value that can be stored in a json/jsonb column. */
export type JsonValue = postgres.JSONValue;

/**
 * Prepares an arbitrary object for `sql.json(...)`. Pass objects through `sql.json`, never
 * `${JSON.stringify(x)}::jsonb`: postgres.js serialises a jsonb parameter itself, so a
 * pre-stringified value is stored as a JSON string and fails `jsonb_typeof(...) = 'object'`
 * checks. BigInt values (database identifiers) are written as strings.
 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ) ?? 'null',
  ) as JsonValue;
}

export async function checkDatabase(database: Database): Promise<void> {
  await database`select 1 as healthy`;
}

export { runMigrations, type MigrationRunOptions } from './migrations.js';
