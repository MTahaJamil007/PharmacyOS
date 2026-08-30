import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import { PERMISSIONS, type OwnerAiChatRequest } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

interface ToolResult {
  readonly facts: unknown;
  readonly dataBasis: string;
  readonly reportPath: string;
}

@Injectable()
export class OwnerToolsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async execute(user: AuthenticatedUser, request: OwnerAiChatRequest): Promise<ToolResult> {
    this.assertToolPermission(user, request.tool);
    const to = request.arguments.to ?? new Date().toISOString().slice(0, 10);
    const from = request.arguments.from ?? this.daysBefore(to, 30);
    if (from > to) throw new Error('INVALID_DATE_RANGE');

    switch (request.tool) {
      case 'get_sales_summary':
        return this.salesSummary(user.branchId, from, to);
      case 'get_profit_summary':
        return this.profitSummary(user.branchId, from, to);
      case 'get_low_stock':
        return this.lowStock(user.branchId, request.arguments.limit ?? 20);
      case 'get_expiry_risk':
        return this.expiryRisk(user.branchId);
      case 'get_purchase_suggestions':
        return this.purchaseSuggestions(user.branchId, request.arguments.limit ?? 20);
      case 'get_supplier_price_comparison':
        return this.supplierPrices(user.branchId, request.arguments.medicineId?.toString());
      case 'get_shelf_recommendations':
        return this.shelfRecommendations(user.branchId, request.arguments.limit ?? 20);
      case 'get_returns_summary':
        return this.returnsSummary(user.branchId, from, to);
      case 'get_cash_reconciliation_summary':
        return this.cashSummary(user.branchId, from, to);
    }
  }

  private assertToolPermission(user: AuthenticatedUser, tool: OwnerAiChatRequest['tool']): void {
    const required =
      tool === 'get_supplier_price_comparison'
        ? PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ
        : tool === 'get_shelf_recommendations'
          ? PERMISSIONS.INVENTORY_SHELF_READ
          : tool === 'get_expiry_risk'
            ? PERMISSIONS.INVENTORY_EXPIRY_READ
            : tool === 'get_purchase_suggestions' || tool === 'get_low_stock'
              ? PERMISSIONS.PROCUREMENT_REORDER_REVIEW
              : PERMISSIONS.ANALYTICS_OWNER_READ;
    if (!user.permissions.includes(required))
      throw new ForbiddenException('Tool access is not permitted');
  }

  private daysBefore(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - days);
    return value.toISOString().slice(0, 10);
  }

  private async salesSummary(branchId: string, from: string, to: string): Promise<ToolResult> {
    const [facts] = await this.database<Array<Record<string, unknown>>>`
      select count(*)::text as invoice_count, coalesce(sum(total), 0)::text as gross_sales,
        coalesce(avg(total), 0)::text as average_ticket
      from sales where branch_id = ${branchId} and status <> 'VOIDED'
        and created_at >= ${from}::date and created_at < ${to}::date + interval '1 day'
    `;
    return {
      facts,
      dataBasis: `Finalized non-voided sales from ${from} through ${to}`,
      reportPath: '/owner?report=sales',
    };
  }

  private async profitSummary(branchId: string, from: string, to: string): Promise<ToolResult> {
    const [facts] = await this.database<Array<Record<string, unknown>>>`
      select coalesce(sum(sale_items.line_total), 0)::text as revenue,
        coalesce(sum(sale_items.unit_cost * sale_items.quantity), 0)::text as cost_basis,
        coalesce(sum(sale_items.line_total - sale_items.unit_cost * sale_items.quantity), 0)::text as gross_profit_estimate
      from sale_items join sales on sales.id = sale_items.sale_id
      where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
        and sales.created_at >= ${from}::date and sales.created_at < ${to}::date + interval '1 day'
    `;
    return {
      facts,
      dataBasis: `Sale-line revenue minus recorded batch acquisition cost, ${from} through ${to}`,
      reportPath: '/owner?report=profit',
    };
  }

  private async lowStock(branchId: string, limit: number): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select medicines.id::text, medicines.name,
        coalesce(stock.quantity, 0)::text as sellable_stock,
        policies.minimum_stock::text,
        coalesce(velocity.average_daily, 0)::text as average_daily_demand,
        case when coalesce(velocity.average_daily, 0) > 0
          then round(coalesce(stock.quantity, 0) / velocity.average_daily, 1)::text else null end as days_of_stock
      from reorder_policies policies join medicines on medicines.id = policies.medicine_id
      left join lateral (select sum(current_qty) quantity from inventory_batches
        where branch_id = policies.branch_id and medicine_id = policies.medicine_id
          and status = 'SELLABLE' and deleted_at is null and expiry_date >= current_date) stock on true
      left join lateral (select avg(quantity_sold) average_daily from sales_velocity_daily
        where branch_id = policies.branch_id and medicine_id = policies.medicine_id
          and sales_date >= current_date - policies.lookback_days) velocity on true
      where policies.branch_id = ${branchId} and policies.is_active
        and coalesce(stock.quantity, 0) <= policies.minimum_stock
      order by coalesce(stock.quantity, 0), medicines.name limit ${limit}
    `;
    return {
      facts,
      dataBasis: 'Current sellable batch stock compared with active reorder policies',
      reportPath: '/inventory?view=reorder',
    };
  }

  private async expiryRisk(branchId: string): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select case when expiry_date < current_date then 'EXPIRED'
          when expiry_date <= current_date + 30 then 'DAYS_0_30'
          when expiry_date <= current_date + 60 then 'DAYS_31_60'
          when expiry_date <= current_date + 90 then 'DAYS_61_90' end as bucket,
        count(*)::text as batch_count, coalesce(sum(current_qty * cost_price), 0)::text as value_at_risk
      from inventory_batches where branch_id = ${branchId} and current_qty > 0 and deleted_at is null
        and expiry_date <= current_date + 90 group by bucket order by bucket
    `;
    return {
      facts,
      dataBasis: 'Current positive batch stock; value uses batch acquisition cost',
      reportPath: '/inventory?view=expiry',
    };
  }

  private async purchaseSuggestions(branchId: string, limit: number): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select medicines.name, suggestions.suggested_qty::text, suggestions.confidence,
        suggestions.expiry_risk_flag, suggestions.reason
      from reorder_suggestions suggestions join medicines on medicines.id = suggestions.medicine_id
      where suggestions.branch_id = ${branchId} and suggestions.status in ('GENERATED', 'REVIEWED')
      order by suggestions.generated_at desc limit ${limit}
    `;
    return {
      facts,
      dataBasis: 'Current deterministic reorder suggestions and saved reasoning inputs',
      reportPath: '/inventory?view=reorder',
    };
  }

  private async supplierPrices(branchId: string, medicineId?: string): Promise<ToolResult> {
    if (!medicineId) throw new Error('MEDICINE_ID_REQUIRED');
    const facts = await this.database<Array<Record<string, unknown>>>`
      select suppliers.name, round(quotes.quoted_unit_cost / quotes.base_units_per_quote_unit, 2)::text as effective_unit_cost,
        quotes.valid_from::text, quotes.valid_until::text, quotes.source
      from supplier_quotes quotes join suppliers on suppliers.id = quotes.supplier_id
      where quotes.branch_id = ${branchId} and quotes.medicine_id = ${medicineId}
        and quotes.valid_from <= current_date and (quotes.valid_until is null or quotes.valid_until >= current_date)
      order by effective_unit_cost, suppliers.name limit 20
    `;
    return {
      facts,
      dataBasis:
        'Current entered supplier quotes normalized to medicine base unit; price is not a supplier recommendation',
      reportPath: `/products/${medicineId}?view=suppliers`,
    };
  }

  private async shelfRecommendations(branchId: string, limit: number): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select medicines.name, recommendations.demand_class, recommendations.pick_count::text,
        current_shelf.name as current_location, suggested_shelf.name as suggested_location,
        recommendations.reason_snapshot
      from shelf_recommendations recommendations join medicines on medicines.id = recommendations.medicine_id
      left join shelves current_shelf on current_shelf.id = recommendations.current_shelf_id
      join shelves suggested_shelf on suggested_shelf.id = recommendations.suggested_shelf_id
      where recommendations.branch_id = ${branchId} and recommendations.status = 'PENDING_REVIEW'
      order by recommendations.demand_score desc limit ${limit}
    `;
    return {
      facts,
      dataBasis:
        'Pending deterministic shelf recommendations; no location changes have been applied',
      reportPath: '/inventory?view=shelf',
    };
  }

  private async returnsSummary(branchId: string, from: string, to: string): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select count(distinct returns.id)::text as return_count,
        coalesce(sum(return_items.refund_amount), 0)::text as requested_value,
        count(*) filter (where returns.status = 'REFUNDED')::text as refunded_item_lines
      from returns left join return_items on return_items.return_id = returns.id
      where returns.branch_id = ${branchId}
        and returns.created_at >= ${from}::date and returns.created_at < ${to}::date + interval '1 day'
    `;
    return {
      facts,
      dataBasis: `Linked return transactions from ${from} through ${to}`,
      reportPath: '/returns',
    };
  }

  private async cashSummary(branchId: string, from: string, to: string): Promise<ToolResult> {
    const facts = await this.database<Array<Record<string, unknown>>>`
      select count(*) filter (where status in ('CLOSED', 'VARIANCE_APPROVED'))::text as closed_sessions,
        coalesce(sum(expected_cash), 0)::text as expected_cash,
        coalesce(sum(counted_cash), 0)::text as counted_cash,
        coalesce(sum(variance), 0)::text as net_variance
      from cash_sessions where branch_id = ${branchId}
        and opened_at >= ${from}::date and opened_at < ${to}::date + interval '1 day'
    `;
    return {
      facts,
      dataBasis: `Recorded cash-session reconciliation from ${from} through ${to}`,
      reportPath: '/owner?report=cash',
    };
  }
}
