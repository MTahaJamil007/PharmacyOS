import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, type TabularReport, type TabularReportName } from '@pharmacy/shared';
import { Download, FileBarChart, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { getTabularReport } from '../../api';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  PageHeader,
  Select,
} from '../../components/ui';
import { formatDate, formatDateTime, isoDateIn, shiftIsoDate } from '../../format';
import { usePermissions, useSession } from '../../hooks/useSession';
import { formatReportCell, tabularReportToCsv } from './report-table';

type RangeKind = 'DATES' | 'DAYS_AHEAD' | 'TOP_N' | 'NONE';

interface ReportDefinition {
  readonly name: TabularReportName;
  readonly group: string;
  readonly label: string;
  readonly summary: string;
  readonly permission: string;
  readonly range: RangeKind;
}

const REPORTS: readonly ReportDefinition[] = [
  {
    group: 'Sales',
    label: 'Daily sales',
    name: 'daily-sales',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    range: 'DATES',
    summary: 'Invoices, discounts, tax, refunds and payment mix per day',
  },
  {
    group: 'Sales',
    label: 'Item sales',
    name: 'item-sales',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    range: 'TOP_N',
    summary: 'Best-selling medicines by revenue',
  },
  {
    group: 'Sales',
    label: 'Profit',
    name: 'profit',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    range: 'DATES',
    summary: 'Revenue, cost of goods and gross margin per day',
  },
  {
    group: 'Sales',
    label: 'Returns register',
    name: 'returns-register',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    range: 'DATES',
    summary: 'Every return, its status and the refund paid',
  },
  {
    group: 'Cash',
    label: 'Cash drawer sessions',
    name: 'cash-sessions',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    range: 'DATES',
    summary: 'Opening float, expected and counted cash, variances',
  },
  {
    group: 'Stock',
    label: 'Stock valuation',
    name: 'stock-valuation',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    range: 'NONE',
    summary: 'Units on hand with cost and retail value, right now',
  },
  {
    group: 'Stock',
    label: 'Expiry',
    name: 'expiry',
    permission: PERMISSIONS.REPORTS_VIEW_BASIC,
    range: 'DAYS_AHEAD',
    summary: 'Batches expiring soon, with the value at risk',
  },
  {
    group: 'Stock',
    label: 'Stock losses',
    name: 'stock-losses',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    range: 'DATES',
    summary: 'Scrapped, expired and count-adjusted stock',
  },
  {
    group: 'Purchasing',
    label: 'Purchases',
    name: 'purchases',
    permission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    range: 'DATES',
    summary: 'Goods received from suppliers and their cost',
  },
];

type Preset = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'CUSTOM';

