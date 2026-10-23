import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import {
  numberSetting,
  parseScannedCode,
  storedBarcodeForGtin,
  type CustomerRequestInput,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';
import { FeaturesService } from '../features/features.service.js';

export interface ScannedMedicine {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly packSize: string;
  readonly unitName: string;
  readonly storageClass: string;
  readonly requiresSecured: boolean;
  readonly requiresPrescription: boolean;
}

export interface ReceivingDefaults {
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly costPerPack: string | null;
  readonly unitsPerPack: string;
  readonly salePricePerUnit: string | null;
  readonly lastReceivedAt: string | null;
}

export interface LowStockRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly packSize: string;
  readonly onHand: string;
  readonly dailySales: string;
  readonly daysLeft: number | null;
  readonly minimumStock: string | null;
  readonly suggestedPacks: number;
}

export interface StuckStockRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly quantity: string;
  readonly value: string;
  readonly nearestExpiry: string;
  readonly lastSoldAt: string | null;
  readonly inStockSince: string;
}

export interface ExpiringRow {
  readonly batchId: string;
  readonly medicineId: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly daysLeft: number;
  readonly quantity: string;
  readonly value: string;
  readonly shelf: string | null;
}

export interface RequestRow {
  readonly medicineId: string | null;
  readonly requestedName: string;
  readonly times: number;
  readonly lastAsked: string;
  readonly quantity: string | null;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly onHand: string;
}

const MEDICINE_COLUMNS = `
  medicines.id::text, medicines.name, medicines.generic_name as "genericName",
  medicines.strength, medicines.dosage_form as "dosageForm",
  manufacturers.name as manufacturer, medicines.pack_size::text as "packSize",
  medicines.unit_name as "unitName", medicines.storage_class as "storageClass",
  medicines.requires_secured_storage as "requiresSecured",
  medicines.requires_prescription as "requiresPrescription"`;

function normalizeRequestName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Day-to-day stock work: identify scanned packs, warn about low, stuck and expiring stock, and
 * record what customers asked for that the shop did not have. Durations come from the shop's
 * feature settings, so the owner tunes them without a code change.
 */
