import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';

import { retryDelaySeconds } from './backoff.js';
import { WorkerHeartbeat } from './heartbeat.js';

interface OutboxJob {
  readonly id: string;
  readonly job_type: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly max_attempts: number;
}

type JobOutcome =
  { readonly status: 'COMPLETED' } | { readonly status: 'RETRYABLE'; readonly error: string };

export class DurableWorker {
  private lastScheduleCheckAt = 0;

  constructor(
    private readonly database: Database,
    private readonly environment: Environment,
    private readonly heartbeat = new WorkerHeartbeat(environment.WORKER_HEALTH_FILE),
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    process.stdout.write(`Worker ${this.environment.WORKER_ID} started\n`);
    while (!signal.aborted) {
      try {
        if (Date.now() - this.lastScheduleCheckAt >= 60_000) {
          await this.runMaintenance();
        }
        const processed = await this.processNext();
        await this.heartbeat.touch(this.lastScheduleCheckAt === 0);
        if (!processed) await this.pause(750, signal);
      } catch (error) {
        this.reportError('worker loop', error);
        await this.pause(2_000, signal);
      }
    }
  }

  async processNext(): Promise<boolean> {
    const [job] = await this.database<OutboxJob[]>`
      select id::text, job_type, payload, attempts, max_attempts
      from claim_outbox_job(${this.environment.WORKER_ID})
    `;
    if (!job) return false;

    let attempt: { readonly id: string };
    try {
      const [recordedAttempt] = await this.database<Array<{ id: string }>>`
        insert into job_attempts (outbox_job_id, worker_id, attempt_number)
        values (${job.id}, ${this.environment.WORKER_ID}, ${job.attempts})
        returning id::text
      `;
      if (!recordedAttempt) throw new Error(`Could not record attempt for outbox job ${job.id}`);
      attempt = recordedAttempt;
    } catch (error) {
      await this.releaseClaimAfterAttemptFailure(job, error).catch((releaseError: unknown) => {
        this.reportError(`release outbox job ${job.id} after attempt-record failure`, releaseError);
      });
      throw error;
    }

    let outcome: JobOutcome;
    try {
      outcome = await this.handle(job);
    } catch (error) {
      outcome = {
        status: 'RETRYABLE',
        error: this.errorMessage(error),
      };
    }

    await this.database.begin(async (transaction) => {
      const exhausted = job.attempts >= job.max_attempts;
      if (outcome.status === 'COMPLETED') {
        await transaction`
          update outbox_jobs
          set status = 'COMPLETED', completed_at = now(), locked_at = null, locked_by = null
          where id = ${job.id} and locked_by = ${this.environment.WORKER_ID}
        `;
      } else {
        const delay = retryDelaySeconds(job.attempts);
        await transaction`
          update outbox_jobs
          set status = ${exhausted ? 'FAILED' : 'RETRYABLE'},
              available_at = now() + ${delay} * interval '1 second',
              last_error = ${outcome.error}, locked_at = null, locked_by = null
          where id = ${job.id} and locked_by = ${this.environment.WORKER_ID}
        `;
      }
      await transaction`
        update job_attempts
        set finished_at = now(), outcome = ${outcome.status === 'COMPLETED' ? 'COMPLETED' : exhausted ? 'FAILED' : 'RETRYABLE'},
            error_message = ${outcome.status === 'RETRYABLE' ? outcome.error : null}
        where id = ${attempt.id}
      `;
    });
    return true;
  }

  private async handle(job: OutboxJob): Promise<JobOutcome> {
    switch (job.job_type) {
      case 'FBR_SUBMIT':
        return this.handleFbrSubmission(job);
      case 'EXPIRE_RESERVATIONS':
        await this.expireReservations();
        return { status: 'COMPLETED' };
      case 'REFRESH_DASHBOARD_METRICS':
        await this.runTracked(job, () =>
          this.refreshDashboardMetrics(String(job.payload.branchId)),
        );
        return { status: 'COMPLETED' };
      case 'SNAPSHOT_INVENTORY_AVAILABILITY':
        await this.runTracked(job, () =>
          this.snapshotInventoryAvailability(String(job.payload.branchId)),
        );
        return { status: 'COMPLETED' };
      case 'REFRESH_EXPIRY_RISK':
        await this.runTracked(job, () => this.refreshExpiryRisk(String(job.payload.branchId)));
        return { status: 'COMPLETED' };
      case 'REFRESH_REORDER_SUGGESTIONS':
        await this.runTracked(job, () =>
          this.refreshReorderSuggestions(String(job.payload.branchId)),
        );
        return { status: 'COMPLETED' };
      case 'REFRESH_SHELF_RECOMMENDATIONS':
        await this.runTracked(job, () =>
          this.refreshShelfRecommendations(String(job.payload.branchId)),
        );
        return { status: 'COMPLETED' };
      case 'FBR_RETURN':
        return this.handleFbrReturn(job);
      default:
        throw new Error(`Unsupported job type: ${job.job_type}`);
    }
  }

