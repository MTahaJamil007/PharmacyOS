import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createClientRequestId,
  PERMISSIONS,
  type FiscalInvoiceStatus,
  type SaleReceipt,
} from '@pharmacy/shared';
import { useState } from 'react';

import {
  getAiAudits,
  getBackupOverview,
  getFiscalAttempts,
  getFiscalOverview,
  getSaleReceipt,
  retryFiscalInvoice,
} from '../../api';
import { ReceiptDialog } from '../pos/ReceiptDialog';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

const FISCAL_FILTERS: readonly FiscalInvoiceStatus[] = [
  'PENDING',
  'SUBMITTED',
  'FAILED_RETRYABLE',
  'FAILED_NEEDS_REVIEW',
  'NOT_REQUIRED',
];

function formatBytes(value: string | null): string {
  if (!value) return '—';
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index] ?? 'B'}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-PK');
}

export function OperationsScreen(): React.JSX.Element | null {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const permissions = session?.user.permissions ?? [];
  const canViewFiscal = permissions.includes(PERMISSIONS.FBR_VIEW_STATUS);
  const canViewReceipt = permissions.includes(PERMISSIONS.SALE_FINALIZE_PAYMENT);
  const canRetryFiscal = permissions.includes(PERMISSIONS.FBR_RETRY);
  const canViewBackups = permissions.includes(PERMISSIONS.BACKUP_RESTORE);
  const canViewAiAudits = permissions.includes(PERMISSIONS.AI_AUDIT_READ);
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<FiscalInvoiceStatus | ''>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [retryRequestId, setRetryRequestId] = useState(createClientRequestId);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<SaleReceipt | null>(null);

  const fiscal = useQuery({
    queryKey: ['fiscal-overview', statusFilter],
    queryFn: () => getFiscalOverview(token, statusFilter || undefined),
    enabled: canViewFiscal && Boolean(token),
  });
  const attempts = useQuery({
    queryKey: ['fiscal-attempts', selectedInvoiceId],
    queryFn: () => getFiscalAttempts(token, selectedInvoiceId ?? ''),
    enabled: canViewFiscal && Boolean(token && selectedInvoiceId),
  });
  const backups = useQuery({
    queryKey: ['backup-overview'],
    queryFn: () => getBackupOverview(token),
    enabled: canViewBackups && Boolean(token),
  });
  const aiAudits = useQuery({
    queryKey: ['ai-audits'],
    queryFn: () => getAiAudits(token),
    enabled: canViewAiAudits && Boolean(token),
  });

  if (!canViewFiscal && !canViewBackups && !canViewAiAudits) return null;

  const openInvoice = (id: string): void => {
    setSelectedInvoiceId(id);
    setRetryReason('');
    setRetryRequestId(createClientRequestId());
    setError('');
    setNotice('');
  };

  const retry = async (): Promise<void> => {
    if (!selectedInvoiceId) return;
    if (retryReason.trim().length < 10) {
      setError('Record why this submission is safe to retry (at least 10 characters)');
      return;
    }
    setBusy(true);
    try {
      setError('');
      await retryFiscalInvoice(token, selectedInvoiceId, retryReason.trim(), retryRequestId);
      setRetryReason('');
      setRetryRequestId(createClientRequestId());
      await queryClient.invalidateQueries({ queryKey: ['fiscal-overview'] });
      await queryClient.invalidateQueries({ queryKey: ['fiscal-attempts', selectedInvoiceId] });
      setNotice('Queued for resubmission; the worker owns the transmission');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retry could not be queued');
    } finally {
      setBusy(false);
    }
  };

  const viewInvoice = async (saleId: string): Promise<void> => {
    try {
      setError('');
      setSelectedReceipt(await getSaleReceipt(token, saleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invoice could not be loaded');
    }
  };

  return (
    <main className="operations-canvas operations-console">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Operations console</p>
          <h1>Fiscal, backup, and assistant evidence.</h1>
          <p>
            Everything an operator needs to answer &ldquo;did it go through, and can we get the shop
            back?&rdquo; without opening a database client.
          </p>
        </div>
      </section>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="counter-notice" role="status">
          {notice}
        </p>
      ) : null}

      {canViewFiscal ? (
        <section className="work-panel fiscal-panel">
          <header>
            <div>
              <p className="eyebrow">
                Mode {fiscal.data?.mode ?? '—'} ·{' '}
                {fiscal.data?.outboundEnabled
                  ? 'outbound transmission enabled'
                  : 'outbound transmission disabled'}
              </p>
              <h2>Fiscal submissions</h2>
            </div>
            <label className="filter-row">
              Status
              <select
                aria-label="Fiscal status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as FiscalInvoiceStatus | '')
                }
              >
                <option value="">All</option>
                {FISCAL_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </header>
          {fiscal.data ? (
            <div className="account-strip">
              {FISCAL_FILTERS.map((value) => (
                <span key={value}>
                  {value.replaceAll('_', ' ')} <b>{fiscal.data.counts[value]}</b>
                </span>
              ))}
            </div>
          ) : null}
          <table className="report-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>Fiscal number</th>
                <th>Attempts</th>
                <th>Total</th>
                <th>Last error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(fiscal.data?.invoices ?? []).map((invoice) => (
                <tr
                  className={selectedInvoiceId === invoice.id ? 'selected' : undefined}
                  key={invoice.id}
                >
                  <td>{invoice.invoiceNumber}</td>
                  <td>{invoice.status.replaceAll('_', ' ')}</td>
                  <td>{invoice.fiscalInvoiceNumber ?? '—'}</td>
                  <td>{invoice.attemptCount}</td>
                  <td>{formatPkrMoney(invoice.total)}</td>
                  <td>{invoice.lastErrorMessage ?? '—'}</td>
                  <td>
                    <button onClick={() => openInvoice(invoice.id)}>Inspect</button>
                    {canViewReceipt ? (
                      <button onClick={() => void viewInvoice(invoice.saleId)}>View invoice</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fiscal.data && fiscal.data.invoices.length === 0 ? (
            <p className="empty-state">No fiscal records for this filter.</p>
          ) : null}

          {attempts.data ? (
            <section className="fiscal-attempts">
              <h3>{attempts.data.invoice.invoiceNumber} · attempt history</h3>
              {attempts.data.attempts.length === 0 ? (
                <p className="empty-state">No transmission has been attempted yet.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Operation</th>
                      <th>Outcome</th>
                      <th>HTTP</th>
                      <th>Duration</th>
                      <th>Error</th>
                      <th>At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.data.attempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>{attempt.attemptNumber}</td>
                        <td>{attempt.operation}</td>
                        <td>{attempt.outcome.replaceAll('_', ' ')}</td>
                        <td>{attempt.httpStatus ?? '—'}</td>
                        <td>{attempt.durationMs === null ? '—' : `${attempt.durationMs} ms`}</td>
                        <td>{attempt.errorMessage ?? '—'}</td>
                        <td>{formatTimestamp(attempt.attemptedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {canRetryFiscal && attempts.data.invoice.retryable ? (
                <div className="retry-form">
                  <label>
                    Reason for retry
                    <input
                      value={retryReason}
                      placeholder="Reconciled with the integrator; no invoice number was issued"
                      onChange={(event) => setRetryReason(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={busy} onClick={() => void retry()}>
                    Queue resubmission
                  </button>
                </div>
              ) : null}
              {!attempts.data.invoice.retryable ? (
                <p className="empty-state">
                  {attempts.data.invoice.fiscalInvoiceNumber
                    ? 'This invoice already carries an official fiscal number; resubmitting could duplicate it.'
                    : 'Only a failed submission without a fiscal number can be retried.'}
                </p>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : null}

      {canViewBackups ? (
        <section className="work-panel backup-panel">
          <header>
            <div>
              <p className="eyebrow">Recoverability</p>
              <h2>Backups and restore drills</h2>
            </div>
          </header>
          <div className="account-strip">
            <span>
              Last backup{' '}
              <b>{formatTimestamp(backups.data?.lastSuccessfulBackup?.finishedAt ?? null)}</b>
            </span>
            <span>
              Last restore drill{' '}
              <b>{formatTimestamp(backups.data?.lastSuccessfulRestoreDrill?.finishedAt ?? null)}</b>
            </span>
          </div>
          <p className="data-basis">
            A restore is run from the host with <code>docs/RUNBOOK.md</code>, never from this
            screen. This is the evidence trail, not a control.
          </p>
          <table className="report-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Destination</th>
                <th>Encrypted</th>
                <th>Size</th>
                <th>Duration</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {(backups.data?.runs ?? []).map((run) => (
                <tr key={run.id}>
                  <td>{run.backupType.replaceAll('_', ' ')}</td>
                  <td>{run.status}</td>
                  <td>{run.destination}</td>
                  <td>{run.encrypted ? 'Yes' : 'No'}</td>
                  <td>{formatBytes(run.sizeBytes)}</td>
                  <td>{run.durationSeconds === null ? '—' : `${run.durationSeconds} s`}</td>
                  <td>{formatTimestamp(run.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {backups.data && backups.data.runs.length === 0 ? (
            <p className="empty-state">No backup run has been recorded yet.</p>
          ) : null}
        </section>
      ) : null}

      {canViewAiAudits ? (
        <section className="work-panel ai-audit-panel">
          <header>
            <div>
              <p className="eyebrow">Assistant usage · question text is never stored</p>
              <h2>Owner assistant audit</h2>
            </div>
          </header>
          <table className="report-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Tool</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Latency</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {(aiAudits.data ?? []).map((audit) => (
                <tr key={audit.id}>
                  <td>{audit.userDisplayName}</td>
                  <td>{audit.toolName}</td>
                  <td>{audit.model ? `${audit.provider} · ${audit.model}` : audit.provider}</td>
                  <td>{audit.status}</td>
                  <td>{audit.latencyMs} ms</td>
                  <td>{formatTimestamp(audit.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {aiAudits.data && aiAudits.data.length === 0 ? (
            <p className="empty-state">The assistant has not been used on this branch.</p>
          ) : null}
        </section>
      ) : null}
      {selectedReceipt ? (
        <ReceiptDialog
          token={token}
          receipt={selectedReceipt}
          autoPrint={false}
          onClose={() => setSelectedReceipt(null)}
        />
      ) : null}
    </main>
  );
}
