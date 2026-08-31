import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '@pharmacy/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runConcurrently } from './harness/concurrency.js';
import { createIsolatedDatabase, type IsolatedDatabase, withRollback } from './harness/database.js';

const migrationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/database/migrations',
);

describe('database-backed integration harness', () => {
  let testDatabase: IsolatedDatabase;

  beforeAll(async () => {
    testDatabase = await createIsolatedDatabase('migration_harness');
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  it('applies every immutable migration with its actual checksum', async () => {
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    const expected = await Promise.all(
      files.map(async (version) => ({
        checksum: createHash('sha256')
          .update(await readFile(resolve(migrationDirectory, version), 'utf8'))
          .digest('hex'),
        version,
      })),
    );
    const actual = await testDatabase.admin<{ checksum: string; version: string }[]>`
      select version, checksum from schema_migrations order by version
    `;

    expect([...actual]).toEqual(expected);
    await expect(runMigrations(testDatabase.url)).resolves.toEqual([]);
  });

  it('connects with the application role but denies schema ownership', async () => {
    await expect(testDatabase.application`select count(*) from branches`).resolves.toBeDefined();
    await expect(
      testDatabase.application`create table forbidden_application_table (id bigint)`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rolls successful test work back', async () => {
    const insertedId = await withRollback(testDatabase.admin, async (transaction) => {
      const [branch] = await transaction<{ id: string }[]>`
        insert into branches (code, name) values ('ROLLBACK', 'Rollback Test') returning id
      `;
      return branch?.id;
    });
    expect(insertedId).toBeDefined();
    if (insertedId === undefined) {
      throw new Error('Rollback fixture did not return a branch ID');
    }
    const countRows = await testDatabase.admin<{ count: string }[]>`
      select count(*) from branches where id = ${insertedId}
    `;

    expect(countRows[0]?.count).toBe('0');
  });

  it('starts parallel clients together and preserves a unique invariant', async () => {
    const results = await runConcurrently(8, async () => {
      return testDatabase.admin`
        insert into branches (code, name) values ('RACE', 'Concurrency Test') returning id
      `;
    });
    const countRows = await testDatabase.admin<{ count: string }[]>`
      select count(*) from branches where code = 'RACE'
    `;

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7);
    expect(countRows[0]?.count).toBe('1');
  });
});
