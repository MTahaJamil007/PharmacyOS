import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  cumulativeRefundAmount,
  minorUnitsToMoney,
  moneyToMinorUnits,
  netPaidPerSaleLine,
  PERMISSIONS,
  sumMoney,
  type CreateReturnRequest,
  type RefundReturnRequest,
  type RejectReturnRequest,
  type ReturnLookup,
  type ReturnStatus,
  type ReturnSummary,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

type Queryable = Database | DatabaseTransaction;

interface ReturnRow {
  readonly id: string;
  readonly branch_id: string;
  readonly sale_id: string;
  readonly status: string;
  readonly return_number: string;
}

interface SaleLineRow {
  readonly id: string;
  readonly quantity: string;
  readonly line_total: string;
}

export interface RefundLimits {
  readonly cashOrCard: string;
  readonly customerAccount: string;
}

/**
 * Sale-level evidence the refund limits are computed from. Kept separate so the rule is
 * readable: outstanding customer credit can be cancelled on the account but never paid out.
 */
interface SaleMoneyRow {
  readonly total: string;
  readonly customer_id: string | null;
  readonly credit_paid: string;
  readonly refunded_account: string;
  readonly refunded_other: string;
  readonly customer_balance: string;
}

export function computeRefundLimits(row: SaleMoneyRow): RefundLimits {
  const total = moneyToMinorUnits(row.total);
  const creditPaid = moneyToMinorUnits(row.credit_paid);
  const refundedAccount = moneyToMinorUnits(row.refunded_account);
  const refundedOther = moneyToMinorUnits(row.refunded_other);
  const balance = moneyToMinorUnits(row.customer_balance);
  const creditStillAttributed = creditPaid - refundedAccount;
  // The customer's balance is attributed to this sale's credit first, so only credit the
  // customer has demonstrably settled is treated as money they actually handed over.
  const outstandingCredit =
    creditStillAttributed <= 0n
      ? 0n
      : balance < creditStillAttributed
        ? balance
        : creditStillAttributed;
  const settledCredit = creditStillAttributed - outstandingCredit;
  const cashOrCard = total - creditPaid + (settledCredit > 0n ? settledCredit : 0n) - refundedOther;
  const remaining = total - refundedAccount - refundedOther;
  const account = row.customer_id ? (balance < remaining ? balance : remaining) : 0n;
  return {
    cashOrCard: minorUnitsToMoney(cashOrCard > 0n ? cashOrCard : 0n),
    customerAccount: minorUnitsToMoney(account > 0n ? account : 0n),
  };
}

