import { describe, expect, it } from 'vitest';

import { formatMoney } from './format';
import { calculateCartLineTotal, calculateCartTotal } from './money';

describe('exact browser money', () => {
  it('totals cart lines without converting money to floating point', () => {
    expect(
      calculateCartTotal([
        { quantity: 3, unitPrice: '0.10' },
        { quantity: 2, unitPrice: '1250.05' },
      ]),
    ).toBe('2500.40');
    expect(calculateCartLineTotal({ quantity: 3, unitPrice: '0.10' })).toBe('0.30');
  });

  it('formats the complete database money range from its exact decimal string', () => {
    expect(formatMoney('9999999999.99')).toBe('Rs 9,999,999,999.99');
    expect(formatMoney('-0.05')).toBe('−Rs 0.05');
  });
});
