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
  readonly salePrice: string | null;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async search(branchId: string, query: string, limit: number): Promise<MedicineSearchResult[]> {
    const normalized = query.trim();
    return this.database<MedicineSearchResult[]>`
      with matched as (
        select distinct medicines.id,
          case
            when exists (select 1 from medicine_barcodes where medicine_id = medicines.id and barcode = ${normalized}) then 0
            when lower(medicines.name) = lower(${normalized}) then 1
            else 2
          end as match_rank,
          greatest(
            similarity(medicines.name, ${normalized}),
            similarity(coalesce(medicines.generic_name, ''), ${normalized}),
            coalesce((select max(similarity(alias, ${normalized})) from medicine_aliases where medicine_id = medicines.id), 0)
          ) as score
        from medicines
        left join medicine_barcodes on medicine_barcodes.medicine_id = medicines.id
        left join medicine_aliases on medicine_aliases.medicine_id = medicines.id
        where medicines.deleted_at is null and medicines.is_active = true
          and (
            medicine_barcodes.barcode = ${normalized}
            or medicines.name % ${normalized}
            or coalesce(medicines.generic_name, '') % ${normalized}
            or medicine_aliases.alias % ${normalized}
            or medicines.name ilike ${`%${normalized}%`}
          )
        order by match_rank, score desc, medicines.id
        limit ${limit}
      )
      select matched.id::text as id, medicines.name, medicines.generic_name as "genericName",
        medicines.strength, manufacturers.name as manufacturer,
        (select barcode from medicine_barcodes where medicine_id = medicines.id order by is_primary desc, id limit 1) as barcode,
        (select concat_ws(' / ', shelves.code, shelves.rack, shelves.bin)
          from medicine_shelf_locations join shelves on shelves.id = medicine_shelf_locations.shelf_id
          where medicine_shelf_locations.medicine_id = medicines.id and shelves.branch_id = ${branchId}
          order by medicine_shelf_locations.is_primary desc, shelves.id limit 1) as shelf,
        coalesce((select sum(current_qty) from inventory_batches
          where medicine_id = medicines.id and branch_id = ${branchId} and current_qty > 0
            and status = 'SELLABLE' and deleted_at is null
            and expiry_date >= (now() at time zone (
              select timezone from branches where id = ${branchId}
            ))::date), 0)::text as "availableQuantity",
        (select min(expiry_date)::text from inventory_batches
          where medicine_id = medicines.id and branch_id = ${branchId} and current_qty > 0
            and status = 'SELLABLE' and deleted_at is null
            and expiry_date >= (now() at time zone (
              select timezone from branches where id = ${branchId}
            ))::date) as "nearestExpiry",
        (select sale_price::text from inventory_batches
          where medicine_id = medicines.id and branch_id = ${branchId} and current_qty > 0
            and status = 'SELLABLE' and deleted_at is null
            and expiry_date >= (now() at time zone (
              select timezone from branches where id = ${branchId}
            ))::date
          order by expiry_date, received_at, id limit 1) as "salePrice"
      from matched
      join medicines on medicines.id = matched.id
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      order by matched.match_rank, matched.score desc, matched.id
    `;
  }
}
