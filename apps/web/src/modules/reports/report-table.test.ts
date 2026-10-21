import { describe, expect, it } from 'vitest';

import {
  formatReportCell,
  humanizeColumn,
  tabularReportToCsv,
  toCsv,
  toReportTable,
} from './report-table';

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

describe('typed report formatting', () => {
  const money = { key: 'netSales', label: 'Net sales', type: 'money' } as const;
  const quantity = { key: 'quantity', label: 'Quantity', type: 'quantity' } as const;
  const text = { key: 'name', label: 'Medicine', type: 'text' } as const;

  it('formats each column by its declared type', () => {
    expect(formatReportCell(money, '1234.5')).toBe('Rs 1,234.50');
    expect(formatReportCell(quantity, '12.500')).toBe('12.5');
    expect(formatReportCell(text, 'Panadol')).toBe('Panadol');
    expect(formatReportCell(money, null)).toBe('—');
  });

  it('exports exact raw values with labelled headers and a totals row', () => {
    expect(
      tabularReportToCsv({
        columns: [text, money],
        dataBasis: 'test',
        from: '2026-01-01',
        report: 'item-sales',
        rows: [
          { name: 'Panadol, 500mg', netSales: '1234.50' },
          { name: 'Brufen', netSales: '10.00' },
        ],
        title: 'Item sales',
        to: '2026-01-31',
        totals: { name: null, netSales: '1244.50' },
      }),
    ).toBe('Medicine,Net sales\r\n"Panadol, 500mg",1234.50\r\nBrufen,10.00\r\nTotal,1244.50');
  });
});
