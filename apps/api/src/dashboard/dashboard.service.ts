import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import type { DashboardSnapshot } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async owner(user: AuthenticatedUser, date?: string) {
    const [snapshot] = await this.database<DashboardSnapshot[]>`
      select metric_date::text as "metricDate", net_sales::text as "netSales",
        gross_profit_estimate::text as "grossProfitEstimate",
        cash_collected::text as "cashCollected",
        non_cash_collected::text as "nonCashCollected", refunds::text,
        invoice_count::text as "invoiceCount",
        -- Snapshots written before the worker rounded these carried 11 decimal places.
        metrics || jsonb_strip_nulls(jsonb_build_object(
          'expiryValueAtRisk', round((metrics->>'expiryValueAtRisk')::numeric, 2)::text,
          'deadStockValue', round((metrics->>'deadStockValue')::numeric, 2)::text
        )) as metrics,
        updated_at as "updatedAt"
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
}