function presetRange(
  preset: Exclude<Preset, 'CUSTOM'>,
  today: string,
): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'YESTERDAY': {
      const yesterday = shiftIsoDate(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'LAST_7':
      return { from: shiftIsoDate(today, -6), to: today };
    case 'THIS_MONTH':
      return { from: monthStart, to: today };
    case 'LAST_MONTH': {
      const lastMonthEnd = shiftIsoDate(monthStart, -1);
      return { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
    }
    case 'LAST_30':
      return { from: shiftIsoDate(today, -29), to: today };
  }
}

function downloadCsv(filename: string, csv: string): void {
  // A byte-order mark makes Excel open the file as UTF-8 (Urdu names, the en dash).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printReport(): void {
  document.body.dataset.print = 'report';
  const reset = (): void => {
    delete document.body.dataset.print;
    window.removeEventListener('afterprint', reset);
  };
  window.addEventListener('afterprint', reset);
  window.print();
}

export function ReportsScreen(): React.JSX.Element {
  const can = usePermissions();
  const available = REPORTS.filter((report) => can(report.permission));
  const [selected, setSelected] = useState<TabularReportName>(available[0]?.name ?? 'daily-sales');
  const definition = available.find((report) => report.name === selected) ?? available[0];
  const groups = [...new Set(available.map((report) => report.group))];
  return (
    <div className="page">
      <PageHeader
        title="Reports"
        description="Exact figures from the shop ledger. Dates follow the branch's local business day."
      />
      {definition ? (
        <div className="grid grid-master">
          <Card flush>
            <nav className="report-list" aria-label="Reports">
              {groups.map((group) => (
                <div key={group}>
                  <div className="report-list-group">{group}</div>
                  {available
                    .filter((report) => report.group === group)
                    .map((report) => (
                      <button
                        key={report.name}
                        type="button"
                        aria-current={report.name === definition.name}
                        onClick={() => setSelected(report.name)}
                      >
                        <strong>{report.label}</strong>
                        <span>{report.summary}</span>
                      </button>
                    ))}
                </div>
              ))}
            </nav>
          </Card>
          <ReportView key={definition.name} definition={definition} />
        </div>
      ) : (
        <EmptyState icon={FileBarChart} title="No reports available">
          Your account does not include report access. Ask the owner if you need it.
        </EmptyState>
      )}
    </div>
  );
}

function ReportView({ definition }: { readonly definition: ReportDefinition }) {
  const session = useSession();
  const today = isoDateIn(session?.user.branchTimezone);
  const [preset, setPreset] = useState<Preset>(definition.range === 'DATES' ? 'LAST_7' : 'LAST_30');
  const [custom, setCustom] = useState(() => presetRange('LAST_7', today));
  const [daysAhead, setDaysAhead] = useState(90);
  const [topN, setTopN] = useState(50);
  const range = preset === 'CUSTOM' ? custom : presetRange(preset, today);
  const rangeError =
    !range.from || !range.to
      ? 'Choose both dates'
      : range.from > range.to
        ? 'The end date must be on or after the start date'
        : range.to > today
          ? 'The end date cannot be in the future'
          : null;
  const parameters =
    definition.range === 'DATES'
      ? range
      : definition.range === 'TOP_N'
        ? { ...range, limit: topN }
        : definition.range === 'DAYS_AHEAD'
          ? { days: daysAhead }
          : {};
  const needsDates = definition.range === 'DATES' || definition.range === 'TOP_N';
  const report = useQuery({
    queryKey: ['tabular-report', definition.name, parameters],
    queryFn: () => getTabularReport(definition.name, parameters),
    enabled: !needsDates || rangeError === null,
  });
  const data = report.data;
  const exportCsv = (): void => {
    if (!data) return;
    const suffix = data.from && data.to ? `${data.from}_to_${data.to}` : today;
    downloadCsv(`${definition.name}_${suffix}.csv`, tabularReportToCsv(data));
  };
  const firstColumn = data?.columns[0]?.key;
  return (
    <Card
      className="report-print"
      title={data?.title ?? definition.label}
      description={
        data?.from && data.to
          ? data.from === data.to
            ? formatDate(data.from)
            : `${formatDate(data.from)} – ${formatDate(data.to)}`
          : definition.summary
      }
      actions={
        <div className="row no-print">
          <Button
            icon={RefreshCw}
            size="sm"
            variant="ghost"
            loading={report.isFetching}
            onClick={() => void report.refetch()}
          >
            Refresh
          </Button>
          <Button icon={Printer} size="sm" disabled={!data} onClick={printReport}>
            Print
          </Button>
          <Button
            icon={Download}
            size="sm"
            disabled={!data || data.rows.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        </div>
      }
      flush
    >
      {definition.range !== 'NONE' ? (
        <div className="report-controls no-print">
          {needsDates ? (
            <>
              <Field label="Period">
                <Select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as Preset)}
                >
                  <option value="TODAY">Today</option>
                  <option value="YESTERDAY">Yesterday</option>
                  <option value="LAST_7">Last 7 days</option>
                  <option value="THIS_MONTH">This month</option>
                  <option value="LAST_MONTH">Last month</option>
                  <option value="LAST_30">Last 30 days</option>
                  <option value="CUSTOM">Custom dates…</option>
                </Select>
              </Field>
              {preset === 'CUSTOM' ? (
                <>
                  <Field label="From">
                    <Input
                      type="date"
                      value={custom.from}
                      max={today}
                      onChange={(event) =>
                        setCustom((current) => ({ ...current, from: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="To" error={rangeError ?? undefined}>
                    <Input
                      type="date"
                      value={custom.to}
                      max={today}
                      invalid={rangeError !== null}
                      onChange={(event) =>
                        setCustom((current) => ({ ...current, to: event.target.value }))
                      }
                    />
                  </Field>
                </>
              ) : null}
            </>
          ) : null}
          {definition.range === 'TOP_N' ? (
            <Field label="Show">
              <Select value={topN} onChange={(event) => setTopN(Number(event.target.value))}>
                {[25, 50, 100, 250, 500].map((value) => (
                  <option key={value} value={value}>
                    Top {value}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition.range === 'DAYS_AHEAD' ? (
            <Field label="Expiring within">
              <Select
                value={daysAhead}
                onChange={(event) => setDaysAhead(Number(event.target.value))}
              >
                {[30, 60, 90, 180, 365].map((value) => (
                  <option key={value} value={value}>
                    {value} days
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
      <ErrorAlert error={report.error} />
      <DataTable
        caption={definition.label}
        compact
        maxHeight="calc(100vh - 330px)"
        loading={report.isLoading}
        rows={(data?.rows ?? []).map((values, index) => ({ index, values }))}
        rowKey={(row) => String(row.index)}
        empty={
          <EmptyState icon={FileBarChart} title="Nothing in this period">
            Try a wider date range.
          </EmptyState>
        }
        columns={(data?.columns ?? []).map((column) => {
          const numeric =
            column.type !== 'text' && column.type !== 'date' && column.type !== 'datetime';
          const total = data?.totals?.[column.key];
          return {
            align: numeric ? ('end' as const) : ('start' as const),
            footer:
              data?.totals == null ? undefined : column.key === firstColumn &&
                (total === null || total === undefined) ? (
                <strong>Total</strong>
              ) : total === null || total === undefined ? null : (
                <strong>{formatReportCell(column, total)}</strong>
              ),
            header: column.label,
            key: column.key,
            render: (row: { readonly values: TabularReport['rows'][number] }) => (
              <span className="nowrap">{formatReportCell(column, row.values[column.key])}</span>
            ),
          };
        })}
      />
      {data ? (
        <p className="report-basis">
          {data.dataBasis} Generated {formatDateTime(new Date())}.
        </p>
      ) : null}
    </Card>
  );
}
