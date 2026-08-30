import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './load-environment.js';

import { createDatabase } from './index.js';

const MIGRATION_LOCK_ID = 7_302_026;

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');
  }

  const database = createDatabase(connectionString, { max: 1 });
  const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

  try {
    await database`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await database`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `;

    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

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
      process.stdout.write(`Applied ${file}\n`);
    }
  } finally {
    await database`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => undefined);
    await database.end();
  }
}

await migrate();
