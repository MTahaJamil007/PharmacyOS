import { describe, expect, it } from 'vitest';

import { allocateMoneyProportionally, calculateInclusiveTax } from './tax.js';

describe('inclusive tax arithmetic', () => {
  it('extracts tax without floating-point arithmetic', () => {
    expect(calculateInclusiveTax('1180.00', '18.00')).toEqual({
      gross: '1180.00',
      net: '1000.00',
      tax: '180.00',
      rate: '18.00',
    });
  });

  it('rounds half-up to the nearest paisa and preserves the gross total', () => {
    const result = calculateInclusiveTax('0.10', '18');
    expect(result.tax).toBe('0.02');
    expect(BigInt(result.net.replace('.', '')) + BigInt(result.tax.replace('.', ''))).toBe(10n);
  });

  it('allocates the exact total with deterministic remainder placement', () => {
    expect(allocateMoneyProportionally('1.00', ['1.00', '1.00', '1.00'])).toEqual([
      '0.33',
      '0.33',
      '0.34',
    ]);
  });
});
