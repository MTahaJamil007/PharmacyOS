import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import type {
  BackupOverview,
  BackupRunSummary,
  FiscalInvoiceAttempt,
  FiscalInvoiceStatus,
  FiscalInvoiceSummary,
  FiscalOverview,
  RetryFiscalInvoiceRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE, ENVIRONMENT } from '../database.module.js';

const FISCAL_STATUSES: readonly FiscalInvoiceStatus[] = [
  'NOT_REQUIRED',
  'PENDING',
  'VALIDATING',
  'VALIDATED',
  'SUBMITTING',
  'SUBMITTED',
  'FAILED_RETRYABLE',
  'FAILED_NEEDS_REVIEW',
  'VOID_OR_CREDIT_NOTE_PENDING',
];

/**
 * A retry may only be requested for a record that stopped in a failed state and never
 * obtained an official invoice number. Anything already carrying a fiscal number is
 * treated as submitted, because a blind resubmission can create a duplicate fiscal
 * invoice — the ambiguity rule recorded in ADR 0004.
 */
const RETRYABLE_STATUSES: readonly FiscalInvoiceStatus[] = [
  'FAILED_RETRYABLE',
  'FAILED_NEEDS_REVIEW',
];

interface InvoiceRow {
  readonly id: string;
  readonly sale_id: string;
  readonly invoice_number: string;
  readonly mode: string;
  readonly status: FiscalInvoiceStatus;
  readonly fiscal_invoice_number: string | null;
  readonly submitted_at: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly attempt_count: number;
  readonly total: string;
  readonly sale_created_at: string;
  readonly updated_at: string;
}

interface BackupRunRow {
  readonly id: string;
  readonly backup_type: BackupRunSummary['backupType'];
  readonly status: BackupRunSummary['status'];
  readonly destination: string;
  readonly encrypted: boolean;
  readonly size_bytes: string | null;
  readonly checksum: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly duration_seconds: number | null;
  readonly error_message: string | null;
}

function toInvoice(row: InvoiceRow): FiscalInvoiceSummary {
  return {
    id: row.id,
    saleId: row.sale_id,
    invoiceNumber: row.invoice_number,
    mode: row.mode,
    status: row.status,
    fiscalInvoiceNumber: row.fiscal_invoice_number,
    submittedAt: row.submitted_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    attemptCount: row.attempt_count,
    total: row.total,
    saleCreatedAt: row.sale_created_at,
    updatedAt: row.updated_at,
    retryable: RETRYABLE_STATUSES.includes(row.status) && row.fiscal_invoice_number === null,
  };
}