@Injectable()
export class StockControlService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(FeaturesService) private readonly features: FeaturesService,
  ) {}

  /** What a scanned pack is, with last delivery's prices so receiving is mostly checking. */
  async scan(user: AuthenticatedUser, code: string) {
    const scanned = parseScannedCode(code);
    const keys = scanned.lookupKeys;
    const [medicine] =
      keys.length === 0
        ? []
        : await this.database<ScannedMedicine[]>`
            select ${this.database.unsafe(MEDICINE_COLUMNS)}
            from medicine_barcodes
            join medicines on medicines.id = medicine_barcodes.medicine_id
            left join manufacturers on manufacturers.id = medicines.manufacturer_id
            where medicine_barcodes.barcode = any(${this.database.array([...keys])}::text[])
              and medicines.deleted_at is null
            order by array_position(${this.database.array([...keys])}::text[],
              medicine_barcodes.barcode)
            limit 1
          `;
    const shop = await this.features.forShop(user.branchId);
    const warnDays = numberSetting(shop.features, 'SCAN_RECEIVING', 'warnShelfLifeDays');
    const warnings: string[] = [...scanned.problems];
    const [clock] = await this.database<Array<{ today: string }>>`
      select (now() at time zone timezone)::date::text as today from branches
      where id = ${user.branchId}`;
    if (scanned.expiryDate && clock) {
      const days = Math.round(
        (Date.parse(scanned.expiryDate) - Date.parse(clock.today)) / 86_400_000,
      );
      if (days <= 0) warnings.push('This pack has expired. Do not receive it.');
      else if (days < warnDays) warnings.push(`Only ${days} days of shelf life left.`);
    }
    return {
      scan: scanned,
      medicine: medicine ?? null,
      defaults: medicine ? await this.defaults(user.branchId, medicine) : null,
      existingBatch:
        medicine && scanned.batch
          ? await this.existingBatch(user.branchId, medicine.id, scanned.batch)
          : null,
      warnings,
    };
  }

  async medicineForReceiving(user: AuthenticatedUser, medicineId: string) {
    const [medicine] = await this.database<ScannedMedicine[]>`
      select ${this.database.unsafe(MEDICINE_COLUMNS)}
      from medicines left join manufacturers on manufacturers.id = medicines.manufacturer_id
      where medicines.id = ${medicineId} and medicines.deleted_at is null`;
    if (!medicine) throw new NotFoundException('Medicine not found');
    return { medicine, defaults: await this.defaults(user.branchId, medicine) };
  }

  private async defaults(branchId: string, medicine: ScannedMedicine): Promise<ReceivingDefaults> {
    const [last] = await this.database<
      Array<{
        supplier_id: string;
        supplier_name: string;
        unit_cost: string;
        base_units: string;
        sale_price: string | null;
        received_at: string;
      }>
    >`
      select orders.supplier_id::text, suppliers.name as supplier_name,
        round(items.unit_cost, 2)::text as unit_cost,
        items.base_units_per_order_unit::text as base_units,
        batches.sale_price::text as sale_price, receipts.received_at::text as received_at
      from goods_receipt_items receipt_items
      join goods_receipts receipts on receipts.id = receipt_items.goods_receipt_id
      join purchase_order_items items on items.id = receipt_items.purchase_order_item_id
      join purchase_orders orders on orders.id = items.purchase_order_id
      join suppliers on suppliers.id = orders.supplier_id
      left join inventory_batches batches on batches.id = receipt_items.inventory_batch_id
      where receipts.branch_id = ${branchId} and items.medicine_id = ${medicine.id}
      order by receipts.received_at desc, receipt_items.id desc
      limit 1
    `;
    if (last) {
      return {
        supplierId: last.supplier_id,
        supplierName: last.supplier_name,
        costPerPack: last.unit_cost,
        unitsPerPack: last.base_units,
        salePricePerUnit: last.sale_price,
        lastReceivedAt: last.received_at,
      };
    }
    const [batch] = await this.database<Array<{ sale_price: string }>>`
      select sale_price::text from inventory_batches
      where branch_id = ${branchId} and medicine_id = ${medicine.id} and deleted_at is null
      order by received_at desc, id desc limit 1`;
    return {
      supplierId: null,
      supplierName: null,
      costPerPack: null,
      unitsPerPack: medicine.packSize,
      salePricePerUnit: batch?.sale_price ?? null,
      lastReceivedAt: null,
    };
  }

  private async existingBatch(branchId: string, medicineId: string, batchNumber: string) {
    const [batch] = await this.database<
      Array<{ quantity: string; expiryDate: string; salePrice: string }>
    >`
      select sum(current_qty)::text as quantity, min(expiry_date)::text as "expiryDate",
        (array_agg(sale_price::text order by received_at desc))[1] as "salePrice"
      from inventory_batches
      where branch_id = ${branchId} and medicine_id = ${medicineId}
        and upper(batch_number) = upper(${batchNumber}) and deleted_at is null
      group by medicine_id`;
    return batch ?? null;
  }

  /**
   * Remembers which medicine an unknown pack barcode belongs to. A person picks the medicine and
   * confirms it; a barcode already linked to a different medicine is refused, never moved.
   */
  async linkBarcode(user: AuthenticatedUser, medicineId: string, code: string) {
    const scanned = parseScannedCode(code);
    if (scanned.kind === 'GS1' && !scanned.gtin) {
      throw new ConflictException('This code has no valid product number to remember.');
    }
    const stored = scanned.gtin ? storedBarcodeForGtin(scanned.gtin) : code.trim();
    const keys = scanned.gtin ? [...scanned.lookupKeys] : [stored];
    return this.database.begin(async (transaction) => {
      const [medicine] = await transaction<Array<{ name: string }>>`
        select name from medicines where id = ${medicineId} and deleted_at is null and is_active`;
      if (!medicine) throw new NotFoundException('Medicine not found');
      const [taken] = await transaction<Array<{ medicine_id: string; name: string }>>`
        select medicine_barcodes.medicine_id::text, medicines.name
        from medicine_barcodes join medicines on medicines.id = medicine_barcodes.medicine_id
        where medicine_barcodes.barcode = any(${transaction.array(keys)}::text[])
        limit 1`;
      if (taken && taken.medicine_id !== medicineId) {
        throw new ConflictException(
          `This barcode already belongs to ${taken.name}. Check the pack before receiving it.`,
        );
      }
      if (!taken) {
        await transaction`
          insert into medicine_barcodes (medicine_id, barcode, is_primary, added_by_user_id)
          values (
            ${medicineId}, ${stored},
            not exists (select 1 from medicine_barcodes where medicine_id = ${medicineId}),
            ${user.id}
          )`;
        await transaction`
          insert into audit_events (
            branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
          ) values (
            ${user.branchId}, ${user.id}, ${user.terminalId}, 'CATALOG.BARCODE_LINKED',
            'medicine', ${medicineId}, ${transaction.json({ barcode: stored })}
          )`;
      }
      return { medicineId, barcode: stored, alreadyLinked: Boolean(taken) };
    });
  }

  /** Medicines that will run out within the shop's cover days at the current selling rate. */
  async lowStock(user: AuthenticatedUser) {
    const shop = await this.features.forShop(user.branchId);
    const lookback = numberSetting(shop.features, 'LOW_STOCK', 'lookbackDays');
    const cover = numberSetting(shop.features, 'LOW_STOCK', 'coverDays');
    const data = await this.database<LowStockRow[]>`
      with clock as materialized (
        select (now() at time zone timezone)::date as today from branches where id = ${user.branchId}
      ), demand as (
        select sale_items.medicine_id, sum(sale_items.quantity) as sold
        from sale_items join sales on sales.id = sale_items.sale_id
        where sales.branch_id = ${user.branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= now() - make_interval(days => ${lookback}::int)
        group by sale_items.medicine_id
      ), policies as (
        select medicine_id, minimum_stock from reorder_policies
        where branch_id = ${user.branchId} and is_active
      ), wanted as (
        select medicine_id from demand union select medicine_id from policies
      ), measured as (
        select medicines.id, medicines.name, medicines.strength,
          medicines.dosage_form, manufacturers.name as manufacturer, medicines.pack_size,
          coalesce(stock.on_hand, 0) as on_hand,
          coalesce(demand.sold, 0) / ${lookback}::numeric as daily,
          policies.minimum_stock
        from wanted
        join medicines on medicines.id = wanted.medicine_id and medicines.deleted_at is null
        left join manufacturers on manufacturers.id = medicines.manufacturer_id
        left join demand on demand.medicine_id = medicines.id
        left join policies on policies.medicine_id = medicines.id
        left join lateral (
          select sum(batches.current_qty) as on_hand from inventory_batches batches, clock
          where batches.branch_id = ${user.branchId} and batches.medicine_id = medicines.id
            and batches.status = 'SELLABLE' and batches.deleted_at is null
            and batches.expiry_date >= clock.today
        ) stock on true
      )
      select id::text, name, strength, dosage_form as "dosageForm", manufacturer,
        pack_size::text as "packSize", on_hand::text as "onHand",
        round(daily, 2)::text as "dailySales",
        case when daily > 0 then floor(on_hand / daily)::int end as "daysLeft",
        minimum_stock::text as "minimumStock",
        greatest(
          ceil((greatest(daily * ${cover}::numeric, coalesce(minimum_stock, 0)) - on_hand) / pack_size),
          1
        )::int as "suggestedPacks"
      from measured
      where (daily > 0 and on_hand < daily * ${cover}::numeric)
        or (minimum_stock is not null and on_hand <= minimum_stock)
      order by case when daily > 0 then on_hand / daily else 0 end, name
      limit 300
    `;
    return { lookbackDays: lookback, coverDays: cover, data };
  }

  /** Stock that has not sold for the shop's chosen number of days, by money tied up. */
  async stuckStock(user: AuthenticatedUser, overrideDays?: number) {
    const shop = await this.features.forShop(user.branchId);
    const days = overrideDays ?? numberSetting(shop.features, 'STUCK_STOCK', 'days');
    const data = await this.database<StuckStockRow[]>`
      select medicines.id::text, medicines.name, medicines.strength,
        medicines.dosage_form as "dosageForm", manufacturers.name as manufacturer,
        sum(batches.current_qty)::text as quantity,
        round(sum(batches.current_qty * batches.cost_price), 2)::text as value,
        min(batches.expiry_date)::text as "nearestExpiry",
        last_sale.at::text as "lastSoldAt", min(batches.received_at)::text as "inStockSince"
      from inventory_batches batches
      join medicines on medicines.id = batches.medicine_id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join lateral (
        select max(sale_items.created_at) as at
        from sale_items join sales on sales.id = sale_items.sale_id
        where sale_items.medicine_id = medicines.id and sales.branch_id = ${user.branchId}
          and sales.status <> 'VOIDED'
      ) last_sale on true
      where batches.branch_id = ${user.branchId} and batches.current_qty > 0
        and batches.status = 'SELLABLE' and batches.deleted_at is null
      group by medicines.id, manufacturers.name, last_sale.at
      having (last_sale.at is null or last_sale.at < now() - make_interval(days => ${days}::int))
        and min(batches.received_at) < now() - make_interval(days => ${days}::int)
      order by sum(batches.current_qty * batches.cost_price) desc, medicines.name
      limit 300
    `;
    return { days, data };
  }

  /** Batches that expire within the shop's window, and expired stock still counted as sellable. */
  async expiring(user: AuthenticatedUser, overrideDays?: number) {
    const shop = await this.features.forShop(user.branchId);
    const days = overrideDays ?? numberSetting(shop.features, 'EXPIRY_ALERTS', 'days');
    const data = await this.database<ExpiringRow[]>`
      with clock as materialized (
        select (now() at time zone timezone)::date as today from branches where id = ${user.branchId}
      )
      select batches.id::text as "batchId", medicines.id::text as "medicineId", medicines.name,
        medicines.strength, medicines.dosage_form as "dosageForm",
        manufacturers.name as manufacturer, batches.batch_number as "batchNumber",
        batches.expiry_date::text as "expiryDate",
        (batches.expiry_date - clock.today)::int as "daysLeft",
        batches.current_qty::text as quantity,
        round(batches.current_qty * batches.cost_price, 2)::text as value,
        shelf.code as shelf
      from inventory_batches batches
      cross join clock
      join medicines on medicines.id = batches.medicine_id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join lateral (
        select shelves.code from medicine_shelf_locations locations
        join shelves on shelves.id = locations.shelf_id
        where locations.medicine_id = medicines.id and shelves.branch_id = ${user.branchId}
          and shelves.is_active and locations.is_primary
        limit 1
      ) shelf on true
      where batches.branch_id = ${user.branchId} and batches.current_qty > 0
        and batches.status = 'SELLABLE' and batches.deleted_at is null
        and batches.expiry_date <= clock.today + ${days}::int
      order by batches.expiry_date, medicines.name, batches.id
      limit 500
    `;
    return { days, data };
  }

  /**
   * The order taker marks a medicine a customer asked for and could not get. A double tap within
   * a few seconds counts once.
   */
  async recordRequest(user: AuthenticatedUser, input: CustomerRequestInput) {
    let name = input.requestedName;
    const medicineId = input.medicineId?.toString() ?? null;
    if (medicineId) {
      const [medicine] = await this.database<Array<{ name: string; strength: string | null }>>`
        select name, strength from medicines where id = ${medicineId} and deleted_at is null`;
      if (!medicine) throw new NotFoundException('Medicine not found');
      name = medicine.name;
    }
    const normalized = normalizeRequestName(name);
    return this.database.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${`request:${user.id}`}))`;
      const [recent] = await transaction<Array<{ id: string }>>`
        select id::text from customer_requests
        where branch_id = ${user.branchId} and requested_by_user_id = ${user.id}
          and normalized_name = ${normalized}
          and created_at > now() - interval '10 seconds'
        order by id desc limit 1`;
      if (recent) return { id: recent.id, counted: false };
      const [created] = await transaction<Array<{ id: string }>>`
        insert into customer_requests (
          branch_id, medicine_id, requested_name, normalized_name, reason, quantity,
          requested_by_user_id, terminal_id
        ) values (
          ${user.branchId}, ${medicineId}, ${name}, ${normalized},
          ${medicineId ? 'OUT_OF_STOCK' : 'NOT_IN_CATALOG'}, ${input.quantity ?? null},
          ${user.id}, ${user.terminalId}
        ) returning id::text`;
      return { id: created!.id, counted: true };
    });
  }

  /** How often each missing medicine was asked for in the shop's report window. */
  async requestReport(user: AuthenticatedUser, overrideDays?: number) {
    const shop = await this.features.forShop(user.branchId);
    const days = overrideDays ?? numberSetting(shop.features, 'CUSTOMER_REQUESTS', 'reportDays');
    const minimum = numberSetting(shop.features, 'CUSTOMER_REQUESTS', 'minimumRequests');
    const data = await this.database<RequestRow[]>`
      with recent as (
        select * from customer_requests
        where branch_id = ${user.branchId} and created_at >= now() - make_interval(days => ${days}::int)
      ), grouped as (
        select medicine_id, case when medicine_id is null then normalized_name end as name_key,
          count(*)::int as times, max(created_at) as last_asked,
          sum(quantity) as quantity,
          (array_agg(requested_name order by created_at desc))[1] as requested_name
        from recent
        group by medicine_id, case when medicine_id is null then normalized_name end
      )
      select grouped.medicine_id::text as "medicineId", grouped.requested_name as "requestedName",
        grouped.times, grouped.last_asked::text as "lastAsked",
        grouped.quantity::text as quantity,
        medicines.strength, medicines.dosage_form as "dosageForm",
        manufacturers.name as manufacturer,
        coalesce(stock.on_hand, 0)::text as "onHand"
      from grouped
      left join medicines on medicines.id = grouped.medicine_id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      left join lateral (
        select sum(current_qty) as on_hand from inventory_batches
        where branch_id = ${user.branchId} and medicine_id = grouped.medicine_id
          and status = 'SELLABLE' and deleted_at is null
          and expiry_date >= (now() at time zone (
            select timezone from branches where id = ${user.branchId}))::date
      ) stock on true
      where grouped.times >= ${minimum}
      order by grouped.times desc, grouped.last_asked desc
      limit 300
    `;
    return { days, minimum, data };
  }

  /**
   * What to buy next: low stock and repeated customer requests, each with the supplier and price
   * of its last delivery so the order can be placed per supplier.
   */
  async orderList(user: AuthenticatedUser) {
    const shop = await this.features.forShop(user.branchId);
    const low = shop.features.LOW_STOCK.enabled ? (await this.lowStock(user)).data : [];
    const requests = shop.features.CUSTOMER_REQUESTS.enabled
      ? (await this.requestReport(user)).data
      : [];
    const ids = [
      ...new Set([
        ...low.map((row) => row.id),
        ...requests.flatMap((row) => (row.medicineId ? [row.medicineId] : [])),
      ]),
    ];
    const last =
      ids.length === 0
        ? []
        : await this.database<
            Array<{
              medicine_id: string;
              supplier_id: string;
              supplier_name: string;
              unit_cost: string;
              base_units: string;
            }>
          >`
            select distinct on (items.medicine_id) items.medicine_id::text,
              orders.supplier_id::text, suppliers.name as supplier_name,
              round(items.unit_cost, 2)::text as unit_cost,
              items.base_units_per_order_unit::text as base_units
            from purchase_order_items items
            join purchase_orders orders on orders.id = items.purchase_order_id
            join suppliers on suppliers.id = orders.supplier_id
            where orders.branch_id = ${user.branchId}
              and items.medicine_id in ${this.database(ids)}
              and orders.status <> 'CANCELLED'
            order by items.medicine_id, orders.created_at desc, items.id desc`;
    const lastByMedicine = new Map(last.map((row) => [row.medicine_id, row]));
    const lowById = new Map(low.map((row) => [row.id, row]));
    const requestById = new Map(
      requests.flatMap((row) => (row.medicineId ? [[row.medicineId, row] as const] : [])),
    );
    const lines = ids.map((id) => {
      const lowRow = lowById.get(id);
      const requestRow = requestById.get(id);
      const supplier = lastByMedicine.get(id);
      return {
        medicineId: id,
        name: lowRow?.name ?? requestRow?.requestedName ?? '',
        strength: lowRow?.strength ?? requestRow?.strength ?? null,
        dosageForm: lowRow?.dosageForm ?? requestRow?.dosageForm ?? null,
        manufacturer: lowRow?.manufacturer ?? requestRow?.manufacturer ?? null,
        onHand: lowRow?.onHand ?? requestRow?.onHand ?? '0',
        daysLeft: lowRow?.daysLeft ?? null,
        suggestedPacks: lowRow?.suggestedPacks ?? 1,
        requestCount: requestRow?.times ?? 0,
        reasons: [
          ...(lowRow ? ['LOW_STOCK' as const] : []),
          ...(requestRow ? ['CUSTOMER_REQUESTS' as const] : []),
        ],
        supplierId: supplier?.supplier_id ?? null,
        supplierName: supplier?.supplier_name ?? null,
        costPerPack: supplier?.unit_cost ?? null,
        unitsPerPack: supplier?.base_units ?? null,
      };
    });
    return {
      lines,
      notInCatalog: requests
        .filter((row) => !row.medicineId)
        .map((row) => ({ requestedName: row.requestedName, times: row.times })),
    };
  }
}
