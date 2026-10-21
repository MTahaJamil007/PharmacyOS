import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import type { DashboardSnapshot, OwnerDashboard } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Worker-refreshed snapshot, retained for history and existing integrations. */
  async owner(user: AuthenticatedUser, date?: string) {
    const [snapshot] = await this.database<DashboardSnapshot[]>`
      select metric_date::text as "metricDate", net_sales::text as "netSales",
        gross_profit_estimate::text as "grossProfitEstimate",
        cash_collected::text as "cashCollected",
        non_cash_collected::text as "nonCashCollected", refunds::text,
        invoice_count::text as "invoiceCount", metrics, updated_at as "updatedAt"
      from dashboard_daily_metrics
      where branch_id = ${user.branchId}
        and metric_date = coalesce(
          ${date ?? null}::date,
          (now() at time zone (select timezone from branches where id = ${user.branchId}))::date
        )
    `;
    return {
      data: snapshot ?? null,
      status: snapshot ? 'READY' : 'PENDING_REFRESH',
      dataBasis: 'Worker-refreshed deterministic branch-local daily metrics',
    };
  }

  /**
   * The owner's live view of one business day. Money is computed from the ledgers on every
   * request so the numbers on screen are never an hour old.
   */
  async overview(
    branchId: string,
    date: string | undefined,
    trendDays: number,
  ): Promise<OwnerDashboard> {
    const [day] = await this.database<
      Array<{
        date: string;
        invoice_count: number;
        sales: string;
        discounts: string;
        refunds: string;
        cost: string;
        recovered_cost: string;
        cash: string;
        card: string;
        bank: string;
        credit: string;
        collected: string;
      }>
    >`
      with bounds as materialized (
        select timezone as tz,
          coalesce(${date ?? null}::date, (now() at time zone timezone)::date) as day
        from branches where id = ${branchId}
      ), window_bounds as materialized (
        select tz, day, (day::timestamp at time zone tz) as start_at,
          ((day + 1)::timestamp at time zone tz) as end_at
        from bounds
      ), day_sales as (
        select count(*)::int as invoice_count, coalesce(sum(sales.total), 0) as sales,
          coalesce(sum(sales.discount_total + lines.line_discounts), 0) as discounts,
          coalesce(sum(lines.cost), 0) as cost
        from sales cross join window_bounds
        cross join lateral (
          select coalesce(sum(discount_amount), 0) as line_discounts,
            coalesce(sum(unit_cost * quantity), 0) as cost
          from sale_items where sale_items.sale_id = sales.id
        ) lines
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= window_bounds.start_at and sales.created_at < window_bounds.end_at
      ), day_payments as (
        select
          coalesce(sum(payments.amount) filter (where payments.method = 'CASH'), 0) as cash,
          coalesce(sum(payments.amount) filter (where payments.method = 'CARD'), 0) as card,
          coalesce(sum(payments.amount) filter (where payments.method = 'BANK_TRANSFER'), 0)
            as bank,
          coalesce(sum(payments.amount) filter (where payments.method = 'CREDIT'), 0) as credit
        from payments join sales on sales.id = payments.sale_id cross join window_bounds
        where sales.branch_id = ${branchId} and payments.status = 'CAPTURED'
          and sales.created_at >= window_bounds.start_at and sales.created_at < window_bounds.end_at
      ), day_refunds as (
        select coalesce(sum(refunds.amount), 0) as refunds,
          coalesce(sum(recovered.cost), 0) as recovered_cost
        from refunds join returns on returns.id = refunds.return_id cross join window_bounds
        cross join lateral (
          select coalesce(sum(return_items.quantity * sale_items.unit_cost)
            filter (where return_items.disposition <> 'SCRAP'), 0) as cost
          from return_items join sale_items on sale_items.id = return_items.sale_item_id
          where return_items.return_id = returns.id
        ) recovered
        where returns.branch_id = ${branchId}
          and refunds.created_at >= window_bounds.start_at and refunds.created_at < window_bounds.end_at
      ), day_collections as (
        select coalesce(-sum(entries.amount_delta), 0) as collected
        from customer_ledger_entries entries cross join window_bounds
        where entries.branch_id = ${branchId} and entries.entry_type = 'PAYMENT'
          and entries.created_at >= window_bounds.start_at and entries.created_at < window_bounds.end_at
      )
      select window_bounds.day::text as date, day_sales.invoice_count,
        day_sales.sales::text, day_sales.discounts::text, day_refunds.refunds::text,
        round(day_sales.cost, 2)::text as cost, round(day_refunds.recovered_cost, 2)::text
          as recovered_cost,
        day_payments.cash::text, day_payments.card::text, day_payments.bank::text,
        day_payments.credit::text, day_collections.collected::text
      from window_bounds cross join day_sales cross join day_payments
      cross join day_refunds cross join day_collections
    `;
    if (!day) throw new Error('Branch clock unavailable');

    const trend = await this.database<OwnerDashboard['trend'][number][]>`
      with bounds as materialized (
        select timezone as tz, ${day.date}::date as last_day from branches where id = ${branchId}
      ), days as (
        select generate_series(last_day - ${trendDays - 1}::int, last_day, interval '1 day')::date
          as day, tz
        from bounds
      ), sold as (
        select (sales.created_at at time zone bounds.tz)::date as day, count(*)::int as invoices,
          sum(sales.total) as sales, sum(costs.cost) as cost
        from sales cross join bounds
        cross join lateral (
          select coalesce(sum(unit_cost * quantity), 0) as cost from sale_items
          where sale_items.sale_id = sales.id
        ) costs
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= ((bounds.last_day - ${trendDays - 1}::int)::timestamp at time zone bounds.tz)
          and sales.created_at < ((bounds.last_day + 1)::timestamp at time zone bounds.tz)
        group by 1
      ), refunded as (
        select (refunds.created_at at time zone bounds.tz)::date as day,
          sum(refunds.amount) as refunds, sum(recovered.cost) as recovered
        from refunds join returns on returns.id = refunds.return_id cross join bounds
        cross join lateral (
          select coalesce(sum(return_items.quantity * sale_items.unit_cost)
            filter (where return_items.disposition <> 'SCRAP'), 0) as cost
          from return_items join sale_items on sale_items.id = return_items.sale_item_id
          where return_items.return_id = returns.id
        ) recovered
        where returns.branch_id = ${branchId}
          and refunds.created_at >= ((bounds.last_day - ${trendDays - 1}::int)::timestamp at time zone bounds.tz)
          and refunds.created_at < ((bounds.last_day + 1)::timestamp at time zone bounds.tz)
        group by 1
      )
      select days.day::text as date,
        (coalesce(sold.sales, 0) - coalesce(refunded.refunds, 0))::numeric(14, 2)::text
          as "netSales",
        round(coalesce(sold.sales, 0) - coalesce(refunded.refunds, 0)
          - coalesce(sold.cost, 0) + coalesce(refunded.recovered, 0), 2)::text as "grossProfit",
        coalesce(sold.invoices, 0) as "invoiceCount"
      from days
      left join sold on sold.day = days.day
      left join refunded on refunded.day = days.day
      order by days.day
    `;

    const topItems = await this.database<OwnerDashboard['topItems'][number][]>`
      with bounds as materialized (
        select timezone as tz, ${day.date}::date as day from branches where id = ${branchId}
      )
      select medicines.id::text as "medicineId", medicines.name,
        sum(sale_items.quantity)::text as quantity, sum(sale_items.line_total)::text as "netSales"
      from sales join sale_items on sale_items.sale_id = sales.id
      join medicines on medicines.id = sale_items.medicine_id cross join bounds
      where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
        and sales.created_at >= (bounds.day::timestamp at time zone bounds.tz)
        and sales.created_at < ((bounds.day + 1)::timestamp at time zone bounds.tz)
      group by medicines.id, medicines.name
      order by sum(sale_items.line_total) desc, medicines.id limit 5
    `;

    const [position] = await this.database<
      Array<{
        receivables: string;
        stock_value: string;
        expiry_value: string;
        low_stock: number;
        out_of_stock: number;
        open_sessions: number;
        pending_returns: number;
        pending_variances: number;
        failed_fiscal: number;
        open_alerts: number;
        last_backup: Date | null;
        last_restore: Date | null;
      }>
    >`
      with clock as materialized (
        select (now() at time zone timezone)::date as today from branches where id = ${branchId}
      ), window_days as materialized (
        select coalesce((select expiry_moderate_days from operational_intelligence_policies
          where branch_id = ${branchId}), 90) as days
      ), per_medicine as (
        select batches.medicine_id,
          coalesce(sum(batches.current_qty) filter (
            where batches.status = 'SELLABLE' and batches.expiry_date >= clock.today
          ), 0) as sellable
        from inventory_batches batches cross join clock
        where batches.branch_id = ${branchId} and batches.deleted_at is null
        group by batches.medicine_id
      )
      select
        (select coalesce(sum(latest.balance_after), 0)::text from (
          select distinct on (customer_id) balance_after from customer_ledger_entries
          where branch_id = ${branchId} order by customer_id, id desc
        ) latest) as receivables,
        (select round(coalesce(sum(current_qty * cost_price), 0), 2)::text
          from inventory_batches where branch_id = ${branchId} and deleted_at is null
            and current_qty > 0) as stock_value,
        (select round(coalesce(sum(current_qty * cost_price), 0), 2)::text
          from inventory_batches cross join clock cross join window_days
          where branch_id = ${branchId} and deleted_at is null and current_qty > 0
            and expiry_date <= clock.today + window_days.days) as expiry_value,
        (select count(*)::int from per_medicine
          join reorder_policies policies on policies.branch_id = ${branchId}
            and policies.medicine_id = per_medicine.medicine_id and policies.is_active
          join medicines on medicines.id = per_medicine.medicine_id and medicines.is_active
            and medicines.deleted_at is null
          where policies.minimum_stock > 0 and per_medicine.sellable > 0
            and per_medicine.sellable <= policies.minimum_stock) as low_stock,
        (select count(*)::int from per_medicine
          join medicines on medicines.id = per_medicine.medicine_id and medicines.is_active
            and medicines.deleted_at is null
          where per_medicine.sellable <= 0) as out_of_stock,
        (select count(*)::int from cash_sessions where branch_id = ${branchId}
          and status = 'OPEN') as open_sessions,
        (select count(*)::int from returns where branch_id = ${branchId}
          and status in ('REQUESTED', 'APPROVED')) as pending_returns,
        (select count(*)::int from cash_sessions where branch_id = ${branchId}
          and status = 'CLOSING') as pending_variances,
        (select count(*)::int from fbr_invoices join sales on sales.id = fbr_invoices.sale_id
          where sales.branch_id = ${branchId}
            and fbr_invoices.status in ('FAILED_RETRYABLE', 'FAILED_NEEDS_REVIEW')) as failed_fiscal,
        (select count(*)::int from operational_alerts
          where (branch_id = ${branchId} or branch_id is null)
            and status in ('OPEN', 'ACKNOWLEDGED')) as open_alerts,
        (select max(finished_at) from backup_runs where status = 'SUCCEEDED'
          and backup_type <> 'RESTORE_DRILL'
          and (branch_id = ${branchId} or branch_id is null)) as last_backup,
        (select max(finished_at) from backup_runs where status = 'SUCCEEDED'
          and backup_type = 'RESTORE_DRILL'
          and (branch_id = ${branchId} or branch_id is null)) as last_restore
      from clock
    `;

    const minor = (value: string): bigint => {
      const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
      const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
      return value.startsWith('-') ? -scaled : scaled;
    };
    const format = (value: bigint): string => {
      const negative = value < 0n;
      const absolute = negative ? -value : value;
      return `${negative ? '-' : ''}${(absolute / 100n).toString()}.${(absolute % 100n)
        .toString()
        .padStart(2, '0')}`;
    };
    const sales = minor(day.sales);
    const refunds = minor(day.refunds);
    const net = sales - refunds;
    const cogs = minor(day.cost) - minor(day.recovered_cost);
    return {
      continuity: {
        lastRestoreDrillAt: position?.last_restore?.toISOString() ?? null,
        lastSuccessfulBackupAt: position?.last_backup?.toISOString() ?? null,
      },
      date: day.date,
      generatedAt: new Date().toISOString(),
      position: {
        expiryValueAtRisk: position?.expiry_value ?? '0.00',
        failedFiscalSubmissions: position?.failed_fiscal ?? 0,
        lowStockCount: position?.low_stock ?? 0,
        openAlerts: position?.open_alerts ?? 0,
        openCashSessions: position?.open_sessions ?? 0,
        outOfStockCount: position?.out_of_stock ?? 0,
        pendingReturns: position?.pending_returns ?? 0,
        pendingVariances: position?.pending_variances ?? 0,
        receivables: position?.receivables ?? '0.00',
        stockValueAtCost: position?.stock_value ?? '0.00',
      },
      sales: {
        averageTicket: format(
          day.invoice_count > 0
            ? (sales * 2n + BigInt(day.invoice_count)) / (2n * BigInt(day.invoice_count))
            : 0n,
        ),
        bankTransfer: format(minor(day.bank)),
        card: format(minor(day.card)),
        cash: format(minor(day.cash)),
        costOfGoods: format(cogs),
        credit: format(minor(day.credit)),
        creditCollected: format(minor(day.collected)),
        discounts: format(minor(day.discounts)),
        grossProfit: format(net - cogs),
        grossSales: format(sales + minor(day.discounts)),
        invoiceCount: day.invoice_count,
        netSales: format(net),
        refunds: format(refunds),
      },
      topItems,
      trend,
    };
  }
}
