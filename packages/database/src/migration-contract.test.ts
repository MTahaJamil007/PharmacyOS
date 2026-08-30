import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '001_initial_schema.sql',
);
const posMigrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '002_pos_transaction_foundation.sql',
);

describe('initial migration contract', () => {
  it('encodes the non-negotiable database invariants', async () => {
    const sql = (await readFile(migrationPath, 'utf8')).toLowerCase();
    expect(sql).toContain('generated always as identity');
    expect(sql).toContain('numeric(12, 2)');
    expect(sql).toContain('numeric(12, 3)');
    expect(sql).toContain('using gin');
    expect(sql).toContain('prevent_append_only_mutation');
    expect(sql).toContain('for update skip locked');
    expect(sql).not.toContain('double precision');
    expect(sql).not.toContain('real ');
  });

  it('provides an atomic branch/day invoice sequence', async () => {
    const sql = (await readFile(posMigrationPath, 'utf8')).toLowerCase();
    expect(sql).toContain('on conflict (branch_id, business_date)');
    expect(sql).toContain('last_value = invoice_counters.last_value + 1');
    expect(sql).toContain('next_invoice_number');
  });
});
