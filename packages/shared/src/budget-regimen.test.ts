import { describe, expect, it } from 'vitest';

import { calculateBudgetRegimen } from './budget-regimen.js';

describe('budget regimen money rounding', () => {
  it('uses the same nearest-paisa rule as a finalized sale line', () => {
    const result = calculateBudgetRegimen('0.00', [
      {
        medicineId: '1',
        medicineName: 'Fractional Medicine',
        minimumSaleIncrement: '0.400',
        prescribedBaseUnitsPerDay: '0.400',
        priceVersion: 'batch-1',
        unitPrice: '0.01',
      },
    ]);

    expect(result.completeDays).toBe(1);
    expect(result.oneDayCost).toBe('0.00');
    expect(result.totalCost).toBe('0.00');
    expect(result.lines[0]?.lineCost).toBe('0.00');
  });

  it('returns zero complete days instead of a partial dose below the one-day cost', () => {
    const result = calculateBudgetRegimen('2.59', [
      {
        medicineId: '1',
        medicineName: 'Pack-rounded medicine',
        minimumSaleIncrement: '2',
        prescribedBaseUnitsPerDay: '1.5',
        priceVersion: 'batch-1',
        unitPrice: '1.25',
      },
      {
        medicineId: '2',
        medicineName: 'Second medicine',
        minimumSaleIncrement: '1',
        prescribedBaseUnitsPerDay: '0.5',
        priceVersion: 'batch-2',
        unitPrice: '0.10',
      },
    ]);

    expect(result.completeDays).toBe(0);
    expect(result.oneDayCost).toBe('2.60');
    expect(result.totalCost).toBe('0.00');
    expect(result.lines.map((line) => line.requiredQuantity)).toEqual(['0.000', '0.000']);
  });

  it('maximizes only complete days at an exact multi-medicine budget with pack rounding', () => {
    const result = calculateBudgetRegimen('5.10', [
      {
        medicineId: '1',
        medicineName: 'Pack-rounded medicine',
        minimumSaleIncrement: '2',
        prescribedBaseUnitsPerDay: '1.5',
        priceVersion: 'batch-1',
        unitPrice: '1.25',
      },
      {
        medicineId: '2',
        medicineName: 'Second medicine',
        minimumSaleIncrement: '1',
        prescribedBaseUnitsPerDay: '0.5',
        priceVersion: 'batch-2',
        unitPrice: '0.10',
      },
    ]);

    expect(result.completeDays).toBe(2);
    expect(result.totalCost).toBe('5.10');
    expect(result.remainder).toBe('0.00');
    expect(result.lines.map((line) => line.requiredQuantity)).toEqual(['4.000', '1.000']);
  });

  it('keeps fractional-unit optimization exact without binary floating-point drift', () => {
    const result = calculateBudgetRegimen('0.30', [
      {
        medicineId: '1',
        medicineName: 'Fractional exact medicine',
        minimumSaleIncrement: '0.001',
        prescribedBaseUnitsPerDay: '0.333',
        priceVersion: 'batch-1',
        unitPrice: '0.10',
      },
    ]);

    expect(result.completeDays).toBe(9);
    expect(result.totalCost).toBe('0.30');
    expect(result.lines[0]?.requiredQuantity).toBe('2.997');
  });
});
