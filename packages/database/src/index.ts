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

export async function checkDatabase(database: Database): Promise<void> {
  await database`select 1 as healthy`;
}
