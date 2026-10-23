import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import {
  describeFormulation,
  formulationKey,
  parseScannedCode,
  type MedicineSearchResult,
} from '@pharmacy/shared';

import { DATABASE } from '../database.module.js';

export type { MedicineSearchResult };

type MatchKind = MedicineSearchResult['matchedBy'];

const MATCH_KINDS: readonly MatchKind[] = ['BARCODE', 'EXACT_NAME', 'PREFIX', 'WORDS', 'SIMILAR'];

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async search(branchId: string, query: string, limit: number): Promise<MedicineSearchResult[]> {
    const normalized = query.trim();
    // A scanner may type a pack's 2D code; its product number is looked up in every stored form.
    // Product identification by barcode is exact only.
    const scan = parseScannedCode(normalized);
    const barcodeKeys = scan.kind === 'OTHER' ? [normalized] : [...scan.lookupKeys];
    const candidateLimit = Math.max(50, limit * 5);
    // A counter types the start of a name, or a few words from name, strength and company
    // ("metformin getz 500"). Those rank above fuzzy trigram matches. LIKE wildcards are escaped.
    const literal = normalized.replace(/[\\%_]/g, (character) => `\\${character}`);
    const prefixPattern = `${literal}%`;
    const wordPatterns = literal
      .split(/\s+/)
      .filter((word) => word !== '')
      .slice(0, 6)
      .map((word) => `%${word}%`);
    const matched = await this.database<Array<{ id: string; match_rank: number }>>`
      with barcode_hit as materialized (
        select medicine_id as id from medicine_barcodes
        where barcode = any(${this.database.array(barcodeKeys)}::text[]) limit 1
      ), exact_name_hits as materialized (
        select id from medicines
        where not exists (select 1 from barcode_hit)
          and deleted_at is null and is_active
          and lower(name) = lower(${normalized})
        order by id limit ${limit}
      ), prefix_hits as materialized (
        select id,
          case when name ilike ${prefixPattern} then 1::real else 0.9::real end as score
        from medicines
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and deleted_at is null and is_active
          and (name ilike ${prefixPattern} or generic_name ilike ${prefixPattern})
        order by (name ilike ${prefixPattern}) desc, name, id limit ${candidateLimit}
      ), word_hits as materialized (
        select medicines.id, 1::real as score
        from medicines
        left join manufacturers on manufacturers.id = medicines.manufacturer_id
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and medicines.deleted_at is null and medicines.is_active
          and concat_ws(' ', medicines.name, medicines.generic_name, medicines.strength,
            manufacturers.name) ilike all (${this.database.array(wordPatterns)}::text[])
        order by medicines.name, medicines.id limit ${candidateLimit}
      ), name_candidates as materialized (
        select id, similarity(name, ${normalized}) as score
        from medicines
        where not exists (select 1 from barcode_hit)
          and not exists (select 1 from exact_name_hits)
          and deleted_at is null and is_active
          and name % ${normalized}
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
        select id, 2, score from prefix_hits
        union all
        select id, 3, score from word_hits
        union all
        select id, 4, score from name_candidates
        union all
        select id, 4, score from generic_candidates
        union all
        select id, 4, score from alias_candidates
      )
      select candidates.id::text, min(match_rank)::int as match_rank
      from candidates
      join medicines on medicines.id = candidates.id
      group by candidates.id
      order by min(match_rank), max(score) desc, min(medicines.name), candidates.id
      limit ${limit}
    `;
    const details = new Map(
      (
        await this.details(
          branchId,
          matched.map((row) => row.id),
        )
      ).map((row) => [row.id, row]),
    );
    return matched.flatMap((row) => {
      const detail = details.get(row.id);
      return detail ? [{ ...detail, matchedBy: MATCH_KINDS[row.match_rank] ?? 'SIMILAR' }] : [];
    });
  }

  /**
   * Other companies' medicine with exactly the same generic, strength and form, in stock. Never
   * fuzzy: an incomplete catalogue entry gets no alternatives at all.
   */
  async substitutes(
    branchId: string,
    medicineId: string,
  ): Promise<{ formulation: string | null; data: MedicineSearchResult[] }> {
    const [medicine] = await this.database<
      Array<{ generic_name: string | null; strength: string | null; dosage_form: string | null }>
    >`
      select generic_name, strength, dosage_form from medicines
      where id = ${medicineId} and deleted_at is null`;
    if (!medicine) throw new NotFoundException('Medicine not found');
    const formulation = {
      genericName: medicine.generic_name,
      strength: medicine.strength,
      dosageForm: medicine.dosage_form,
    };
    const key = formulationKey(formulation);
    if (!key || !medicine.generic_name) return { formulation: null, data: [] };
    // The database narrows by generic name (ignoring spacing); the exact rule runs below.
    const candidates = await this.database<
      Array<{ id: string; generic_name: string; strength: string; dosage_form: string }>
    >`
      select id::text, generic_name, strength, dosage_form from medicines
      where id <> ${medicineId} and deleted_at is null and is_active
        and generic_name is not null and strength is not null and dosage_form is not null
        and lower(regexp_replace(generic_name, '\\s+', '', 'g'))
          = lower(regexp_replace(${medicine.generic_name}, '\\s+', '', 'g'))
      limit 200
    `;
    const same = candidates.filter(
      (candidate) =>
        formulationKey({
          genericName: candidate.generic_name,
          strength: candidate.strength,
          dosageForm: candidate.dosage_form,
        }) === key,
    );
    const data = (
      await this.details(
        branchId,
        same.map((candidate) => candidate.id),
      )
    )
      .filter((row) => Number(row.availableQuantity) > 0)
      .sort(
        (a, b) =>
          Number(b.availableQuantity) - Number(a.availableQuantity) || a.name.localeCompare(b.name),
      )
      .map((row) => ({ ...row, matchedBy: 'SAME_FORMULATION' as const }));
    return { formulation: describeFormulation(formulation), data };
  }

  /** What the counter shows for each medicine: identity, place, sellable stock, price. */
  private async details(
    branchId: string,
    ids: readonly string[],
  ): Promise<Array<Omit<MedicineSearchResult, 'matchedBy'>>> {
    if (ids.length === 0) return [];
    return this.database<Array<Omit<MedicineSearchResult, 'matchedBy'>>>`
      with branch_clock as materialized (
        select (now() at time zone timezone)::date as local_date
        from branches where id = ${branchId}
      )
      select medicines.id::text as id, medicines.name, medicines.generic_name as "genericName",
        medicines.strength, medicines.dosage_form as "dosageForm",
        medicines.unit_name as "unitName",
        medicines.requires_prescription as "requiresPrescription",
        manufacturers.name as manufacturer,
        barcode.barcode, shelf.location as shelf,
        greatest(coalesce(stock.available_quantity, 0) - coalesce(held.quantity, 0), 0)::text
          as "availableQuantity",
        stock.nearest_expiry::text as "nearestExpiry",
        (stock.nearest_expiry - branch_clock.local_date)::integer as "daysToExpiry",
        stock.sale_price::text as "salePrice"
      from medicines
      left join manufacturers on manufacturers.id = medicines.manufacturer_id
      cross join branch_clock
      left join lateral (
        select medicine_barcodes.barcode from medicine_barcodes
        where medicine_barcodes.medicine_id = medicines.id
        order by medicine_barcodes.is_primary desc, medicine_barcodes.id limit 1
      ) barcode on true
      left join lateral (
        select concat_ws(' · ', concat_ws(' / ', shelves.code, shelves.rack, shelves.bin),
            shelves.label) as location
        from medicine_shelf_locations
        join shelves on shelves.id = medicine_shelf_locations.shelf_id
        where medicine_shelf_locations.medicine_id = medicines.id
          and shelves.branch_id = ${branchId} and shelves.is_active
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
      left join lateral (
        -- Stock another counter is holding for an order right now is not available here.
        select sum(reservations.quantity) as quantity
        from stock_reservations reservations
        join inventory_batches batches on batches.id = reservations.inventory_batch_id
        where batches.medicine_id = medicines.id and batches.branch_id = ${branchId}
          and reservations.status = 'ACTIVE' and reservations.expires_at > now()
      ) held on true
      where medicines.id in ${this.database(ids)}
    `;
  }
}
