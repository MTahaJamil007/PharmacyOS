import { describe, expect, it } from 'vitest';

import { normalizeHeading, parseCatalogFile, parseCsv } from './catalog-csv';

describe('catalog CSV parsing', () => {
  it('splits quoted fields containing commas, quotes, and newlines', () => {
    expect(parseCsv('a,"b,c","say ""hi""","line\nbreak"')).toEqual([
      ['a', 'b,c', 'say "hi"', 'line\nbreak'],
    ]);
  });

  it('handles CRLF line endings and drops blank lines', () => {
    expect(parseCsv('name,sku\r\nPanadol,P1\r\n\r\nBrufen,B1\r\n')).toEqual([
      ['name', 'sku'],
      ['Panadol', 'P1'],
      ['Brufen', 'B1'],
    ]);
  });

  it('accepts the common spellings of each heading', () => {
    expect(normalizeHeading('Brand Name')).toBe('name');
    expect(normalizeHeading('  GENERIC_NAME ')).toBe('genericName');
    expect(normalizeHeading('EAN')).toBe('barcode');
    expect(normalizeHeading('Rack')).toBeNull();
  });
});

describe('catalog file mapping', () => {
  const file = [
    'Brand Name,Generic,Pack,Barcode,Rx,Rack,Tax',
    'Panadol,Paracetamol,20,8964000123456,yes,A-03,17',
    'Brufen,Ibuprofen,,8964000654321,no,B-01,',
  ].join('\n');

  it('maps recognized columns and reports the ignored ones', () => {
    const result = parseCatalogFile(file);
    expect(result.recognizedColumns).toEqual([
      'Brand Name',
      'Generic',
      'Pack',
      'Barcode',
      'Rx',
      'Tax',
    ]);
    expect(result.ignoredColumns).toEqual(['Rack']);
  });

  it('omits blank cells so the server applies its own defaults', () => {
    const [, second] = parseCatalogFile(file).rows;
    expect(second).toEqual({
      barcode: '8964000654321',
      genericName: 'Ibuprofen',
      name: 'Brufen',
      requiresPrescription: false,
    });
  });

  it('coerces prescription flags to booleans', () => {
    const [first] = parseCatalogFile(file).rows;
    expect(first).toMatchObject({
      barcode: '8964000123456',
      name: 'Panadol',
      packSize: '20',
      requiresPrescription: true,
      taxRate: '17',
    });
  });

  it('keeps an unrecognizable boolean as text so the server reports it', () => {
    const [row] = parseCatalogFile('name,rx\nPanadol,maybe').rows;
    expect(row).toMatchObject({ requiresPrescription: 'maybe' });
  });

  it('upper-cases the storage class so a lower-case export still matches the enum', () => {
    const [row] = parseCatalogFile('name,storage\nInsulin,cold').rows;
    expect(row).toMatchObject({ storageClass: 'COLD' });
  });

  it('returns nothing for an empty file', () => {
    expect(parseCatalogFile('')).toEqual({
      ignoredColumns: [],
      recognizedColumns: [],
      rows: [],
    });
  });
});
