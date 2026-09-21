import { Inject, Injectable } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  catalogImportRowSchema,
  type CatalogImportIssue,
  type CatalogImportRequest,
  type CatalogImportResult,
  type CatalogImportRow,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

interface ParsedRow {
  readonly line: number;
  readonly row: CatalogImportRow;
}

interface ExistingMedicine {
  readonly id: string;
  readonly sku: string | null;
  readonly barcode: string | null;
}

/**
 * Bulk catalog onboarding. A pharmacy arrives with a spreadsheet, not with 4,000
 * individual form submissions, and a wrong catalog invalidates every otherwise-correct
 * figure the system produces. `VALIDATE` therefore always runs first and never writes;
 * `APPLY` re-validates and refuses to write anything if any row is still rejected.
 */
@Injectable()
export class CatalogImportService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async import(user: AuthenticatedUser, input: CatalogImportRequest): Promise<CatalogImportResult> {
    const issues: CatalogImportIssue[] = [];
    const parsed: ParsedRow[] = [];

    for (const [index, raw] of input.rows.entries()) {
      const line = index + 1;
      const result = catalogImportRowSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            row: line,
            field: issue.path.map(String).join('.') || '(row)',
            message: issue.message,
          });
        }
        continue;
      }
      parsed.push({ line, row: result.data });
    }

    this.collectDuplicateIssues(parsed, issues);

    const rejectedRows = new Set(issues.map((issue) => issue.row));
    const accepted = parsed.filter((entry) => !rejectedRows.has(entry.line));

    if (input.mode === 'VALIDATE' || accepted.length === 0 || issues.length > 0) {
      const classified = await this.classify(accepted);
      return {
        mode: input.mode,
        applied: false,
        totalRows: input.rows.length,
        created: classified.created,
        updated: classified.updated,
        unchanged: 0,
        rejected: rejectedRows.size,
        issues,
        idempotentReplay: false,
      };
    }

    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(transaction, 'CATALOG.IMPORT', user.branchId, input.clientRequestId);
      const [replay] = await transaction<
        Array<{ metadata: Omit<CatalogImportResult, 'issues' | 'idempotentReplay'> }>
      >`
        select metadata from audit_events
        where branch_id = ${user.branchId} and request_id = ${input.clientRequestId}
          and event_type = 'CATALOG.IMPORTED'
      `;
      if (replay) {
        return { ...replay.metadata, issues: [], idempotentReplay: true };
      }

      let created = 0;
      let updated = 0;
      for (const entry of accepted) {
        const existing = await this.findExisting(transaction, entry.row);
        if (existing) {
          await this.updateMedicine(transaction, existing.id, entry.row);
          updated += 1;
        } else {
          await this.insertMedicine(transaction, entry.row);
          created += 1;
        }
      }

      const result: CatalogImportResult = {
        mode: 'APPLY',
        applied: true,
        totalRows: input.rows.length,
        created,
        updated,
        unchanged: 0,
        rejected: 0,
        issues: [],
        idempotentReplay: false,
      };
      const auditMetadata = {
        applied: true,
        created,
        mode: 'APPLY',
        rejected: 0,
        totalRows: input.rows.length,
        unchanged: 0,
        updated,
      };
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CATALOG.IMPORTED',
          'medicine', null, ${input.clientRequestId}, ${transaction.json(auditMetadata)}
        )
      `;
      return result;
    });
  }

  /**
   * A file that names the same SKU or barcode twice would otherwise apply the last
   * row silently and lose the earlier one, so both lines are reported instead.
   */
  private collectDuplicateIssues(parsed: readonly ParsedRow[], issues: CatalogImportIssue[]): void {
    for (const field of ['sku', 'barcode'] as const) {
      const seen = new Map<string, number>();
      for (const entry of parsed) {
        const value = entry.row[field];
        if (!value) continue;
        const first = seen.get(value);
        if (first === undefined) {
          seen.set(value, entry.line);
          continue;
        }
        issues.push({
          row: entry.line,
          field,
          message: `Duplicate ${field} "${value}"; first seen on row ${String(first)}`,
        });
      }
    }
  }

  private async classify(
    accepted: readonly ParsedRow[],
  ): Promise<{ readonly created: number; readonly updated: number }> {
    let created = 0;
    let updated = 0;
    for (const entry of accepted) {
      const existing = await this.findExisting(this.database, entry.row);
      if (existing) updated += 1;
      else created += 1;
    }
    return { created, updated };
  }

  private async findExisting(
    client: Database | DatabaseTransaction,
    row: CatalogImportRow,
  ): Promise<ExistingMedicine | null> {
    const [match] = await client<ExistingMedicine[]>`
      select medicines.id::text, medicines.sku, barcodes.barcode
      from medicines
      left join lateral (
        select barcode from medicine_barcodes
        where medicine_id = medicines.id order by is_primary desc, id limit 1
      ) barcodes on true
      where medicines.deleted_at is null
        and (
          (${row.sku ?? null}::text is not null and medicines.sku = ${row.sku ?? null})
          or (${row.barcode ?? null}::text is not null and barcodes.barcode = ${row.barcode ?? null})
        )
      order by medicines.id limit 1
    `;
    return match ?? null;
  }

  private async insertMedicine(
    transaction: DatabaseTransaction,
    row: CatalogImportRow,
  ): Promise<void> {
    const [medicine] = await transaction<Array<{ id: string }>>`
      insert into medicines (
        sku, name, generic_name, strength, dosage_form, pack_size, unit_name,
        requires_prescription, storage_class, requires_secured_storage,
        hs_code, tax_rate, fbr_uom, fbr_sale_type
      ) values (
        ${row.sku ?? null}, ${row.name}, ${row.genericName ?? null},
        ${row.strength ?? null}, ${row.dosageForm ?? null}, ${row.packSize},
        ${row.unitName}, ${row.requiresPrescription}, ${row.storageClass},
        ${row.requiresSecuredStorage}, ${row.hsCode ?? null}, ${row.taxRate},
        ${row.fbrUom}, ${row.fbrSaleType}
      ) returning id::text
    `;
    if (!medicine) throw new Error('Catalog import did not return a medicine identifier');
    if (row.barcode) {
      await transaction`
        insert into medicine_barcodes (medicine_id, barcode, is_primary)
        values (${medicine.id}, ${row.barcode}, true)
      `;
    }
  }

  private async updateMedicine(
    transaction: DatabaseTransaction,
    medicineId: string,
    row: CatalogImportRow,
  ): Promise<void> {
    await transaction`
      update medicines set
        sku = coalesce(${row.sku ?? null}, sku),
        name = ${row.name},
        generic_name = coalesce(${row.genericName ?? null}, generic_name),
        strength = coalesce(${row.strength ?? null}, strength),
        dosage_form = coalesce(${row.dosageForm ?? null}, dosage_form),
        pack_size = ${row.packSize}::numeric,
        unit_name = ${row.unitName},
        requires_prescription = ${row.requiresPrescription},
        storage_class = ${row.storageClass},
        requires_secured_storage = ${row.requiresSecuredStorage},
        hs_code = coalesce(${row.hsCode ?? null}, hs_code),
        tax_rate = ${row.taxRate}::numeric,
        fbr_uom = ${row.fbrUom},
        fbr_sale_type = ${row.fbrSaleType}
      where id = ${medicineId}
    `;
    if (row.barcode) {
      await transaction`
        delete from medicine_barcodes where medicine_id = ${medicineId} and is_primary
      `;
      await transaction`
        insert into medicine_barcodes (medicine_id, barcode, is_primary)
        values (${medicineId}, ${row.barcode}, true)
      `;
    }
  }
}
