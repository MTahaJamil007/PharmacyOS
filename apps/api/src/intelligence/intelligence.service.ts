import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import type {
  ExpiryWorkItemActionRequest,
  ShelfRecommendationReviewRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

interface ShelfRecommendationRow {
  readonly id: string;
  readonly branch_id: string;
  readonly medicine_id: string;
  readonly suggested_shelf_id: string;
  readonly status: string;
}

interface EligibilityRow {
  readonly shelf_id: string;
  readonly is_active: boolean;
  readonly is_pick_location: boolean;
  readonly shelf_storage_class: string;
  readonly is_secured: boolean;
  readonly medicine_storage_class: string;
  readonly requires_secured_storage: boolean;
}

@Injectable()
export class IntelligenceService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getAttentionSummary(branchId: string): Promise<Record<string, unknown>> {
    const [summary] = await this.database<
      Array<{
        expired: string;
        critical_expiry: string;
        open_reorders: string;
        pending_shelf: string;
      }>
    >`
      select
        count(*) filter (where inventory_batches.expiry_date < local_date)::text as expired,
        count(*) filter (
          where inventory_batches.expiry_date between local_date and local_date + policies.expiry_critical_days
        )::text as critical_expiry,
        (select count(*)::text from reorder_suggestions
          where branch_id = ${branchId} and status in ('GENERATED', 'REVIEWED')) as open_reorders,
        (select count(*)::text from shelf_recommendations
          where branch_id = ${branchId} and status = 'PENDING_REVIEW') as pending_shelf
      from inventory_batches
      join branches on branches.id = inventory_batches.branch_id
      join operational_intelligence_policies policies on policies.branch_id = branches.id
      cross join lateral (select (now() at time zone branches.timezone)::date as local_date) dates
      where inventory_batches.branch_id = ${branchId}
        and inventory_batches.current_qty > 0
        and inventory_batches.deleted_at is null
        and inventory_batches.expiry_date <= local_date + policies.expiry_moderate_days
      group by policies.expiry_critical_days
    `;
    return (
      summary ?? { expired: '0', critical_expiry: '0', open_reorders: '0', pending_shelf: '0' }
    );
  }

  async listShelfRecommendations(
    branchId: string,
    status: string,
    limit: number,
    offset: number,
  ): Promise<{ readonly data: readonly Record<string, unknown>[] }> {
    const data = await this.database<Array<Record<string, unknown>>>`
      select recommendations.id::text,
        medicines.id::text as medicine_id,
        medicines.name as medicine_name,
        recommendations.status,
        recommendations.confidence,
        recommendations.demand_class,
        recommendations.pick_count::text,
        recommendations.units_sold::text,
        recommendations.demand_score::text,
        recommendations.current_pick_priority,
        recommendations.suggested_pick_priority,
        current_shelf.name as current_location,
        suggested_shelf.name as suggested_location,
        recommendations.reason_snapshot,
        recommendations.generated_for_date::text,
        recommendations.review_notes
      from shelf_recommendations recommendations
      join medicines on medicines.id = recommendations.medicine_id
      left join shelves current_shelf on current_shelf.id = recommendations.current_shelf_id
      join shelves suggested_shelf on suggested_shelf.id = recommendations.suggested_shelf_id
      where recommendations.branch_id = ${branchId} and recommendations.status = ${status}
      order by recommendations.demand_score desc, recommendations.id
      limit ${limit} offset ${offset}
    `;
    return { data };
  }

  async reviewShelfRecommendation(
    user: AuthenticatedUser,
    recommendationId: bigint,
    input: ShelfRecommendationReviewRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [recommendation] = await transaction<ShelfRecommendationRow[]>`
        select id::text, branch_id::text, medicine_id::text, suggested_shelf_id::text, status
        from shelf_recommendations where id = ${recommendationId.toString()} for update
      `;
      if (!recommendation || recommendation.branch_id !== user.branchId) {
        throw new NotFoundException('Shelf recommendation not found');
      }
      if (recommendation.status !== 'PENDING_REVIEW') {
        throw new ConflictException('Shelf recommendation has already been reviewed');
      }

      const nextStatus = input.decision === 'APPLY' ? 'APPLIED' : 'DISMISSED';
      if (input.decision === 'APPLY') {
        const [eligibility] = await transaction<EligibilityRow[]>`
          select shelves.id::text as shelf_id, shelves.is_active, shelves.is_pick_location,
            shelves.storage_class as shelf_storage_class, shelves.is_secured,
            medicines.storage_class as medicine_storage_class, medicines.requires_secured_storage
          from shelves cross join medicines
          where shelves.id = ${recommendation.suggested_shelf_id}
            and shelves.branch_id = ${user.branchId}
            and medicines.id = ${recommendation.medicine_id}
          for update of shelves
        `;
        if (
          !eligibility?.is_active ||
          !eligibility.is_pick_location ||
          eligibility.shelf_storage_class !== eligibility.medicine_storage_class ||
          (eligibility.requires_secured_storage && !eligibility.is_secured)
        ) {
          throw new ConflictException('Suggested shelf is no longer eligible for this medicine');
        }
        await transaction`
          update medicine_shelf_locations set is_primary = false
          where medicine_id = ${recommendation.medicine_id} and is_primary = true
        `;
        await transaction`
          insert into medicine_shelf_locations (medicine_id, shelf_id, is_primary, location_type)
          values (${recommendation.medicine_id}, ${eligibility.shelf_id}, true, 'PRIMARY_PICK')
          on conflict (medicine_id, shelf_id)
          do update set is_primary = true, location_type = 'PRIMARY_PICK'
        `;
      }

      await transaction`
        update shelf_recommendations
        set status = ${nextStatus}, reviewed_by_user_id = ${user.id},
            review_notes = ${input.notes ?? null}, reviewed_at = now(),
            applied_at = ${input.decision === 'APPLY' ? new Date() : null}
        where id = ${recommendation.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId},
          ${`SHELF_RECOMMENDATION.${nextStatus}`}, 'shelf_recommendation', ${recommendation.id},
          ${transaction.json({ notes: input.notes ?? null })}
        )
      `;
      return { id: recommendation.id, status: nextStatus };
    });
  }

  async listExpiryRisk(
    branchId: string,
    bucket: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ readonly data: readonly Record<string, unknown>[]; readonly costBasis: string }> {
    const data = await this.database<Array<Record<string, unknown>>>`
      with risk as (
        select inventory_batches.id::text as batch_id,
          medicines.id::text as medicine_id,
          medicines.name as medicine_name,
          inventory_batches.batch_number,
          inventory_batches.expiry_date::text,
          inventory_batches.current_qty::text as quantity,
          inventory_batches.cost_price::text as unit_cost,
          round(inventory_batches.current_qty * inventory_batches.cost_price, 2)::text as value_at_risk,
          case
            when inventory_batches.expiry_date < local_date then 'EXPIRED'
            when inventory_batches.expiry_date <= local_date + policies.expiry_critical_days then 'DAYS_0_30'
            when inventory_batches.expiry_date <= local_date + policies.expiry_high_days then 'DAYS_31_60'
            when inventory_batches.expiry_date <= local_date + policies.expiry_moderate_days then 'DAYS_61_90'
          end as risk_bucket,
          (inventory_batches.expiry_date - local_date) as days_to_expiry,
          inventory_batches.status
        from inventory_batches
        join medicines on medicines.id = inventory_batches.medicine_id
        join branches on branches.id = inventory_batches.branch_id
        join operational_intelligence_policies policies on policies.branch_id = branches.id
        cross join lateral (select (now() at time zone branches.timezone)::date as local_date) dates
        where inventory_batches.branch_id = ${branchId}
          and inventory_batches.current_qty > 0
          and inventory_batches.deleted_at is null
          and inventory_batches.expiry_date <= local_date + policies.expiry_moderate_days
      )
      select * from risk
      where (${bucket ?? null}::text is null or risk_bucket = ${bucket ?? null})
      order by expiry_date, medicine_name, batch_id
      limit ${limit} offset ${offset}
    `;
    return { data, costBasis: 'Batch acquisition cost' };
  }

  async actionExpiryWorkItem(
    user: AuthenticatedUser,
    workItemId: bigint,
    input: ExpiryWorkItemActionRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [item] = await transaction<
        Array<{
          id: string;
          action: string | null;
          branch_id: string;
          inventory_batch_id: string;
          status: string;
        }>
      >`
        select id::text, action, branch_id::text, inventory_batch_id::text, status
        from expiry_work_items where id = ${workItemId.toString()} for update
      `;
      if (!item || item.branch_id !== user.branchId)
        throw new NotFoundException('Expiry work item not found');
      if (item.action === input.action) {
        return {
          action: item.action,
          id: item.id,
          idempotentReplay: true,
          status: item.status,
        };
      }
      if (item.status === 'RESOLVED')
        throw new ConflictException('Expiry work item is already resolved');

      let inventoryBatchId = item.inventory_batch_id;
      if (input.action === 'QUARANTINED' || input.action === 'SCRAPPED') {
        const [batch] = await transaction<
          Array<{
            id: string;
            batch_number: string;
            cost_price: string;
            current_qty: string;
            expiry_date: string;
            medicine_id: string;
            purchase_order_item_id: string | null;
            received_at: Date;
            sale_price: string;
            source_batch_id: string | null;
            status: string;
          }>
        >`
          select id::text, medicine_id::text, purchase_order_item_id::text,
            batch_number, expiry_date::text, received_at, cost_price::text,
            sale_price::text, current_qty::text, status, source_batch_id::text
          from inventory_batches
          where id = ${item.inventory_batch_id} and current_qty > 0
          for update
        `;
        if (!batch) {
          throw new ConflictException('Expiry batch has no stock to action');
        }
        const [reservation] = await transaction<Array<{ has_active: boolean }>>`
          select exists (
            select 1 from stock_reservations
            where inventory_batch_id = ${batch.id}
              and status = 'ACTIVE' and expires_at > now()
          ) as has_active
        `;
        if (reservation?.has_active) {
          throw new ConflictException('Release active reservations before restricting this batch');
        }

        if (input.action === 'QUARANTINED') {
          if (batch.status !== 'SELLABLE') {
            throw new ConflictException('Only sellable stock can enter expiry quarantine');
          }
          const [quarantineBatch] = await transaction<
            Array<{ id: string; quantity_after: string }>
          >`
            insert into inventory_batches (
              branch_id, medicine_id, purchase_order_item_id, batch_number, expiry_date,
              received_at, cost_price, sale_price, current_qty, status,
              source_batch_id, segment_key
            ) values (
              ${user.branchId}, ${batch.medicine_id}, ${batch.purchase_order_item_id},
              ${batch.batch_number}, ${batch.expiry_date}, ${batch.received_at},
              ${batch.cost_price}, ${batch.sale_price}, ${batch.current_qty}, 'QUARANTINE',
              ${batch.source_batch_id ?? batch.id}, 'EXPIRY_QUARANTINE'
            )
            on conflict on constraint inventory_batches_acquisition_lot_key do update set
              current_qty = inventory_batches.current_qty + excluded.current_qty,
              status = 'QUARANTINE', deleted_at = null
            returning id::text, current_qty::text as quantity_after
          `;
          if (!quarantineBatch) throw new Error('Quarantine batch creation failed');
          await transaction`
            update inventory_batches set current_qty = 0, status = 'DEPLETED' where id = ${batch.id}
          `;
          await transaction`
            insert into stock_movements (
              branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
              performed_by_user_id, reason, metadata
            ) values (
              ${user.branchId}, ${batch.id}, 'QUARANTINE', -${batch.current_qty}::numeric, 0,
              ${user.id}, 'Expiry quarantine',
              ${transaction.json({ expiryWorkItemId: item.id, quarantineBatchId: quarantineBatch.id })}
            )
          `;
          await transaction`
            insert into stock_movements (
              branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
              performed_by_user_id, reason, metadata
            ) values (
              ${user.branchId}, ${quarantineBatch.id}, 'TRANSFER', ${batch.current_qty},
              ${quarantineBatch.quantity_after}, ${user.id}, 'Received into expiry quarantine',
              ${transaction.json({ expiryWorkItemId: item.id, sourceBatchId: batch.id })}
            )
          `;
          inventoryBatchId = quarantineBatch.id;
        } else {
          await transaction`
            update inventory_batches set current_qty = 0, status = 'DEPLETED' where id = ${batch.id}
          `;
          await transaction`
            insert into stock_movements (
              branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
              performed_by_user_id, reason, metadata
            ) values (
              ${user.branchId}, ${batch.id}, 'SCRAP', -${batch.current_qty}::numeric, 0,
              ${user.id}, 'Expiry write-off',
              ${transaction.json({ expiryWorkItemId: item.id, notes: input.notes })}
            )
          `;
        }
      }
      const nextStatus =
        input.action === 'RESOLVED' || input.action === 'SCRAPPED' ? 'RESOLVED' : 'REVIEWED';
      await transaction`
        update expiry_work_items
          set action = ${input.action}, status = ${nextStatus}, acted_by_user_id = ${user.id},
            action_notes = ${input.notes}, acted_at = now(),
            inventory_batch_id = ${inventoryBatchId}
        where id = ${item.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'EXPIRY_WORK_ITEM.ACTIONED',
          'expiry_work_item', ${item.id}, ${transaction.json({ action: input.action })}
        )
      `;
      return {
        id: item.id,
        status: nextStatus,
        action: input.action,
        inventoryBatchId,
        idempotentReplay: false,
      };
    });
  }
}
