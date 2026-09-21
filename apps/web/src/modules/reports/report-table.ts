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
