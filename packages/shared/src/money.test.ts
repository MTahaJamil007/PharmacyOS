import { describe, expect, it } from 'vitest';

import { minorUnitsToMoney, moneyToMinorUnits, sumMoney } from './money.js';

describe('money utilities', () => {
  it('converts exact PKR values without floating point arithmetic', () => {
    expect(moneyToMinorUnits('1250.05')).toBe(125005n);
    expect(minorUnitsToMoney(-99n)).toBe('-0.99');
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
  });

  it('rejects precision beyond paisa', () => {
    expect(() => moneyToMinorUnits('1.001')).toThrow('Invalid money value');
  });
});
