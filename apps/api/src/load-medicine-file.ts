// Loads the repository .env before anything reads process.env. Other entry points receive it as a
// side effect of an unrelated import; this tool states the dependency.
import '@pharmacy/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { createDatabase, type Database, type DatabaseTransaction } from '@pharmacy/database';
import {
  catalogImportRowSchema,
  NON_CONTRACT_FIELDS,
  parseCatalogFile,
  type CatalogImportIssue,
} from '@pharmacy/shared';

import { CatalogImportService } from './administration/catalog-import.service.js';
import type { AuthenticatedUser } from './auth/auth.types.js';

/**
 * Loads a medicine catalog file that a pharmacy or a regulator publishes.
 *
 * The catalog itself goes through `CatalogImportService`, the same validated path the
 * administration screen uses, so a file cannot introduce rows the API would reject. Prices and
 * opening quantities are a separate, explicitly requested step: a sale price lives on an
 * inventory batch, not on a catalog row, and inventing stock is only ever a development fixture.
 *
 * Usage:
 *   npm run load:medicines --workspace @pharmacy/api -- <file.csv> [options]
 *
 *   --validate-only     Report what the file would do and write nothing.
 *   --with-demo-stock   Also create one opening batch per medicine, priced from the file.
 *                       Requires ALLOW_DEVELOPMENT_SEED=true and refuses in production.
 *   --quantity <n>      Opening quantity per batch for --with-demo-stock (default 50).
 *   --limit <n>         Load only the first n data rows, for a trial run.
 *   --operator <name>   Username the load is audited against (default BOOTSTRAP_OWNER_USERNAME).
 */

const CHUNK_SIZE = 2000;

interface Options {
  readonly filePath: string;
  readonly limit: number | null;
  readonly operator: string;
  readonly quantity: string;
  readonly validateOnly: boolean;
  readonly withDemoStock: boolean;
}

function readOptions(argv: readonly string[]): Options {
  const positional = argv.filter((value) => !value.startsWith('--'));
  const filePath = positional[0];
  if (!filePath) throw new Error('A catalog file path is required');

  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const limitRaw = flag('limit');
  const limit = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  const quantity = flag('quantity') ?? '50';
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(quantity)) {
    throw new Error('--quantity must be a non-negative number with up to three decimals');
  }
  const operator = flag('operator') ?? process.env.BOOTSTRAP_OWNER_USERNAME ?? '';
  if (!operator) {
    throw new Error('Pass --operator, or set BOOTSTRAP_OWNER_USERNAME, so the load is audited');
  }
  return {
    filePath,
    limit,
    operator,
    quantity,
    validateOnly: argv.includes('--validate-only'),
    withDemoStock: argv.includes('--with-demo-stock'),
  };
}

/** The load is recorded against a real operator on a real terminal, like any other write. */
async function resolveOperator(database: Database, username: string): Promise<AuthenticatedUser> {
  const [row] = await database<
    Array<{
      branch_id: string;
      display_name: string;
      terminal_id: string;
      user_id: string;
      username: string;
    }>
  >`
    select users.id::text as user_id, users.username, users.display_name,
      user_branch_roles.branch_id::text as branch_id, terminals.id::text as terminal_id
    from users
    join user_branch_roles on user_branch_roles.user_id = users.id
    join terminals on terminals.branch_id = user_branch_roles.branch_id
      and terminals.is_active = true
    where lower(users.username) = lower(${username})
      and users.is_active = true and users.deleted_at is null
    order by user_branch_roles.branch_id, terminals.id
    limit 1
  `;
  if (!row) {
    throw new Error(`No active user "${username}" with a branch role and an active terminal`);
  }
  return {
    branchId: row.branch_id,
    displayName: row.display_name,
    id: row.user_id,
    permissions: [],
    sessionId: '0',
    terminalId: row.terminal_id,
    username: row.username,
  } satisfies AuthenticatedUser;
}