function toBackupRun(row: BackupRunRow): BackupRunSummary {
  return {
    id: row.id,
    backupType: row.backup_type,
    status: row.status,
    destination: row.destination,
    encrypted: row.encrypted,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationSeconds: row.duration_seconds,
    errorMessage: row.error_message,
  };
}

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async overview(
    user: AuthenticatedUser,
    status: FiscalInvoiceStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<FiscalOverview> {
    const [counts, invoices] = await Promise.all([
      this.database<Array<{ status: FiscalInvoiceStatus; total: number }>>`
        select fbr_invoices.status, count(*)::int as total
        from fbr_invoices
        join sales on sales.id = fbr_invoices.sale_id
        where sales.branch_id = ${user.branchId}
        group by fbr_invoices.status
      `,
      this.database<InvoiceRow[]>`
        select fbr_invoices.id::text, fbr_invoices.sale_id::text, sales.invoice_number,
          fbr_invoices.mode, fbr_invoices.status, fbr_invoices.fiscal_invoice_number,
          fbr_invoices.submitted_at::text, fbr_invoices.last_error_code,
          fbr_invoices.last_error_message, sales.total::text,
          sales.created_at::text as sale_created_at, fbr_invoices.updated_at::text,
          (select count(*)::int from fbr_invoice_attempts
            where fbr_invoice_attempts.fbr_invoice_id = fbr_invoices.id) as attempt_count
        from fbr_invoices
        join sales on sales.id = fbr_invoices.sale_id
        where sales.branch_id = ${user.branchId}
          and (${status ?? null}::text is null or fbr_invoices.status = ${status ?? null})
        order by fbr_invoices.updated_at desc, fbr_invoices.id desc
        limit ${limit} offset ${offset}
      `,
    ]);

    const tally = Object.fromEntries(
      FISCAL_STATUSES.map((value) => [
        value,
        counts.find((row) => row.status === value)?.total ?? 0,
      ]),
    ) as Record<FiscalInvoiceStatus, number>;

    return {
      mode: this.environment.FBR_MODE,
      outboundEnabled: this.environment.FBR_MODE !== 'DISABLED',
      counts: tally,
      invoices: invoices.map(toInvoice),
    };
  }

  async attempts(
    user: AuthenticatedUser,
    fiscalInvoiceId: bigint,
  ): Promise<{
    readonly invoice: FiscalInvoiceSummary;
    readonly attempts: readonly FiscalInvoiceAttempt[];
  }> {
    const [invoice] = await this.database<InvoiceRow[]>`
      select fbr_invoices.id::text, fbr_invoices.sale_id::text, sales.invoice_number,
        fbr_invoices.mode, fbr_invoices.status, fbr_invoices.fiscal_invoice_number,
        fbr_invoices.submitted_at::text, fbr_invoices.last_error_code,
        fbr_invoices.last_error_message, sales.total::text,
        sales.created_at::text as sale_created_at, fbr_invoices.updated_at::text,
        (select count(*)::int from fbr_invoice_attempts
          where fbr_invoice_attempts.fbr_invoice_id = fbr_invoices.id) as attempt_count
      from fbr_invoices
      join sales on sales.id = fbr_invoices.sale_id
      where fbr_invoices.id = ${fiscalInvoiceId.toString()} and sales.branch_id = ${user.branchId}
    `;
    if (!invoice) throw new NotFoundException('Fiscal invoice not found');

    const attempts = await this.database<
      Array<{
        id: string;
        attempt_number: number;
        operation: string;
        outcome: FiscalInvoiceAttempt['outcome'];
        http_status: number | null;
        duration_ms: number | null;
        correlation_id: string | null;
        error_message: string | null;
        attempted_at: string;
      }>
    >`
      select id::text, attempt_number, operation, outcome, http_status, duration_ms,
        correlation_id, error_message, attempted_at::text
      from fbr_invoice_attempts
      where fbr_invoice_id = ${invoice.id}
      order by attempt_number desc
    `;

    return {
      invoice: toInvoice(invoice),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attempt_number,
        operation: attempt.operation,
        outcome: attempt.outcome,
        httpStatus: attempt.http_status,
        durationMs: attempt.duration_ms,
        correlationId: attempt.correlation_id,
        errorMessage: attempt.error_message,
        attemptedAt: attempt.attempted_at,
      })),
    };
  }

  /**
   * Re-queues a failed fiscal submission. The gateway is never called inline: the
   * existing durable outbox row is reset so the worker owns the transmission, which
   * keeps the counter independent of the fiscal endpoint.
   */
  async retry(
    user: AuthenticatedUser,
    fiscalInvoiceId: bigint,
    input: RetryFiscalInvoiceRequest,
  ): Promise<{ readonly id: string; readonly status: string; readonly idempotentReplay: boolean }> {
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'FISCAL.RETRY_INVOICE',
        user.branchId,
        input.clientRequestId,
      );
      const [replay] = await transaction<Array<{ entity_id: string }>>`
        select entity_id::text from audit_events
        where branch_id = ${user.branchId} and request_id = ${input.clientRequestId}
          and event_type = 'FISCAL.RETRY_REQUESTED'
      `;
      if (replay) {
        return { id: replay.entity_id, status: 'PENDING', idempotentReplay: true };
      }

      const [invoice] = await transaction<
        Array<{
          id: string;
          sale_id: string;
          status: FiscalInvoiceStatus;
          fiscal_invoice_number: string | null;
        }>
      >`
        select fbr_invoices.id::text, fbr_invoices.sale_id::text, fbr_invoices.status,
          fbr_invoices.fiscal_invoice_number
        from fbr_invoices
        join sales on sales.id = fbr_invoices.sale_id
        where fbr_invoices.id = ${fiscalInvoiceId.toString()} and sales.branch_id = ${user.branchId}
        for update of fbr_invoices
      `;
      if (!invoice) throw new NotFoundException('Fiscal invoice not found');
      if (invoice.fiscal_invoice_number !== null) {
        throw new ConflictException(
          'This invoice already carries an official fiscal number; resubmitting it could duplicate it',
        );
      }
      if (!RETRYABLE_STATUSES.includes(invoice.status)) {
        throw new ConflictException(`A ${invoice.status} fiscal record cannot be retried`);
      }

      await transaction`
        update fbr_invoices
        set status = 'PENDING', last_error_code = null, last_error_message = null
        where id = ${invoice.id}
      `;
      await transaction`
        insert into outbox_jobs (job_type, deduplication_key, payload, status, attempts, available_at)
        values (
          'FBR_SUBMIT', ${`sale:${invoice.sale_id}`},
          ${transaction.json({ fbrInvoiceId: invoice.id, saleId: invoice.sale_id })},
          'PENDING', 0, now()
        )
        on conflict (job_type, deduplication_key) where deduplication_key is not null
        do update set status = 'PENDING', attempts = 0, available_at = now(),
          locked_at = null, locked_by = null, completed_at = null, last_error = null
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'FISCAL.RETRY_REQUESTED',
          'fbr_invoice', ${invoice.id}, ${input.clientRequestId},
          ${transaction.json({ previousStatus: invoice.status, reason: input.reason })}
        )
      `;
      return { id: invoice.id, status: 'PENDING', idempotentReplay: false };
    });
  }

  async backups(user: AuthenticatedUser, limit: number): Promise<BackupOverview> {
    const [runs, [lastBackup], [lastDrill]] = await Promise.all([
      this.database<BackupRunRow[]>`
        select id::text, backup_type, status, destination, encrypted, size_bytes::text,
          checksum, started_at::text, finished_at::text, error_message,
          case when finished_at is null then null
            else extract(epoch from (finished_at - started_at))::int end as duration_seconds
        from backup_runs
        where branch_id is null or branch_id = ${user.branchId}
        order by started_at desc, id desc
        limit ${limit}
      `,
      this.database<BackupRunRow[]>`
        select id::text, backup_type, status, destination, encrypted, size_bytes::text,
          checksum, started_at::text, finished_at::text, error_message,
          case when finished_at is null then null
            else extract(epoch from (finished_at - started_at))::int end as duration_seconds
        from backup_runs
        where status = 'SUCCEEDED' and backup_type <> 'RESTORE_DRILL'
          and (branch_id is null or branch_id = ${user.branchId})
        order by finished_at desc nulls last, id desc limit 1
      `,
      this.database<BackupRunRow[]>`
        select id::text, backup_type, status, destination, encrypted, size_bytes::text,
          checksum, started_at::text, finished_at::text, error_message,
          case when finished_at is null then null
            else extract(epoch from (finished_at - started_at))::int end as duration_seconds
        from backup_runs
        where status = 'SUCCEEDED' and backup_type = 'RESTORE_DRILL'
          and (branch_id is null or branch_id = ${user.branchId})
        order by finished_at desc nulls last, id desc limit 1
      `,
    ]);

    return {
      lastSuccessfulBackup: lastBackup ? toBackupRun(lastBackup) : null,
      lastSuccessfulRestoreDrill: lastDrill ? toBackupRun(lastDrill) : null,
      runs: runs.map(toBackupRun),
    };
  }
}
