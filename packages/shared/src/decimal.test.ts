import { describe, expect, it } from 'vitest';

import {
  decimalToScaledInteger,
  multiplyMoneyByQuantity,
  scaledIntegerToDecimal,
} from './decimal.js';

describe('scaled decimal utilities', () => {
  it('preserves three-decimal quantities exactly', () => {
    expect(decimalToScaledInteger('12.375', 3)).toBe(12_375n);
    expect(scaledIntegerToDecimal(12_375n, 3)).toBe('12.375');
  });

  it('rounds extended line values to the nearest paisa', () => {
    expect(multiplyMoneyByQuantity('35.00', '1.500')).toBe('52.50');
    expect(multiplyMoneyByQuantity('10.01', '0.500')).toBe('5.01');
    expect(multiplyMoneyByQuantity('0.01', '0.400')).toBe('0.00');
    expect(multiplyMoneyByQuantity('-0.01', '0.500')).toBe('-0.01');
  });
});
