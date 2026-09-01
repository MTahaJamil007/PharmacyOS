import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import type {
  CreatePurchaseOrderRequest,
  CreateDraftPurchaseOrderRequest,
  OrderPurchaseOrderRequest,
  ReceivePurchaseOrderRequest,
  ReviewReorderSuggestionRequest,
  SupplierQuoteRequest,
} from '@pharmacy/shared';
import {
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  sumMoney,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

interface SuggestionRow {
  readonly id: string;
  readonly branch_id: string;
  readonly medicine_id: string;
  readonly policy_id: string;
  readonly status: string;
  readonly suggested_qty: string;
  readonly preferred_supplier_id: string | null;
}

interface PurchaseOrderRow {
  readonly id: string;
  readonly branch_id: string;
  readonly status: string;
  readonly order_number: string;
  readonly ordered_client_request_id: string | null;
}

@Injectable()
export class ProcurementService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async addSupplierQuote(
    user: AuthenticatedUser,
    input: SupplierQuoteRequest,
  ): Promise<Record<string, unknown>> {
    const [quote] = await this.database<Array<{ id: string }>>`
      insert into supplier_quotes (
        branch_id, supplier_id, medicine_id, quoted_unit_cost, quote_unit,
        base_units_per_quote_unit, minimum_order_qty, valid_from, valid_until, source,
        entered_by_user_id
      )
      select ${user.branchId}, suppliers.id, medicines.id, ${input.quotedUnitCost},
        ${input.quoteUnit}, ${input.baseUnitsPerQuoteUnit}, ${input.minimumOrderQuantity},
        coalesce(${input.validFrom ?? null}::date, current_date),
        ${input.validUntil ?? null}::date, ${input.source}, ${user.id}
      from suppliers cross join medicines
      where suppliers.id = ${input.supplierId.toString()}
        and suppliers.branch_id = ${user.branchId} and suppliers.is_active = true
        and medicines.id = ${input.medicineId.toString()} and medicines.is_active = true
      returning id::text
    `;
    if (!quote) throw new NotFoundException('Active supplier or medicine not found');
    await this.database`
      insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id)
      values (${user.branchId}, ${user.id}, ${user.terminalId}, 'SUPPLIER_QUOTE.CREATED', 'supplier_quote', ${quote.id})
    `;
    return { id: quote.id, status: 'ACTIVE' };
  }

  async getSupplierComparison(
    branchId: string,
    medicineId: bigint,
  ): Promise<{ readonly data: readonly Record<string, unknown>[] }> {
    const data = await this.database<Array<Record<string, unknown>>>`
      with historical as (
        select distinct on (purchase_orders.supplier_id)
          purchase_orders.supplier_id,
          suppliers.name as supplier_name,
          round(
            greatest(purchase_order_items.ordered_qty * purchase_order_items.unit_cost - purchase_order_items.line_discount, 0)
            / nullif(
                (purchase_order_items.ordered_qty + purchase_order_items.bonus_qty)
                * purchase_order_items.base_units_per_order_unit,
                0
              ),
            8
          ) as effective_unit_cost,
          purchase_orders.received_at as observed_at,
          purchase_orders.id::text as source_id,
          'PAID_HISTORY'::text as source_type,
          suppliers.lead_time_days
        from purchase_order_items
        join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
        join suppliers on suppliers.id = purchase_orders.supplier_id
        where purchase_orders.branch_id = ${branchId}
          and purchase_order_items.medicine_id = ${medicineId.toString()}
          and purchase_orders.status in ('PARTIALLY_RECEIVED', 'RECEIVED')
        order by purchase_orders.supplier_id, purchase_orders.received_at desc nulls last, purchase_orders.id desc
      ), current_quotes as (
        select distinct on (supplier_quotes.supplier_id)
          supplier_quotes.supplier_id,
          suppliers.name as supplier_name,
          round(supplier_quotes.quoted_unit_cost / supplier_quotes.base_units_per_quote_unit, 8) as effective_unit_cost,
          supplier_quotes.created_at as observed_at,
          supplier_quotes.id::text as source_id,
          'CURRENT_QUOTE'::text as source_type,
          suppliers.lead_time_days
        from supplier_quotes
        join suppliers on suppliers.id = supplier_quotes.supplier_id
        where supplier_quotes.branch_id = ${branchId}
          and supplier_quotes.medicine_id = ${medicineId.toString()}
          and supplier_quotes.valid_from <= current_date
          and (supplier_quotes.valid_until is null or supplier_quotes.valid_until >= current_date)
        order by supplier_quotes.supplier_id, supplier_quotes.valid_from desc, supplier_quotes.id desc
      )
      select supplier_id::text, supplier_name, effective_unit_cost::text,
        observed_at, source_id, source_type, lead_time_days
      from historical
      union all
      select supplier_id::text, supplier_name, effective_unit_cost::text,
        observed_at, source_id, source_type, lead_time_days
      from current_quotes
      order by supplier_name, source_type desc
    `;
    return { data };
  }

  async listReorderSuggestions(
    branchId: string,
    status: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ readonly data: readonly Record<string, unknown>[] }> {
    const data = await this.database<Array<Record<string, unknown>>>`
      select suggestions.id::text,
        medicines.id::text as medicine_id,
        medicines.name as medicine_name,
        suggestions.status,
        suggestions.average_daily_sales::text,
        suggestions.eligible_demand_days,
        suggestions.stockout_days,
        suggestions.current_sellable_stock::text,
        suggestions.reserved_stock::text,
        suggestions.effective_lead_time_days,
        suggestions.safety_stock::text,
        suggestions.reorder_point::text,
        suggestions.target_stock::text,
        suggestions.minimum_order_qty::text,
        suggestions.order_multiple::text,
        suggestions.suggested_qty::text,
        suggestions.confidence,
        suggestions.expiry_risk_flag,
        suggestions.reason,
        suggestions.generated_at,
        suggestions.expires_at,
        suggestions.draft_purchase_order_id::text
      from reorder_suggestions suggestions
      join medicines on medicines.id = suggestions.medicine_id
      where suggestions.branch_id = ${branchId}
        and (${status ?? null}::text is null or suggestions.status = ${status ?? null})
      order by suggestions.generated_at desc, suggestions.id desc
      limit ${limit} offset ${offset}
    `;
    return { data };
  }

  async reviewReorderSuggestion(
    user: AuthenticatedUser,
    suggestionId: bigint,
    input: ReviewReorderSuggestionRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [suggestion] = await transaction<SuggestionRow[]>`
        select suggestions.id::text, suggestions.branch_id::text, suggestions.medicine_id::text,
          suggestions.policy_id::text, suggestions.status, suggestions.suggested_qty::text,
          policies.preferred_supplier_id::text
        from reorder_suggestions suggestions
        join reorder_policies policies on policies.id = suggestions.policy_id
        where suggestions.id = ${suggestionId.toString()} for update of suggestions
      `;
      if (!suggestion || suggestion.branch_id !== user.branchId)
        throw new NotFoundException('Reorder suggestion not found');
      if (!['GENERATED', 'REVIEWED'].includes(suggestion.status)) {
        throw new ConflictException('Reorder suggestion is no longer reviewable');
      }
      const status = input.decision === 'REVIEW' ? 'REVIEWED' : 'DISMISSED';
      await transaction`
        update reorder_suggestions set status = ${status}, reviewed_by_user_id = ${user.id}, reviewed_at = now(),
          reason = reason || ${transaction.json({ reviewNotes: input.notes ?? null })}
        where id = ${suggestion.id}
      `;
      await transaction`
        insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id)
        values (${user.branchId}, ${user.id}, ${user.terminalId}, ${`REORDER_SUGGESTION.${status}`}, 'reorder_suggestion', ${suggestion.id})
      `;
      return { id: suggestion.id, status };
    });
  }

  async createDraftPurchaseOrder(
    user: AuthenticatedUser,
    suggestionId: bigint,
    input: CreateDraftPurchaseOrderRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'PROCUREMENT.CREATE_DRAFT_PURCHASE_ORDER',
        user.branchId,
        input.clientRequestId,
      );
      const [existing] = await transaction<Array<{ id: string; order_number: string }>>`
        select id::text, order_number from purchase_orders
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (existing)
        return {
          id: existing.id,
          orderNumber: existing.order_number,
          status: 'DRAFT',
          idempotentReplay: true,
        };

      const [suggestion] = await transaction<SuggestionRow[]>`
        select suggestions.id::text, suggestions.branch_id::text, suggestions.medicine_id::text,
          suggestions.policy_id::text, suggestions.status, suggestions.suggested_qty::text,
          policies.preferred_supplier_id::text
        from reorder_suggestions suggestions
        join reorder_policies policies on policies.id = suggestions.policy_id
        where suggestions.id = ${suggestionId.toString()} for update of suggestions
      `;
      if (!suggestion || suggestion.branch_id !== user.branchId)
        throw new NotFoundException('Reorder suggestion not found');
      if (!['GENERATED', 'REVIEWED'].includes(suggestion.status)) {
        throw new ConflictException('Suggestion has already been converted or closed');
      }
      const supplierId = input.supplierId?.toString() ?? suggestion.preferred_supplier_id;
      if (!supplierId)
        throw new ConflictException('Select a supplier before creating a purchase draft');
      const quantity = input.quantity ?? suggestion.suggested_qty;

      const [cost] = await transaction<Array<{ unit_cost: string }>>`
        with candidates as (
          select round(quoted_unit_cost / base_units_per_quote_unit, 8) as unit_cost, created_at
          from supplier_quotes
          where branch_id = ${user.branchId} and supplier_id = ${supplierId}
            and medicine_id = ${suggestion.medicine_id}
            and valid_from <= current_date and (valid_until is null or valid_until >= current_date)
          union all
          select round(
              greatest(items.ordered_qty * items.unit_cost - items.line_discount, 0)
              / nullif((items.ordered_qty + items.bonus_qty) * items.base_units_per_order_unit, 0), 8
            ), orders.received_at
          from purchase_order_items items
          join purchase_orders orders on orders.id = items.purchase_order_id
          where orders.branch_id = ${user.branchId} and orders.supplier_id = ${supplierId}
            and items.medicine_id = ${suggestion.medicine_id}
            and orders.status in ('PARTIALLY_RECEIVED', 'RECEIVED')
        ) select unit_cost::text from candidates order by created_at desc nulls last limit 1
      `;
      if (!cost)
        throw new ConflictException(
          'Supplier has no comparable quote or paid cost for this medicine',
        );

      const [purchaseOrder] = await transaction<Array<{ id: string; order_number: string }>>`
        insert into purchase_orders (
          branch_id, supplier_id, created_by_user_id, order_number, status, total_cost, client_request_id
        ) values (
          ${user.branchId}, ${supplierId}, ${user.id},
          concat('DR-', to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD'), '-',
            upper(substr(encode(digest(${input.clientRequestId}, 'sha256'), 'hex'), 1, 10))),
          'DRAFT', round(${quantity}::numeric * ${cost.unit_cost}::numeric, 2), ${input.clientRequestId}
        ) returning id::text, order_number
      `;
      if (!purchaseOrder) throw new Error('Purchase draft creation failed');
      await transaction`
        insert into purchase_order_items (purchase_order_id, medicine_id, ordered_qty, unit_cost)
        values (${purchaseOrder.id}, ${suggestion.medicine_id}, ${quantity}, ${cost.unit_cost})
      `;
      await transaction`
        update reorder_suggestions
        set status = 'DRAFT_PO', draft_purchase_order_id = ${purchaseOrder.id},
            reviewed_by_user_id = coalesce(reviewed_by_user_id, ${user.id}),
            reviewed_at = coalesce(reviewed_at, now())
        where id = ${suggestion.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'PURCHASE_ORDER.DRAFT_FROM_REORDER',
          'purchase_order', ${purchaseOrder.id},
          ${transaction.json({ suggestionId: suggestion.id, clientRequestId: input.clientRequestId })}
        )
      `;
      return {
        id: purchaseOrder.id,
        orderNumber: purchaseOrder.order_number,
        status: 'DRAFT',
        idempotentReplay: false,
      };
    });
  }

  async listPurchaseOrders(
    branchId: string,
    status: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ readonly data: readonly Record<string, unknown>[] }> {
    const data = await this.database<Array<Record<string, unknown>>>`
      select orders.id::text, orders.order_number, orders.status, orders.supplier_invoice_number,
        orders.total_cost::text, suppliers.id::text as supplier_id,
        suppliers.name as supplier_name, orders.ordered_at, orders.received_at, orders.created_at,
        count(items.id)::int as line_count,
        coalesce(sum(items.ordered_qty), 0)::text as ordered_quantity,
        coalesce(sum(items.received_qty), 0)::text as received_quantity
      from purchase_orders orders
      join suppliers on suppliers.id = orders.supplier_id
      left join purchase_order_items items on items.purchase_order_id = orders.id
      where orders.branch_id = ${branchId}
        and (${status ?? null}::text is null or orders.status = ${status ?? null})
      group by orders.id, suppliers.id
      order by orders.created_at desc, orders.id desc
      limit ${limit} offset ${offset}
    `;
    return { data };
  }

  async getPurchaseOrder(
    branchId: string,
    purchaseOrderId: bigint,
  ): Promise<Record<string, unknown>> {
    const [order] = await this.database<Array<Record<string, unknown>>>`
      select orders.id::text, orders.order_number, orders.status, orders.supplier_invoice_number,
        orders.total_cost::text, suppliers.id::text as supplier_id,
        suppliers.name as supplier_name, orders.ordered_at, orders.received_at, orders.created_at
      from purchase_orders orders join suppliers on suppliers.id = orders.supplier_id
      where orders.id = ${purchaseOrderId.toString()} and orders.branch_id = ${branchId}
    `;
    if (!order) throw new NotFoundException('Purchase order not found');
    const items = await this.database<Array<Record<string, unknown>>>`
      select items.id::text, medicines.id::text as medicine_id, medicines.name as medicine_name,
        items.ordered_qty::text, items.received_qty::text, items.bonus_qty::text,
        items.received_bonus_qty::text, items.unit_cost::text, items.line_discount::text,
        items.base_units_per_order_unit::text
      from purchase_order_items items join medicines on medicines.id = items.medicine_id
      where items.purchase_order_id = ${purchaseOrderId.toString()}
      order by items.id
    `;
    const receipts = await this.database<Array<Record<string, unknown>>>`
      select receipts.id::text, receipts.supplier_invoice_number, receipts.received_at,
        users.display_name as received_by,
        coalesce(sum(receipt_items.received_base_qty), 0)::text as received_base_quantity
      from goods_receipts receipts
      join users on users.id = receipts.received_by_user_id
      left join goods_receipt_items receipt_items on receipt_items.goods_receipt_id = receipts.id
      where receipts.purchase_order_id = ${purchaseOrderId.toString()}
      group by receipts.id, users.id order by receipts.received_at desc, receipts.id desc
    `;
    return { ...order, items, receipts };
  }

  async createPurchaseOrder(
    user: AuthenticatedUser,
    input: CreatePurchaseOrderRequest,
  ): Promise<Record<string, unknown>> {
    const medicineIds = input.items.map((item) => item.medicineId.toString());
    if (new Set(medicineIds).size !== medicineIds.length) {
      throw new ConflictException('Each medicine may appear only once in a purchase order');
    }
    const lineTotals = input.items.map((item) => {
      const gross = multiplyMoneyByQuantity(item.unitCost, item.orderedQuantity);
      const discount = moneyToMinorUnits(item.lineDiscount);
      if (discount > moneyToMinorUnits(gross)) {
        throw new ConflictException('Line discount cannot exceed the line gross cost');
      }
      return minorUnitsToMoney(moneyToMinorUnits(gross) - discount);
    });
    const totalCost = sumMoney(lineTotals);

    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'PROCUREMENT.CREATE_PURCHASE_ORDER',
        user.branchId,
        input.clientRequestId,
      );
      const [existing] = await transaction<Array<{ id: string }>>`
        select id::text from purchase_orders
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (existing) {
        return {
          ...(await this.getPurchaseOrderWith(transaction, user.branchId, existing.id)),
          idempotentReplay: true,
        };
      }
      const [supplier] = await transaction<Array<{ id: string }>>`
        select id::text from suppliers where id = ${input.supplierId.toString()}
          and branch_id = ${user.branchId} and is_active = true and deleted_at is null
      `;
      if (!supplier) throw new NotFoundException('Active supplier not found');
      const [order] = await transaction<Array<{ id: string; order_number: string }>>`
        insert into purchase_orders (
          branch_id, supplier_id, created_by_user_id, order_number, supplier_invoice_number,
          status, total_cost, client_request_id
        ) values (
          ${user.branchId}, ${supplier.id}, ${user.id},
          concat('PO-', to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD'), '-',
            upper(substr(encode(digest(${input.clientRequestId}, 'sha256'), 'hex'), 1, 10))),
          ${input.supplierInvoiceNumber ?? null}, 'DRAFT', ${totalCost}, ${input.clientRequestId}
        ) returning id::text, order_number
      `;
      if (!order) throw new Error('Purchase order creation did not return an identifier');
      for (const item of input.items) {
        const [created] = await transaction<Array<{ id: string }>>`
          insert into purchase_order_items (
            purchase_order_id, medicine_id, ordered_qty, unit_cost, line_discount, bonus_qty,
            base_units_per_order_unit
          )
          select ${order.id}, medicines.id, ${item.orderedQuantity}, ${item.unitCost},
            ${item.lineDiscount}, ${item.bonusQuantity}, ${item.baseUnitsPerOrderUnit}
          from medicines where medicines.id = ${item.medicineId.toString()}
            and medicines.is_active = true and medicines.deleted_at is null
          returning id::text
        `;
        if (!created) throw new NotFoundException('One or more active medicines were not found');
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'PURCHASE_ORDER.CREATED',
          'purchase_order', ${order.id}, ${input.clientRequestId},
          ${transaction.json({ lineCount: input.items.length, totalCost })}
        )
      `;
      return {
        ...(await this.getPurchaseOrderWith(transaction, user.branchId, order.id)),
        idempotentReplay: false,
      };
    });
  }

  async orderPurchaseOrder(
    user: AuthenticatedUser,
    purchaseOrderId: bigint,
    input: OrderPurchaseOrderRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'PROCUREMENT.ORDER_PURCHASE_ORDER',
        user.branchId,
        input.clientRequestId,
      );
      const order = await this.lockPurchaseOrder(transaction, user.branchId, purchaseOrderId);
      if (order.ordered_client_request_id === input.clientRequestId) {
        return {
          ...(await this.getPurchaseOrderWith(transaction, user.branchId, order.id)),
          idempotentReplay: true,
        };
      }
      if (order.status !== 'DRAFT')
        throw new ConflictException('Only a draft purchase order can be ordered');
      await transaction`
        update purchase_orders set status = 'ORDERED', ordered_at = now(),
          ordered_client_request_id = ${input.clientRequestId}
        where id = ${order.id}
      `;
      await transaction`
        update reorder_suggestions set status = 'ORDERED'
        where draft_purchase_order_id = ${order.id} and status in ('DRAFT_PO', 'APPROVED')
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'PURCHASE_ORDER.ORDERED',
          'purchase_order', ${order.id}, ${input.clientRequestId}
        )
      `;
      return {
        ...(await this.getPurchaseOrderWith(transaction, user.branchId, order.id)),
        idempotentReplay: false,
      };
    });
  }

  async receivePurchaseOrder(
    user: AuthenticatedUser,
    purchaseOrderId: bigint,
    input: ReceivePurchaseOrderRequest,
  ): Promise<Record<string, unknown>> {
    const lineIds = input.lines.map((line) => line.purchaseOrderItemId.toString());
    if (new Set(lineIds).size !== lineIds.length) {
      throw new ConflictException('Each purchase-order item may appear only once per receipt');
    }
    const sortedLines = [...input.lines].sort((left, right) => {
      const leftId = left.purchaseOrderItemId;
      const rightId = right.purchaseOrderItemId;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });

    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'PROCUREMENT.RECEIVE_PURCHASE_ORDER',
        user.branchId,
        input.clientRequestId,
      );
      const [existing] = await transaction<Array<{ id: string }>>`
        select id::text from goods_receipts
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (existing) {
        return {
          receiptId: existing.id,
          ...(await this.getPurchaseOrderWith(
            transaction,
            user.branchId,
            purchaseOrderId.toString(),
          )),
          idempotentReplay: true,
        };
      }
      const order = await this.lockPurchaseOrder(transaction, user.branchId, purchaseOrderId);
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
        throw new ConflictException('Purchase order is not open for receipt');
      }
      const [clock] = await transaction<
        Array<{ today: string }>
      >`select current_date::text as today`;
      if (!clock) throw new Error('Database date was unavailable');
      if (sortedLines.some((line) => line.expiryDate <= clock.today)) {
        throw new ConflictException('Expired stock cannot be received into sellable inventory');
      }
      const receiptLines = sortedLines.map((line) => ({
        purchaseOrderItemId: line.purchaseOrderItemId.toString(),
        receivedQuantity: line.receivedQuantity,
        receivedBonusQuantity: line.receivedBonusQuantity,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        salePricePerBaseUnit: line.salePricePerBaseUnit,
      }));
      const lockedItems = await transaction<Array<{ id: string }>>`
        select items.id::text
        from purchase_order_items items
        join jsonb_to_recordset(${transaction.json(receiptLines)}) as input(
          "purchaseOrderItemId" text, "receivedQuantity" text,
          "receivedBonusQuantity" text, "batchNumber" text,
          "expiryDate" text, "salePricePerBaseUnit" text
        ) on input."purchaseOrderItemId"::bigint = items.id
        where items.purchase_order_id = ${order.id}
        order by items.id
        for update of items
      `;
      if (lockedItems.length !== receiptLines.length) {
        throw new NotFoundException('One or more purchase-order items were not found');
      }
      const [receipt] = await transaction<Array<{ id: string }>>`
        insert into goods_receipts (
          branch_id, purchase_order_id, received_by_user_id, client_request_id,
          supplier_invoice_number
        ) values (
          ${user.branchId}, ${order.id}, ${user.id}, ${input.clientRequestId},
          ${input.supplierInvoiceNumber ?? null}
        ) returning id::text
      `;
      if (!receipt) throw new Error('Goods receipt creation did not return an identifier');
      const [batchResult] = await transaction<Array<{ processed_count: number }>>`
        with input as materialized (
          select "purchaseOrderItemId"::bigint as purchase_order_item_id,
            "receivedQuantity"::numeric as received_quantity,
            "receivedBonusQuantity"::numeric as received_bonus_quantity,
            "batchNumber" as batch_number, "expiryDate"::date as expiry_date,
            "salePricePerBaseUnit"::numeric as sale_price
          from jsonb_to_recordset(${transaction.json(receiptLines)}) as rows(
            "purchaseOrderItemId" text, "receivedQuantity" text,
            "receivedBonusQuantity" text, "batchNumber" text,
            "expiryDate" text, "salePricePerBaseUnit" text
          )
        ), updated_items as (
          update purchase_order_items items set
            received_qty = items.received_qty + input.received_quantity,
            received_bonus_qty = items.received_bonus_qty + input.received_bonus_quantity
          from input
          where items.id = input.purchase_order_item_id
            and items.purchase_order_id = ${order.id}
            and items.received_qty + input.received_quantity <= items.ordered_qty
            and items.received_bonus_qty + input.received_bonus_quantity <= items.bonus_qty
          returning items.id, items.medicine_id, items.ordered_qty, items.bonus_qty,
            items.unit_cost, items.line_discount, items.base_units_per_order_unit,
            input.received_quantity, input.received_bonus_quantity,
            input.batch_number, input.expiry_date, input.sale_price
        ), prepared as (
          select updated_items.*,
            (received_quantity + received_bonus_quantity) * base_units_per_order_unit
              as received_base_quantity,
            round(greatest(ordered_qty * unit_cost - line_discount, 0)
              / nullif((ordered_qty + bonus_qty) * base_units_per_order_unit, 0), 8)
              as effective_cost
          from updated_items
        ), upserted_batches as (
          insert into inventory_batches (
            branch_id, medicine_id, purchase_order_item_id, batch_number, expiry_date,
            cost_price, sale_price, current_qty, status
          )
          select ${user.branchId}, medicine_id, id, batch_number, expiry_date,
            effective_cost, sale_price, received_base_quantity, 'SELLABLE'
          from prepared order by id
          on conflict on constraint inventory_batches_acquisition_lot_key do update set
            current_qty = inventory_batches.current_qty + excluded.current_qty,
            sale_price = excluded.sale_price, status = 'SELLABLE', deleted_at = null
          returning id, purchase_order_item_id, current_qty
        ), receipt_items as (
          insert into goods_receipt_items (
            goods_receipt_id, purchase_order_item_id, inventory_batch_id, received_order_qty,
            received_bonus_qty, base_units_per_order_unit, effective_cost_per_base_unit,
            batch_number, expiry_date
          )
          select ${receipt.id}, prepared.id, upserted_batches.id, prepared.received_quantity,
            prepared.received_bonus_quantity, prepared.base_units_per_order_unit,
            prepared.effective_cost, prepared.batch_number, prepared.expiry_date
          from prepared join upserted_batches
            on upserted_batches.purchase_order_item_id = prepared.id
          order by prepared.id
          returning id, inventory_batch_id, purchase_order_item_id, received_base_qty
        ), movements as (
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
            purchase_order_item_id, performed_by_user_id, reason, metadata
          )
          select ${user.branchId}, receipt_items.inventory_batch_id, 'PURCHASE_RECEIPT',
            receipt_items.received_base_qty, upserted_batches.current_qty,
            receipt_items.purchase_order_item_id, ${user.id}, 'Goods receipt',
            jsonb_build_object('goodsReceiptId', ${receipt.id}::text,
              'goodsReceiptItemId', receipt_items.id::text)
          from receipt_items join upserted_batches
            on upserted_batches.id = receipt_items.inventory_batch_id
          order by receipt_items.purchase_order_item_id
          returning id
        )
        select count(*)::int as processed_count from movements
      `;
      if ((batchResult?.processed_count ?? 0) !== receiptLines.length) {
        throw new ConflictException('Receipt quantity exceeds the outstanding ordered quantity');
      }
      const [completion] = await transaction<Array<{ complete: boolean }>>`
        select not exists (
          select 1 from purchase_order_items where purchase_order_id = ${order.id}
            and (received_qty < ordered_qty or received_bonus_qty < bonus_qty)
        ) as complete
      `;
      if (!completion) throw new Error('Purchase order completion could not be determined');
      const status = completion.complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await transaction`
        update purchase_orders set status = ${status},
          received_at = case when ${completion.complete} then now() else received_at end,
          supplier_invoice_number = coalesce(${input.supplierInvoiceNumber ?? null}, supplier_invoice_number)
        where id = ${order.id}
      `;
      if (completion.complete) {
        await transaction`
          update reorder_suggestions set status = 'RECEIVED'
          where draft_purchase_order_id = ${order.id} and status = 'ORDERED'
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'GOODS_RECEIPT.COMPLETED',
          'goods_receipt', ${receipt.id}, ${input.clientRequestId},
          ${transaction.json({ purchaseOrderId: order.id, lineCount: sortedLines.length, purchaseOrderStatus: status })}
        )
      `;
      return {
        receiptId: receipt.id,
        ...(await this.getPurchaseOrderWith(transaction, user.branchId, order.id)),
        idempotentReplay: false,
      };
    });
  }

  private async lockPurchaseOrder(
    transaction: DatabaseTransaction,
    branchId: string,
    purchaseOrderId: bigint,
  ): Promise<PurchaseOrderRow> {
    const [order] = await transaction<PurchaseOrderRow[]>`
      select id::text, branch_id::text, status, order_number, ordered_client_request_id
      from purchase_orders where id = ${purchaseOrderId.toString()} for update
    `;
    if (!order || order.branch_id !== branchId)
      throw new NotFoundException('Purchase order not found');
    return order;
  }

  private async getPurchaseOrderWith(
    transaction: DatabaseTransaction,
    branchId: string,
    purchaseOrderId: string,
  ): Promise<Record<string, unknown>> {
    const [order] = await transaction<Array<Record<string, unknown>>>`
      select orders.id::text, orders.order_number, orders.status, orders.supplier_invoice_number,
        orders.total_cost::text, suppliers.id::text as supplier_id,
        suppliers.name as supplier_name, orders.ordered_at, orders.received_at, orders.created_at
      from purchase_orders orders join suppliers on suppliers.id = orders.supplier_id
      where orders.id = ${purchaseOrderId} and orders.branch_id = ${branchId}
    `;
    if (!order) throw new NotFoundException('Purchase order not found');
    const items = await transaction<Array<Record<string, unknown>>>`
      select items.id::text, medicines.id::text as medicine_id, medicines.name as medicine_name,
        items.ordered_qty::text, items.received_qty::text, items.bonus_qty::text,
        items.received_bonus_qty::text, items.unit_cost::text, items.line_discount::text,
        items.base_units_per_order_unit::text
      from purchase_order_items items join medicines on medicines.id = items.medicine_id
      where items.purchase_order_id = ${purchaseOrderId} order by items.id
    `;
    return { ...order, items };
  }
}
