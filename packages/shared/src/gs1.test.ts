import { describe, expect, it } from 'vitest';

import {
  gtinCheckDigitValid,
  gtinLookupKeys,
  parseScannedCode,
  storedBarcodeForGtin,
} from './gs1.js';

const GS = '\u001d';
// A valid GTIN-14 (check digit 8) like those on Pakistani medicine packs.
const GTIN = '08964000121238';

describe('GS1 and barcode scanning', () => {
  it('checks GTIN check digits', () => {
    expect(gtinCheckDigitValid(GTIN)).toBe(true);
    expect(gtinCheckDigitValid('08964000121237')).toBe(false);
    expect(gtinCheckDigitValid('8964000121238')).toBe(true);
    expect(gtinCheckDigitValid('4006381333931')).toBe(true);
  });

  it('reads a DataMatrix with group separators in any field order', () => {
    const code = parseScannedCode(`01${GTIN}17270630` + `10AB12C${GS}21SN0099`);
    expect(code).toMatchObject({
      kind: 'GS1',
      gtin: GTIN,
      expiryDate: '2027-06-30',
      batch: 'AB12C',
      serial: 'SN0099',
      needsReview: false,
    });
    const reordered = parseScannedCode(`01${GTIN}21SN0099${GS}10AB12C${GS}17270630`);
    expect(reordered).toMatchObject({ batch: 'AB12C', serial: 'SN0099', expiryDate: '2027-06-30' });
  });

  it('accepts the symbology prefix and the bracketed human-readable form', () => {
    expect(parseScannedCode(`]d201${GTIN}17280100` + `10LOT-7`)).toMatchObject({
      gtin: GTIN,
      expiryDate: '2028-01-31',
      batch: 'LOT-7',
    });
    expect(parseScannedCode(`(01)${GTIN}(17)270630(10)B 55`)).toMatchObject({
      gtin: GTIN,
      expiryDate: '2027-06-30',
      batch: 'B 55',
    });
  });

  it('flags an inferred batch boundary when the scanner drops separators', () => {
    const code = parseScannedCode(`01${GTIN}10AB1217270630` + `21XYZ9`);
    expect(code.batch).toBe('AB12');
    expect(code.expiryDate).toBe('2027-06-30');
    expect(code.serial).toBe('XYZ9');
    expect(code.needsReview).toBe(true);
    expect(code.problems.join(' ')).toMatch(/check the batch/);
  });

  it('turns day 00 into the last day of the month and rejects impossible dates', () => {
    expect(parseScannedCode(`01${GTIN}17260200`).expiryDate).toBe('2026-02-28');
    const bad = parseScannedCode(`01${GTIN}17261340`);
    expect(bad.expiryDate).toBeNull();
    expect(bad.needsReview).toBe(true);
  });

  it('refuses a product number with a wrong check digit instead of guessing', () => {
    const code = parseScannedCode('010896400012123717270630');
    expect(code.gtin).toBeNull();
    expect(code.lookupKeys).toEqual([]);
    expect(code.needsReview).toBe(true);
  });

  it('reads plain EAN-13 and EAN-8 barcodes and looks them up in every stored form', () => {
    expect(parseScannedCode('8964000121238')).toMatchObject({
      kind: 'EAN',
      gtin: GTIN,
      lookupKeys: ['8964000121238', GTIN],
    });
    expect(parseScannedCode('96385074').kind).toBe('EAN');
    expect(parseScannedCode('8964000121237')).toMatchObject({ kind: 'OTHER', gtin: null });
    expect(gtinLookupKeys('00012345678905')).toEqual([
      '00012345678905',
      '0012345678905',
      '012345678905',
    ]);
    expect(storedBarcodeForGtin(GTIN)).toBe('8964000121238');
  });

  it('passes anything else through as an exact lookup only', () => {
    expect(parseScannedCode(' SKU-ABC \r\n')).toMatchObject({
      kind: 'OTHER',
      lookupKeys: ['SKU-ABC'],
      gtin: null,
    });
  });
});
