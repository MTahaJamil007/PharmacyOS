import { describe, expect, it } from 'vitest';

import { normalizeExpiryDate, parseOpeningStockFile } from './opening-stock-csv';

describe('opening stock file parsing', () => {
  it('maps common headings and cleans numbers', () => {
    const result = parseOpeningStockFile(
      '﻿Item Code,Batch No,Exp,Qty,Trade Price,Retail Price,MRP,Shelf\r\nPAN-1,B1,03/2027,"1,200",Rs 1.10,1.60,1.75,A1\r\n',
    );
    expect(result.recognizedColumns).toEqual([
      'Item Code',
      'Batch No',
      'Exp',
      'Qty',
      'Trade Price',
      'Retail Price',
      'MRP',
    ]);
    expect(result.ignoredColumns).toEqual(['Shelf']);
    expect(result.rows).toEqual([
      {
        batchNumber: 'B1',
        costPrice: '1.10',
        expiryDate: '2027-03-31',
        maximumRetailPrice: '1.75',
        quantity: '1200',
        salePrice: '1.60',
        sku: 'PAN-1',
      },
    ]);
  });

  it('reads day-first and month-name expiry dates', () => {
    expect(normalizeExpiryDate('2027-02-28')).toBe('2027-02-28');
    expect(normalizeExpiryDate('05/04/2027')).toBe('2027-04-05');
    expect(normalizeExpiryDate('5-4-27')).toBe('2027-04-05');
    expect(normalizeExpiryDate('02/2028')).toBe('2028-02-29');
    expect(normalizeExpiryDate('MAR-27')).toBe('2027-03-31');
    expect(normalizeExpiryDate('March 2027')).toBe('2027-03-31');
  });

  it('leaves impossible dates for the server to reject on the right row', () => {
    expect(normalizeExpiryDate('31/02/2027')).toBe('31/02/2027');
    expect(normalizeExpiryDate('soon')).toBe('soon');
  });
});
