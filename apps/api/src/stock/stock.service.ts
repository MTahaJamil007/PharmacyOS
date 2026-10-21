import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  openingStockRowSchema,
  scaledIntegerToDecimal,
  type ImportIssue,
  type MedicineStockDetail,
  type OpeningStockImportRequest,
  type OpeningStockImportResult,
  type OpeningStockRow,
  type ReorderPolicyRequest,
  type StockOverview,
  type StockOverviewQuery,
  type StockOverviewRow,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

type Queryable = Database | DatabaseTransaction;

interface ResolvedOpeningRow {
  readonly line: number;
  readonly row: OpeningStockRow;
  readonly medicineId: string;
}

const OPENING_SEGMENT = 'OPENING';

@Injectable()
export class StockService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Stock position per medicine. "Available" is sellable, unexpired stock less what open
   * counter reservations hold, which is what the next customer can actually be sold.
   */
  async overview(branchId: string, query: StockOverviewQuery): Promise<StockOverview> {
    const rows = await this.positions(this.database, branchId, {
      filter: query.filter,
      limit: query.limit,
      medicineId: null,
      offset: query.offset,
      search: query.query,
    });
    const [totals] = await this.database<
      Array<{
        matching: number;
        value_at_cost: string;
        value_at_retail: string;
        low: number;
        out: number;
        expiring: number;
      }>
    >`
      with positions as (${this.positionSql(branchId, query.query, null)})
      select count(*) filter (where ${this.filterPredicate(query.filter)})::int as matching,
        coalesce(sum(value_at_cost), 0)::text as value_at_cost,
        coalesce(sum(value_at_retail), 0)::text as value_at_retail,
        count(*) filter (where status = 'LOW')::int as low,
        count(*) filter (where status = 'OUT' and counts_as_out)::int as out,
        count(*) filter (where status = 'EXPIRING')::int as expiring
      from positions
    `;
    return {
      data: rows,
      totals: {
        expiring: totals?.expiring ?? 0,
        low: totals?.low ?? 0,
        matching: totals?.matching ?? 0,
        out: totals?.out ?? 0,
        valueAtCost: totals?.value_at_cost ?? '0.00',
        valueAtRetail: totals?.value_at_retail ?? '0.00',
      },
    };
  }

  async medicineDetail(branchId: string, medicineId: bigint): Promise<MedicineStockDetail> {
    const id = medicineId.toString();
    const [position] = await this.positions(this.database, branchId, {
      filter: 'ALL',
      limit: 1,
      medicineId: id,
      offset: 0,
      search: '',
    });
    if (!position) throw new NotFoundException('Medicine not found');
    const [units] = await this.database<Array<{ unit_name: string; pack_size: string }>>`
      select unit_name, pack_size::text from medicines where id = ${id}
    `;
    const [policy] = await this.database<Array<NonNullable<MedicineStockDetail['policy']>>>`
      select policies.minimum_stock::text as "minimumStock",
        policies.preferred_supplier_id::text as "preferredSupplierId",
        suppliers.name as "preferredSupplierName",
        policies.lead_time_days as "leadTimeDays", policies.safety_days as "safetyDays",
        policies.target_coverage_days as "targetCoverageDays",
        policies.minimum_order_qty::text as "minimumOrderQuantity",
        policies.order_multiple::text as "orderMultiple", policies.is_active as "isActive"
      from reorder_policies policies
      left join suppliers on suppliers.id = policies.preferred_supplier_id
      where policies.branch_id = ${branchId} and policies.medicine_id = ${id}
    `;
    const batches = await this.database<MedicineStockDetail['batches'][number][]>`
      select batches.id::text, batches.batch_number as "batchNumber",
        batches.expiry_date::text as "expiryDate",
        (batches.expiry_date - (now() at time zone branches.timezone)::date)::int
          as "daysToExpiry",
        batches.status, batches.current_qty::text as "currentQuantity",
        round(batches.cost_price, 2)::text as "costPrice", batches.sale_price::text as "salePrice",
        batches.maximum_retail_price::text as "maximumRetailPrice",
        batches.received_at as "receivedAt",
        case
          when batches.segment_key = ${OPENING_SEGMENT} then 'Opening stock'
          when batches.segment_key = 'RETURN_QUARANTINE' then 'Customer return'
          when batches.purchase_order_item_id is not null then 'Purchase'
          else 'Adjustment'
        end as source
      from inventory_batches batches join branches on branches.id = batches.branch_id
      where batches.branch_id = ${branchId} and batches.medicine_id = ${id}
        and batches.deleted_at is null
        and (batches.current_qty > 0 or batches.received_at > now() - interval '180 days')
      order by (batches.current_qty > 0) desc, batches.expiry_date, batches.id
      limit 100
    `;
    const movements = await this.database<MedicineStockDetail['movements'][number][]>`
      select movements.id::text, batches.batch_number as "batchNumber",
        movements.movement_type as "movementType",
        movements.quantity_delta::text as "quantityDelta",
        movements.quantity_after::text as "quantityAfter", movements.reason,
        users.display_name as "performedBy", movements.created_at as "createdAt"
      from stock_movements movements
      join inventory_batches batches on batches.id = movements.inventory_batch_id
      left join users on users.id = movements.performed_by_user_id
      where movements.branch_id = ${branchId} and batches.medicine_id = ${id}
      order by movements.id desc limit 50
    `;
    return {
      batches,
      medicine: {
        ...position,
        packSize: units?.pack_size ?? '1',
        unitName: units?.unit_name ?? 'unit',
      },
      movements,
      policy: policy ?? null,
    };
  }

  async upsertReorderPolicy(
    user: AuthenticatedUser,
    medicineId: bigint,
    input: ReorderPolicyRequest,
  ): Promise<{ readonly medicineId: string; readonly updated: true }> {
    const id = medicineId.toString();
    return this.database.begin(async (transaction) => {
      const [medicine] = await transaction<Array<{ id: string; pack_size: string }>>`
        select id::text, pack_size::text from medicines where id = ${id} and deleted_at is null
      `;
      if (!medicine) throw new NotFoundException('Medicine not found');
      const supplierId = input.preferredSupplierId?.toString() ?? null;
      if (supplierId) {
        const [supplier] = await transaction<Array<{ id: string }>>`
          select id::text from suppliers where id = ${supplierId} and branch_id = ${user.branchId}
            and deleted_at is null and is_active
        `;
        if (!supplier) throw new NotFoundException('Active supplier not found');
      }
      await transaction`
        insert into reorder_policies (
          branch_id, medicine_id, preferred_supplier_id, lead_time_days, safety_days,
          minimum_stock, pack_size, target_coverage_days, minimum_order_qty, order_multiple,
          is_active
        ) values (
          ${user.branchId}, ${id}, ${supplierId}, ${input.leadTimeDays}, ${input.safetyDays},
          ${input.minimumStock}, ${medicine.pack_size}, ${input.targetCoverageDays},
          ${input.minimumOrderQuantity}, ${input.orderMultiple}, ${input.isActive}
        )
        on conflict (branch_id, medicine_id) do update set
          preferred_supplier_id = excluded.preferred_supplier_id,
          lead_time_days = excluded.lead_time_days, safety_days = excluded.safety_days,
          minimum_stock = excluded.minimum_stock,
          target_coverage_days = excluded.target_coverage_days,
          minimum_order_qty = excluded.minimum_order_qty,
          order_multiple = excluded.order_multiple, is_active = excluded.is_active
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'INVENTORY.REORDER_POLICY_SET',
          'medicine', ${id}, ${transaction.json({ ...input, preferredSupplierId: supplierId })}
        )
      `;
      return { medicineId: id, updated: true as const };
    });
  }

  /**
   * Loads the stock a pharmacy already holds on the day it starts. `VALIDATE` never writes;
   * `APPLY` re-validates and writes nothing unless every row is clean. Each lot becomes an
   * acquisition batch with an opening ledger movement and an initial price history row.
   */
  async importOpeningStock(
    user: AuthenticatedUser,
    input: OpeningStockImportRequest,
  ): Promise<OpeningStockImportResult> {
    const validate = async (client: Queryable) => this.validateOpeningStock(client, user, input);
    if (input.mode === 'VALIDATE') {
      const result = await validate(this.database);
      return result.summary;
    }
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'STOCK.OPENING_IMPORT',
        user.branchId,
        input.clientRequestId,
      );
      const [replay] = await transaction<
        Array<{ metadata: Omit<OpeningStockImportResult, 'issues' | 'idempotentReplay'> }>
      >`
        select metadata from audit_events
        where branch_id = ${user.branchId} and request_id = ${input.clientRequestId}
          and event_type = 'STOCK.OPENING_IMPORTED'
      `;
      if (replay) return { ...replay.metadata, idempotentReplay: true, issues: [] };

      const { summary, accepted } = await validate(transaction);
      if (summary.rejected > 0 || accepted.length === 0) return summary;

      for (const entry of accepted) {
        const { row } = entry;
        const [batch] = await transaction<Array<{ id: string }>>`
          insert into inventory_batches (
            branch_id, medicine_id, batch_number, expiry_date, cost_price, sale_price,
            maximum_retail_price, current_qty, status, segment_key
          ) values (
            ${user.branchId}, ${entry.medicineId}, ${row.batchNumber}, ${row.expiryDate},
            ${row.costPrice}, ${row.salePrice}, ${row.maximumRetailPrice ?? null},
            ${row.quantity}, 'SELLABLE', ${OPENING_SEGMENT}
          ) returning id::text
        `;
        if (!batch) throw new Error('Opening stock batch was not created');
        await transaction`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
            performed_by_user_id, reason, metadata
          ) values (
            ${user.branchId}, ${batch.id}, 'ADJUSTMENT_IN', ${row.quantity}, ${row.quantity},
            ${user.id}, 'Opening stock',
            ${transaction.json({ source: 'OPENING_STOCK', clientRequestId: input.clientRequestId, row: entry.line })}
          )
        `;
        await transaction`
          insert into inventory_batch_price_history (
            branch_id, inventory_batch_id, new_sale_price, new_maximum_retail_price,
            change_type, reason, performed_by_user_id
          ) values (
            ${user.branchId}, ${batch.id}, ${row.salePrice}, ${row.maximumRetailPrice ?? null},
            'INITIAL', 'Opening stock', ${user.id}
          )
        `;
        await transaction`
          insert into reorder_policies (branch_id, medicine_id)
          values (${user.branchId}, ${entry.medicineId})
          on conflict (branch_id, medicine_id) do nothing
        `;
      }
      const result: OpeningStockImportResult = { ...summary, applied: true, mode: 'APPLY' };
      const auditable = {
        accepted: result.accepted,
        applied: result.applied,
        mode: result.mode,
        rejected: result.rejected,
        totalQuantity: result.totalQuantity,
        totalRows: result.totalRows,
        valueAtCost: result.valueAtCost,
      };
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'STOCK.OPENING_IMPORTED',
          'inventory_batch', ${input.clientRequestId}, ${transaction.json(auditable)}
        )
      `;
      return result;
    });
  }

  private async validateOpeningStock(
    client: Queryable,
    user: AuthenticatedUser,
    input: OpeningStockImportRequest,
  ): Promise<{ summary: OpeningStockImportResult; accepted: readonly ResolvedOpeningRow[] }> {
    const issues: ImportIssue[] = [];
    const parsed: Array<{ line: number; row: OpeningStockRow }> = [];
    for (const [index, raw] of input.rows.entries()) {
      const line = index + 1;
      const result = openingStockRowSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            field: issue.path.map(String).join('.') || '(row)',
            message: issue.message,
            row: line,
          });
        }
        continue;
      }
      parsed.push({ line, row: result.data });
    }

    const [clock] = await client<Array<{ today: string }>>`
      select (now() at time zone timezone)::date::text as today from branches where id = ${user.branchId}
    `;
    const today = clock?.today ?? new Date().toISOString().slice(0, 10);
    const skus = [...new Set(parsed.flatMap((entry) => (entry.row.sku ? [entry.row.sku] : [])))];
    const barcodes = [
      ...new Set(parsed.flatMap((entry) => (entry.row.barcode ? [entry.row.barcode] : []))),
    ];
    const bySku = new Map<string, string>();
    const byBarcode = new Map<string, string>();
    if (skus.length > 0) {
      for (const found of await client<Array<{ id: string; sku: string }>>`
        select id::text, sku from medicines
        where sku in ${client(skus)} and deleted_at is null and is_active
      `) {
        bySku.set(found.sku, found.id);
      }
    }
    if (barcodes.length > 0) {
      for (const found of await client<Array<{ id: string; barcode: string }>>`
        select medicines.id::text, medicine_barcodes.barcode from medicine_barcodes
        join medicines on medicines.id = medicine_barcodes.medicine_id
        where medicine_barcodes.barcode in ${client(barcodes)}
          and medicines.deleted_at is null and medicines.is_active
      `) {
        byBarcode.set(found.barcode, found.id);
      }
    }

    const resolved: ResolvedOpeningRow[] = [];
    const seen = new Map<string, number>();
    for (const entry of parsed) {
      const { row, line } = entry;
      const fromSku = row.sku ? bySku.get(row.sku) : undefined;
      const fromBarcode = row.barcode ? byBarcode.get(row.barcode) : undefined;
      if (fromSku && fromBarcode && fromSku !== fromBarcode) {
        issues.push({
          field: 'barcode',
          message: 'SKU and barcode name different medicines',
          row: line,
        });
        continue;
      }
      const medicineId = fromSku ?? fromBarcode;
      if (!medicineId) {
        issues.push({
          field: row.sku ? 'sku' : 'barcode',
          message: 'No active catalog medicine has this SKU or barcode; import the catalog first',
          row: line,
        });
        continue;
      }
      if (row.expiryDate <= today) {
        issues.push({
          field: 'expiryDate',
          message: 'Expired or expiring today; do not load it as sellable stock',
          row: line,
        });
        continue;
      }
      const key = `${medicineId}|${row.batchNumber.toUpperCase()}|${row.expiryDate}`;
      const first = seen.get(key);
      if (first !== undefined) {
        issues.push({
          field: 'batchNumber',
          message: `Same medicine, batch, and expiry as row ${String(first)}; combine the quantities`,
          row: line,
        });
        continue;
      }
      seen.set(key, line);
      resolved.push({ line, medicineId, row });
    }

    if (resolved.length > 0) {
      const existing = await client<Array<{ key: string }>>`
        select medicine_id::text || '|' || upper(batch_number) || '|' || expiry_date::text as key
        from inventory_batches
        where branch_id = ${user.branchId} and segment_key = ${OPENING_SEGMENT}
          and medicine_id in ${client([...new Set(resolved.map((entry) => entry.medicineId))])}
      `;
      const already = new Set(existing.map((row) => row.key));
      for (const entry of [...resolved]) {
        const key = `${entry.medicineId}|${entry.row.batchNumber.toUpperCase()}|${entry.row.expiryDate}`;
        if (already.has(key)) {
          issues.push({
            field: 'batchNumber',
            message: 'Opening stock for this batch was already loaded',
            row: entry.line,
          });
          resolved.splice(resolved.indexOf(entry), 1);
        }
      }
    }

    const rejectedRows = new Set(issues.map((issue) => issue.row));
    let quantity = 0n;
    let value = 0n;
    for (const entry of resolved) {
      quantity += decimalToScaledInteger(entry.row.quantity, 3);
      value += moneyToMinorUnits(multiplyMoneyByQuantity(entry.row.costPrice, entry.row.quantity));
    }
    return {
      accepted: resolved,
      summary: {
        accepted: resolved.length,
        applied: false,
        idempotentReplay: false,
        issues: issues.sort((left, right) => left.row - right.row),
        mode: input.mode,
        rejected: rejectedRows.size,
        totalQuantity: scaledIntegerToDecimal(quantity, 3),
        totalRows: input.rows.length,
        valueAtCost: minorUnitsToMoney(value),
      },
    };
  }

  private filterPredicate(filter: StockOverviewQuery['filter']) {
    switch (filter) {
      case 'IN_STOCK':
        return this.database`available_quantity > 0`;
      case 'LOW':
        return this.database`status = 'LOW'`;
      case 'OUT':
        return this.database`status = 'OUT' and counts_as_out`;
      case 'EXPIRING':
        return this.database`status = 'EXPIRING' or (expiring_soon and available_quantity > 0)`;
      case 'ALL':
        return this.database`true`;
    }
  }

  private positionSql(branchId: string, search: string, medicineId: string | null) {
    const value = search.trim();
    return this.database`
      with clock as materialized (
        select (now() at time zone timezone)::date as today from branches where id = ${branchId}
      ), window_days as materialized (
        select coalesce((
          select expiry_moderate_days from operational_intelligence_policies
          where branch_id = ${branchId}
        ), 90) as expiring_days
      ), base as (
        select medicines.id, medicines.name, medicines.generic_name, medicines.strength,
          medicines.sku, manufacturers.name as manufacturer, barcode.barcode,
          coalesce(stock.sellable, 0::numeric(12, 3)) as sellable,
          coalesce(reserved.quantity, 0::numeric(12, 3)) as reserved,
          coalesce(stock.quarantined, 0::numeric(12, 3)) as quarantined,
          coalesce(stock.expired, 0::numeric(12, 3)) as expired,
          stock.nearest_expiry, stock.sale_price,
          coalesce(stock.value_at_cost, 0) as value_at_cost,
          coalesce(stock.value_at_retail, 0) as value_at_retail,
          coalesce(stock.ever_stocked, false) as ever_stocked,
          policies.minimum_stock, coalesce(velocity.average_daily, 0) as average_daily,
          clock.today, window_days.expiring_days
        from medicines
        cross join clock cross join window_days
        left join manufacturers on manufacturers.id = medicines.manufacturer_id
        left join lateral (
          select medicine_barcodes.barcode from medicine_barcodes
          where medicine_barcodes.medicine_id = medicines.id
          order by medicine_barcodes.is_primary desc, medicine_barcodes.id limit 1
        ) barcode on true
        left join lateral (
          select
            sum(current_qty) filter (where status = 'SELLABLE' and expiry_date >= clock.today)
              as sellable,
            sum(current_qty) filter (where status in ('QUARANTINE', 'RECALLED')) as quarantined,
            sum(current_qty) filter (where status = 'SELLABLE' and expiry_date < clock.today)
              as expired,
            min(expiry_date) filter (
              where status = 'SELLABLE' and current_qty > 0 and expiry_date >= clock.today
            ) as nearest_expiry,
            (array_agg(sale_price order by expiry_date, received_at, id) filter (
              where status = 'SELLABLE' and current_qty > 0 and expiry_date >= clock.today
            ))[1] as sale_price,
            round(coalesce(sum(current_qty * cost_price) filter (where current_qty > 0), 0), 2)
              as value_at_cost,
            round(coalesce(sum(current_qty * sale_price) filter (
              where status = 'SELLABLE' and expiry_date >= clock.today
            ), 0), 2) as value_at_retail,
            count(*) > 0 as ever_stocked
          from inventory_batches
          where inventory_batches.branch_id = ${branchId}
            and inventory_batches.medicine_id = medicines.id
            and inventory_batches.deleted_at is null
        ) stock on true
        left join lateral (
          select sum(reservations.quantity) as quantity
          from stock_reservations reservations
          join inventory_batches batches on batches.id = reservations.inventory_batch_id
          where batches.branch_id = ${branchId} and batches.medicine_id = medicines.id
            and reservations.status = 'ACTIVE' and reservations.expires_at > now()
        ) reserved on true
        left join reorder_policies policies on policies.branch_id = ${branchId}
          and policies.medicine_id = medicines.id and policies.is_active
        left join lateral (
          select sum(quantity_sold) / 30.0 as average_daily from sales_velocity_daily
          where sales_velocity_daily.branch_id = ${branchId}
            and sales_velocity_daily.medicine_id = medicines.id
            and sales_velocity_daily.sales_date > clock.today - 30
        ) velocity on true
        where medicines.deleted_at is null and medicines.is_active
          and (${medicineId}::bigint is null or medicines.id = ${medicineId}::bigint)
          and (
            ${value} = ''
            or medicines.name ilike ${`%${value}%`}
            or coalesce(medicines.generic_name, '') ilike ${`%${value}%`}
            or coalesce(medicines.sku, '') = ${value}
            or exists (
              select 1 from medicine_barcodes
              where medicine_barcodes.medicine_id = medicines.id
                and medicine_barcodes.barcode = ${value}
            )
          )
      )
      select base.*,
        greatest(sellable - reserved, 0) as available_quantity,
        (ever_stocked or coalesce(minimum_stock, 0) > 0) as counts_as_out,
        (nearest_expiry is not null and nearest_expiry <= today + expiring_days) as expiring_soon,
        case
          when sellable - reserved <= 0 then 'OUT'
          when coalesce(minimum_stock, 0) > 0 and sellable - reserved <= minimum_stock then 'LOW'
          when nearest_expiry is not null and nearest_expiry <= today + expiring_days
            then 'EXPIRING'
          else 'OK'
        end as status
      from base
    `;
  }

  private async positions(
    client: Queryable,
    branchId: string,
    options: {
      readonly search: string;
      readonly filter: StockOverviewQuery['filter'];
      readonly limit: number;
      readonly offset: number;
      readonly medicineId: string | null;
    },
  ): Promise<readonly StockOverviewRow[]> {
    const order =
      options.filter === 'LOW' || options.filter === 'OUT'
        ? client`order by available_quantity, name, id`
        : options.filter === 'EXPIRING'
          ? client`order by nearest_expiry nulls last, name, id`
          : client`order by name, id`;
    return client<StockOverviewRow[]>`
      with positions as (${this.positionSql(branchId, options.search, options.medicineId)})
      select id::text as "medicineId", name, generic_name as "genericName", strength,
        manufacturer, sku, barcode,
        sellable::text as "sellableQuantity", reserved::text as "reservedQuantity",
        available_quantity::text as "availableQuantity",
        quarantined::text as "quarantinedQuantity", expired::text as "expiredQuantity",
        nearest_expiry::text as "nearestExpiry",
        (nearest_expiry - today)::int as "daysToExpiry",
        sale_price::text as "salePrice",
        value_at_cost::text as "valueAtCost", value_at_retail::text as "valueAtRetail",
        minimum_stock::text as "minimumStock",
        round(average_daily, 3)::text as "averageDailySales",
        case when average_daily > 0 then round(available_quantity / average_daily, 1)::text
          else null end as "daysOfCover",
        status
      from positions
      where ${this.filterPredicate(options.filter)}
      ${order}
      limit ${options.limit} offset ${options.offset}
    `;
  }
}
