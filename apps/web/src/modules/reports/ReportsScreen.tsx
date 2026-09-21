import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, type DeterministicReportName } from '@pharmacy/shared';
import { useState } from 'react';

import { getDeterministicReport } from '../../api';
import { usePharmacyStore } from '../../store';
import { humanizeColumn, toCsv, toReportTable } from './report-table';

interface ReportDefinition {
  readonly name: DeterministicReportName;
  readonly label: string;
  readonly permission: string;
  readonly ranged: boolean;
}

const REPORTS: readonly ReportDefinition[] = [
  {
    label: 'Sales summary',
    name: 'sales',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    ranged: true,
  },
  {
    label: 'Gross profit estimate',
    name: 'profit',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    ranged: true,
  },
  {
    label: 'Cash reconciliation',
    name: 'cash-reconciliation',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    ranged: true,
  },
  {
    label: 'Returns',
    name: 'returns',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    ranged: true,
  },
  {
    label: 'Low stock',
    name: 'low-stock',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    ranged: false,
  },
  {
    label: 'Expiry risk',
    name: 'expiry-risk',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    ranged: false,
  },
  {
    label: 'Purchase suggestions',
    name: 'purchase-suggestions',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    ranged: false,
  },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function ReportsScreen(): React.JSX.Element | null {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const permissions = session?.user.permissions ?? [];
  const available = REPORTS.filter((report) => permissions.includes(report.permission));
  const [selected, setSelected] = useState<DeterministicReportName>(available[0]?.name ?? 'sales');
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(today);

  const definition = available.find((report) => report.name === selected) ?? available[0];
  const report = useQuery({
    queryKey: ['deterministic-report', selected, from, to],
    queryFn: () =>
      getDeterministicReport(token, selected, definition?.ranged ? { from, to } : { limit: 50 }),
    enabled: Boolean(token && definition),
  });

  if (available.length === 0 || !definition) return null;

  const table = report.data ? toReportTable(report.data.facts) : { columns: [], rows: [] };

  const download = (): void => {
    const blob = new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = definition.ranged
      ? `${selected}-${from}-to-${to}.csv`
      : `${selected}-${today()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="operations-canvas reports-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Deterministic reporting · no AI in the path</p>
          <h1>Read the day from the ledger itself.</h1>
          <p>
            Every figure is computed by the database from finalized records. Export to CSV for the
            accountant without leaving the shop network.
          </p>
        </div>
      </section>

      <section className="work-panel report-controls">
        <label>
          Report
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value as DeterministicReportName)}
          >
            {available.map((item) => (
              <option key={item.name} value={item.name}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {definition.ranged ? (
          <>
            <label>
              From
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </>
        ) : null}
        <button disabled={table.rows.length === 0} onClick={download}>
          Export CSV
        </button>
      </section>

      <section className="work-panel report-output">
        {report.isPending ? <p className="empty-state">Computing…</p> : null}
        {report.isError ? (
          <p className="inline-error" role="alert">
            {report.error instanceof Error ? report.error.message : 'Report failed'}
          </p>
        ) : null}
        {report.data ? (
          <>
            <header>
              <div>
                <p className="eyebrow">Data basis</p>
                <h2>{definition.label}</h2>
              </div>
            </header>
            <p className="data-basis">{report.data.dataBasis}</p>
            {table.rows.length === 0 ? (
              <p className="empty-state">No records matched this report.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column}>{humanizeColumn(column)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={`${selected}-${String(rowIndex)}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${table.columns[cellIndex] ?? String(cellIndex)}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