  private async handleFbrSubmission(job: OutboxJob): Promise<JobOutcome> {
    const invoiceId = job.payload.fbrInvoiceId;
    if (typeof invoiceId !== 'string' && typeof invoiceId !== 'number') {
      return { status: 'RETRYABLE', error: 'FBR job is missing fbrInvoiceId' };
    }

    if (this.environment.FBR_MODE === 'DISABLED') {
      await this.database`
        update fbr_invoices set status = 'NOT_REQUIRED', last_error_code = null, last_error_message = null
        where id = ${String(invoiceId)}
      `;
      return { status: 'COMPLETED' };
    }

    if (this.environment.FBR_MODE === 'SANDBOX') {
      await this.database`
        update fbr_invoices
        set status = 'SUBMITTED', fiscal_invoice_number = concat('SANDBOX-', id), submitted_at = now(),
            last_error_code = null, last_error_message = null
        where id = ${String(invoiceId)}
      `;
      return { status: 'COMPLETED' };
    }

    return {
      status: 'RETRYABLE',
      error: `FBR adapter ${this.environment.FBR_MODE} is not configured`,
    };
  }

  private async handleFbrReturn(job: OutboxJob): Promise<JobOutcome> {
    const invoiceId = job.payload.fbrInvoiceId;
    if (typeof invoiceId !== 'string' && typeof invoiceId !== 'number') {
      return { status: 'RETRYABLE', error: 'FBR return job is missing fbrInvoiceId' };
    }
    if (this.environment.FBR_MODE === 'DISABLED' || this.environment.FBR_MODE === 'SANDBOX') {
      await this.database`
        update fbr_invoices set status = ${this.environment.FBR_MODE === 'DISABLED' ? 'NOT_REQUIRED' : 'SUBMITTED'},
          last_error_code = null, last_error_message = null
        where id = ${String(invoiceId)}
      `;
      return { status: 'COMPLETED' };
    }
    return {
      status: 'RETRYABLE',
      error: `FBR return adapter ${this.environment.FBR_MODE} is not configured`,
    };
  }

  private async enqueueOperationalJobs(): Promise<void> {
    const minute = new Date().toISOString().slice(0, 16);
    await this.database`
      insert into outbox_jobs (job_type, deduplication_key, payload, priority)
      values ('EXPIRE_RESERVATIONS', ${`reservation-expiry:${minute}`}, '{}'::jsonb, 20)
      on conflict (job_type, deduplication_key) where deduplication_key is not null do nothing
    `;

    const branches = await this.database<Array<{ id: string; local_date: string }>>`
      select id::text, (now() at time zone timezone)::date::text as local_date
      from branches where is_active = true order by id
    `;
    for (const branch of branches) {
      const date = branch.local_date;
      const week = `${date.slice(0, 4)}-W${this.isoWeek(date).toString().padStart(2, '0')}`;
      const hour = new Date().toISOString().slice(0, 13);
      const jobs = [
        ['REFRESH_DASHBOARD_METRICS', `dashboard:${branch.id}:${hour}`, hour, 30],
        ['SNAPSHOT_INVENTORY_AVAILABILITY', `availability:${branch.id}:${date}`, date, 40],
        ['REFRESH_EXPIRY_RISK', `expiry:${branch.id}:${date}`, date, 50],
        ['REFRESH_REORDER_SUGGESTIONS', `reorder:${branch.id}:${date}`, date, 60],
        ['REFRESH_SHELF_RECOMMENDATIONS', `shelf:${branch.id}:${week}`, week, 80],
      ] as const;
      for (const [jobType, deduplicationKey, runKey, priority] of jobs) {
        await this.database`
          insert into outbox_jobs (job_type, deduplication_key, payload, priority)
          values (
            ${jobType}, ${deduplicationKey},
            ${this.database.json({ branchId: branch.id, runKey })}, ${priority}
          )
          on conflict (job_type, deduplication_key) where deduplication_key is not null do nothing
        `;
      }
    }
  }

  private isoWeek(date: string): number {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  }

