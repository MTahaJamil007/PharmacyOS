import { describe, expect, it } from 'vitest';

import type { CartLine } from '../../store';
import {
  allocateBudget,
  calculateBudgetLocally,
  plannedQuantities,
  regimenEntryError,
} from './budget-plan';

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
      strength: null,
    },
    quantity,
  };
}

const panadol = line('1', 'Panadol', '75.36', 1);
const amoxil = line('2', 'Amoxil', '289.30', 1);
const syrup = line('3', 'Syrup', '150.00', 2);

describe('budget plan inputs', () => {
  it('requires positive daily units and whole-unit sale steps', () => {
    expect(regimenEntryError({ unitsPerDay: '1.5', saleIncrement: '1' })).toBeNull();
    expect(regimenEntryError({ unitsPerDay: '0', saleIncrement: '1' })).not.toBeNull();
    expect(regimenEntryError({ unitsPerDay: 'two', saleIncrement: '1' })).not.toBeNull();
    expect(regimenEntryError({ unitsPerDay: '2', saleIncrement: '0.5' })).not.toBeNull();
    expect(regimenEntryError({ unitsPerDay: '2', saleIncrement: '0' })).not.toBeNull();
  });

  it('takes the unticked items out of the budget first', () => {
    expect(allocateBudget('1000', [syrup], true)).toEqual({
      budgetForPlan: '700.00',
      otherItemsTotal: '300.00',
    });
    expect(allocateBudget('1000', [syrup], false).budgetForPlan).toBe('1000.00');
    expect(allocateBudget('250', [syrup], true).error).toMatch(/does not cover the other items/);
    expect(allocateBudget('12,000', [], true).error).toBe('Enter the customer budget in rupees');
  });
});

describe('planned quantities', () => {
  it('turns complete days into whole cart quantities for only the ticked lines', () => {
    const result = calculateBudgetLocally('1000', [panadol, amoxil], {
      '1': { unitsPerDay: '1.5', saleIncrement: '1' },
      '2': { unitsPerDay: '1', saleIncrement: '1' },
    });
    expect(result.completeDays).toBe(2);
    expect(plannedQuantities(result)).toEqual({ quantities: { '1': 3, '2': 2 } });
  });

  it('refuses to apply a plan that cannot cover one day', () => {
    const result = calculateBudgetLocally('100', [amoxil], {});
    expect(result.completeDays).toBe(0);
    expect(plannedQuantities(result)).toEqual({
      error: 'The budget does not cover one complete day of this regimen',
    });
  });
});
