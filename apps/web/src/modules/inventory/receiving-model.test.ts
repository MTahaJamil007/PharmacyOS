import { describe, expect, it } from 'vitest';

import {
  addLine,
  checkLine,
  lineKey,
  lineTotal,
  looksLikeScan,
  receiptTotal,
  updateLine,
  type ReceivingLine,
} from './receiving-model';

function line(overrides: Partial<ReceivingLine> = {}): ReceivingLine {
  const base: ReceivingLine = {
    key: lineKey('7', 'PN22'),
    medicineId: '7',
    name: 'Panadol',
    strength: '500mg',
    dosageForm: 'tablets',
    manufacturer: 'GSK',
    unitName: 'tablet',
    batchNumber: 'PN22',
    expiryDate: '2030-06-30',
    packs: '1',
    bonusPacks: '0',
    unitsPerPack: '10',
    costPerPack: '100',
    discount: '0',
    salePricePerUnit: '12.50',
    scannedCode: null,
    notes: [],
    checkBatch: false,
  };
  return { ...base, ...overrides };
}

describe('receiving a delivery', () => {
  it('counts one more pack each time the same batch is scanned', () => {
    let lines = addLine([], line());
    lines = addLine(lines, line());
    lines = addLine(lines, line({ batchNumber: 'pn22' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.packs).toBe('3');
    lines = addLine(lines, line({ key: 'row-2', batchNumber: 'OTHER' }));
    expect(lines).toHaveLength(2);
    expect(addLine(lines, line({ key: 'row-3', batchNumber: '' }))).toHaveLength(3);
  });

  it('keeps a row stable while its batch is edited, and merges by the new batch after', () => {
    const lines = updateLine([line()], lineKey('7', 'PN22'), { batchNumber: 'PN23' });
    expect(lines[0]!.key).toBe(lineKey('7', 'PN22'));
    expect(addLine(lines, line({ key: 'row-9', batchNumber: 'pn23' }))[0]!.packs).toBe('2');
  });

  it('totals in exact money', () => {
    expect(lineTotal(line({ packs: '3', costPerPack: '33.33', discount: '0.99' }))).toBe('99.00');
    expect(receiptTotal([line({ packs: '2' }), line({ costPerPack: '0.10', packs: '0.5' })])).toBe(
      '200.05',
    );
    expect(lineTotal(line({ packs: 'two' }))).toBeNull();
  });

  it('blocks expired, empty and impossible lines and warns below cost', () => {
    expect(checkLine(line(), '2026-10-22')).toEqual({ errors: [], warnings: [] });
    expect(checkLine(line({ expiryDate: '2026-10-01' }), '2026-10-22').errors).toContain(
      'This stock has expired',
    );
    expect(checkLine(line({ batchNumber: ' ', packs: '0' }), '2026-10-22').errors).toEqual([
      'Batch number is missing',
      'Packs must be more than 0',
    ]);
    expect(checkLine(line({ salePricePerUnit: '9' }), '2026-10-22').warnings).toEqual([
      'Selling price is below cost',
    ]);
    expect(checkLine(line({ discount: '150' }), '2026-10-22').errors).toContain(
      'Discount is more than the line',
    );
  });

  it('tells a scanner from a person typing a name', () => {
    expect(looksLikeScan('8964000121238')).toBe(true);
    expect(looksLikeScan('0108964000121238172706')).toBe(true);
    expect(looksLikeScan(']d20108964000121238')).toBe(true);
    expect(looksLikeScan('(01)08964000121238(17)270630')).toBe(true);
    expect(looksLikeScan('panadol')).toBe(false);
    expect(looksLikeScan('500')).toBe(false);
  });
});
