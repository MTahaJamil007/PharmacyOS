import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import type {
  ReportCell,
  ReportColumn,
  TabularReport,
  TabularReportName,
  TabularReportQuery,
} from '@pharmacy/shared';

import { DATABASE } from '../database.module.js';

type Row = Record<string, ReportCell>;

const money = (key: string, label: string): ReportColumn => ({ key, label, type: 'money' });
const count = (key: string, label: string): ReportColumn => ({ key, label, type: 'count' });
const quantity = (key: string, label: string): ReportColumn => ({ key, label, type: 'quantity' });
const text = (key: string, label: string): ReportColumn => ({ key, label, type: 'text' });
const date = (key: string, label: string): ReportColumn => ({ key, label, type: 'date' });
const datetime = (key: string, label: string): ReportColumn => ({
  key,
  label,
  type: 'datetime',
});

/**
 * Deterministic owner and manager reports. Every date is a branch-local business day: a
 * sale at 01:30 in Karachi belongs to that Karachi date, not to the previous UTC day.
 * Totals are computed by PostgreSQL in exact numeric arithmetic.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async run(
    branchId: string,
    report: TabularReportName,
    query: TabularReportQuery,
  ): Promise<TabularReport> {
    const [range] = await this.database<Array<{ from_date: string; to_date: string }>>`
      select coalesce(${query.from ?? null}::date,
          (now() at time zone timezone)::date - 29)::text as from_date,
        coalesce(${query.to ?? null}::date, (now() at time zone timezone)::date)::text as to_date
      from branches where id = ${branchId}
    `;
    const from = range?.from_date ?? '';
    const to = range?.to_date ?? '';
    switch (report) {
      case 'daily-sales':
        return this.dailySales(branchId, from, to);
      case 'profit':
        return this.profit(branchId, from, to);
      case 'item-sales':
        return this.itemSales(branchId, from, to, query.limit);
      case 'returns-register':
        return this.returnsRegister(branchId, from, to);
      case 'cash-sessions':
        return this.cashSessions(branchId, from, to);
      case 'stock-valuation':
        return this.stockValuation(branchId);
      case 'expiry':
        return this.expiry(branchId, query.days);
      case 'purchases':
        return this.purchases(branchId, from, to);
      case 'stock-losses':
        return this.stockLosses(branchId, from, to);
    }
  }

  private bounds(branchId: string, from: string, to: string) {
    return this.database`
      select timezone as tz, ${from}::date as from_date, ${to}::date as to_date,
        (${from}::date::timestamp at time zone timezone) as start_at,
        ((${to}::date + 1)::timestamp at time zone timezone) as end_at
      from branches where id = ${branchId}
    `;
  }

  private async dailySales(branchId: string, from: string, to: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)}),
      days as (
        select generate_series(from_date, to_date, interval '1 day')::date as day from bounds
      ),
      sale_days as (
        select (sales.created_at at time zone bounds.tz)::date as day,
          count(*) as invoices, sum(sales.total) as sales,
          sum(sales.discount_total + coalesce(lines.line_discounts, 0)) as discounts,
          sum(sales.tax_total) as tax
        from sales cross join bounds
        left join lateral (
          select sum(discount_amount) as line_discounts from sale_items
          where sale_items.sale_id = sales.id
        ) lines on true
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= bounds.start_at and sales.created_at < bounds.end_at
        group by 1
      ),
      payment_days as (
        select (sales.created_at at time zone bounds.tz)::date as day,
          sum(payments.amount) filter (where payments.method = 'CASH') as cash,
          sum(payments.amount) filter (where payments.method = 'CARD') as card,
          sum(payments.amount) filter (where payments.method = 'BANK_TRANSFER') as bank,
          sum(payments.amount) filter (where payments.method = 'CREDIT') as credit
        from payments join sales on sales.id = payments.sale_id cross join bounds
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and payments.status = 'CAPTURED'
          and sales.created_at >= bounds.start_at and sales.created_at < bounds.end_at
        group by 1
      ),
      refund_days as (
        select (refunds.created_at at time zone bounds.tz)::date as day,
          sum(refunds.amount) as refunds
        from refunds join returns on returns.id = refunds.return_id cross join bounds
        where returns.branch_id = ${branchId}
          and refunds.created_at >= bounds.start_at and refunds.created_at < bounds.end_at
        group by 1
      ),
      collection_days as (
        select (entries.created_at at time zone bounds.tz)::date as day,
          -sum(entries.amount_delta) as collected
        from customer_ledger_entries entries cross join bounds
        where entries.branch_id = ${branchId} and entries.entry_type = 'PAYMENT'
          and entries.created_at >= bounds.start_at and entries.created_at < bounds.end_at
        group by 1
      )
      select days.day::text as date,
        coalesce(sale_days.invoices, 0)::int as invoices,
        (coalesce(sale_days.sales, 0) + coalesce(sale_days.discounts, 0))::text as "grossSales",
        coalesce(sale_days.discounts, 0)::text as discounts,
        coalesce(sale_days.sales, 0)::text as sales,
        coalesce(refund_days.refunds, 0)::text as refunds,
        (coalesce(sale_days.sales, 0) - coalesce(refund_days.refunds, 0))::text as "netSales",
        coalesce(sale_days.tax, 0)::text as tax,
        coalesce(payment_days.cash, 0)::text as cash,
        coalesce(payment_days.card, 0)::text as card,
        coalesce(payment_days.bank, 0)::text as bank,
        coalesce(payment_days.credit, 0)::text as credit,
        coalesce(collection_days.collected, 0)::text as "creditCollected"
      from days
      left join sale_days on sale_days.day = days.day
      left join payment_days on payment_days.day = days.day
      left join refund_days on refund_days.day = days.day
      left join collection_days on collection_days.day = days.day
      order by days.day desc
    `;
    const columns: ReportColumn[] = [
      date('date', 'Date'),
      count('invoices', 'Invoices'),
      money('grossSales', 'Gross sales'),
      money('discounts', 'Discounts'),
      money('sales', 'Sales'),
      money('refunds', 'Refunds'),
      money('netSales', 'Net sales'),
      money('tax', 'Tax included'),
      money('cash', 'Cash'),
      money('card', 'Card'),
      money('bank', 'Bank transfer'),
      money('credit', 'On khata'),
      money('creditCollected', 'Khata collected'),
    ];
    return this.report('daily-sales', 'Daily sales', from, to, columns, rows, {
      dataBasis:
        'Finalized sales by branch-local day. Gross sales are before discounts; refunds are counted on the day they were paid out; net sales = sales − refunds. Prices include tax.',
    });
  }

  private async profit(branchId: string, from: string, to: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)}),
      days as (
        select generate_series(from_date, to_date, interval '1 day')::date as day from bounds
      ),
      sale_days as (
        select (sales.created_at at time zone bounds.tz)::date as day,
          sum(sales.total) as sales, sum(costs.cost) as cost
        from sales cross join bounds
        cross join lateral (
          select coalesce(sum(sale_items.unit_cost * sale_items.quantity), 0) as cost
          from sale_items where sale_items.sale_id = sales.id
        ) costs
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= bounds.start_at and sales.created_at < bounds.end_at
        group by 1
      ),
      refund_days as (
        select (refunds.created_at at time zone bounds.tz)::date as day,
          sum(refunds.amount) as refunds,
          sum(recovered.cost) as recovered_cost
        from refunds join returns on returns.id = refunds.return_id cross join bounds
        cross join lateral (
          select coalesce(sum(return_items.quantity * sale_items.unit_cost)
            filter (where return_items.disposition <> 'SCRAP'), 0) as cost
          from return_items join sale_items on sale_items.id = return_items.sale_item_id
          where return_items.return_id = returns.id
        ) recovered
        where returns.branch_id = ${branchId}
          and refunds.created_at >= bounds.start_at and refunds.created_at < bounds.end_at
        group by 1
      ),
      loss_days as (
        select (movements.created_at at time zone bounds.tz)::date as day,
          sum(-movements.quantity_delta * batches.cost_price) as losses
        from stock_movements movements
        join inventory_batches batches on batches.id = movements.inventory_batch_id
        cross join bounds
        where movements.branch_id = ${branchId}
          and (movements.movement_type in ('SCRAP', 'ADJUSTMENT_OUT')
            or (movements.movement_type = 'ADJUSTMENT_IN'
              and movements.metadata->>'adjustmentType' = 'COUNT'))
          and movements.created_at >= bounds.start_at and movements.created_at < bounds.end_at
        group by 1
      ),
      combined as (
        select days.day,
          coalesce(sale_days.sales, 0) - coalesce(refund_days.refunds, 0) as net_sales,
          round(coalesce(sale_days.cost, 0) - coalesce(refund_days.recovered_cost, 0), 2) as cogs,
          round(coalesce(loss_days.losses, 0), 2) as losses
        from days
        left join sale_days on sale_days.day = days.day
        left join refund_days on refund_days.day = days.day
        left join loss_days on loss_days.day = days.day
      )
      select day::text as date, net_sales::text as "netSales", cogs::text as "costOfGoods",
        (net_sales - cogs)::text as "grossProfit",
        case when net_sales > 0 then round((net_sales - cogs) * 100 / net_sales, 1)::text
          else null end as margin,
        losses::text as "stockLosses",
        (net_sales - cogs - losses)::text as "profitAfterLosses"
      from combined order by day desc
    `;
    const columns: ReportColumn[] = [
      date('date', 'Date'),
      money('netSales', 'Net sales'),
      money('costOfGoods', 'Cost of goods sold'),
      money('grossProfit', 'Gross profit'),
      { key: 'margin', label: 'Margin %', type: 'percent' },
      money('stockLosses', 'Stock losses'),
      money('profitAfterLosses', 'Profit after losses'),
    ];
    return this.report('profit', 'Gross profit', from, to, columns, rows, {
      dataBasis:
        'Net sales less the recorded acquisition cost of the batches sold. Returned goods that were restocked or quarantined give their cost back; scrapped returns do not. Stock losses are scraps and count shortages at batch cost, net of count gains. Expenses are not included.',
      skipTotals: ['margin'],
    });
  }

  private async itemSales(
    branchId: string,
    from: string,
    to: string,
    limit: number,
  ): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)}),
      sold as (
        select sale_items.medicine_id, sum(sale_items.quantity) as quantity,
          sum(sale_items.line_total) as sales,
          sum(sale_items.unit_cost * sale_items.quantity) as cost
        from sale_items join sales on sales.id = sale_items.sale_id cross join bounds
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= bounds.start_at and sales.created_at < bounds.end_at
        group by sale_items.medicine_id
      ),
      returned as (
        select sale_items.medicine_id, sum(return_items.quantity) as quantity,
          sum(return_items.refund_amount) as refunds,
          sum(return_items.quantity * sale_items.unit_cost)
            filter (where return_items.disposition <> 'SCRAP') as recovered_cost
        from return_items
        join returns on returns.id = return_items.return_id and returns.status = 'REFUNDED'
        join refunds on refunds.return_id = returns.id
        join sale_items on sale_items.id = return_items.sale_item_id
        cross join bounds
        where returns.branch_id = ${branchId}
          and refunds.created_at >= bounds.start_at and refunds.created_at < bounds.end_at
        group by sale_items.medicine_id
      )
      select medicines.name as medicine, medicines.strength,
        coalesce(sold.quantity, 0)::text as "quantitySold",
        coalesce(returned.quantity, 0)::text as "quantityReturned",
        (coalesce(sold.quantity, 0) - coalesce(returned.quantity, 0))::text as "netQuantity",
        (coalesce(sold.sales, 0) - coalesce(returned.refunds, 0))::text as "netSales",
        round(coalesce(sold.cost, 0) - coalesce(returned.recovered_cost, 0), 2)::text
          as "costOfGoods",
        round(coalesce(sold.sales, 0) - coalesce(returned.refunds, 0)
          - coalesce(sold.cost, 0) + coalesce(returned.recovered_cost, 0), 2)::text
          as "grossProfit"
      from sold
      full join returned on returned.medicine_id = sold.medicine_id
      join medicines on medicines.id = coalesce(sold.medicine_id, returned.medicine_id)
      order by coalesce(sold.sales, 0) - coalesce(returned.refunds, 0) desc, medicines.name
      limit ${limit}
    `;
    const columns: ReportColumn[] = [
      text('medicine', 'Medicine'),
      text('strength', 'Strength'),
      quantity('quantitySold', 'Sold'),
      quantity('quantityReturned', 'Returned'),
      quantity('netQuantity', 'Net units'),
      money('netSales', 'Net sales'),
      money('costOfGoods', 'Cost of goods'),
      money('grossProfit', 'Gross profit'),
    ];
    return this.report('item-sales', 'Sales by medicine', from, to, columns, rows, {
      dataBasis: `Top ${String(limit)} medicines by net sales (line value after line discounts, before invoice discounts, less refunds). Cost is the recorded batch acquisition cost.`,
    });
  }

  private async returnsRegister(
    branchId: string,
    from: string,
    to: string,
  ): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)})
      select returns.requested_at as "requestedAt", returns.return_number as "returnNumber",
        sales.invoice_number as invoice, customers.name as customer, returns.status,
        coalesce(refunds.method, '') as method,
        coalesce(refunds.amount, items.total, 0)::text as amount,
        returns.reason, requester.display_name as "requestedBy",
        processor.display_name as "refundedBy"
      from returns
      join sales on sales.id = returns.sale_id
      join users requester on requester.id = returns.requested_by_user_id
      left join customers on customers.id = sales.customer_id
      left join refunds on refunds.return_id = returns.id
      left join users processor on processor.id = refunds.processed_by_user_id
      left join lateral (
        select sum(refund_amount) as total from return_items where return_items.return_id = returns.id
      ) items on true
      cross join bounds
      where returns.branch_id = ${branchId}
        and returns.requested_at >= bounds.start_at and returns.requested_at < bounds.end_at
      order by returns.requested_at desc, returns.id desc
    `;
    const columns: ReportColumn[] = [
      datetime('requestedAt', 'Requested'),
      text('returnNumber', 'Return'),
      text('invoice', 'Invoice'),
      text('customer', 'Customer'),
      text('status', 'Status'),
      text('method', 'Refund method'),
      money('amount', 'Amount'),
      text('reason', 'Reason'),
      text('requestedBy', 'Requested by'),
      text('refundedBy', 'Refunded by'),
    ];
    return this.report('returns-register', 'Returns register', from, to, columns, rows, {
      dataBasis:
        'Every return requested in the period with its current status. Amount is the refund paid, or the refund that would be paid for an open request.',
    });
  }

  private async cashSessions(branchId: string, from: string, to: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)})
      select cash_sessions.opened_at as "openedAt", cash_sessions.closed_at as "closedAt",
        users.display_name as cashier, terminals.name as terminal, cash_sessions.status,
        cash_sessions.opening_float::text as "openingFloat",
        cash_sessions.expected_cash::text as "expectedCash",
        cash_sessions.counted_cash::text as "countedCash",
        cash_sessions.variance::text as variance, approver.display_name as "approvedBy"
      from cash_sessions
      join users on users.id = cash_sessions.cashier_user_id
      join terminals on terminals.id = cash_sessions.terminal_id
      left join users approver on approver.id = cash_sessions.variance_approved_by_user_id
      cross join bounds
      where cash_sessions.branch_id = ${branchId}
        and cash_sessions.opened_at >= bounds.start_at and cash_sessions.opened_at < bounds.end_at
      order by cash_sessions.opened_at desc, cash_sessions.id desc
    `;
    const columns: ReportColumn[] = [
      datetime('openedAt', 'Opened'),
      datetime('closedAt', 'Closed'),
      text('cashier', 'Cashier'),
      text('terminal', 'Terminal'),
      text('status', 'Status'),
      money('openingFloat', 'Opening float'),
      money('expectedCash', 'Expected'),
      money('countedCash', 'Counted'),
      money('variance', 'Variance'),
      text('approvedBy', 'Variance approved by'),
    ];
    return this.report('cash-sessions', 'Cash sessions', from, to, columns, rows, {
      dataBasis:
        'Till sessions opened in the period. Expected cash = opening float + cash sales + khata cash collected − cash refunds + cash in − cash out. Open sessions have no count yet.',
      skipTotals: ['openingFloat', 'expectedCash', 'countedCash'],
    });
  }

  private async stockValuation(branchId: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with clock as (
        select (now() at time zone timezone)::date as today from branches where id = ${branchId}
      ), classified as (
        select case
            when batches.status = 'SELLABLE' and batches.expiry_date < clock.today
              then 'Expired (not yet scrapped)'
            when batches.status = 'SELLABLE' then 'Sellable'
            when batches.status = 'QUARANTINE' then 'Quarantined'
            when batches.status = 'RECALLED' then 'Recalled'
            else 'Other'
          end as category,
          batches.medicine_id, batches.current_qty, batches.cost_price, batches.sale_price
        from inventory_batches batches cross join clock
        where batches.branch_id = ${branchId} and batches.deleted_at is null
          and batches.current_qty > 0
      )
      select category, count(distinct medicine_id)::int as medicines, count(*)::int as batches,
        sum(current_qty)::text as units,
        round(sum(current_qty * cost_price), 2)::text as "valueAtCost",
        round(sum(current_qty * sale_price), 2)::text as "valueAtRetail"
      from classified group by category
      order by case category when 'Sellable' then 0 when 'Expired (not yet scrapped)' then 1
        when 'Quarantined' then 2 when 'Recalled' then 3 else 4 end
    `;
    const columns: ReportColumn[] = [
      text('category', 'Stock'),
      count('medicines', 'Medicines'),
      count('batches', 'Batches'),
      quantity('units', 'Units'),
      money('valueAtCost', 'Value at cost'),
      money('valueAtRetail', 'Value at retail'),
    ];
    return this.report('stock-valuation', 'Stock valuation', null, null, columns, rows, {
      dataBasis:
        'Current batch stock on hand valued at each batch’s acquisition cost and current retail price.',
      skipTotals: ['medicines'],
    });
  }

  private async expiry(branchId: string, days: number): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with clock as (
        select (now() at time zone timezone)::date as today from branches where id = ${branchId}
      )
      select medicines.name as medicine, batches.batch_number as batch,
        batches.expiry_date::text as expiry, (batches.expiry_date - clock.today)::int as "daysLeft",
        batches.status, batches.current_qty::text as units,
        round(batches.current_qty * batches.cost_price, 2)::text as "valueAtCost",
        suppliers.name as supplier
      from inventory_batches batches cross join clock
      join medicines on medicines.id = batches.medicine_id
      left join purchase_order_items items on items.id = batches.purchase_order_item_id
      left join purchase_orders orders on orders.id = items.purchase_order_id
      left join suppliers on suppliers.id = orders.supplier_id
      where batches.branch_id = ${branchId} and batches.deleted_at is null
        and batches.current_qty > 0 and batches.expiry_date <= clock.today + ${days}::int
      order by batches.expiry_date, medicines.name, batches.id
    `;
    const columns: ReportColumn[] = [
      text('medicine', 'Medicine'),
      text('batch', 'Batch'),
      date('expiry', 'Expiry'),
      count('daysLeft', 'Days left'),
      text('status', 'Status'),
      quantity('units', 'Units'),
      money('valueAtCost', 'Value at cost'),
      text('supplier', 'Supplier'),
    ];
    return this.report(
      'expiry',
      `Expiring within ${String(days)} days`,
      null,
      null,
      columns,
      rows,
      {
        dataBasis:
          'Batches with stock that are expired or expire within the window, oldest first, with the supplier they came from for return-to-supplier decisions.',
        skipTotals: ['daysLeft'],
      },
    );
  }

  private async purchases(branchId: string, from: string, to: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)})
      select receipts.received_at as "receivedAt", suppliers.name as supplier,
        orders.order_number as "orderNumber",
        coalesce(receipts.supplier_invoice_number, orders.supplier_invoice_number) as "supplierInvoice",
        count(receipt_items.id)::int as lines, sum(receipt_items.received_base_qty)::text as units,
        round(sum(receipt_items.received_base_qty * receipt_items.effective_cost_per_base_unit), 2)::text
          as "valueAtCost",
        users.display_name as "receivedBy"
      from goods_receipts receipts
      join purchase_orders orders on orders.id = receipts.purchase_order_id
      join suppliers on suppliers.id = orders.supplier_id
      join users on users.id = receipts.received_by_user_id
      join goods_receipt_items receipt_items on receipt_items.goods_receipt_id = receipts.id
      cross join bounds
      where receipts.branch_id = ${branchId}
        and receipts.received_at >= bounds.start_at and receipts.received_at < bounds.end_at
      group by receipts.id, suppliers.name, orders.order_number, orders.supplier_invoice_number,
        users.display_name
      order by receipts.received_at desc, receipts.id desc
    `;
    const columns: ReportColumn[] = [
      datetime('receivedAt', 'Received'),
      text('supplier', 'Supplier'),
      text('orderNumber', 'Purchase order'),
      text('supplierInvoice', 'Supplier invoice'),
      count('lines', 'Lines'),
      quantity('units', 'Units'),
      money('valueAtCost', 'Value at cost'),
      text('receivedBy', 'Received by'),
    ];
    return this.report('purchases', 'Purchases received', from, to, columns, rows, {
      dataBasis:
        'Goods receipts in the period valued at effective acquisition cost (after line discounts, with bonus units spreading the cost).',
    });
  }

  private async stockLosses(branchId: string, from: string, to: string): Promise<TabularReport> {
    const rows = await this.database<Row[]>`
      with bounds as materialized (${this.bounds(branchId, from, to)})
      select movements.created_at as "recordedAt", medicines.name as medicine,
        batches.batch_number as batch,
        case movements.movement_type
          when 'SCRAP' then 'Scrapped'
          when 'ADJUSTMENT_OUT' then 'Count shortage'
          else 'Count surplus'
        end as kind,
        movements.quantity_delta::text as units,
        round(-movements.quantity_delta * batches.cost_price, 2)::text as "valueAtCost",
        movements.reason, users.display_name as "recordedBy"
      from stock_movements movements
      join inventory_batches batches on batches.id = movements.inventory_batch_id
      join medicines on medicines.id = batches.medicine_id
      left join users on users.id = movements.performed_by_user_id
      cross join bounds
      where movements.branch_id = ${branchId}
        and (movements.movement_type in ('SCRAP', 'ADJUSTMENT_OUT')
          or (movements.movement_type = 'ADJUSTMENT_IN'
            and movements.metadata->>'adjustmentType' = 'COUNT'))
        and movements.created_at >= bounds.start_at and movements.created_at < bounds.end_at
      order by movements.created_at desc, movements.id desc
    `;
    const columns: ReportColumn[] = [
      datetime('recordedAt', 'Recorded'),
      text('medicine', 'Medicine'),
      text('batch', 'Batch'),
      text('kind', 'Type'),
      quantity('units', 'Units'),
      money('valueAtCost', 'Loss at cost'),
      text('reason', 'Reason'),
      text('recordedBy', 'Recorded by'),
    ];
    return this.report('stock-losses', 'Stock losses and adjustments', from, to, columns, rows, {
      dataBasis:
        'Scrapped stock and physical-count differences at batch acquisition cost. A count surplus appears as a negative loss.',
      skipTotals: ['units'],
    });
  }

  private report(
    report: TabularReportName,
    title: string,
    from: string | null,
    to: string | null,
    columns: readonly ReportColumn[],
    rows: readonly Row[],
    options: { readonly dataBasis: string; readonly skipTotals?: readonly string[] },
  ): TabularReport {
    const skip = new Set(options.skipTotals ?? []);
    const summable = columns.filter(
      (column) =>
        !skip.has(column.key) &&
        (column.type === 'money' || column.type === 'count' || column.type === 'quantity'),
    );
    const totals: Record<string, ReportCell> = {};
    for (const column of summable) {
      totals[column.key] = sumDecimalColumn(
        rows.map((row) => row[column.key] ?? null),
        column.type === 'money' ? 2 : column.type === 'quantity' ? 3 : 0,
      );
    }
    return {
      columns,
      dataBasis: options.dataBasis,
      from,
      report,
      rows,
      title,
      to,
      totals: rows.length > 0 && summable.length > 0 ? totals : null,
    };
  }
}

/** Exact decimal column total; numbers arrive as strings from PostgreSQL numeric. */
export function sumDecimalColumn(values: readonly ReportCell[], scale: number): string {
  const factor = 10n ** BigInt(scale);
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const textValue = String(value);
    const negative = textValue.startsWith('-');
    const [whole = '0', fraction = ''] = (negative ? textValue.slice(1) : textValue).split('.');
    const scaled =
      BigInt(whole || '0') * factor + BigInt(fraction.padEnd(scale, '0').slice(0, scale) || '0');
    total += negative ? -scaled : scaled;
  }
  if (scale === 0) return total.toString();
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  return `${negative ? '-' : ''}${(absolute / factor).toString()}.${(absolute % factor)
    .toString()
    .padStart(scale, '0')}`;
}
