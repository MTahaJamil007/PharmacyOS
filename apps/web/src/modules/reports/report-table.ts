import type { ReportCell, ReportColumn, TabularReport } from '@pharmacy/shared';

import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
} from '../../format';

export interface ReportTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function humanizeColumn(column: string): string {
  return column
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

/**
 * The deterministic report endpoints return either one aggregate object
 * (sales, profit, cash) or a list of rows (low stock, expiry, returns).
 * Both are rendered as a table so the owner sees the same shape either way.
 */
export function toReportTable(facts: unknown): ReportTable {
  if (Array.isArray(facts)) {
    const objectRows = facts.filter(
      (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
    );
    if (objectRows.length === 0) return { columns: [], rows: [] };
    const columns = [...new Set(objectRows.flatMap((row) => Object.keys(row)))];
    return {
      columns,
      rows: objectRows.map((row) => columns.map((column) => renderCell(row[column]))),
    };
  }
  if (typeof facts === 'object' && facts !== null) {
    return {
      columns: ['Measure', 'Value'],
      rows: Object.entries(facts).map(([key, value]) => [humanizeColumn(key), renderCell(value)]),
    };
  }
  return { columns: [], rows: [] };
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(table: ReportTable): string {
  const lines = [
    table.columns.map(humanizeColumn).map(escapeCsvCell).join(','),
    ...table.rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return lines.join('\r\n');
}

/* ---------- Typed operational reports ---------- */

export function formatReportCell(column: ReportColumn, value: ReportCell | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (column.type) {
    case 'money':
      return formatMoney(String(value));
    case 'quantity':
      return formatQuantity(String(value));
    case 'count':
      return formatCount(String(value));
    case 'percent':
      return formatPercent(String(value));
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'text':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  }
}

/**
 * CSV keeps the exact values the server sent (plain decimals, ISO dates) so a spreadsheet
 * sums them correctly; only the header row uses the human labels.
 */
export function tabularReportToCsv(report: TabularReport): string {
  const raw = (value: ReportCell | undefined): string =>
    value === null || value === undefined ? '' : String(value);
  const lines = [
    report.columns.map((column) => escapeCsvCell(column.label)).join(','),
    ...report.rows.map((row) =>
      report.columns.map((column) => escapeCsvCell(raw(row[column.key]))).join(','),
    ),
  ];
  if (report.totals) {
    lines.push(
      report.columns
        .map((column, index) =>
          escapeCsvCell(
            index === 0 && report.totals?.[column.key] == null
              ? 'Total'
              : raw(report.totals?.[column.key]),
          ),
        )
        .join(','),
    );
  }
  return lines.join('\r\n');
}
