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
});
