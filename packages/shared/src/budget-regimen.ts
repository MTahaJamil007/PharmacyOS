import {
  decimalToScaledInteger,
  multiplyMoneyByQuantity,
  scaledIntegerToDecimal,
} from './decimal.js';
import { minorUnitsToMoney, moneyToMinorUnits } from './money.js';

export interface PricedRegimenItem {
  readonly medicineId: string;
  readonly medicineName: string;
  readonly prescribedBaseUnitsPerDay: string;
  readonly minimumSaleIncrement: string;
  readonly unitPrice: string;
  readonly priceVersion: string;
}

export interface BudgetRegimenLine {
  readonly medicineId: string;
  readonly medicineName: string;
  readonly requiredQuantity: string;
  readonly unitPrice: string;
  readonly lineCost: string;
  readonly priceVersion: string;
}

export interface BudgetRegimenResult {
  readonly completeDays: number;
  readonly totalCost: string;
  readonly remainder: string;
  readonly oneDayCost: string;
  readonly lines: readonly BudgetRegimenLine[];
  readonly safetyMessage: string;
}

const MAX_CALCULATION_DAYS = 3650;

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n)
    throw new Error('Ceiling division requires non-negative values');
  return (numerator + denominator - 1n) / denominator;
}

function calculateAtDays(
  items: readonly PricedRegimenItem[],
  days: number,
): {
  readonly cost: bigint;
  readonly lines: readonly BudgetRegimenLine[];
} {
  const lines = items.map((item) => {
    const dailyQuantity = decimalToScaledInteger(item.prescribedBaseUnitsPerDay, 3);
    const increment = decimalToScaledInteger(item.minimumSaleIncrement, 3);
    if (dailyQuantity <= 0n || increment <= 0n)
      throw new Error('Regimen quantities must be positive');
    const required = dailyQuantity * BigInt(days);
    const sellable = ceilDivide(required, increment) * increment;
    const requiredQuantity = scaledIntegerToDecimal(sellable, 3);
    const lineCost = multiplyMoneyByQuantity(item.unitPrice, requiredQuantity);
    return {
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      requiredQuantity,
      unitPrice: item.unitPrice,
      lineCost,
      priceVersion: item.priceVersion,
    };
  });
  return {
    cost: lines.reduce((total, line) => total + moneyToMinorUnits(line.lineCost), 0n),
    lines,
  };
}

export function calculateBudgetRegimen(
  budget: string,
  items: readonly PricedRegimenItem[],
): BudgetRegimenResult {
  if (items.length === 0) throw new Error('At least one regimen item is required');
  const budgetMinor = moneyToMinorUnits(budget);
  if (budgetMinor < 0n) throw new Error('Budget cannot be negative');

  const oneDay = calculateAtDays(items, 1);
  let completeDays = 0;
  if (oneDay.cost <= budgetMinor) {
    let low = 1;
    let high = 2;
    while (high < MAX_CALCULATION_DAYS && calculateAtDays(items, high).cost <= budgetMinor) {
      low = high;
      high = Math.min(high * 2, MAX_CALCULATION_DAYS);
    }
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (calculateAtDays(items, middle).cost <= budgetMinor) {
        completeDays = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
  }

  const result = calculateAtDays(items, completeDays);
  return {
    completeDays,
    totalCost: minorUnitsToMoney(result.cost),
    remainder: minorUnitsToMoney(budgetMinor - result.cost),
    oneDayCost: minorUnitsToMoney(oneDay.cost),
    lines: result.lines,
    safetyMessage:
      'Affordability only: this calculation does not change the entered dose, frequency, strength, medicine, or clinical instruction.',
  };
}
