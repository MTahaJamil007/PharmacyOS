import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';

import { DATABASE } from '../database.module.js';

export interface MedicineSearchResult {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly manufacturer: string | null;
  readonly barcode: string | null;
  readonly shelf: string | null;
  readonly availableQuantity: string;
  readonly nearestExpiry: string | null;
  readonly daysToExpiry: number | null;
  readonly salePrice: string | null;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async search(branchId: string, query: string, limit: number): Promise<MedicineSearchResult[]> {
    const normalized = query.trim();
    const candidateLimit = Math.max(50, limit * 5);
    return this.database<MedicineSearchResult[]>`
      with branch_clock as materialized (
        select (now() at time zone timezone)::date as local_date
        from branches where id = ${branchId}
      ), barcode_hit as materialized (
        select medicine_id as id from medicine_barcodes
        where barcode = ${normalized} limit 1
      ), exact_name_hits as materialized (
        select id from medicines
        where not exists (select 1 from barcode_hit)
          and deleted_at is null and is_active
          and lower(name) = lower(${normalized})
        order by id limit ${limit}
      ), name_candidates as materialized (
        select id, similarity(name, ${normalized}) as score
        from medicines
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and deleted_at is null and is_active
          and (name % ${normalized} or name ilike ${`%${normalized}%`})
        order by name <-> ${normalized}, id limit ${candidateLimit}
      ), generic_candidates as materialized (
        select id, similarity(generic_name, ${normalized}) as score
        from medicines
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and deleted_at is null and is_active and generic_name is not null
          and generic_name % ${normalized}
        order by generic_name <-> ${normalized}, id limit ${candidateLimit}
      ), alias_candidates as materialized (
        select aliases.medicine_id as id, similarity(aliases.alias, ${normalized}) as score
        from medicine_aliases aliases
        join medicines on medicines.id = aliases.medicine_id
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and medicines.deleted_at is null and medicines.is_active
          and aliases.alias % ${normalized}
        order by aliases.alias <-> ${normalized}, aliases.id limit ${candidateLimit}
      ), candidates as materialized (
        select id, 0 as match_rank, 1::real as score from barcode_hit
        union all
        select id, 1, 1::real from exact_name_hits
        union all
        select id, 2, score from name_candidates
        union all
        select id, 2, score from generic_candidates
        union all
        select id, 2, score from alias_candidates
      ), matched as (
        select id, min(match_rank) as match_rank, max(score) as score
        from candidates group by id
        order by match_rank, score desc, id
        limit ${limit}
      )
      select matched.id::text as id, medicines.name, medicines.generic_name as "genericName",
        medicines.strength, manufacturers.name as manufacturer,
        barcode.barcode, shelf.location as shelf,
        coalesce(stock.available_quantity, 0)::text as "availableQuantity",
        stock.nearest_expiry::text as "nearestExpiry",
        (stock.nearest_expiry - branch_clock.local_date)::integer as "daysToExpiry",
        stock.sale_price::text as "salePrice"
      from matched
      join medicines on medicines.id = matched.id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      cross join branch_clock
      left join lateral (
        select medicine_barcodes.barcode from medicine_barcodes
        where medicine_barcodes.medicine_id = medicines.id
        order by medicine_barcodes.is_primary desc, medicine_barcodes.id limit 1
      ) barcode on true
      left join lateral (
        select concat_ws(' / ', shelves.code, shelves.rack, shelves.bin) as location
        from medicine_shelf_locations
        join shelves on shelves.id = medicine_shelf_locations.shelf_id
        where medicine_shelf_locations.medicine_id = medicines.id
          and shelves.branch_id = ${branchId}
        order by medicine_shelf_locations.is_primary desc, shelves.id limit 1
      ) shelf on true
      left join lateral (
        select sum(inventory_batches.current_qty) as available_quantity,
          min(inventory_batches.expiry_date) as nearest_expiry,
          (array_agg(inventory_batches.sale_price order by inventory_batches.expiry_date,
            inventory_batches.received_at, inventory_batches.id))[1] as sale_price
        from inventory_batches
        where inventory_batches.medicine_id = medicines.id
          and inventory_batches.branch_id = ${branchId}
          and inventory_batches.current_qty > 0 and inventory_batches.status = 'SELLABLE'
          and inventory_batches.deleted_at is null
          and inventory_batches.expiry_date >= branch_clock.local_date
      ) stock on true
      order by matched.match_rank, matched.score desc, matched.id
    `;
  }
}
