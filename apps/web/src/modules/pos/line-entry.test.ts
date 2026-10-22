import { parseDosage } from '@pharmacy/shared';
import { describe, expect, it } from 'vitest';

import {
  discountShorthand,
  parseDiscountShorthand,
  parseQuantityEntry,
  parseTimingEntry,
} from './line-entry';

function schedule(code: string) {
  const parsed = parseDosage(code);
  if (!('schedule' in parsed)) throw new Error(parsed.error);
  return parsed.schedule;
}

describe('quantity entry', () => {
  it('has no default and accepts units or days of the timing', () => {
    expect(parseQuantityEntry('', null)).toEqual({ error: 'Enter a quantity, or days such as 5d' });
    expect(parseQuantityEntry('20', null)).toEqual({ quantity: 20 });
    expect(parseQuantityEntry('0', null)).toEqual({ error: 'Quantity must be at least 1' });
    expect(parseQuantityEntry('5d', schedule('111'))).toEqual({ quantity: 15, days: 5 });
    expect(parseQuantityEntry('5 days', schedule('h0h'))).toEqual({ quantity: 5, days: 5 });
    expect(parseQuantityEntry('3d', schedule('h00'))).toEqual({ quantity: 2, days: 3 });
    expect(parseQuantityEntry('5d', null)).toEqual({
      error: 'Choose a timing first to sell by days',
    });
    expect('error' in parseQuantityEntry('2.5', null)).toBe(true);
  });

  it('treats an empty timing as optional and rejects a malformed one', () => {
    expect(parseTimingEntry('  ')).toEqual({ schedule: null });
    expect(parseTimingEntry('101')).toEqual({ schedule: schedule('101') });
    expect('error' in parseTimingEntry('12')).toBe(true);
  });
});

describe('discount shorthand', () => {
  it.each([
    ['10', { mode: 'PERCENT', value: '10' }],
    ['12.5%', { mode: 'PERCENT', value: '12.5' }],
    ['50r', { mode: 'AMOUNT', value: '50' }],
    ['Rs 50', { mode: 'AMOUNT', value: '50' }],
    ['75.50rs', { mode: 'AMOUNT', value: '75.50' }],
    ['100/-', { mode: 'AMOUNT', value: '100' }],
  ])('reads %s', (input, spec) => {
    expect(parseDiscountShorthand(input)).toEqual({ spec });
  });

  it('clears on empty or zero and rejects nonsense', () => {
    expect(parseDiscountShorthand('')).toEqual({ spec: null });
    expect(parseDiscountShorthand('0')).toEqual({ spec: null });
    expect('error' in parseDiscountShorthand('150')).toBe(true);
    expect('error' in parseDiscountShorthand('ten')).toBe(true);
  });

  it('shows a spec back in the same shorthand', () => {
    expect(discountShorthand({ mode: 'PERCENT', value: '10' })).toBe('10%');
    expect(discountShorthand({ mode: 'AMOUNT', value: '50' })).toBe('50r');
    expect(discountShorthand(null)).toBe('');
  });
});