function reportIssues(issues: readonly CatalogImportIssue[]): void {
  const shown = issues.slice(0, 25);
  for (const issue of shown) {
    process.stdout.write(`  row ${String(issue.row)} ${issue.field}: ${issue.message}\n`);
  }
  if (issues.length > shown.length) {
    process.stdout.write(`  … and ${String(issues.length - shown.length)} more\n`);
  }
}

function chunk<T>(rows: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

/**
 * Opening stock for a development environment: one batch per priced medicine, recorded through
 * the append-only stock ledger exactly like the existing development fixture, and never touching
 * a batch that already has movement history.
 */
async function loadDemoStock(
  transaction: DatabaseTransaction,
  branchId: string,
  rows: readonly Record<string, unknown>[],
  quantity: string,
): Promise<{ readonly batches: number; readonly skipped: number }> {
  let batches = 0;
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    const salePrice = typeof row.salePrice === 'string' ? row.salePrice.trim() : '';
    const sku = typeof row.sku === 'string' ? row.sku.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(salePrice) || Number(salePrice) <= 0) {
      skipped += 1;
      continue;
    }
    const costPriceRaw = typeof row.costPrice === 'string' ? row.costPrice.trim() : '';
    const costPrice = /^\d{1,10}(?:\.\d{1,2})?$/.test(costPriceRaw)
      ? costPriceRaw
      : (Number(salePrice) * 0.8).toFixed(2);
    // Expiries are spread across the next two years so expiry reporting has a realistic shape.
    const expiryDays = 30 + ((index * 37) % 700);
    const [batch] = await transaction<Array<{ id: string }>>`
      with target as (
        select id from medicines
        where deleted_at is null
          and (
            (${sku || null}::text is not null and sku = ${sku || null})
            or (${sku ? null : name}::text is not null and name = ${sku ? null : name})
          )
        order by id limit 1
      )
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date, received_at, cost_price, sale_price,
        current_qty, status
      )
      select ${branchId}, target.id, 'FILE-LOAD-' || target.id::text,
        current_date + ${expiryDays}::integer, now(), ${costPrice}::numeric, ${salePrice}::numeric,
        ${quantity}::numeric, 'SELLABLE'
      from target
      on conflict on constraint inventory_batches_acquisition_lot_key
      do update set sale_price = excluded.sale_price, cost_price = excluded.cost_price,
        current_qty = case
          when exists (
            select 1 from stock_movements
            where stock_movements.inventory_batch_id = inventory_batches.id
          ) then inventory_batches.current_qty
          else excluded.current_qty
        end,
        status = 'SELLABLE', deleted_at = null
      returning id::text
    `;
    if (!batch) {
      skipped += 1;
      continue;
    }
    batches += 1;
    await transaction`
      insert into stock_movements (
        branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason,
        metadata
      )
      select ${branchId}, inventory_batches.id, 'ADJUSTMENT_IN', inventory_batches.current_qty,
        inventory_batches.current_qty, 'Catalog file load opening balance',
        ${transaction.json({ fixture: true })}
      from inventory_batches
      where inventory_batches.id = ${batch.id}
        and inventory_batches.current_qty > 0
        and not exists (
          select 1 from stock_movements
          where stock_movements.inventory_batch_id = inventory_batches.id
        )
    `;
  }
  return { batches, skipped };
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');
  if (options.withDemoStock) {
    if ((process.env.NODE_ENV ?? 'development') === 'production') {
      throw new Error('Demo stock refused in production');
    }
    if (process.env.ALLOW_DEVELOPMENT_SEED !== 'true') {
      throw new Error('Demo stock requires ALLOW_DEVELOPMENT_SEED=true');
    }
  }

  const contents = await readFile(options.filePath, 'utf8');
  const digest = createHash('sha256').update(contents).digest('hex');
  const parsed = parseCatalogFile(contents);
  const rows = options.limit === null ? parsed.rows : parsed.rows.slice(0, options.limit);

  process.stdout.write(`File: ${basename(options.filePath)} (sha256 ${digest.slice(0, 16)}…)\n`);
  process.stdout.write(`Recognized columns: ${parsed.recognizedColumns.join(', ') || '(none)'}\n`);
  if (parsed.ignoredColumns.length > 0) {
    process.stdout.write(`Ignored columns: ${parsed.ignoredColumns.join(', ')}\n`);
  }
  process.stdout.write(`Data rows: ${String(rows.length)}\n`);
  if (rows.length === 0) throw new Error('The file contains no data rows');
  if (!parsed.recognizedColumns.some((column) => column.length > 0)) {
    throw new Error('No column of this file maps to the catalog contract');
  }

  // Validate every row locally first, with the same schema the endpoint applies, so a large file
  // reports all of its problems in one pass instead of failing chunk by chunk.
  const localIssues: CatalogImportIssue[] = [];
  for (const [index, row] of rows.entries()) {
    const result = catalogImportRowSchema.safeParse(row);
    if (result.success) continue;
    for (const issue of result.error.issues) {
      localIssues.push({
        row: index + 1,
        field: issue.path.map(String).join('.') || '(row)',
        message: issue.message,
      });
    }
  }
  if (localIssues.length > 0) {
    process.stdout.write(
      `\nRejected rows: ${String(new Set(localIssues.map((i) => i.row)).size)}\n`,
    );
    reportIssues(localIssues);
    throw new Error('Fix the rejected rows, or drop them from the file, and run again');
  }
  process.stdout.write('Every row satisfies the catalog import contract.\n');

  const database = createDatabase(connectionString, { max: 4 });
  try {
    const operator = await resolveOperator(database, options.operator);
    const service = new CatalogImportService(database);
    const contractRows = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([field]) => !NON_CONTRACT_FIELDS.includes(field)),
      ),
    );
    const chunks = chunk(contractRows, CHUNK_SIZE);
    let created = 0;
    let updated = 0;

    for (const [index, batch] of chunks.entries()) {
      const label = `chunk ${String(index + 1)}/${String(chunks.length)}`;
      const result = await service.import(operator, {
        // A stable identifier per file and chunk makes a repeated run replay instead of duplicate.
        clientRequestId: `catalog-file-${digest.slice(0, 24)}-${String(index).padStart(4, '0')}`,
        mode: options.validateOnly ? 'VALIDATE' : 'APPLY',
        rows: batch,
      });
      created += result.created;
      updated += result.updated;
      if (result.issues.length > 0) {
        process.stdout.write(`${label}: rejected ${String(result.rejected)} row(s)\n`);
        reportIssues(result.issues);
        throw new Error(`${label} was rejected; nothing in that chunk was written`);
      }
      process.stdout.write(
        `${label}: ${options.validateOnly ? 'would create' : 'created'} ${String(result.created)}` +
          `, ${options.validateOnly ? 'would update' : 'updated'} ${String(result.updated)}` +
          `${result.idempotentReplay ? ' (replay of an earlier identical load)' : ''}\n`,
      );
    }

    if (options.validateOnly) {
      process.stdout.write(
        `\nValidation only. ${String(created)} would be created, ${String(updated)} updated.\n`,
      );
      return;
    }

    let stockSummary = '';
    if (options.withDemoStock) {
      const stock = await database.begin((transaction) =>
        loadDemoStock(transaction, operator.branchId, rows, options.quantity),
      );
      stockSummary =
        `Demo stock: ${String(stock.batches)} batch(es) at quantity ${options.quantity}` +
        `, ${String(stock.skipped)} row(s) skipped for a missing or unusable price.\n`;
      process.stdout.write(stockSummary);
    }

    // Provenance: which file produced this catalog, and what it did.
    await database`
      insert into audit_events (
        branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
      ) values (
        ${operator.branchId}, ${operator.id}, ${operator.terminalId}, 'CATALOG.FILE_LOADED',
        'medicine', null,
        ${database.json({
          created,
          demoStock: options.withDemoStock,
          fileName: basename(options.filePath),
          fileSha256: digest,
          rows: rows.length,
          updated,
        })}
      )
    `;
    process.stdout.write(
      `\nLoaded ${String(rows.length)} row(s): ${String(created)} created, ` +
        `${String(updated)} updated.\n`,
    );
  } finally {
    await database.end();
  }
}

await main();
