import { describe, expect, it } from 'vitest';

import {
  daysLabel,
  formatDate,
  formatMoney,
  formatQuantity,
  normalizeMoney,
  shiftIsoDate,
} from './format';

describe('display formatting', () => {
  it('formats money exactly and groups thousands', () => {
    expect(formatMoney('9999999999.99')).toBe('Rs 9,999,999,999.99');
    expect(formatMoney('0')).toBe('Rs 0.00');
    expect(formatMoney('-0.05')).toBe('−Rs 0.05');
    expect(formatMoney(null)).toBe('—');
  });

  it('tolerates database values with more decimal places instead of crashing', () => {
    expect(normalizeMoney('1003245.00000000000')).toBe('1003245.00');
    expect(normalizeMoney('109.5000000000000000')).toBe('109.50');
    expect(normalizeMoney('2.345')).toBe('2.35');
    expect(normalizeMoney('not money')).toBeNull();
  });

  it('shows quantities without trailing zeros', () => {
    expect(formatQuantity('49.000')).toBe('49');
    expect(formatQuantity('0.500')).toBe('0.5');
    expect(formatQuantity('12500.250')).toBe('12,500.25');
  });

  it('keeps a calendar date on its own day', () => {
    expect(formatDate('2026-03-02')).toBe('02 Mar 2026');
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('describes days to expiry in plain words', () => {
    expect(daysLabel(-3)).toBe('expired 3d ago');
    expect(daysLabel(0)).toBe('expires today');
    expect(daysLabel(45)).toBe('45 days');
    expect(daysLabel(180)).toBe('6 months');
  });
});
