import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import type {
  AssignShelfRequest,
  CreateMedicineRequest,
  CreateShelfRequest,
  CreateSupplierRequest,
  CreateTerminalRequest,
  UpdateMedicineRequest,
  UpdateFiscalSettingsRequest,
  UpdateOperationalPoliciesRequest,
  UpdateShelfRequest,
  UpdateSupplierRequest,
  UpdateTerminalRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

type AuditMetadata = Readonly<
  Record<string, string | number | boolean | null | readonly string[] | undefined>
>;

@Injectable()
export class AdministrationService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async medicines(_user: AuthenticatedUser, query: string, limit: number) {
    const value = query.trim();
    const data = await this.database<Array<Record<string, unknown>>>`
      select medicines.id::text, medicines.sku, medicines.name,
        medicines.generic_name as "genericName", medicines.strength,
        medicines.dosage_form as "dosageForm", medicines.pack_size::text as "packSize",
        medicines.unit_name as "unitName",
        medicines.requires_prescription as "requiresPrescription",
        medicines.storage_class as "storageClass",
        medicines.requires_secured_storage as "requiresSecuredStorage",
        medicines.hs_code as "hsCode", medicines.tax_rate::text as "taxRate",
        medicines.fbr_uom as "fbrUom", medicines.fbr_sale_type as "fbrSaleType",
        medicines.is_active as "isActive", barcodes.barcode
      from medicines
      left join lateral (select barcode from medicine_barcodes
        where medicine_id = medicines.id order by is_primary desc, id limit 1) barcodes on true
      where medicines.deleted_at is null
        and (${value} = '' or medicines.name ilike ${`%${value}%`}
          or coalesce(medicines.generic_name, '') ilike ${`%${value}%`}
          or coalesce(medicines.sku, '') ilike ${`%${value}%`}
          or coalesce(barcodes.barcode, '') = ${value})
      order by medicines.is_active desc, medicines.name, medicines.id limit ${limit}
    `;
    return { data };
  }

  async createMedicine(user: AuthenticatedUser, input: CreateMedicineRequest) {
    return this.database.begin(async (transaction) => {
      const [medicine] = await transaction<Array<{ id: string }>>`
        insert into medicines (
          sku, name, generic_name, strength, dosage_form, pack_size, unit_name,
          requires_prescription, storage_class, requires_secured_storage,
          hs_code, tax_rate, fbr_uom, fbr_sale_type
        ) values (
          ${input.sku ?? null}, ${input.name}, ${input.genericName ?? null},
          ${input.strength ?? null}, ${input.dosageForm ?? null}, ${input.packSize},
          ${input.unitName}, ${input.requiresPrescription}, ${input.storageClass},
          ${input.requiresSecuredStorage}, ${input.hsCode ?? null}, ${input.taxRate},
          ${input.fbrUom}, ${input.fbrSaleType}
        ) returning id::text
      `;
      if (!medicine) throw new Error('Medicine creation did not return an identifier');
      if (input.barcode) {
        await transaction`
          insert into medicine_barcodes (medicine_id, barcode, is_primary)
          values (${medicine.id}, ${input.barcode}, true)
        `;
      }
      await this.audit(transaction, user, 'CATALOG.MEDICINE_CREATED', 'medicine', medicine.id, {
        name: input.name,
        sku: input.sku,
      });
      return { id: medicine.id };
    });
  }

  async updateMedicine(user: AuthenticatedUser, medicineId: bigint, input: UpdateMedicineRequest) {
    const id = medicineId.toString();
    return this.database.begin(async (transaction) => {
      const [medicine] = await transaction<Array<{ id: string }>>`
        select id::text from medicines where id = ${id} and deleted_at is null for update
      `;
      if (!medicine) throw new NotFoundException('Medicine not found');
      await transaction`
        update medicines set
          sku = case when ${input.sku !== undefined} then ${input.sku ?? null} else sku end,
          name = case when ${input.name !== undefined} then ${input.name ?? null} else name end,
          generic_name = case when ${input.genericName !== undefined} then ${input.genericName ?? null} else generic_name end,
          strength = case when ${input.strength !== undefined} then ${input.strength ?? null} else strength end,
          dosage_form = case when ${input.dosageForm !== undefined} then ${input.dosageForm ?? null} else dosage_form end,
          pack_size = case when ${input.packSize !== undefined} then ${input.packSize ?? null}::numeric else pack_size end,
          unit_name = case when ${input.unitName !== undefined} then ${input.unitName ?? null} else unit_name end,
          requires_prescription = case when ${input.requiresPrescription !== undefined} then ${input.requiresPrescription ?? false} else requires_prescription end,
          storage_class = case when ${input.storageClass !== undefined} then ${input.storageClass ?? null} else storage_class end,
          requires_secured_storage = case when ${input.requiresSecuredStorage !== undefined} then ${input.requiresSecuredStorage ?? false} else requires_secured_storage end,
          is_active = case when ${input.isActive !== undefined} then ${input.isActive ?? true} else is_active end,
          hs_code = case when ${input.hsCode !== undefined} then ${input.hsCode ?? null} else hs_code end,
          tax_rate = case when ${input.taxRate !== undefined} then ${input.taxRate ?? '0'}::numeric else tax_rate end,
          fbr_uom = case when ${input.fbrUom !== undefined} then ${input.fbrUom ?? null} else fbr_uom end,
          fbr_sale_type = case when ${input.fbrSaleType !== undefined} then ${input.fbrSaleType ?? null} else fbr_sale_type end
        where id = ${id}
      `;
      if (input.barcode !== undefined) {
        await transaction`delete from medicine_barcodes where medicine_id = ${id} and is_primary`;
        if (input.barcode) {
          await transaction`
            insert into medicine_barcodes (medicine_id, barcode, is_primary)
            values (${id}, ${input.barcode}, true)
          `;
        }
      }
      await this.audit(transaction, user, 'CATALOG.MEDICINE_UPDATED', 'medicine', id, {
        fields: Object.keys(input),
      });
      return { id, updated: true };
    });
  }

  async suppliers(user: AuthenticatedUser) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select id::text, code, name, phone, address, lead_time_days as "leadTimeDays",
        is_active as "isActive" from suppliers
      where branch_id = ${user.branchId} and deleted_at is null
      order by is_active desc, name, id
    `;
    return { data };
  }

  async createSupplier(user: AuthenticatedUser, input: CreateSupplierRequest) {
    return this.database.begin(async (transaction) => {
      const [supplier] = await transaction<Array<{ id: string }>>`
        insert into suppliers (branch_id, code, name, phone, address, lead_time_days)
        values (${user.branchId}, ${input.code ?? null}, ${input.name}, ${input.phone ?? null},
          ${input.address ?? null}, ${input.leadTimeDays}) returning id::text
      `;
      if (!supplier) throw new Error('Supplier creation did not return an identifier');
      await this.audit(transaction, user, 'SUPPLIER.CREATED', 'supplier', supplier.id, {
        name: input.name,
      });
      return { id: supplier.id };
    });
  }

  async updateSupplier(user: AuthenticatedUser, supplierId: bigint, input: UpdateSupplierRequest) {
    const id = supplierId.toString();
    return this.database.begin(async (transaction) => {
      const [supplier] = await transaction<Array<{ id: string }>>`
        select id::text from suppliers where id = ${id} and branch_id = ${user.branchId}
          and deleted_at is null for update
      `;
      if (!supplier) throw new NotFoundException('Supplier not found');
      await transaction`
        update suppliers set
          code = case when ${input.code !== undefined} then ${input.code ?? null} else code end,
          name = case when ${input.name !== undefined} then ${input.name ?? null} else name end,
          phone = case when ${input.phone !== undefined} then ${input.phone ?? null} else phone end,
          address = case when ${input.address !== undefined} then ${input.address ?? null} else address end,
          lead_time_days = case when ${input.leadTimeDays !== undefined} then ${input.leadTimeDays ?? 1} else lead_time_days end,
          is_active = case when ${input.isActive !== undefined} then ${input.isActive ?? true} else is_active end
        where id = ${id}
      `;
      await this.audit(transaction, user, 'SUPPLIER.UPDATED', 'supplier', id, {
        fields: Object.keys(input),
      });
      return { id, updated: true };
    });
  }

  async shelves(user: AuthenticatedUser) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select id::text, code, name, rack, bin, row_label as "rowLabel",
        pick_priority as "pickPriority", storage_class as "storageClass",
        is_secured as "isSecured", is_pick_location as "isPickLocation",
        is_active as "isActive"
      from shelves where branch_id = ${user.branchId} order by is_active desc, code, id
    `;
    return { data };
  }

  async createShelf(user: AuthenticatedUser, input: CreateShelfRequest) {
    return this.database.begin(async (transaction) => {
      const [shelf] = await transaction<Array<{ id: string }>>`
        insert into shelves (
          branch_id, code, name, rack, bin, row_label, pick_priority,
          storage_class, is_secured, is_pick_location
        ) values (
          ${user.branchId}, ${input.code}, ${input.name}, ${input.rack ?? null},
          ${input.bin ?? null}, ${input.rowLabel ?? null}, ${input.pickPriority},
          ${input.storageClass}, ${input.isSecured}, ${input.isPickLocation}
        ) returning id::text
      `;
      if (!shelf) throw new Error('Shelf creation did not return an identifier');
      await this.audit(transaction, user, 'SHELF.CREATED', 'shelf', shelf.id, { code: input.code });
      return { id: shelf.id };
    });
  }

  async updateShelf(user: AuthenticatedUser, shelfId: bigint, input: UpdateShelfRequest) {
    const id = shelfId.toString();
    return this.database.begin(async (transaction) => {
      await this.lockBranchResource(transaction, 'shelves', id, user.branchId, 'Shelf');
      await transaction`
        update shelves set
          code = case when ${input.code !== undefined} then ${input.code ?? null} else code end,
          name = case when ${input.name !== undefined} then ${input.name ?? null} else name end,
          rack = case when ${input.rack !== undefined} then ${input.rack ?? null} else rack end,
          bin = case when ${input.bin !== undefined} then ${input.bin ?? null} else bin end,
          row_label = case when ${input.rowLabel !== undefined} then ${input.rowLabel ?? null} else row_label end,
          pick_priority = case when ${input.pickPriority !== undefined} then ${input.pickPriority ?? 100} else pick_priority end,
          storage_class = case when ${input.storageClass !== undefined} then ${input.storageClass ?? null} else storage_class end,
          is_secured = case when ${input.isSecured !== undefined} then ${input.isSecured ?? false} else is_secured end,
          is_pick_location = case when ${input.isPickLocation !== undefined} then ${input.isPickLocation ?? true} else is_pick_location end,
          is_active = case when ${input.isActive !== undefined} then ${input.isActive ?? true} else is_active end
        where id = ${id}
      `;
      await this.audit(transaction, user, 'SHELF.UPDATED', 'shelf', id, {
        fields: Object.keys(input),
      });
      return { id, updated: true };
    });
  }

  async assignShelf(user: AuthenticatedUser, shelfId: bigint, input: AssignShelfRequest) {
    const id = shelfId.toString();
    const medicineId = input.medicineId.toString();
    return this.database.begin(async (transaction) => {
      await this.lockBranchResource(transaction, 'shelves', id, user.branchId, 'Shelf');
      const [medicine] = await transaction<Array<{ id: string }>>`
        select id::text from medicines where id = ${medicineId} and deleted_at is null
      `;
      if (!medicine) throw new NotFoundException('Medicine not found');
      if (input.isPrimary) {
        await transaction`
          update medicine_shelf_locations set is_primary = false
          where medicine_id = ${medicineId}
        `;
      }
      await transaction`
        insert into medicine_shelf_locations (medicine_id, shelf_id, is_primary, location_type)
        values (${medicineId}, ${id}, ${input.isPrimary}, ${input.locationType})
        on conflict (medicine_id, shelf_id) do update
          set is_primary = excluded.is_primary, location_type = excluded.location_type
      `;
      await this.audit(transaction, user, 'SHELF.MEDICINE_ASSIGNED', 'shelf', id, {
        medicineId,
        locationType: input.locationType,
        isPrimary: input.isPrimary,
      });
      return { shelfId: id, medicineId };
    });
  }

  async terminals(user: AuthenticatedUser) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select id::text, code, name, terminal_type as "terminalType",
        is_active as "isActive", last_seen_at as "lastSeenAt"
      from terminals where branch_id = ${user.branchId} order by is_active desc, code, id
    `;
    return { data };
  }

  async createTerminal(user: AuthenticatedUser, input: CreateTerminalRequest) {
    return this.database.begin(async (transaction) => {
      const [terminal] = await transaction<Array<{ id: string }>>`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${user.branchId}, ${input.code}, ${input.name}, ${input.terminalType})
        returning id::text
      `;
      if (!terminal) throw new Error('Terminal creation did not return an identifier');
      await this.audit(transaction, user, 'TERMINAL.CREATED', 'terminal', terminal.id, {
        code: input.code,
      });
      return { id: terminal.id };
    });
  }

  async updateTerminal(user: AuthenticatedUser, terminalId: bigint, input: UpdateTerminalRequest) {
    const id = terminalId.toString();
    if (id === user.terminalId && input.isActive === false) {
      throw new ConflictException('You cannot deactivate the terminal in use');
    }
    return this.database.begin(async (transaction) => {
      await this.lockBranchResource(transaction, 'terminals', id, user.branchId, 'Terminal');
      await transaction`
        update terminals set
          code = case when ${input.code !== undefined} then ${input.code ?? null} else code end,
          name = case when ${input.name !== undefined} then ${input.name ?? null} else name end,
          terminal_type = case when ${input.terminalType !== undefined} then ${input.terminalType ?? null} else terminal_type end,
          is_active = case when ${input.isActive !== undefined} then ${input.isActive ?? true} else is_active end
        where id = ${id}
      `;
      if (input.isActive === false) {
        await transaction`
          update sessions set revoked_at = now(), revoke_reason = 'TERMINAL_DEACTIVATED'
          where terminal_id = ${id} and revoked_at is null
        `;
      }
      await this.audit(transaction, user, 'TERMINAL.UPDATED', 'terminal', id, {
        fields: Object.keys(input),
      });
      return { id, updated: true };
    });
  }

  async policies(user: AuthenticatedUser) {
    const [data] = await this.database<Array<Record<string, unknown>>>`
      select shelf_lookback_days as "shelfLookbackDays",
        shelf_minimum_picks as "shelfMinimumPicks",
        shelf_minimum_rank_improvement as "shelfMinimumRankImprovement",
        expiry_critical_days as "expiryCriticalDays", expiry_high_days as "expiryHighDays",
        expiry_moderate_days as "expiryModerateDays",
        target_coverage_days as "targetCoverageDays",
        regulated_retention_years as "regulatedRetentionYears",
        require_regimen_verification as "requireRegimenVerification",
        cash_variance_approval_threshold::text as "cashVarianceApprovalThreshold",
        basic_discount_limit_percent::text as "basicDiscountLimitPercent",
        updated_at as "updatedAt"
      from operational_intelligence_policies where branch_id = ${user.branchId}
    `;
    if (!data) throw new NotFoundException('Operational policies not found');
    return data;
  }

  async updatePolicies(user: AuthenticatedUser, input: UpdateOperationalPoliciesRequest) {
    return this.database.begin(async (transaction) => {
      const [current] = await transaction<
        Array<{ critical: number; high: number; moderate: number }>
      >`
        select expiry_critical_days as critical, expiry_high_days as high,
          expiry_moderate_days as moderate from operational_intelligence_policies
        where branch_id = ${user.branchId} for update
      `;
      if (!current) throw new NotFoundException('Operational policies not found');
      const critical = input.expiryCriticalDays ?? current.critical;
      const high = input.expiryHighDays ?? current.high;
      const moderate = input.expiryModerateDays ?? current.moderate;
      if (!(critical < high && high < moderate)) {
        throw new ConflictException('Expiry risk windows must increase: critical, high, moderate');
      }
      await transaction`
        update operational_intelligence_policies set
          shelf_lookback_days = coalesce(${input.shelfLookbackDays ?? null}, shelf_lookback_days),
          shelf_minimum_picks = coalesce(${input.shelfMinimumPicks ?? null}, shelf_minimum_picks),
          shelf_minimum_rank_improvement = coalesce(${input.shelfMinimumRankImprovement ?? null}, shelf_minimum_rank_improvement),
          expiry_critical_days = ${critical}, expiry_high_days = ${high},
          expiry_moderate_days = ${moderate},
          target_coverage_days = coalesce(${input.targetCoverageDays ?? null}, target_coverage_days),
          regulated_retention_years = coalesce(${input.regulatedRetentionYears ?? null}, regulated_retention_years),
          require_regimen_verification = coalesce(${input.requireRegimenVerification ?? null}, require_regimen_verification),
          cash_variance_approval_threshold = coalesce(${input.cashVarianceApprovalThreshold ?? null}::numeric, cash_variance_approval_threshold),
          basic_discount_limit_percent = coalesce(${input.basicDiscountLimitPercent ?? null}::numeric, basic_discount_limit_percent),
          updated_by_user_id = ${user.id}
        where branch_id = ${user.branchId}
      `;
      await this.audit(transaction, user, 'POLICIES.UPDATED', 'branch', user.branchId, {
        fields: Object.keys(input),
      });
      return { updated: true };
    });
  }

  async fiscalSettings(user: AuthenticatedUser) {
    const [settings] = await this.database<Array<Record<string, unknown>>>`
      select seller_ntn_cnic as "sellerNtnCnic", seller_strn as "sellerStrn",
        fbr_pos_registration_number as "posRegistrationNumber",
        coalesce(fbr_business_name, name) as "businessName",
        fbr_province as province, fbr_scenario_id as "scenarioId"
      from branches where id = ${user.branchId}
    `;
    if (!settings) throw new NotFoundException('Branch not found');
    return settings;
  }

  async updateFiscalSettings(user: AuthenticatedUser, input: UpdateFiscalSettingsRequest) {
    return this.database.begin(async (transaction) => {
      const [updated] = await transaction<Array<Record<string, unknown>>>`
        update branches set
          seller_ntn_cnic = case when ${input.sellerNtnCnic !== undefined}
            then ${input.sellerNtnCnic ?? null} else seller_ntn_cnic end,
          seller_strn = case when ${input.sellerStrn !== undefined}
            then ${input.sellerStrn ?? null} else seller_strn end,
          fbr_pos_registration_number = case when ${input.posRegistrationNumber !== undefined}
            then ${input.posRegistrationNumber ?? null} else fbr_pos_registration_number end,
          fbr_business_name = case when ${input.businessName !== undefined}
            then ${input.businessName ?? null} else fbr_business_name end,
          fbr_province = case when ${input.province !== undefined}
            then ${input.province ?? null} else fbr_province end,
          fbr_scenario_id = case when ${input.scenarioId !== undefined}
            then ${input.scenarioId ?? null} else fbr_scenario_id end
        where id = ${user.branchId}
        returning seller_ntn_cnic as "sellerNtnCnic", seller_strn as "sellerStrn",
          fbr_pos_registration_number as "posRegistrationNumber",
          coalesce(fbr_business_name, name) as "businessName",
          fbr_province as province, fbr_scenario_id as "scenarioId"
      `;
      if (!updated) throw new NotFoundException('Branch not found');
      await this.audit(transaction, user, 'SETTINGS.FISCAL_UPDATED', 'branch', user.branchId, {
        fields: Object.keys(input),
      });
      return updated;
    });
  }

  private async lockBranchResource(
    transaction: DatabaseTransaction,
    table: 'shelves' | 'terminals',
    id: string,
    branchId: string,
    label: string,
  ) {
    const rows =
      table === 'shelves'
        ? await transaction<Array<{ id: string }>>`
            select id::text from shelves where id = ${id} and branch_id = ${branchId} for update
          `
        : await transaction<Array<{ id: string }>>`
            select id::text from terminals where id = ${id} and branch_id = ${branchId} for update
          `;
    if (!rows[0]) throw new NotFoundException(`${label} not found`);
  }

  private async audit(
    transaction: DatabaseTransaction,
    actor: AuthenticatedUser,
    eventType: string,
    entityType: string,
    entityId: string,
    metadata: AuditMetadata,
  ) {
    await transaction`
      insert into audit_events (
        branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
      ) values (
        ${actor.branchId}, ${actor.id}, ${actor.terminalId}, ${eventType}, ${entityType},
        ${entityId}, ${transaction.json(metadata)}
      )
    `;
  }
}
