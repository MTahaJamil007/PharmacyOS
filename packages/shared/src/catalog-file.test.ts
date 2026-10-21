import { describe, expect, it } from 'vitest';

import {
  NON_CONTRACT_FIELDS,
  normalizeHeading,
  parseCatalogFile,
  parseCsv,
} from './catalog-file.js';

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

  it('reads the price and company columns a supplier or regulator file carries', () => {
    const result = parseCatalogFile(
      [
        'Item Code,Brand Name,Generic,MRP,Trade Price,Company',
        'PK-1,Panadol,Paracetamol,75.36,60.29,GSK Pakistan',
      ].join('\n'),
    );
    expect(result.ignoredColumns).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      costPrice: '60.29',
      manufacturerName: 'GSK Pakistan',
      name: 'Panadol',
      salePrice: '75.36',
      sku: 'PK-1',
    });
  });

  it('names the fields the catalog contract does not carry', () => {
    expect([...NON_CONTRACT_FIELDS].sort()).toEqual(['costPrice', 'manufacturerName', 'salePrice']);
    const [row] = parseCatalogFile(['name,price', 'Panadol,75.36'].join('\n')).rows;
    const contractRow = Object.fromEntries(
      Object.entries(row ?? {}).filter(([field]) => !NON_CONTRACT_FIELDS.includes(field)),
    );
    expect(contractRow).toEqual({ name: 'Panadol' });
  });

  it('accepts the price spellings a Pakistani price list uses', () => {
    for (const heading of ['MRP', 'Maximum Retail Price', 'Retail Price', 'Consumer Price']) {
      expect(normalizeHeading(heading)).toBe('salePrice');
    }
    for (const heading of ['Trade Price', 'Purchase Price', 'Cost Price']) {
      expect(normalizeHeading(heading)).toBe('costPrice');
    }
  });

  it('returns nothing for an empty file', () => {
    expect(parseCatalogFile('')).toEqual({
      ignoredColumns: [],
      recognizedColumns: [],
      rows: [],
    });
  });
});
