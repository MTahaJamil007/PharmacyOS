import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import {
  calculateBudgetRegimen,
  PERMISSIONS,
  type BudgetRegimenRequest,
  type PricedRegimenItem,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

@Injectable()
export class BudgetRegimenService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async calculate(
    user: AuthenticatedUser,
    input: BudgetRegimenRequest,
  ): Promise<Record<string, unknown>> {
    const medicineIds = input.items.map((item) => item.medicineId.toString());
    const rows = await this.database<
      Array<{
        medicine_id: string;
        medicine_name: string;
        sale_price: string;
        price_version: string;
      }>
    >`
      select medicines.id::text as medicine_id, medicines.name as medicine_name,
        price.sale_price::text,
        concat(price.batch_id, ':', extract(epoch from price.updated_at)::bigint, ':', price.sale_price) as price_version
      from medicines
      join lateral (
        select inventory_batches.id::text as batch_id, inventory_batches.sale_price,
          inventory_batches.updated_at
        from inventory_batches
        where inventory_batches.branch_id = ${user.branchId}
          and inventory_batches.medicine_id = medicines.id
          and inventory_batches.current_qty > 0
          and inventory_batches.status = 'SELLABLE'
          and inventory_batches.deleted_at is null
          and inventory_batches.expiry_date >= (now() at time zone (
            select timezone from branches where id = ${user.branchId}
          ))::date
        order by inventory_batches.expiry_date, inventory_batches.received_at, inventory_batches.id
        limit 1
      ) price on true
      where medicines.id in ${this.database(medicineIds)}
        and medicines.is_active = true and medicines.deleted_at is null
      order by medicines.id
    `;
    if (rows.length !== new Set(medicineIds).size) {
      throw new ConflictException('One or more regimen medicines have no current sellable price');
    }
    const byId = new Map(rows.map((row) => [row.medicine_id, row]));
    const pricedItems: PricedRegimenItem[] = input.items.map((item) => {
      const medicine = byId.get(item.medicineId.toString());
      if (!medicine) throw new ConflictException('Regimen medicine is unavailable');
      return {
        medicineId: medicine.medicine_id,
        medicineName: medicine.medicine_name,
        prescribedBaseUnitsPerDay: item.prescribedBaseUnitsPerDay,
        minimumSaleIncrement: item.minimumSaleIncrement,
        unitPrice: medicine.sale_price,
        priceVersion: medicine.price_version,
      };
    });
    const result = calculateBudgetRegimen(input.budget, pricedItems);
    const [policy] = await this.database<Array<{ require_regimen_verification: boolean }>>`
      select require_regimen_verification from operational_intelligence_policies
      where branch_id = ${user.branchId}
    `;
    const requiresVerification = policy?.require_regimen_verification ?? true;
    let auditId: string | null = null;
    if (input.persistAudit) {
      if (
        requiresVerification &&
        (input.verifiedByUserId?.toString() !== user.id ||
          !user.permissions.includes(PERMISSIONS.SALES_BUDGET_REGIMEN_VERIFY))
      ) {
        throw new ConflictException(
          'A permitted pharmacist must verify this regimen before it is recorded',
        );
      }
      const priceSnapshot = result.lines.map((line) => ({
        medicineId: line.medicineId,
        unitPrice: line.unitPrice,
        priceVersion: line.priceVersion,
        quantity: line.requiredQuantity,
      }));
      const [audit] = await this.database<Array<{ id: string }>>`
        insert into budget_regimen_audits (
          branch_id, calculated_by_user_id, verified_by_user_id, budget,
          complete_days, total_cost, price_snapshot, regimen_hash
        ) values (
          ${user.branchId}, ${user.id}, ${input.verifiedByUserId?.toString() ?? null}, ${input.budget},
          ${result.completeDays}, ${result.totalCost}, ${this.database.json(priceSnapshot)},
          digest(${JSON.stringify(input.items)}, 'sha256')
        ) returning id::text
      `;
      auditId = audit?.id ?? null;
    }
    return {
      ...result,
      auditId,
      requiresVerification,
      verified: Boolean(input.verifiedByUserId),
      priceCheckedAt: new Date().toISOString(),
      checkoutRule:
        'Recalculate if any priceVersion changes before checkout; normal checkout remains authoritative.',
    };
  }
}
