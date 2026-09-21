import { describe, expect, it } from 'vitest';

import {
  calculatePurchaseLineTotal,
  calculatePurchaseOrderTotal,
  hasOutstandingQuantity,
  outstandingOrderQuantity,
  selectSubmittableReceiptLines,
} from './purchase-order';

const line = { lineDiscount: '0.00', orderedQuantity: '12', unitCost: '145.75' };

describe('purchase order arithmetic', () => {
  it('multiplies cost by quantity without floating point drift', () => {
    expect(calculatePurchaseLineTotal(line)).toBe('1749.00');
    expect(calculatePurchaseLineTotal({ ...line, orderedQuantity: '0.333' })).toBe('48.53');
  });

  it('subtracts the line discount in exact minor units', () => {
    expect(calculatePurchaseLineTotal({ ...line, lineDiscount: '49.00' })).toBe('1700.00');
    expect(calculatePurchaseLineTotal({ ...line, lineDiscount: '1749.00' })).toBe('0.00');
  });

  it('refuses a discount larger than the line gross cost', () => {
    expect(() => calculatePurchaseLineTotal({ ...line, lineDiscount: '1749.01' })).toThrow(
      /exceed the line gross cost/,
    );
    expect(() => calculatePurchaseLineTotal({ ...line, lineDiscount: '-1.00' })).toThrow(
      /cannot be negative/,
    );
  });

  it('totals an order from its own line totals', () => {
    expect(
      calculatePurchaseOrderTotal([
        line,
        { lineDiscount: '10.50', orderedQuantity: '3', unitCost: '99.99' },
      ]),
    ).toBe('2038.47');
    expect(calculatePurchaseOrderTotal([])).toBe('0.00');
  });
});

describe('goods receipt preparation', () => {
  it('reports the quantity still owed by the supplier', () => {
    expect(outstandingOrderQuantity({ ordered_qty: '100.000', received_qty: '40.500' })).toBe(
      '59.500',
    );
    expect(outstandingOrderQuantity({ ordered_qty: '100.000', received_qty: '100.000' })).toBe(
      '0.000',
    );
  });

  it('never reports a negative outstanding quantity after an over-receipt', () => {
    expect(outstandingOrderQuantity({ ordered_qty: '10.000', received_qty: '12.000' })).toBe(
      '0.000',
    );
    expect(hasOutstandingQuantity([{ ordered_qty: '10.000', received_qty: '12.000' }])).toBe(false);
    expect(hasOutstandingQuantity([{ ordered_qty: '10.000', received_qty: '9.999' }])).toBe(true);
  });

  it('submits only lines that carry a batch, expiry, price, and positive quantity', () => {
    const complete = {
      batchNumber: 'B-1',
      expiryDate: '2027-01-31',
      purchaseOrderItemId: '1',
      receivedBonusQuantity: '0',
      receivedQuantity: '10',
      salePricePerBaseUnit: '12.50',
    };
    const drafted = [
      complete,
      { ...complete, batchNumber: '   ', purchaseOrderItemId: '2' },
      { ...complete, expiryDate: '', purchaseOrderItemId: '3' },
      { ...complete, purchaseOrderItemId: '4', receivedQuantity: '0' },
      { ...complete, purchaseOrderItemId: '5', receivedQuantity: 'abc' },
      { ...complete, purchaseOrderItemId: '6', salePricePerBaseUnit: '' },
    ];
    expect(selectSubmittableReceiptLines(drafted)).toEqual([complete]);
  });
});
