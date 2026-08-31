import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase } from './index.js';

const MIGRATION_LOCK_ID = 7_302_026;
const MIGRATION_FILE_PATTERN = /^\d+_.+\.sql$/;

export interface MigrationRunOptions {
  readonly directory?: string;
  readonly onApplied?: (file: string) => void;
}

function defaultMigrationDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

export async function runMigrations(
  connectionString: string,
  options: MigrationRunOptions = {},
): Promise<readonly string[]> {
  const database = createDatabase(connectionString, { max: 1 });
  const migrationDirectory = options.directory ?? defaultMigrationDirectory();
  const applied: string[] = [];

  try {
    await database`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await database`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `;

    const files = (await readdir(migrationDirectory)).filter((file) =>
      MIGRATION_FILE_PATTERN.test(file),
    );
    files.sort();

    for (const file of files) {
      const migration = await readFile(join(migrationDirectory, file), 'utf8');
      const checksum = createHash('sha256').update(migration).digest('hex');
      const [existing] = await database<{ checksum: string }[]>`
        select checksum from schema_migrations where version = ${file}
      `;

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Applied migration ${file} has been modified`);
        }
        continue;
      }

      await database.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          insert into schema_migrations (version, checksum) values (${file}, ${checksum})
        `;
      });
      applied.push(file);
      options.onApplied?.(file);
    }

    return applied;
  } finally {
    await database`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => undefined);
    await database.end();
  }
}
