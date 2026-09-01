import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import {
  decimalToScaledInteger,
  scaledIntegerToDecimal,
  type StockAdjustmentRequest,
  type UpdateBatchPriceRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

interface LockedBatch {
  readonly id: string;
  readonly current_qty: string;
  readonly sale_price: string;
  readonly maximum_retail_price: string | null;
  readonly status: string;
}

@Injectable()
export class InventoryOperationsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async searchBatches(user: AuthenticatedUser, query: string, limit: number) {
    const normalized = query.trim();
    const data = await this.database<Array<Record<string, unknown>>>`
      select inventory_batches.id::text, medicines.id::text as "medicineId",
        medicines.name as "medicineName", inventory_batches.batch_number as "batchNumber",
        inventory_batches.expiry_date::text as "expiryDate",
        inventory_batches.current_qty::text as "currentQuantity",
        inventory_batches.sale_price::text as "salePrice",
        inventory_batches.maximum_retail_price::text as "maximumRetailPrice",
        inventory_batches.status
      from inventory_batches join medicines on medicines.id = inventory_batches.medicine_id
      where inventory_batches.branch_id = ${user.branchId}
        and inventory_batches.deleted_at is null
        and (${normalized} = '' or medicines.name ilike ${`%${normalized}%`}
          or inventory_batches.batch_number ilike ${`%${normalized}%`})
      order by medicines.name, inventory_batches.expiry_date, inventory_batches.id
      limit ${limit}
    `;
    return { data };
  }

  async updatePrice(user: AuthenticatedUser, batchId: bigint, input: UpdateBatchPriceRequest) {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'INVENTORY.PRICE',
        user.branchId,
        input.clientRequestId,
      );
      const [batch] = await transaction<LockedBatch[]>`
        select id::text, current_qty::text, sale_price::text,
          maximum_retail_price::text, status
        from inventory_batches where id = ${batchId.toString()}
          and branch_id = ${user.branchId} and deleted_at is null for update
      `;
      if (!batch) throw new NotFoundException('Inventory batch not found');
      const [replay] = await transaction<Array<{ id: string }>>`
        select id::text from inventory_batch_price_history
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (replay) return { id: replay.id, batchId: batch.id, idempotentReplay: true };

      const maximumRetailPrice =
        input.maximumRetailPrice === undefined
          ? batch.maximum_retail_price
          : input.maximumRetailPrice;
      if (
        maximumRetailPrice !== null &&
        decimalToScaledInteger(input.salePrice, 2) > decimalToScaledInteger(maximumRetailPrice, 2)
      ) {
        throw new ConflictException('Sale price cannot exceed maximum retail price');
      }
      await transaction`
        update inventory_batches set sale_price = ${input.salePrice},
          maximum_retail_price = ${maximumRetailPrice}
        where id = ${batch.id}
      `;
      const [history] = await transaction<Array<{ id: string }>>`
        insert into inventory_batch_price_history (
          branch_id, inventory_batch_id, old_sale_price, new_sale_price,
          old_maximum_retail_price, new_maximum_retail_price, change_type,
          reason, client_request_id, performed_by_user_id
        ) values (
          ${user.branchId}, ${batch.id}, ${batch.sale_price}, ${input.salePrice},
          ${batch.maximum_retail_price}, ${maximumRetailPrice}, 'MANUAL',
          ${input.reason}, ${input.clientRequestId}, ${user.id}
        ) returning id::text
      `;
      if (!history) throw new Error('Price history creation did not return an identifier');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'INVENTORY.PRICE_CHANGED',
          'inventory_batch', ${batch.id}, ${input.clientRequestId},
          ${transaction.json({ oldSalePrice: batch.sale_price, newSalePrice: input.salePrice, maximumRetailPrice, reason: input.reason })}
        )
      `;
      return { id: history.id, batchId: batch.id, idempotentReplay: false };
    });
  }

  async adjustStock(user: AuthenticatedUser, batchId: bigint, input: StockAdjustmentRequest) {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'INVENTORY.ADJUSTMENT',
        user.branchId,
        input.clientRequestId,
      );
      const [batch] = await transaction<LockedBatch[]>`
        select id::text, current_qty::text, sale_price::text,
          maximum_retail_price::text, status
        from inventory_batches where id = ${batchId.toString()}
          and branch_id = ${user.branchId} and deleted_at is null for update
      `;
      if (!batch) throw new NotFoundException('Inventory batch not found');
      const [replay] = await transaction<Array<{ id: string; quantity_after: string }>>`
        select id::text, quantity_after::text from stock_adjustments
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (replay) {
        return { id: replay.id, quantityAfter: replay.quantity_after, idempotentReplay: true };
      }

      const before = decimalToScaledInteger(batch.current_qty, 3);
      const after =
        input.type === 'COUNT'
          ? decimalToScaledInteger(input.countedQuantity, 3)
          : before - decimalToScaledInteger(input.quantity, 3);
      if (after < 0n) throw new ConflictException('Scrap quantity exceeds batch stock');
      const delta = after - before;
      const quantityAfter = scaledIntegerToDecimal(after, 3);
      const quantityDelta = scaledIntegerToDecimal(delta, 3);
      let movementId: string | null = null;

      if (delta !== 0n) {
        await transaction`
          update inventory_batches set current_qty = ${quantityAfter},
            status = case
              when ${quantityAfter}::numeric = 0 then 'DEPLETED'
              when status = 'DEPLETED' then 'SELLABLE'
              else status
            end
          where id = ${batch.id}
        `;
        const movementType =
          input.type === 'SCRAP' ? 'SCRAP' : delta > 0n ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        const [movement] = await transaction<Array<{ id: string }>>`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta,
            quantity_after, performed_by_user_id, reason, metadata
          ) values (
            ${user.branchId}, ${batch.id}, ${movementType}, ${quantityDelta},
            ${quantityAfter}, ${user.id}, ${input.reason},
            ${transaction.json({ adjustmentType: input.type, clientRequestId: input.clientRequestId })}
          ) returning id::text
        `;
        if (!movement) throw new Error('Stock movement did not return an identifier');
        movementId = movement.id;
      }

      const [adjustment] = await transaction<Array<{ id: string }>>`
        insert into stock_adjustments (
          branch_id, inventory_batch_id, stock_movement_id, adjustment_type,
          quantity_before, quantity_delta, quantity_after, reason,
          client_request_id, performed_by_user_id
        ) values (
          ${user.branchId}, ${batch.id}, ${movementId}, ${input.type},
          ${batch.current_qty}, ${quantityDelta}, ${quantityAfter}, ${input.reason},
          ${input.clientRequestId}, ${user.id}
        ) returning id::text
      `;
      if (!adjustment) throw new Error('Stock adjustment did not return an identifier');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'INVENTORY.STOCK_ADJUSTED',
          'stock_adjustment', ${adjustment.id}, ${input.clientRequestId},
          ${transaction.json({ batchId: batch.id, type: input.type, quantityBefore: batch.current_qty, quantityDelta, quantityAfter, reason: input.reason })}
        )
      `;
      return {
        id: adjustment.id,
        movementId,
        quantityBefore: batch.current_qty,
        quantityAfter,
        idempotentReplay: false,
      };
    });
  }
}
