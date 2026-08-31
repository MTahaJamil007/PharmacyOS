import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import { sumMoney, type CreateReturnRequest, type RefundReturnRequest } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

interface ReturnRow {
  readonly id: string;
  readonly branch_id: string;
  readonly sale_id: string;
  readonly status: string;
}

@Injectable()
export class ReturnsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async lookup(branchId: string, token: string): Promise<Record<string, unknown>> {
    const [sale] = await this.database<Array<Record<string, unknown>>>`
      select sales.id::text, sales.invoice_number, sales.status, sales.total::text,
        sales.created_at, return_lookup_tokens.token::text as lookup_token
      from return_lookup_tokens
      join sales on sales.id = return_lookup_tokens.sale_id
      where return_lookup_tokens.token = ${token}::uuid
        and return_lookup_tokens.revoked_at is null
        and sales.branch_id = ${branchId}
    `;
    if (!sale) throw new NotFoundException('Receipt was not found');
    const items = await this.database<Array<Record<string, unknown>>>`
      select sale_items.id::text, medicines.name as medicine_name,
        sale_items.quantity::text as sold_quantity,
        coalesce(returned.returned_quantity, 0)::text as returned_quantity,
        greatest(sale_items.quantity - coalesce(returned.returned_quantity, 0), 0)::text as eligible_quantity,
        sale_items.unit_price::text, sale_items.line_total::text,
        inventory_batches.batch_number, inventory_batches.expiry_date::text
      from sale_items
      join medicines on medicines.id = sale_items.medicine_id
      join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
      left join lateral (
        select sum(return_items.quantity) as returned_quantity
        from return_items join returns on returns.id = return_items.return_id
        where return_items.sale_item_id = sale_items.id and returns.status <> 'REJECTED'
      ) returned on true
      where sale_items.sale_id = ${String(sale.id)}
      order by sale_items.id
    `;
    return { sale, items };
  }

  async requestReturn(
    user: AuthenticatedUser,
    token: string,
    input: CreateReturnRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(transaction, 'RETURN.REQUEST', user.branchId, input.clientRequestId);
      const [existing] = await transaction<ReturnRow[]>`
        select id::text, branch_id::text, sale_id::text, status from returns
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (existing) return { id: existing.id, status: existing.status, idempotentReplay: true };
      const [sale] = await transaction<Array<{ id: string; invoice_number: string }>>`
        select sales.id::text, sales.invoice_number
        from return_lookup_tokens join sales on sales.id = return_lookup_tokens.sale_id
        where return_lookup_tokens.token = ${token}::uuid and return_lookup_tokens.revoked_at is null
          and sales.branch_id = ${user.branchId} and sales.status <> 'VOIDED'
        for update of sales
      `;
      if (!sale) throw new NotFoundException('Receipt was not found');
      const saleItemIds = input.items.map((item) => item.saleItemId.toString());
      const saleItems = await transaction<
        Array<{ id: string; quantity: string; line_total: string }>
      >`
        select id::text, quantity::text, line_total::text from sale_items
        where sale_id = ${sale.id} and id in ${transaction(saleItemIds)}
        order by id for update
      `;
      if (saleItems.length !== new Set(saleItemIds).size)
        throw new ConflictException('Return contains an invalid sale item');

      const [created] = await transaction<Array<{ id: string; return_number: string }>>`
        insert into returns (
          branch_id, sale_id, requested_by_user_id, return_number, status, reason, client_request_id
        ) values (
          ${user.branchId}, ${sale.id}, ${user.id},
          concat('RET-', to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD'), '-',
            upper(substr(encode(digest(${input.clientRequestId}, 'sha256'), 'hex'), 1, 10))),
          'REQUESTED', ${input.reason}, ${input.clientRequestId}
        ) returning id::text, return_number
      `;
      if (!created) throw new Error('Return creation failed');
      const saleItemMap = new Map(saleItems.map((item) => [item.id, item]));
      for (const item of input.items) {
        const saleItem = saleItemMap.get(item.saleItemId.toString());
        if (!saleItem) throw new ConflictException('Return item is unavailable');
        await transaction`
          insert into return_items (return_id, sale_item_id, quantity, disposition, refund_amount)
          values (
            ${created.id}, ${saleItem.id}, ${item.quantity}, ${item.disposition},
            round(${item.quantity}::numeric * (${saleItem.line_total}::numeric / ${saleItem.quantity}::numeric), 2)
          )
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'RETURN.REQUESTED', 'return', ${created.id},
          ${transaction.json({ invoiceNumber: sale.invoice_number, itemCount: input.items.length })}
        )
      `;
      return {
        id: created.id,
        returnNumber: created.return_number,
        status: 'REQUESTED',
        idempotentReplay: false,
      };
    });
  }

  async approve(user: AuthenticatedUser, returnId: bigint): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [row] = await transaction<ReturnRow[]>`
        select id::text, branch_id::text, sale_id::text, status from returns
        where id = ${returnId.toString()} for update
      `;
      if (!row || row.branch_id !== user.branchId) throw new NotFoundException('Return not found');
      if (row.status === 'APPROVED')
        return { id: row.id, status: row.status, idempotentReplay: true };
      if (row.status !== 'REQUESTED')
        throw new ConflictException('Return cannot be approved from its current status');
      await transaction`
        update returns set status = 'APPROVED', approved_by_user_id = ${user.id}, approved_at = now()
        where id = ${row.id}
      `;
      await transaction`
        insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id)
        values (${user.branchId}, ${user.id}, ${user.terminalId}, 'RETURN.APPROVED', 'return', ${row.id})
      `;
      return { id: row.id, status: 'APPROVED', idempotentReplay: false };
    });
  }

  async refund(
    user: AuthenticatedUser,
    returnId: bigint,
    input: RefundReturnRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [row] = await transaction<ReturnRow[]>`
        select id::text, branch_id::text, sale_id::text, status from returns
        where id = ${returnId.toString()} for update
      `;
      if (!row || row.branch_id !== user.branchId) throw new NotFoundException('Return not found');
      const [existingRefund] = await transaction<Array<{ id: string; amount: string }>>`
        select id::text, amount::text from refunds where return_id = ${row.id}
      `;
      if (existingRefund)
        return {
          id: row.id,
          status: 'REFUNDED',
          refundAmount: existingRefund.amount,
          idempotentReplay: true,
        };
      if (row.status !== 'APPROVED')
        throw new ConflictException('Return must be approved before refund');
      if (input.method === 'CASH' && !input.cashSessionId)
        throw new ConflictException('Cash refund requires an open cash session');
      if (input.cashSessionId) {
        const [session] = await transaction<Array<{ id: string }>>`
          select id::text from cash_sessions where id = ${input.cashSessionId.toString()}
            and branch_id = ${user.branchId} and status = 'OPEN' for update
        `;
        if (!session) throw new ConflictException('Cash session is not open');
      }
      const items = await transaction<
        Array<{
          return_item_id: string;
          sale_item_id: string;
          inventory_batch_id: string;
          quantity: string;
          disposition: string;
          refund_amount: string;
          sellable_by_date: boolean;
          medicine_id: string;
          purchase_order_item_id: string | null;
          batch_number: string;
          expiry_date: string;
          received_at: Date;
          cost_price: string;
          sale_price: string;
          batch_status: string;
          source_batch_id: string | null;
        }>
      >`
        select return_items.id::text as return_item_id, sale_items.id::text as sale_item_id,
          sale_items.inventory_batch_id::text, return_items.quantity::text,
          return_items.disposition, return_items.refund_amount::text,
          inventory_batches.expiry_date >= (now() at time zone 'Asia/Karachi')::date as sellable_by_date,
          inventory_batches.medicine_id::text, inventory_batches.purchase_order_item_id::text,
          inventory_batches.batch_number, inventory_batches.expiry_date::text,
          inventory_batches.received_at, inventory_batches.cost_price::text,
          inventory_batches.sale_price::text, inventory_batches.status as batch_status,
          inventory_batches.source_batch_id::text
        from return_items
        join sale_items on sale_items.id = return_items.sale_item_id
        join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
        where return_items.return_id = ${row.id}
        order by inventory_batches.id, return_items.id
        for update of inventory_batches
      `;
      for (const item of items) {
        if (item.disposition === 'RESTOCK_SELLABLE' && !item.sellable_by_date) {
          throw new ConflictException('Expired returned stock cannot be restored as sellable');
        }
        if (item.disposition !== 'SCRAP') {
          const [batch] =
            item.disposition === 'QUARANTINE'
              ? await transaction<Array<{ id: string; quantity_after: string }>>`
                  insert into inventory_batches (
                    branch_id, medicine_id, purchase_order_item_id, batch_number, expiry_date,
                    received_at, cost_price, sale_price, current_qty, status,
                    source_batch_id, segment_key
                  ) values (
                    ${user.branchId}, ${item.medicine_id}, ${item.purchase_order_item_id},
                    ${item.batch_number}, ${item.expiry_date}, ${item.received_at},
                    ${item.cost_price}, ${item.sale_price}, ${item.quantity}, 'QUARANTINE',
                    ${item.source_batch_id ?? item.inventory_batch_id}, 'RETURN_QUARANTINE'
                  )
                  on conflict on constraint inventory_batches_acquisition_lot_key do update set
                    current_qty = inventory_batches.current_qty + excluded.current_qty,
                    status = case
                      when inventory_batches.status = 'RECALLED' then 'RECALLED'
                      else 'QUARANTINE'
                    end,
                    deleted_at = null
                  returning id::text, current_qty::text as quantity_after
                `
              : await transaction<Array<{ id: string; quantity_after: string }>>`
                  update inventory_batches
                  set current_qty = current_qty + ${item.quantity}::numeric,
                      status = case when status = 'DEPLETED' then 'SELLABLE' else status end
                  where id = ${item.inventory_batch_id}
                  returning id::text, current_qty::text as quantity_after
                `;
          if (!batch) throw new ConflictException('Original inventory batch is unavailable');
          await transaction`
            insert into stock_movements (
              branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
              sale_item_id, performed_by_user_id, reason, metadata
            ) values (
              ${user.branchId}, ${batch.id}, 'RETURN_RESTOCK', ${item.quantity},
              ${batch.quantity_after}, ${item.sale_item_id}, ${user.id}, 'Accepted customer return',
              ${transaction.json({ returnId: row.id, disposition: item.disposition })}
            )
          `;
        }
      }
      const refundAmount = sumMoney(items.map((item) => item.refund_amount));
      const [refund] = await transaction<Array<{ id: string }>>`
        insert into refunds (
          return_id, cash_session_id, processed_by_user_id, method, amount, reference
        ) values (
          ${row.id}, ${input.cashSessionId?.toString() ?? null}, ${user.id}, ${input.method},
          ${refundAmount}, ${input.reference ?? null}
        ) returning id::text
      `;
      if (!refund) throw new Error('Refund creation failed');
      await transaction`update returns set status = 'REFUNDED' where id = ${row.id}`;
      await transaction`
        update sales set status = case
          when not exists (
            select 1 from sale_items
            left join lateral (
              select coalesce(sum(return_items.quantity), 0) quantity
              from return_items join returns on returns.id = return_items.return_id
              where return_items.sale_item_id = sale_items.id and returns.status = 'REFUNDED'
            ) returned on true
            where sale_items.sale_id = ${row.sale_id} and returned.quantity < sale_items.quantity
          ) then 'RETURNED' else 'PARTIALLY_RETURNED' end
        where id = ${row.sale_id}
      `;
      const [fbr] = await transaction<Array<{ id: string }>>`
        update fbr_invoices set status = 'VOID_OR_CREDIT_NOTE_PENDING'
        where sale_id = ${row.sale_id} and status = 'SUBMITTED'
        returning id::text
      `;
      if (fbr) {
        await transaction`
          insert into outbox_jobs (job_type, deduplication_key, payload, priority)
          values ('FBR_RETURN', ${`return:${row.id}`}, ${transaction.json({ returnId: row.id, fbrInvoiceId: fbr.id })}, 20)
          on conflict (job_type, deduplication_key) where deduplication_key is not null do nothing
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'RETURN.REFUNDED', 'return', ${row.id},
          ${transaction.json({ refundId: refund.id, amount: refundAmount, method: input.method })}
        )
      `;
      return { id: row.id, status: 'REFUNDED', refundAmount, idempotentReplay: false };
    });
  }
}