@Injectable()
export class ReturnsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async lookup(branchId: string, token: string): Promise<ReturnLookup> {
    const [sale] = await this.database<Array<{ id: string }>>`
      select sales.id::text from return_lookup_tokens
      join sales on sales.id = return_lookup_tokens.sale_id
      where return_lookup_tokens.token = ${token}::uuid
        and return_lookup_tokens.revoked_at is null and sales.branch_id = ${branchId}
    `;
    if (!sale) throw new NotFoundException('Receipt was not found');
    return this.buildLookup(this.database, branchId, sale.id);
  }

  async lookupByInvoice(branchId: string, invoiceNumber: string): Promise<ReturnLookup> {
    const [sale] = await this.database<Array<{ id: string }>>`
      select id::text from sales
      where branch_id = ${branchId} and upper(invoice_number) = upper(${invoiceNumber})
    `;
    if (!sale) throw new NotFoundException('No sale has that invoice number');
    return this.buildLookup(this.database, branchId, sale.id);
  }

  async list(
    branchId: string,
    status: ReturnStatus | undefined,
    limit: number,
  ): Promise<{ readonly data: readonly ReturnSummary[] }> {
    const rows = await this.database<Array<{ id: string }>>`
      select id::text from returns
      where branch_id = ${branchId}
        and (${status ?? null}::text is null or status = ${status ?? null})
      order by case when status in ('REQUESTED', 'APPROVED') then 0 else 1 end,
        requested_at desc, id desc
      limit ${limit}
    `;
    return {
      data: await this.summaries(
        this.database,
        branchId,
        rows.map((row) => row.id),
      ),
    };
  }

  async requestReturn(user: AuthenticatedUser, token: string, input: CreateReturnRequest) {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(transaction, 'RETURN.REQUEST', user.branchId, input.clientRequestId);
      const [existing] = await transaction<ReturnRow[]>`
        select id::text, branch_id::text, sale_id::text, status, return_number from returns
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (existing) {
        return {
          id: existing.id,
          returnNumber: existing.return_number,
          status: existing.status,
          idempotentReplay: true,
        };
      }
      const [sale] = await transaction<
        Array<{ id: string; invoice_number: string; discount_total: string }>
      >`
        select sales.id::text, sales.invoice_number, sales.discount_total::text
        from return_lookup_tokens join sales on sales.id = return_lookup_tokens.sale_id
        where return_lookup_tokens.token = ${token}::uuid and return_lookup_tokens.revoked_at is null
          and sales.branch_id = ${user.branchId} and sales.status <> 'VOIDED'
        for update of sales
      `;
      if (!sale) throw new NotFoundException('Receipt was not found');

      // Every line of the sale, in finalization order, so the invoice discount is spread over
      // them exactly as it was when the sale was finalized.
      const lines = await transaction<
        Array<
          SaleLineRow & {
            expired: boolean;
            previously_returned: string;
            previously_refunded: string;
          }
        >
      >`
        select sale_items.id::text, sale_items.quantity::text, sale_items.line_total::text,
          inventory_batches.expiry_date < (now() at time zone (
            select timezone from branches where id = ${user.branchId}
          ))::date as expired,
          coalesce(previous.quantity, 0)::text as previously_returned,
          coalesce(previous.refund, 0)::text as previously_refunded
        from sale_items
        join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
        left join lateral (
          select sum(return_items.quantity) as quantity, sum(return_items.refund_amount) as refund
          from return_items join returns on returns.id = return_items.return_id
          where return_items.sale_item_id = sale_items.id and returns.status <> 'REJECTED'
        ) previous on true
        where sale_items.sale_id = ${sale.id}
        order by sale_items.id for update of sale_items
      `;
      const netPaid = netPaidPerSaleLine(
        lines.map((line) => line.line_total),
        sale.discount_total,
      );
      const lineById = new Map(lines.map((line, index) => [line.id, { line, index }]));
      const requestedIds = input.items.map((item) => item.saleItemId.toString());
      if (new Set(requestedIds).size !== requestedIds.length) {
        throw new ConflictException('Each sale line may appear only once in a return');
      }

      const [created] = await transaction<Array<{ id: string; return_number: string }>>`
        insert into returns (
          branch_id, sale_id, requested_by_user_id, return_number, status, reason, client_request_id
        ) values (
          ${user.branchId}, ${sale.id}, ${user.id},
          concat('RET-', to_char(now() at time zone (
            select timezone from branches where id = ${user.branchId}
          ), 'YYYYMMDD'), '-',
            upper(substr(encode(digest(${input.clientRequestId}, 'sha256'), 'hex'), 1, 10))),
          'REQUESTED', ${input.reason}, ${input.clientRequestId}
        ) returning id::text, return_number
      `;
      if (!created) throw new Error('Return creation failed');

      const refundAmounts: string[] = [];
      for (const item of input.items) {
        const entry = lineById.get(item.saleItemId.toString());
        if (!entry) throw new ConflictException('Return contains a line from another sale');
        if (item.disposition === 'RESTOCK_SELLABLE' && entry.line.expired) {
          throw new ConflictException(
            'Expired stock cannot be restocked as sellable; choose quarantine or scrap',
          );
        }
        let refundAmount: string;
        try {
          refundAmount = cumulativeRefundAmount({
            netPaid: netPaid[entry.index] ?? '0.00',
            previouslyRefunded: entry.line.previously_refunded,
            previouslyReturnedQuantity: entry.line.previously_returned,
            quantity: item.quantity,
            soldQuantity: entry.line.quantity,
          });
        } catch (cause) {
          throw new ConflictException(
            cause instanceof Error ? cause.message : 'Return quantity is not valid',
          );
        }
        refundAmounts.push(refundAmount);
        await transaction`
          insert into return_items (return_id, sale_item_id, quantity, disposition, refund_amount)
          values (
            ${created.id}, ${entry.line.id}, ${item.quantity}, ${item.disposition}, ${refundAmount}
          )
        `;
      }
      const refundTotal = sumMoney(refundAmounts);
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'RETURN.REQUESTED', 'return',
          ${created.id}, ${input.clientRequestId},
          ${transaction.json({ invoiceNumber: sale.invoice_number, itemCount: input.items.length, refundTotal })}
        )
      `;
      return {
        id: created.id,
        returnNumber: created.return_number,
        status: 'REQUESTED',
        refundAmount: refundTotal,
        idempotentReplay: false,
      };
    });
  }

  async approve(user: AuthenticatedUser, returnId: bigint) {
    return this.database.begin(async (transaction) => {
      const row = await this.lockReturn(transaction, user.branchId, returnId);
      if (row.status === 'APPROVED' || row.status === 'REFUNDED')
        return { id: row.id, status: row.status, idempotentReplay: true };
      if (row.status !== 'REQUESTED')
        throw new ConflictException('Only a requested return can be approved');
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

  /**
   * Rejecting releases the requested quantity back to the sale so a corrected request can be
   * made; the rejected lines stay on record.
   */
  async reject(user: AuthenticatedUser, returnId: bigint, input: RejectReturnRequest) {
    return this.database.begin(async (transaction) => {
      const row = await this.lockReturn(transaction, user.branchId, returnId);
      if (row.status === 'REJECTED')
        return { id: row.id, status: row.status, idempotentReplay: true };
      if (row.status !== 'REQUESTED' && row.status !== 'APPROVED')
        throw new ConflictException('A refunded return cannot be rejected');
      await transaction`
        update returns set status = 'REJECTED', rejected_by_user_id = ${user.id},
          rejected_at = now(), rejection_reason = ${input.reason}
        where id = ${row.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'RETURN.REJECTED', 'return', ${row.id},
          ${transaction.json({ reason: input.reason, previousStatus: row.status })}
        )
      `;
      return { id: row.id, status: 'REJECTED', idempotentReplay: false };
    });
  }

  async refund(user: AuthenticatedUser, returnId: bigint, input: RefundReturnRequest) {
    // Handing physical cash back across the counter is a separate authority from
    // approving a card or bank reversal, so the cash path needs its own permission.
    if (input.method === 'CASH' && !user.permissions.includes(PERMISSIONS.RETURNS_REFUND_CASH)) {
      throw new ForbiddenException('This account may not issue a cash refund');
    }
    return this.database.begin(async (transaction) => {
      const row = await this.lockReturn(transaction, user.branchId, returnId);
      const [existingRefund] = await transaction<Array<{ amount: string; method: string }>>`
        select amount::text, method from refunds where return_id = ${row.id}
      `;
      if (existingRefund)
        return {
          id: row.id,
          status: 'REFUNDED',
          refundAmount: existingRefund.amount,
          refundMethod: existingRefund.method,
          idempotentReplay: true,
        };
      if (row.status !== 'APPROVED')
        throw new ConflictException('Return must be approved before refund');
      if (input.method === 'CASH') {
        const [session] = await transaction<Array<{ id: string }>>`
          select id::text from cash_sessions where id = ${input.cashSessionId?.toString() ?? null}
            and branch_id = ${user.branchId} and terminal_id = ${user.terminalId}
            and cashier_user_id = ${user.id} and status = 'OPEN' for update
        `;
        if (!session) throw new ConflictException('Caller cash session is not open');
      }

      // Lock the sale first so concurrent refunds of different returns on one sale see each
      // other's evidence when the limits are computed.
      const [saleMoney] = await transaction<SaleMoneyRow[]>`
        select sales.total::text, sales.customer_id::text,
          coalesce((select sum(amount) from payments
            where payments.sale_id = sales.id and payments.method = 'CREDIT'
              and payments.status = 'CAPTURED'), 0)::text as credit_paid,
          coalesce((select sum(refunds.amount) from refunds join returns on returns.id = refunds.return_id
            where returns.sale_id = sales.id and refunds.method = 'CUSTOMER_ACCOUNT'), 0)::text
            as refunded_account,
          coalesce((select sum(refunds.amount) from refunds join returns on returns.id = refunds.return_id
            where returns.sale_id = sales.id and refunds.method <> 'CUSTOMER_ACCOUNT'), 0)::text
            as refunded_other,
          coalesce((select balance_after from customer_ledger_entries
            where customer_ledger_entries.customer_id = sales.customer_id
            order by id desc limit 1), 0)::text as customer_balance
        from sales where sales.id = ${row.sale_id} for update
      `;
      if (!saleMoney) throw new NotFoundException('Original sale not found');

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
          source_batch_id: string | null;
        }>
      >`
        select return_items.id::text as return_item_id, sale_items.id::text as sale_item_id,
          sale_items.inventory_batch_id::text, return_items.quantity::text,
          return_items.disposition, return_items.refund_amount::text,
          inventory_batches.expiry_date >= (now() at time zone (
            select timezone from branches where id = ${user.branchId}
          ))::date as sellable_by_date,
          inventory_batches.medicine_id::text, inventory_batches.purchase_order_item_id::text,
          inventory_batches.batch_number, inventory_batches.expiry_date::text,
          inventory_batches.received_at, inventory_batches.cost_price::text,
          inventory_batches.sale_price::text, inventory_batches.source_batch_id::text
        from return_items
        join sale_items on sale_items.id = return_items.sale_item_id
        join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
        where return_items.return_id = ${row.id}
        order by inventory_batches.id, return_items.id
        for update of inventory_batches
      `;
      const refundAmount = sumMoney(items.map((item) => item.refund_amount));
      const limits = computeRefundLimits(saleMoney);
      const limit =
        input.method === 'CUSTOMER_ACCOUNT' ? limits.customerAccount : limits.cashOrCard;
      if (moneyToMinorUnits(refundAmount) > moneyToMinorUnits(limit)) {
        throw new ConflictException({
          message:
            input.method === 'CUSTOMER_ACCOUNT'
              ? 'The refund is larger than what this customer owes; refund the rest by cash or card'
              : 'Part of this sale is still owed on the customer account; credit the refund to the account instead',
          refundAmount,
          limits,
        });
      }

      for (const item of items) {
        if (item.disposition === 'RESTOCK_SELLABLE' && !item.sellable_by_date) {
          throw new ConflictException('Expired returned stock cannot be restored as sellable');
        }
        if (item.disposition === 'SCRAP') continue;
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

      let ledgerEntryId: string | null = null;
      if (input.method === 'CUSTOMER_ACCOUNT') {
        if (!saleMoney.customer_id)
          throw new ConflictException('This sale has no customer account');
        await transaction`select id from customers where id = ${saleMoney.customer_id} for update`;
        const [latest] = await transaction<Array<{ balance: string }>>`
          select coalesce((select balance_after from customer_ledger_entries
            where customer_id = ${saleMoney.customer_id} order by id desc limit 1), 0)::text as balance
        `;
        const balanceAfter = minorUnitsToMoney(
          moneyToMinorUnits(latest?.balance ?? '0') - moneyToMinorUnits(refundAmount),
        );
        if (moneyToMinorUnits(refundAmount) > 0n) {
          const [entry] = await transaction<Array<{ id: string }>>`
            insert into customer_ledger_entries (
              branch_id, customer_id, entry_type, amount_delta, balance_after, sale_id,
              performed_by_user_id, reason, reference
            ) values (
              ${user.branchId}, ${saleMoney.customer_id}, 'RETURN_CREDIT',
              -${refundAmount}::numeric, ${balanceAfter}, ${row.sale_id}, ${user.id},
              'Return credited to account', ${row.return_number}
            ) returning id::text
          `;
          ledgerEntryId = entry?.id ?? null;
        }
      }

      if (moneyToMinorUnits(refundAmount) > 0n) {
        await transaction`
          insert into refunds (
            return_id, cash_session_id, processed_by_user_id, method, amount, reference,
            customer_ledger_entry_id
          ) values (
            ${row.id}, ${input.method === 'CASH' ? (input.cashSessionId?.toString() ?? null) : null},
            ${user.id}, ${input.method}, ${refundAmount}, ${input.reference ?? null}, ${ledgerEntryId}
          )
        `;
      }
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
          ${transaction.json({ amount: refundAmount, method: input.method, customerLedgerEntryId: ledgerEntryId })}
        )
      `;
      return {
        id: row.id,
        status: 'REFUNDED',
        refundAmount,
        refundMethod: input.method,
        idempotentReplay: false,
      };
    });
  }

  private async lockReturn(
    transaction: DatabaseTransaction,
    branchId: string,
    returnId: bigint,
  ): Promise<ReturnRow> {
    const [row] = await transaction<ReturnRow[]>`
      select id::text, branch_id::text, sale_id::text, status, return_number from returns
      where id = ${returnId.toString()} for update
    `;
    if (!row || row.branch_id !== branchId) throw new NotFoundException('Return not found');
    return row;
  }

  private async buildLookup(
    database: Queryable,
    branchId: string,
    saleId: string,
  ): Promise<ReturnLookup> {
    const [sale] = await database<Array<ReturnLookup['sale']>>`
      select sales.id::text, sales.invoice_number as "invoiceNumber", sales.status,
        sales.total::text, sales.discount_total::text as "discountTotal",
        sales.created_at as "createdAt", tokens.token::text as "lookupToken",
        sales.customer_id::text as "customerId", customers.name as "customerName"
      from sales
      join return_lookup_tokens tokens on tokens.sale_id = sales.id and tokens.revoked_at is null
      left join customers on customers.id = sales.customer_id
      where sales.id = ${saleId} and sales.branch_id = ${branchId}
    `;
    if (!sale) throw new NotFoundException('Receipt was not found');
    const lines = await database<
      Array<Omit<ReturnLookup['items'][number], 'netPaid'> & { lineTotal: string }>
    >`
      select sale_items.id::text, medicines.name as "medicineName", medicines.strength,
        inventory_batches.batch_number as "batchNumber",
        inventory_batches.expiry_date::text as "expiryDate",
        inventory_batches.expiry_date < (now() at time zone (
          select timezone from branches where id = ${branchId}
        ))::date as expired,
        sale_items.quantity::text as "soldQuantity",
        coalesce(returned.quantity, 0)::text as "returnedQuantity",
        greatest(sale_items.quantity - coalesce(returned.quantity, 0), 0)::text
          as "eligibleQuantity",
        sale_items.unit_price::text as "unitPrice", sale_items.line_total::text as "lineTotal"
      from sale_items
      join medicines on medicines.id = sale_items.medicine_id
      join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
      left join lateral (
        select sum(return_items.quantity) as quantity
        from return_items join returns on returns.id = return_items.return_id
        where return_items.sale_item_id = sale_items.id and returns.status <> 'REJECTED'
      ) returned on true
      where sale_items.sale_id = ${saleId}
      order by sale_items.id
    `;
    const netPaid = netPaidPerSaleLine(
      lines.map((line) => line.lineTotal),
      sale.discountTotal,
    );
    const payments = await database<Array<{ method: string; amount: string }>>`
      select method, sum(amount)::text as amount from payments
      where sale_id = ${saleId} and status = 'CAPTURED'
      group by method order by method
    `;
    const returnIds = await database<Array<{ id: string }>>`
      select id::text from returns where sale_id = ${saleId} order by id desc
    `;
    return {
      sale,
      payments,
      items: lines.map((line, index) => ({
        batchNumber: line.batchNumber,
        eligibleQuantity: line.eligibleQuantity,
        expired: line.expired,
        expiryDate: line.expiryDate,
        id: line.id,
        medicineName: line.medicineName,
        netPaid: netPaid[index] ?? '0.00',
        returnedQuantity: line.returnedQuantity,
        soldQuantity: line.soldQuantity,
        strength: line.strength,
        unitPrice: line.unitPrice,
      })),
      returns: await this.summaries(
        database,
        branchId,
        returnIds.map((row) => row.id),
      ),
    };
  }

  private async summaries(
    database: Queryable,
    branchId: string,
    ids: readonly string[],
  ): Promise<readonly ReturnSummary[]> {
    if (ids.length === 0) return [];
    const rows = await database<Array<Omit<ReturnSummary, 'refundLimits'> & SaleMoneyRow>>`
      select returns.id::text, returns.return_number as "returnNumber", returns.status,
        returns.reason, returns.sale_id::text as "saleId",
        sales.invoice_number as "invoiceNumber", tokens.token::text as "lookupToken",
        sales.customer_id::text as "customerId", customers.name as "customerName",
        requester.display_name as "requestedBy", returns.requested_at as "requestedAt",
        coalesce(refunds.amount, items.refund_total, 0)::text as "refundAmount",
        refunds.method as "refundMethod", returns.rejection_reason as "rejectionReason",
        items.item_count::int as "itemCount",
        sales.total::text, sales.customer_id::text as customer_id,
        coalesce((select sum(amount) from payments
          where payments.sale_id = sales.id and payments.method = 'CREDIT'
            and payments.status = 'CAPTURED'), 0)::text as credit_paid,
        coalesce((select sum(r.amount) from refunds r join returns rr on rr.id = r.return_id
          where rr.sale_id = sales.id and r.method = 'CUSTOMER_ACCOUNT'), 0)::text
          as refunded_account,
        coalesce((select sum(r.amount) from refunds r join returns rr on rr.id = r.return_id
          where rr.sale_id = sales.id and r.method <> 'CUSTOMER_ACCOUNT'), 0)::text
          as refunded_other,
        coalesce((select balance_after from customer_ledger_entries
          where customer_ledger_entries.customer_id = sales.customer_id
          order by id desc limit 1), 0)::text as customer_balance
      from returns
      join sales on sales.id = returns.sale_id
      join users requester on requester.id = returns.requested_by_user_id
      left join return_lookup_tokens tokens on tokens.sale_id = sales.id and tokens.revoked_at is null
      left join customers on customers.id = sales.customer_id
      left join refunds on refunds.return_id = returns.id
      left join lateral (
        select count(*) as item_count, sum(refund_amount) as refund_total
        from return_items where return_items.return_id = returns.id
      ) items on true
      where returns.id in ${database(ids)} and returns.branch_id = ${branchId}
      order by case when returns.status in ('REQUESTED', 'APPROVED') then 0 else 1 end,
        returns.requested_at desc, returns.id desc
    `;
    return rows.map(
      ({
        total,
        customer_id,
        credit_paid,
        refunded_account,
        refunded_other,
        customer_balance,
        ...summary
      }) => ({
        ...summary,
        refundLimits: computeRefundLimits({
          total,
          customer_id,
          credit_paid,
          refunded_account,
          refunded_other,
          customer_balance,
        }),
      }),
    );
  }
}
