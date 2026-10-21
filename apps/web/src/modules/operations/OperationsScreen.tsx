import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type FiscalInvoiceStatus } from '@pharmacy/shared';
import {
  Activity,
  Bot,
  CheckCheck,
  DatabaseBackup,
  FileCheck2,
  RefreshCw,
  RotateCcw,
  ServerCrash,
} from 'lucide-react';
import { useState } from 'react';

import {
  acknowledgeAlert,
  getAiAudits,
  getBackupOverview,
  getFailedJobs,
  getFiscalAttempts,
  getFiscalOverview,
  getOperationalAlerts,
  retryFiscalInvoice,
  type FiscalInvoiceSummary,
} from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  Select,
  Stat,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from '../../components/ui';
import { formatDateTime, formatMoney, humanize } from '../../format';
import { useClock } from '../../hooks/useClock';
import { usePayloadRequestId, usePermissions } from '../../hooks/useSession';

type OperationsTab = 'FISCAL' | 'BACKUPS' | 'HEALTH' | 'AI';

const FISCAL_STATUS: Record<FiscalInvoiceStatus, { readonly label: string; readonly tone: Tone }> =
  {
    FAILED_NEEDS_REVIEW: { label: 'Needs review', tone: 'danger' },
    FAILED_RETRYABLE: { label: 'Will retry', tone: 'warning' },
    NOT_REQUIRED: { label: 'Not required', tone: 'neutral' },
    PENDING: { label: 'Queued', tone: 'info' },
    SUBMITTED: { label: 'Accepted by FBR', tone: 'success' },
    SUBMITTING: { label: 'Sending', tone: 'info' },
    VALIDATED: { label: 'Validated', tone: 'info' },
    VALIDATING: { label: 'Validating', tone: 'info' },
    VOID_OR_CREDIT_NOTE_PENDING: { label: 'Credit note pending', tone: 'warning' },
  };

