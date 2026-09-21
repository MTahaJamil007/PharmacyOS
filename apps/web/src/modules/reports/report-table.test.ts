import { describe, expect, it } from 'vitest';

import { humanizeColumn, toCsv, toReportTable } from './report-table';

describe('deterministic report rendering', () => {
  it('renders an aggregate fact object as measure and value rows', () => {
    expect(
      toReportTable({ average_ticket: '415.50', gross_sales: '18420.00', invoice_count: '44' }),
    ).toEqual({
      columns: ['Measure', 'Value'],
      rows: [
        ['Average ticket', '415.50'],
        ['Gross sales', '18420.00'],
        ['Invoice count', '44'],
      ],
    });
  });

  it('renders a row list with the union of every row key', () => {
    expect(
      toReportTable([
        { days_of_stock: '2.5', name: 'Panadol' },
        { name: 'Brufen', sellable_stock: '0' },
      ]),
    ).toEqual({
      columns: ['days_of_stock', 'name', 'sellable_stock'],
      rows: [
        ['2.5', 'Panadol', '—'],
        ['—', 'Brufen', '0'],
      ],
    });
  });

  it('shows a missing value as an em dash rather than an empty cell', () => {
    expect(toReportTable([{ days_of_stock: null, name: 'Augmentin' }]).rows).toEqual([
      ['—', 'Augmentin'],
    ]);
  });

  it('returns an empty table for an empty or non-object payload', () => {
    expect(toReportTable([])).toEqual({ columns: [], rows: [] });
    expect(toReportTable(null)).toEqual({ columns: [], rows: [] });
    expect(toReportTable('unexpected')).toEqual({ columns: [], rows: [] });
  });

  it('humanizes snake_case and camelCase column names', () => {
    expect(humanizeColumn('gross_profit_estimate')).toBe('Gross profit estimate');
    expect(humanizeColumn('averageDailyDemand')).toBe('Average Daily Demand');
  });
});

describe('report export', () => {
  it('writes CRLF-delimited CSV with humanized headers', () => {
    expect(toCsv(toReportTable([{ name: 'Panadol', sellable_stock: '3' }]))).toBe(
      'Name,Sellable stock\r\nPanadol,3',
    );
  });

  it('quotes cells that contain a comma, quote, or newline', () => {
    expect(
      toCsv({
        columns: ['note'],
        rows: [['Expired, damaged'], ['He said "return it"'], ['line\nbreak']],
      }),
    ).toBe('Note\r\n"Expired, damaged"\r\n"He said ""return it"""\r\n"line\nbreak"');
  });
});
