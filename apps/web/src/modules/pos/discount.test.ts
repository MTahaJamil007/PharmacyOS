import { describe, expect, it } from 'vitest';

import type { CartLine } from '../../store';
import {
  buildDiscountPlan,
  discountRequestBody,
  discountSignature,
  EMPTY_DISCOUNTS,
  isDiscountSpec,
  parseDiscountSpec,
  resolveDiscountMinor,
} from './discount';

function line(id: string, name: string, price: string, quantity: number): CartLine {
  return {
    medicine: {
      availableQuantity: '100.000',
      barcode: null,
      daysToExpiry: 200,
      genericName: null,
      id,
      manufacturer: null,
      name,
      nearestExpiry: '2027-12-01',
      salePrice: price,
      shelf: null,
      strength: '500 mg',
    },
    quantity,
  };
}

const cart = [line('1', 'Panadol', '75.36', 3), line('2', 'Amoxil', '289.30', 2)];

describe('discount specs', () => {
  it('accepts exact percentages and amounts and rejects malformed input', () => {
    expect(parseDiscountSpec('PERCENT', '12.5')).toEqual({
      spec: { mode: 'PERCENT', value: '12.5' },
    });
    expect(parseDiscountSpec('AMOUNT', ' 40 ')).toEqual({ spec: { mode: 'AMOUNT', value: '40' } });
    expect(parseDiscountSpec('AMOUNT', '')).toEqual({ spec: null });
    expect(parseDiscountSpec('AMOUNT', '0.00')).toEqual({ spec: null });
    expect(parseDiscountSpec('AMOUNT', 'abc').error).toBeDefined();
    expect(parseDiscountSpec('AMOUNT', '1.005').error).toBeDefined();
    expect(parseDiscountSpec('PERCENT', '100.01').error).toBe('A percentage cannot exceed 100%');
    expect(isDiscountSpec({ mode: 'PERCENT', value: '5' })).toBe(true);
    expect(isDiscountSpec({ mode: 'PERCENT', value: '-5' })).toBe(false);
    expect(isDiscountSpec({ mode: 'FREE', value: '5' })).toBe(false);
  });

  it('rounds percentages half up to the nearest paisa', () => {
    expect(resolveDiscountMinor({ mode: 'PERCENT', value: '10' }, 22_608n)).toBe(2_261n);
    expect(resolveDiscountMinor({ mode: 'PERCENT', value: '12.5' }, 1n)).toBe(0n);
    expect(resolveDiscountMinor({ mode: 'PERCENT', value: '50' }, 1n)).toBe(1n);
  });
});

describe('discount plan', () => {
  it('applies line discounts before the invoice discount', () => {
    const plan = buildDiscountPlan(cart, {
      lines: { '1': { mode: 'PERCENT', value: '10' }, '2': { mode: 'AMOUNT', value: '78.60' } },
      invoice: { mode: 'AMOUNT', value: '50' },
      reason: 'Regular customer',
    });
    expect(plan).toMatchObject({
      gross: '804.68',
      lineDiscountTotal: '101.21',
      invoiceDiscount: '50.00',
      discountTotal: '151.21',
      total: '653.47',
      discountPercent: '18.79',
      hasDiscount: true,
      errors: [],
    });
    expect(discountRequestBody(plan)).toEqual({
      lineDiscounts: [
        { medicineId: '1', amount: '22.61' },
        { medicineId: '2', amount: '78.60' },
      ],
      invoiceDiscount: '50.00',
    });
  });

  it('computes an invoice percentage on the already discounted subtotal', () => {
    const plan = buildDiscountPlan(cart, {
      lines: { '2': { mode: 'PERCENT', value: '100' } },
      invoice: { mode: 'PERCENT', value: '10' },
      reason: 'Price match',
    });
    expect(plan.invoiceDiscount).toBe('22.61');
    expect(plan.total).toBe('203.47');
  });

  it('blocks discounts that exceed value, zero the bill or have no reason', () => {
    expect(
      buildDiscountPlan(cart, {
        lines: { '1': { mode: 'AMOUNT', value: '500' } },
        invoice: null,
        reason: 'Regular customer',
      }).errors,
    ).toContain('Panadol: discount is more than the line value');
    expect(
      buildDiscountPlan(cart, {
        lines: {},
        invoice: { mode: 'PERCENT', value: '100' },
        reason: 'Regular customer',
      }).errors,
    ).toContain('Discount must leave something to pay');
    expect(
      buildDiscountPlan(cart, { lines: {}, invoice: { mode: 'AMOUNT', value: '5' }, reason: ' ' })
        .errors,
    ).toContain('Choose or type a discount reason');
  });

  it('signs only the money that reaches the server', () => {
    const none = buildDiscountPlan(cart, EMPTY_DISCOUNTS);
    expect(none.hasDiscount).toBe(false);
    expect(discountSignature(none, 'anything')).toBe('');
    const first = buildDiscountPlan(cart, {
      ...EMPTY_DISCOUNTS,
      invoice: { mode: 'PERCENT', value: '5' },
      reason: 'Regular customer',
    });
    const same = buildDiscountPlan(cart, {
      ...EMPTY_DISCOUNTS,
      invoice: { mode: 'AMOUNT', value: '40.23' },
      reason: 'Regular customer',
    });
    expect(discountSignature(first, 'Regular customer')).toBe(
      discountSignature(same, 'Regular customer'),
    );
    expect(discountSignature(first, 'Staff purchase')).not.toBe(
      discountSignature(first, 'Regular customer'),
    );
  });
});