function formatBytes(value: string | null): string {
  if (!value) return '—';
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

export function OperationsScreen(): React.JSX.Element {
  const can = usePermissions();
  const tabs = [
    ...(can(PERMISSIONS.FBR_VIEW_STATUS)
      ? [{ icon: FileCheck2, id: 'FISCAL' as const, label: 'FBR invoices' }]
      : []),
    ...(can(PERMISSIONS.BACKUP_RESTORE)
      ? [{ icon: DatabaseBackup, id: 'BACKUPS' as const, label: 'Backups' }]
      : []),
    ...(can(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
      ? [{ icon: Activity, id: 'HEALTH' as const, label: 'System health' }]
      : []),
    ...(can(PERMISSIONS.AI_AUDIT_READ)
      ? [{ icon: Bot, id: 'AI' as const, label: 'Assistant log' }]
      : []),
  ];
  const [tab, setTab] = useState<OperationsTab>(tabs[0]?.id ?? 'FISCAL');
  return (
    <div className="page">
      <PageHeader
        title="Operations"
        description="Tax submissions, backups and background work. Problems here do not stop the counter, but they must be fixed."
      />
      {tabs.length > 1 ? (
        <Tabs label="Operations views" tabs={tabs} active={tab} onChange={setTab} />
      ) : null}
      {tab === 'FISCAL' ? <FiscalTab /> : null}
      {tab === 'BACKUPS' ? <BackupsTab /> : null}
      {tab === 'HEALTH' ? <HealthTab /> : null}
      {tab === 'AI' ? <AiAuditTab /> : null}
    </div>
  );
}

/* ---------- FBR ---------- */

function FiscalTab() {
  const [status, setStatus] = useState<FiscalInvoiceStatus | ''>('');
  const [selected, setSelected] = useState<FiscalInvoiceSummary | null>(null);
  const overview = useQuery({
    queryKey: ['fiscal-overview', status],
    queryFn: () => getFiscalOverview(status || undefined),
    refetchInterval: 30_000,
  });
  const counts = overview.data?.counts;
  const problems = (counts?.FAILED_NEEDS_REVIEW ?? 0) + (counts?.FAILED_RETRYABLE ?? 0);
  const inFlight =
    (counts?.PENDING ?? 0) +
    (counts?.VALIDATING ?? 0) +
    (counts?.VALIDATED ?? 0) +
    (counts?.SUBMITTING ?? 0);
  return (
    <div className="stack">
      {overview.data && !overview.data.outboundEnabled ? (
        <Alert
          tone="warning"
          title={`FBR submission is off (mode: ${humanize(overview.data.mode)})`}
        >
          {overview.data.mode === 'DISABLED'
            ? 'Sales are recorded normally but are not reported to FBR. Switch the FBR mode on once the shop’s POS integration is registered and authorised.'
            : 'Sales are recorded and queued for FBR, but nothing is sent until outbound submission is enabled on the server.'}
        </Alert>
      ) : null}
      <div className="grid grid-4">
        <Stat
          label="Accepted by FBR"
          value={counts?.SUBMITTED ?? '—'}
          tone="success"
          onClick={() => setStatus('SUBMITTED')}
          selected={status === 'SUBMITTED'}
        />
        <Stat
          label="In progress"
          value={inFlight || (counts ? 0 : '—')}
          hint="Queued, validating or sending"
          onClick={() => setStatus('PENDING')}
          selected={status === 'PENDING'}
        />
        <Stat
          label="Will retry"
          value={counts?.FAILED_RETRYABLE ?? '—'}
          tone={counts?.FAILED_RETRYABLE ? 'warning' : undefined}
          onClick={() => setStatus('FAILED_RETRYABLE')}
          selected={status === 'FAILED_RETRYABLE'}
        />
        <Stat
          label="Needs review"
          value={counts?.FAILED_NEEDS_REVIEW ?? '—'}
          tone={counts?.FAILED_NEEDS_REVIEW ? 'danger' : undefined}
          hint={problems ? 'Open one to see why and retry' : 'Nothing to fix'}
          onClick={() => setStatus('FAILED_NEEDS_REVIEW')}
          selected={status === 'FAILED_NEEDS_REVIEW'}
        />
      </div>
      <Card
        title="Fiscal invoices"
        description="Most recent 100. Click one to see every attempt."
        actions={
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as FiscalInvoiceStatus | '')}
          >
            <option value="">All statuses</option>
            {(Object.keys(FISCAL_STATUS) as FiscalInvoiceStatus[]).map((key) => (
              <option key={key} value={key}>
                {FISCAL_STATUS[key].label}
              </option>
            ))}
          </Select>
        }
        flush
      >
        <ErrorAlert error={overview.error} />
        <DataTable
          caption="Fiscal invoices"
          compact
          rows={overview.data?.invoices ?? []}
          rowKey={(invoice) => invoice.id}
          loading={overview.isLoading}
          onRowClick={setSelected}
          selectedKey={selected?.id ?? null}
          empty={<EmptyState icon={FileCheck2} title="No invoices with this status" />}
          columns={[
            {
              header: 'Invoice',
              key: 'invoice',
              render: (invoice) => (
                <>
                  <span className="cell-primary mono">{invoice.invoiceNumber}</span>
                  <span className="cell-sub">{formatDateTime(invoice.saleCreatedAt)}</span>
                </>
              ),
            },
            {
              header: 'Status',
              key: 'status',
              render: (invoice) => (
                <Badge tone={FISCAL_STATUS[invoice.status].tone}>
                  {FISCAL_STATUS[invoice.status].label}
                </Badge>
              ),
            },
            {
              header: 'FBR number',
              key: 'fbr',
              render: (invoice) => (
                <span className="mono">{invoice.fiscalInvoiceNumber ?? '—'}</span>
              ),
            },
            {
              header: 'Last problem',
              key: 'error',
              render: (invoice) =>
                invoice.lastErrorMessage ? (
                  <span className="text-danger">
                    {invoice.lastErrorCode ? `${invoice.lastErrorCode}: ` : ''}
                    {invoice.lastErrorMessage}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              align: 'end',
              header: 'Attempts',
              key: 'attempts',
              render: (invoice) => invoice.attemptCount,
            },
            {
              align: 'end',
              header: 'Total',
              key: 'total',
              render: (invoice) => formatMoney(invoice.total),
            },
          ]}
        />
      </Card>
      {selected ? <FiscalDrawer invoice={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function FiscalDrawer({
  invoice,
  onClose,
}: {
  readonly invoice: FiscalInvoiceSummary;
  readonly onClose: () => void;
}) {
  const can = usePermissions();
  const [retrying, setRetrying] = useState(false);
  const attempts = useQuery({
    queryKey: ['fiscal-attempts', invoice.id],
    queryFn: () => getFiscalAttempts(invoice.id),
  });
  const current = attempts.data?.invoice ?? invoice;
  const canRetry = can(PERMISSIONS.FBR_RETRY) && current.retryable;
  return (
    <Drawer
      title={`Invoice ${current.invoiceNumber}`}
      description={`${FISCAL_STATUS[current.status].label} · ${formatMoney(current.total)}`}
      onClose={onClose}
      footer={
        canRetry ? (
          <Button variant="primary" icon={RotateCcw} onClick={() => setRetrying(true)}>
            Send to FBR again
          </Button>
        ) : null
      }
    >
      <div className="stack">
        {current.lastErrorMessage ? (
          <Alert tone="danger" title={current.lastErrorCode ?? 'Last error'}>
            {current.lastErrorMessage}
          </Alert>
        ) : null}
        <dl className="detail-list">
          <dt>Sale time</dt>
          <dd>{formatDateTime(current.saleCreatedAt)}</dd>
          <dt>FBR invoice number</dt>
          <dd className="mono">{current.fiscalInvoiceNumber ?? 'Not issued yet'}</dd>
          <dt>Submitted</dt>
          <dd>{current.submittedAt ? formatDateTime(current.submittedAt) : '—'}</dd>
          <dt>Mode</dt>
          <dd>{humanize(current.mode)}</dd>
        </dl>
        <ErrorAlert error={attempts.error} />
        <Card title="Attempts" flush>
          <DataTable
            caption="Submission attempts"
            compact
            rows={attempts.data?.attempts ?? []}
            rowKey={(attempt) => attempt.id}
            loading={attempts.isLoading}
            empty={<EmptyState title="Not attempted yet" />}
            columns={[
              { header: '#', key: 'n', render: (attempt) => attempt.attemptNumber },
              {
                header: 'When',
                key: 'at',
                render: (attempt) => (
                  <>
                    {formatDateTime(attempt.attemptedAt)}
                    <span className="cell-sub">{humanize(attempt.operation)}</span>
                  </>
                ),
              },
              {
                header: 'Outcome',
                key: 'outcome',
                render: (attempt) => (
                  <>
                    <Badge
                      tone={
                        attempt.outcome === 'SUCCESS'
                          ? 'success'
                          : attempt.outcome === 'RETRYABLE_FAILURE'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {humanize(attempt.outcome)}
                    </Badge>
                    {attempt.errorMessage ? (
                      <span className="cell-sub text-danger">{attempt.errorMessage}</span>
                    ) : null}
                  </>
                ),
              },
              {
                align: 'end',
                header: 'HTTP',
                key: 'http',
                render: (attempt) => attempt.httpStatus ?? '—',
              },
            ]}
          />
        </Card>
      </div>
      {retrying ? <RetryDialog invoice={current} onClose={() => setRetrying(false)} /> : null}
    </Drawer>
  );
}

function RetryDialog({
  invoice,
  onClose,
}: {
  readonly invoice: FiscalInvoiceSummary;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId] = usePayloadRequestId(`${invoice.id}:${reason.trim()}`);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await retryFiscalInvoice(invoice.id, reason.trim(), requestId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fiscal-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['fiscal-attempts', invoice.id] }),
      ]);
      toast.success('Queued for another attempt');
      onClose();
    } catch (caught) {
      toast.error('Could not queue the retry', caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Retry ${invoice.invoiceNumber}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={RotateCcw}
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            Queue retry
          </Button>
        </>
      }
    >
      <Field
        label="What was fixed?"
        hint="Recorded in the audit log, e.g. 'Internet restored' or 'HS code corrected'."
      >
        <Textarea
          rows={3}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/* ---------- Backups ---------- */

function BackupsTab() {
  const now = useClock();
  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: getBackupOverview,
    refetchInterval: 60_000,
  });
  const data = backups.data;
  const lastBackupAt =
    data?.lastSuccessfulBackup?.finishedAt ?? data?.lastSuccessfulBackup?.startedAt ?? null;
  const stale = !lastBackupAt || now.getTime() - Date.parse(lastBackupAt) > 26 * 60 * 60 * 1000;
  return (
    <div className="stack">
      <ErrorAlert error={backups.error} />
      {data && stale ? (
        <Alert tone="danger" title="No recent backup">
          The last successful backup is{' '}
          {lastBackupAt ? `from ${formatDateTime(lastBackupAt)}` : 'missing'}. Check the backup job
          and the external disk before the shop closes.
        </Alert>
      ) : null}
      <div className="grid grid-3">
        <Stat
          label="Last successful backup"
          icon={DatabaseBackup}
          value={lastBackupAt ? formatDateTime(lastBackupAt) : 'Never'}
          hint={
            data?.lastSuccessfulBackup
              ? `${formatBytes(data.lastSuccessfulBackup.sizeBytes)} · ${data.lastSuccessfulBackup.encrypted ? 'encrypted' : 'NOT encrypted'}`
              : undefined
          }
          tone={stale ? 'danger' : 'success'}
        />
        <Stat
          label="Last restore drill"
          icon={RotateCcw}
          value={
            data?.lastSuccessfulRestoreDrill
              ? formatDateTime(
                  data.lastSuccessfulRestoreDrill.finishedAt ??
                    data.lastSuccessfulRestoreDrill.startedAt,
                )
              : 'Never'
          }
          hint="Proves a backup can actually be restored"
          tone={data?.lastSuccessfulRestoreDrill ? undefined : 'warning'}
        />
        <Stat
          label="Failed runs (recent)"
          icon={ServerCrash}
          value={data ? data.runs.filter((run) => run.status === 'FAILED').length : '—'}
          tone={data?.runs.some((run) => run.status === 'FAILED') ? 'warning' : undefined}
        />
      </div>
      <Card title="Recent backup runs" flush>
        <DataTable
          caption="Backup runs"
          compact
          rows={data?.runs ?? []}
          rowKey={(run) => run.id}
          loading={backups.isLoading}
          empty={
            <EmptyState icon={DatabaseBackup} title="No backup has ever run">
              Backups are taken by the scheduled backup script on the shop server. See the
              operations runbook.
            </EmptyState>
          }
          columns={[
            { header: 'Started', key: 'start', render: (run) => formatDateTime(run.startedAt) },
            { header: 'Type', key: 'type', render: (run) => humanize(run.backupType) },
            {
              header: 'Result',
              key: 'status',
              render: (run) => (
                <>
                  <Badge
                    tone={
                      run.status === 'SUCCEEDED'
                        ? 'success'
                        : run.status === 'FAILED'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {humanize(run.status)}
                  </Badge>
                  {run.errorMessage ? (
                    <span className="cell-sub text-danger">{run.errorMessage}</span>
                  ) : null}
                </>
              ),
            },
            {
              header: 'Destination',
              key: 'dest',
              render: (run) => <span className="mono">{run.destination}</span>,
            },
            {
              align: 'end',
              header: 'Size',
              key: 'size',
              render: (run) => formatBytes(run.sizeBytes),
            },
            {
              align: 'end',
              header: 'Took',
              key: 'duration',
              render: (run) =>
                run.durationSeconds === null ? '—' : `${String(run.durationSeconds)} s`,
            },
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------- Health ---------- */

function HealthTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [alertStatus, setAlertStatus] = useState<'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'>('OPEN');
  const alerts = useQuery({
    queryKey: ['operational-alerts', alertStatus],
    queryFn: () => getOperationalAlerts(alertStatus),
    refetchInterval: 60_000,
  });
  const jobs = useQuery({
    queryKey: ['failed-jobs'],
    queryFn: () => getFailedJobs(),
    refetchInterval: 60_000,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const acknowledge = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await acknowledgeAlert(id);
      await queryClient.invalidateQueries({ queryKey: ['operational-alerts'] });
      toast.success('Alert acknowledged');
    } catch (caught) {
      toast.error('Could not acknowledge', caught);
    } finally {
      setBusyId(null);
    }
  };
  const summary = jobs.data?.summary;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat
          label="Failed jobs"
          value={summary?.failed ?? '—'}
          tone={summary?.failed ? 'danger' : undefined}
        />
        <Stat
          label="Waiting to retry"
          value={summary?.retryable ?? '—'}
          tone={summary?.retryable ? 'warning' : undefined}
        />
        <Stat label="Running now" value={summary?.processing ?? '—'} />
        <Stat
          label="Stuck jobs"
          value={summary?.staleProcessing ?? '—'}
          tone={summary?.staleProcessing ? 'danger' : undefined}
          hint="Running far longer than expected — check the worker"
        />
      </div>
      <Card
        title="Alerts"
        actions={
          <Select
            aria-label="Alert status"
            value={alertStatus}
            onChange={(event) => setAlertStatus(event.target.value as typeof alertStatus)}
          >
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
        }
        flush
      >
        <ErrorAlert error={alerts.error} />
        <DataTable
          caption="Operational alerts"
          compact
          rows={alerts.data?.alerts ?? []}
          rowKey={(alert) => alert.id}
          loading={alerts.isLoading}
          empty={<EmptyState icon={CheckCheck} title="No alerts" />}
          columns={[
            {
              header: 'Alert',
              key: 'title',
              render: (alert) => (
                <>
                  <span className="cell-primary">{alert.title}</span>
                  <span className="cell-sub">{humanize(alert.alertType)}</span>
                </>
              ),
            },
            {
              header: 'Severity',
              key: 'severity',
              render: (alert) => (
                <Badge tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                  {humanize(alert.severity)}
                </Badge>
              ),
            },
            {
              header: 'First seen',
              key: 'first',
              render: (alert) => formatDateTime(alert.firstObservedAt),
            },
            {
              header: 'Last seen',
              key: 'last',
              render: (alert) => formatDateTime(alert.lastObservedAt),
            },
            {
              align: 'end',
              header: <span className="sr-only">Actions</span>,
              key: 'actions',
              render: (alert) =>
                alert.status === 'OPEN' ? (
                  <Button
                    size="sm"
                    icon={CheckCheck}
                    loading={busyId === alert.id}
                    onClick={() => void acknowledge(alert.id)}
                  >
                    Acknowledge
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      <Card
        title="Failed background jobs"
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            loading={jobs.isFetching}
            onClick={() => void jobs.refetch()}
          >
            Refresh
          </Button>
        }
        flush
      >
        <ErrorAlert error={jobs.error} />
        <DataTable
          caption="Failed jobs"
          compact
          rows={jobs.data?.jobs ?? []}
          rowKey={(job) => job.id}
          loading={jobs.isLoading}
          empty={<EmptyState icon={CheckCheck} title="No failed jobs" />}
          columns={[
            {
              header: 'Job',
              key: 'type',
              render: (job) => (
                <>
                  <span className="cell-primary">{humanize(job.jobType)}</span>
                  <span className="cell-sub">Created {formatDateTime(job.createdAt)}</span>
                </>
              ),
            },
            {
              align: 'end',
              header: 'Attempts',
              key: 'attempts',
              render: (job) => `${String(job.attempts)} / ${String(job.maxAttempts)}`,
            },
            {
              header: 'Last error',
              key: 'error',
              render: (job) => <span className="text-danger">{job.lastError ?? '—'}</span>,
            },
            { header: 'Updated', key: 'updated', render: (job) => formatDateTime(job.updatedAt) },
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------- AI audit ---------- */

function AiAuditTab() {
  const audits = useQuery({ queryKey: ['ai-audits'], queryFn: getAiAudits });
  return (
    <Card
      title="Assistant usage"
      description="Every question asked of the owner assistant, newest first."
      flush
    >
      <ErrorAlert error={audits.error} />
      <DataTable
        caption="Assistant audit log"
        compact
        rows={audits.data ?? []}
        rowKey={(audit) => audit.id}
        loading={audits.isLoading}
        empty={<EmptyState icon={Bot} title="The assistant has not been used" />}
        columns={[
          { header: 'When', key: 'at', render: (audit) => formatDateTime(audit.createdAt) },
          { header: 'User', key: 'user', render: (audit) => audit.userDisplayName },
          { header: 'Report', key: 'tool', render: (audit) => humanize(audit.toolName) },
          {
            header: 'Result',
            key: 'status',
            render: (audit) => (
              <Badge
                tone={
                  audit.status === 'SUCCEEDED'
                    ? 'success'
                    : audit.status === 'DISABLED'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {humanize(audit.status)}
              </Badge>
            ),
          },
          {
            header: 'Provider',
            key: 'provider',
            render: (audit) => `${audit.provider}${audit.model ? ` · ${audit.model}` : ''}`,
          },
          {
            align: 'end',
            header: 'Time',
            key: 'latency',
            render: (audit) => `${String(audit.latencyMs)} ms`,
          },
        ]}
      />
    </Card>
  );
}