  private async runTracked(
    job: OutboxJob,
    operation: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const branchId = String(job.payload.branchId);
    const rawRunKey = job.payload.runKey;
    const runKey =
      typeof rawRunKey === 'string' || typeof rawRunKey === 'number' ? String(rawRunKey) : job.id;
    const [run] = await this.database<Array<{ id: string }>>`
      insert into scheduled_job_runs (branch_id, job_name, run_key, status)
      values (${branchId}, ${job.job_type}, ${runKey}, 'RUNNING')
      on conflict (job_name, run_key) do update
        set status = 'RUNNING', started_at = now(), finished_at = null,
          duration_ms = null, last_error = null
      returning id::text
    `;
    if (!run) throw new Error('Could not record scheduled job run');
    const started = Date.now();
    try {
      const summary = await operation();
      await this.database`
        update scheduled_job_runs set status = 'SUCCEEDED', finished_at = now(),
          duration_ms = ${Date.now() - started}, result_summary = ${JSON.stringify(summary)}::jsonb
        where id = ${run.id}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scheduled job failure';
      await this.database`
        update scheduled_job_runs set status = 'FAILED', finished_at = now(),
          duration_ms = ${Date.now() - started}, last_error = ${message}
        where id = ${run.id}
      `;
      throw error;
    }
  }

  private async snapshotInventoryAvailability(branchId: string): Promise<Record<string, unknown>> {
    const rows = await this.database<Array<{ medicine_id: string }>>`
      insert into inventory_availability_daily (
        branch_id, medicine_id, availability_date, had_sellable_stock, closing_sellable_qty
      )
      select ${branchId}, medicines.id, (now() at time zone branches.timezone)::date,
        coalesce(stock.quantity, 0) > 0, coalesce(stock.quantity, 0)
      from medicines cross join branches
      left join lateral (
        select sum(current_qty) quantity from inventory_batches
        where inventory_batches.branch_id = branches.id
          and inventory_batches.medicine_id = medicines.id
          and inventory_batches.status = 'SELLABLE' and inventory_batches.deleted_at is null
          and inventory_batches.expiry_date >= (now() at time zone branches.timezone)::date
      ) stock on true
      where branches.id = ${branchId} and medicines.is_active and medicines.deleted_at is null
      on conflict (branch_id, medicine_id, availability_date) do update
        set had_sellable_stock = excluded.had_sellable_stock,
          closing_sellable_qty = excluded.closing_sellable_qty, updated_at = now()
      returning medicine_id::text
    `;
    return { medicinesSnapshotted: rows.length };
  }

  private async refreshDashboardMetrics(branchId: string): Promise<Record<string, unknown>> {
    const [snapshot] = await this.database<Array<{ metric_date: string }>>`
      with branch_clock as (
        select id, timezone, (now() at time zone timezone)::date as metric_date,
          ((now() at time zone timezone)::date::timestamp at time zone timezone) as start_at,
          (((now() at time zone timezone)::date + 1)::timestamp at time zone timezone) as end_at
        from branches where id = ${branchId}
      ), day_sales as (
        select coalesce(sum(sales.total), 0) as gross_sales, count(sales.id) as invoice_count,
          coalesce(sum(costs.cost_basis), 0) as cost_basis
        from branch_clock left join sales on sales.branch_id = branch_clock.id
          and sales.status <> 'VOIDED' and sales.created_at >= branch_clock.start_at
          and sales.created_at < branch_clock.end_at
        left join lateral (
          select coalesce(sum(sale_items.unit_cost * sale_items.quantity), 0) as cost_basis
          from sale_items where sale_items.sale_id = sales.id
        ) costs on true
      ), day_payments as (
        select
          coalesce(sum(payments.amount) filter (where payments.method = 'CASH'), 0) as cash_sales,
          coalesce(sum(payments.amount) filter (
            where payments.method in ('CARD', 'BANK_TRANSFER')
          ), 0) as non_cash_sales
        from branch_clock left join sales on sales.branch_id = branch_clock.id
          and sales.status <> 'VOIDED' and sales.created_at >= branch_clock.start_at
          and sales.created_at < branch_clock.end_at
        left join payments on payments.sale_id = sales.id and payments.status = 'CAPTURED'
      ), account_payments as (
        select
          coalesce(-sum(entries.amount_delta) filter (where entries.payment_method = 'CASH'), 0)
            as cash_accounts,
          coalesce(-sum(entries.amount_delta) filter (
            where entries.payment_method in ('CARD', 'BANK_TRANSFER')
          ), 0) as non_cash_accounts
        from branch_clock left join customer_ledger_entries entries
          on entries.branch_id = branch_clock.id and entries.entry_type = 'PAYMENT'
          and entries.created_at >= branch_clock.start_at and entries.created_at < branch_clock.end_at
      ), day_refunds as (
        select coalesce(sum(refunds.amount), 0) as total,
          coalesce(sum(refunds.amount) filter (where refunds.method = 'CASH'), 0) as cash,
          coalesce(sum(refunds.amount) filter (
            where refunds.method in ('CARD', 'BANK_TRANSFER')
          ), 0) as non_cash
        from branch_clock left join returns on returns.branch_id = branch_clock.id
          and returns.created_at >= branch_clock.start_at and returns.created_at < branch_clock.end_at
        left join refunds on refunds.return_id = returns.id
      ), latest_balances as (
        select distinct on (entries.customer_id) entries.balance_after
        from customer_ledger_entries entries
        where entries.branch_id = ${branchId} order by entries.customer_id, entries.id desc
      ), inventory_metrics as (
        select coalesce(sum(batches.current_qty * batches.cost_price) filter (
            where batches.current_qty > 0 and batches.expiry_date <= branch_clock.metric_date + 90
          ), 0) as expiry_risk,
          coalesce(sum(batches.current_qty * batches.cost_price) filter (
            where batches.current_qty > 0 and not exists (
              select 1 from sale_items join sales on sales.id = sale_items.sale_id
              where sale_items.inventory_batch_id = batches.id
                and sales.created_at >= branch_clock.start_at - interval '90 days'
            )
          ), 0) as dead_stock
        from branch_clock left join inventory_batches batches on batches.branch_id = branch_clock.id
          and batches.deleted_at is null
      ), top_movers as (
        select coalesce(jsonb_agg(jsonb_build_object(
          'medicineId', ranked.medicine_id, 'name', ranked.name,
          'quantity', ranked.quantity, 'netSales', ranked.net_sales
        ) order by ranked.quantity desc, ranked.medicine_id), '[]'::jsonb) as items
        from (
          select medicines.id::text as medicine_id, medicines.name,
            sum(sale_items.quantity)::text as quantity,
            sum(sale_items.line_total)::text as net_sales
          from branch_clock join sales on sales.branch_id = branch_clock.id
            and sales.status <> 'VOIDED' and sales.created_at >= branch_clock.start_at
            and sales.created_at < branch_clock.end_at
          join sale_items on sale_items.sale_id = sales.id
          join medicines on medicines.id = sale_items.medicine_id
          group by medicines.id, medicines.name
          order by sum(sale_items.quantity) desc, medicines.id limit 5
        ) ranked
      ), operational as (
        select
          (select count(*)::int from reorder_policies policies
            left join lateral (select coalesce(sum(current_qty), 0) quantity
              from inventory_batches where branch_id = policies.branch_id
                and medicine_id = policies.medicine_id and status = 'SELLABLE'
                and deleted_at is null) stock on true
            where policies.branch_id = ${branchId} and policies.is_active
              and stock.quantity <= policies.minimum_stock) as low_stock_count,
          (select count(*)::int from fbr_invoices join sales on sales.id = fbr_invoices.sale_id
            where sales.branch_id = ${branchId}
              and fbr_invoices.status in ('FAILED_RETRYABLE', 'FAILED_NEEDS_REVIEW'))
            as failed_fiscal,
          (select coalesce(sum(variance), 0)::text from cash_sessions
            cross join branch_clock where cash_sessions.branch_id = ${branchId}
              and cash_sessions.opened_at >= branch_clock.start_at
              and cash_sessions.opened_at < branch_clock.end_at) as cash_variance,
          (select to_jsonb(run) from (
            select id::text, backup_type as "backupType", finished_at as "finishedAt",
              size_bytes::text as "sizeBytes", checksum
            from backup_runs where status = 'SUCCEEDED' and backup_type <> 'RESTORE_DRILL'
              and (branch_id = ${branchId} or branch_id is null)
            order by finished_at desc nulls last, id desc limit 1
          ) run) as last_backup,
          (select to_jsonb(run) from (
            select id::text, finished_at as "finishedAt", destination
            from backup_runs where status = 'SUCCEEDED' and backup_type = 'RESTORE_DRILL'
              and (branch_id = ${branchId} or branch_id is null)
            order by finished_at desc nulls last, id desc limit 1
          ) run) as last_restore
      )
      insert into dashboard_daily_metrics (
        branch_id, metric_date, net_sales, gross_profit_estimate, cash_collected,
        non_cash_collected, refunds, invoice_count, metrics, updated_at
      )
      select ${branchId}, branch_clock.metric_date,
        day_sales.gross_sales - day_refunds.total,
        day_sales.gross_sales - day_sales.cost_basis - day_refunds.total,
        day_payments.cash_sales + account_payments.cash_accounts - day_refunds.cash,
        day_payments.non_cash_sales + account_payments.non_cash_accounts - day_refunds.non_cash,
        day_refunds.total, day_sales.invoice_count,
        jsonb_build_object(
          'receivables', (select coalesce(sum(balance_after), 0)::text from latest_balances),
          'expiryValueAtRisk', inventory_metrics.expiry_risk::text,
          'lowStockCount', operational.low_stock_count,
          'failedFiscalSubmissions', operational.failed_fiscal,
          'netCashVariance', operational.cash_variance,
          'deadStockValue', inventory_metrics.dead_stock::text,
          'topMovers', top_movers.items,
          'lastSuccessfulBackup', operational.last_backup,
          'lastRestoreDrill', operational.last_restore
        ), now()
      from branch_clock cross join day_sales cross join day_payments
      cross join account_payments cross join day_refunds cross join inventory_metrics
      cross join top_movers cross join operational
      on conflict (branch_id, metric_date) do update set
        net_sales = excluded.net_sales,
        gross_profit_estimate = excluded.gross_profit_estimate,
        cash_collected = excluded.cash_collected,
        non_cash_collected = excluded.non_cash_collected,
        refunds = excluded.refunds,
        invoice_count = excluded.invoice_count,
        metrics = excluded.metrics,
        updated_at = now()
      returning metric_date::text
    `;
    if (!snapshot) throw new Error(`Branch ${branchId} does not exist`);
    return { metricDate: snapshot.metric_date };
  }

  private async refreshExpiryRisk(branchId: string): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const rows = await transaction<Array<{ id: string }>>`
        insert into expiry_work_items (
          branch_id, inventory_batch_id, risk_bucket, quantity_snapshot,
          value_at_risk, snapshot_date
        )
        select inventory_batches.branch_id, inventory_batches.id,
          case
            when inventory_batches.expiry_date < local_date then 'EXPIRED'
            when inventory_batches.expiry_date <= local_date + policies.expiry_critical_days then 'DAYS_0_30'
            when inventory_batches.expiry_date <= local_date + policies.expiry_high_days then 'DAYS_31_60'
            else 'DAYS_61_90'
          end,
          inventory_batches.current_qty,
          round(inventory_batches.current_qty * inventory_batches.cost_price, 2),
          local_date
        from inventory_batches
        join branches on branches.id = inventory_batches.branch_id
        join operational_intelligence_policies policies on policies.branch_id = branches.id
        cross join lateral (select (now() at time zone branches.timezone)::date local_date) dates
        where inventory_batches.branch_id = ${branchId}
          and inventory_batches.current_qty > 0 and inventory_batches.deleted_at is null
          and inventory_batches.expiry_date <= local_date + policies.expiry_moderate_days
        on conflict (branch_id, inventory_batch_id) where status in ('OPEN', 'REVIEWED')
        do update set risk_bucket = excluded.risk_bucket,
          quantity_snapshot = excluded.quantity_snapshot,
          value_at_risk = excluded.value_at_risk,
          snapshot_date = excluded.snapshot_date
        returning id::text
      `;
      const resolved = await transaction<Array<{ id: string }>>`
        update expiry_work_items set status = 'RESOLVED', action = 'RESOLVED', acted_at = now(),
          action_notes = 'Automatically resolved because the batch is depleted or outside the configured risk window'
        where branch_id = ${branchId} and status in ('OPEN', 'REVIEWED')
          and not exists (
            select 1 from inventory_batches join operational_intelligence_policies policies
              on policies.branch_id = inventory_batches.branch_id
            join branches on branches.id = inventory_batches.branch_id
            where inventory_batches.id = expiry_work_items.inventory_batch_id
              and inventory_batches.current_qty > 0 and inventory_batches.deleted_at is null
              and inventory_batches.expiry_date <=
                (now() at time zone branches.timezone)::date + policies.expiry_moderate_days
          ) returning id::text
      `;
      return { workItemsRefreshed: rows.length, workItemsResolved: resolved.length };
    });
  }

  private async refreshShelfRecommendations(branchId: string): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await transaction`
        update shelf_recommendations set status = 'SUPERSEDED', reviewed_at = now(),
          review_notes = 'Superseded by a newer deterministic scoring run'
        where branch_id = ${branchId} and status = 'PENDING_REVIEW'
      `;
      const rows = await transaction<Array<{ id: string }>>`
        with demand as (
          select sale_items.medicine_id,
            count(distinct sale_items.id) as pick_count,
            sum(sale_items.quantity) as units_sold,
            count(distinct sale_items.id) * 0.6 + sum(sale_items.quantity) * 0.4 as demand_score
          from sale_items join sales on sales.id = sale_items.sale_id
          join branches on branches.id = sales.branch_id
          join operational_intelligence_policies policies on policies.branch_id = sales.branch_id
          where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
            and sales.created_at >= (
              (now() at time zone branches.timezone)::date - policies.shelf_lookback_days
            )::timestamp at time zone branches.timezone
          group by sale_items.medicine_id
        ), ranked as (
          select demand.*, percent_rank() over (order by demand_score desc) percentile
          from demand
        ), candidates as (
          select ranked.*, medicines.storage_class, medicines.requires_secured_storage,
            current_location.shelf_id as current_shelf_id,
            current_location.pick_priority as current_priority,
            suggested.id as suggested_shelf_id,
            suggested.pick_priority as suggested_priority,
            policies.shelf_lookback_days, policies.shelf_minimum_picks,
            policies.shelf_minimum_rank_improvement
          from ranked join medicines on medicines.id = ranked.medicine_id
          join operational_intelligence_policies policies on policies.branch_id = ${branchId}
          left join lateral (
            select shelves.id as shelf_id, shelves.pick_priority
            from medicine_shelf_locations locations join shelves on shelves.id = locations.shelf_id
            where locations.medicine_id = ranked.medicine_id and locations.is_primary
            order by shelves.pick_priority, shelves.id limit 1
          ) current_location on true
          join lateral (
            select shelves.id, shelves.pick_priority from shelves
            where shelves.branch_id = ${branchId} and shelves.is_active and shelves.is_pick_location
              and shelves.storage_class = medicines.storage_class
              and (not medicines.requires_secured_storage or shelves.is_secured)
            order by shelves.pick_priority, shelves.id limit 1
          ) suggested on true
        )
        insert into shelf_recommendations (
          branch_id, medicine_id, current_shelf_id, suggested_shelf_id,
          confidence, demand_class, demand_score, pick_count, units_sold,
          current_pick_priority, suggested_pick_priority, reason_snapshot, generated_for_date
        )
        select ${branchId}, medicine_id, current_shelf_id, suggested_shelf_id,
          case when pick_count < shelf_minimum_picks then 'LOW'
            when pick_count >= shelf_minimum_picks * 3 then 'HIGH' else 'MEDIUM' end,
          case when pick_count < shelf_minimum_picks then 'LOW_CONFIDENCE'
            when percentile <= 0.2 then 'A' when percentile <= 0.5 then 'B' else 'C' end,
          demand_score, pick_count, units_sold, current_priority, suggested_priority,
          jsonb_build_object(
            'lookbackDays', shelf_lookback_days, 'pickCount', pick_count,
            'unitsSold', units_sold, 'storageClass', storage_class,
            'securedStorageRequired', requires_secured_storage,
            'currentPriority', current_priority, 'suggestedPriority', suggested_priority
          ), (now() at time zone (
            select timezone from branches where id = ${branchId}
          ))::date
        from candidates
        where current_shelf_id is null
          or current_priority - suggested_priority >= shelf_minimum_rank_improvement
        returning id::text
      `;
      return { recommendationsGenerated: rows.length };
    });
  }

  private async refreshReorderSuggestions(branchId: string): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await transaction`
        insert into sales_velocity_daily (branch_id, medicine_id, sales_date, quantity_sold, net_sales)
        select sales.branch_id, sale_items.medicine_id,
          (sales.created_at at time zone branches.timezone)::date,
          sum(sale_items.quantity), sum(sale_items.line_total)
        from sale_items join sales on sales.id = sale_items.sale_id
        join branches on branches.id = sales.branch_id
        where sales.branch_id = ${branchId} and sales.status <> 'VOIDED'
          and sales.created_at >= (
            (now() at time zone branches.timezone)::date - 366
          )::timestamp at time zone branches.timezone
        group by sales.branch_id, sale_items.medicine_id,
          (sales.created_at at time zone branches.timezone)::date
        on conflict (branch_id, medicine_id, sales_date) do update
          set quantity_sold = excluded.quantity_sold, net_sales = excluded.net_sales, updated_at = now()
      `;
      await transaction`
        update reorder_suggestions set status = 'SUPERSEDED'
        where branch_id = ${branchId} and status in ('GENERATED', 'REVIEWED')
      `;
      const rows = await transaction<Array<{ id: string }>>`
        with inputs as (
          select policies.*, branches.timezone as branch_timezone,
            greatest(policies.lookback_days - coalesce(availability.stockout_days, 0), 1) as eligible_days,
            coalesce(availability.stockout_days, 0) as stockout_days,
            coalesce(demand.fulfilled_units, 0) as fulfilled_units,
            coalesce(stock.sellable_stock, 0) as sellable_stock,
            coalesce(stock.reserved_stock, 0) as reserved_stock,
            observed.observed_lead_time_days,
            coalesce(observed.observed_lead_time_days, policies.lead_time_days) as effective_lead_time,
            coalesce(stock.near_expiry_stock, 0) as near_expiry_stock
          from reorder_policies policies
          join branches on branches.id = policies.branch_id
          left join lateral (
            select count(*) filter (where not had_sellable_stock)::int stockout_days
            from inventory_availability_daily
            where branch_id = policies.branch_id and medicine_id = policies.medicine_id
              and availability_date >=
                (now() at time zone branches.timezone)::date - policies.lookback_days
          ) availability on true
          left join lateral (
            select sum(quantity_sold) fulfilled_units from sales_velocity_daily
            where branch_id = policies.branch_id and medicine_id = policies.medicine_id
              and sales_date >=
                (now() at time zone branches.timezone)::date - policies.lookback_days
          ) demand on true
          left join lateral (
            select sum(current_qty) filter (
                where status = 'SELLABLE'
                  and expiry_date >= (now() at time zone branches.timezone)::date
              ) sellable_stock,
              sum(current_qty) filter (
                where status = 'SELLABLE' and expiry_date between
                  (now() at time zone branches.timezone)::date
                  and (now() at time zone branches.timezone)::date + 90
              ) near_expiry_stock,
              (select coalesce(sum(reservations.quantity), 0)
                from stock_reservations reservations join sale_draft_items draft_items
                  on draft_items.id = reservations.sale_draft_item_id
                join sale_drafts drafts on drafts.id = draft_items.sale_draft_id
                where drafts.branch_id = policies.branch_id
                  and draft_items.medicine_id = policies.medicine_id
                  and reservations.status = 'ACTIVE' and reservations.expires_at > now()) reserved_stock
            from inventory_batches where branch_id = policies.branch_id
              and medicine_id = policies.medicine_id and deleted_at is null
          ) stock on true
          left join lateral (
            select round(avg(extract(epoch from (received_at - ordered_at)) / 86400))::int observed_lead_time_days
            from purchase_orders join purchase_order_items on purchase_order_items.purchase_order_id = purchase_orders.id
            where purchase_orders.branch_id = policies.branch_id
              and purchase_order_items.medicine_id = policies.medicine_id
              and purchase_orders.ordered_at is not null and purchase_orders.received_at is not null
          ) observed on true
          where policies.branch_id = ${branchId} and policies.is_active
        ), calculated as (
          select inputs.*,
            fulfilled_units / eligible_days as average_daily,
            (fulfilled_units / eligible_days) * safety_days as safety_stock,
            greatest(
              (fulfilled_units / eligible_days) * effective_lead_time
                + (fulfilled_units / eligible_days) * safety_days,
              minimum_stock
            ) as calculated_reorder_point,
            greatest(
              (fulfilled_units / eligible_days) * target_coverage_days
                + (fulfilled_units / eligible_days) * safety_days,
              minimum_stock
            ) as calculated_target
          from inputs
        ), quantities as (
          select calculated.*,
            greatest(calculated_target - greatest(sellable_stock - reserved_stock, 0), 0) raw_qty
          from calculated
        )
        insert into reorder_suggestions (
          branch_id, medicine_id, policy_id, status, average_daily_sales,
          current_sellable_stock, reserved_stock, reorder_point, suggested_qty, reason,
          expires_at, eligible_demand_days, stockout_days, observed_lead_time_days,
          effective_lead_time_days, safety_stock, target_stock, minimum_order_qty,
          order_multiple, confidence, expiry_risk_flag
        )
        select branch_id, medicine_id, id, 'GENERATED', round(average_daily, 3),
          sellable_stock, reserved_stock, round(calculated_reorder_point, 3),
          ceil(greatest(raw_qty, minimum_order_qty) / order_multiple) * order_multiple,
          jsonb_build_object(
            'lookbackDays', lookback_days, 'fulfilledUnits', fulfilled_units,
            'eligibleDemandDays', eligible_days, 'stockoutDays', stockout_days,
            'leadTimeSource', case when observed_lead_time_days is null then 'POLICY_FALLBACK' else 'OBSERVED' end,
            'safetyDays', safety_days, 'targetCoverageDays', target_coverage_days,
            'netAvailableUnits', greatest(sellable_stock - reserved_stock, 0),
            'nearExpiryStock', near_expiry_stock
          ), (now() at time zone branch_timezone)::date + 2,
          eligible_days, stockout_days, observed_lead_time_days,
          effective_lead_time, round(safety_stock, 3), round(calculated_target, 3),
          minimum_order_qty, order_multiple,
          case when fulfilled_units = 0 or eligible_days < 14
              or stockout_days > lookback_days / 3 then 'LOW'
            when eligible_days >= 60 and stockout_days = 0 then 'HIGH' else 'MEDIUM' end,
          near_expiry_stock > calculated_reorder_point
        from quantities where raw_qty > 0
        returning id::text
      `;
      return { suggestionsGenerated: rows.length };
    });
  }

  private async expireReservations(): Promise<void> {
    await this.database.begin(async (transaction) => {
      const expired = await transaction<Array<{ sale_draft_item_id: string }>>`
        update stock_reservations
        set status = 'EXPIRED', released_at = now()
        where id in (
          select id from stock_reservations
          where status = 'ACTIVE' and expires_at <= now()
          order by id for update skip locked
        )
        returning sale_draft_item_id::text
      `;
      if (expired.length > 0) {
        const itemIds = expired.map((row) => row.sale_draft_item_id);
        await transaction`
          update sale_drafts
          set status = 'EXPIRED'
          where id in (select distinct sale_draft_id from sale_draft_items where id in ${transaction(itemIds)})
            and status = 'RESERVED'
        `;
      }
    });
  }

  private async runMaintenance(): Promise<void> {
    try {
      const reclaimed = await this.reclaimStaleJobs();
      if (reclaimed > 0) {
        process.stderr.write(`Reclaimed ${reclaimed} stale outbox job(s)\n`);
      }
    } catch (error) {
      this.reportError('stale outbox-job reaper', error);
    }

    try {
      await this.enqueueOperationalJobs();
    } catch (error) {
      this.reportError('operational job scheduler', error);
    } finally {
      this.lastScheduleCheckAt = Date.now();
    }
  }

  private async reclaimStaleJobs(): Promise<number> {
    return this.database.begin(async (transaction) => {
      const staleJobs = await transaction<Array<{ id: string }>>`
        select id::text
        from outbox_jobs
        where status = 'PROCESSING' and locked_at < now() - interval '5 minutes'
        order by locked_at, id
        limit 100
        for update skip locked
      `;
      if (staleJobs.length === 0) return 0;

      const jobIds = staleJobs.map((job) => job.id);
      await transaction`
        update outbox_jobs
        set status = case when attempts >= max_attempts then 'FAILED' else 'RETRYABLE' end,
            available_at = now(), locked_at = null, locked_by = null,
            last_error = concat_ws(E'\n', nullif(last_error, ''), 'Worker lock expired after 5 minutes')
        where id in ${transaction(jobIds)}
      `;
      await transaction`
        update job_attempts attempts
        set finished_at = now(),
            outcome = case when jobs.attempts >= jobs.max_attempts then 'FAILED' else 'RETRYABLE' end,
            error_message = 'Worker lock expired after 5 minutes'
        from outbox_jobs jobs
        where attempts.outbox_job_id = jobs.id
          and attempts.outbox_job_id in ${transaction(jobIds)}
          and attempts.finished_at is null
      `;
      return staleJobs.length;
    });
  }

  private async releaseClaimAfterAttemptFailure(job: OutboxJob, error: unknown): Promise<void> {
    const exhausted = job.attempts >= job.max_attempts;
    await this.database`
      update outbox_jobs
      set status = ${exhausted ? 'FAILED' : 'RETRYABLE'}, available_at = now(),
          locked_at = null, locked_by = null,
          last_error = ${`Could not record worker attempt: ${this.errorMessage(error)}`}
      where id = ${job.id} and status = 'PROCESSING'
        and locked_by = ${this.environment.WORKER_ID}
    `;
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : 'Unknown worker failure').slice(0, 4_000);
  }

  private reportError(context: string, error: unknown): void {
    process.stderr.write(`[worker] ${context} failed: ${this.errorMessage(error)}\n`);
  }

  private pause(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }
}
