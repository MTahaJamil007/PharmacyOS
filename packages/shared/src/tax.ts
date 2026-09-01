import { decimalToScaledInteger, scaledIntegerToDecimal } from './decimal.js';
import { minorUnitsToMoney, moneyToMinorUnits } from './money.js';

export interface InclusiveTaxBreakdown {
  readonly gross: string;
  readonly net: string;
  readonly tax: string;
  readonly rate: string;
}

export function calculateInclusiveTax(gross: string, rate: string): InclusiveTaxBreakdown {
  const grossMinor = moneyToMinorUnits(gross);
  const rateBasisPoints = decimalToScaledInteger(rate, 2);
  if (grossMinor < 0n) throw new Error('Taxable gross amount cannot be negative');
  if (rateBasisPoints < 0n || rateBasisPoints > 10_000n) {
    throw new Error('Tax rate must be between 0 and 100 percent');
  }

  const denominator = 10_000n + rateBasisPoints;
  const taxMinor = (grossMinor * rateBasisPoints + denominator / 2n) / denominator;
  return {
    gross: minorUnitsToMoney(grossMinor),
    net: minorUnitsToMoney(grossMinor - taxMinor),
    tax: minorUnitsToMoney(taxMinor),
    rate: scaledIntegerToDecimal(rateBasisPoints, 2),
  };
}

export function allocateMoneyProportionally(
  total: string,
  weights: readonly string[],
): readonly string[] {
  const totalMinor = moneyToMinorUnits(total);
  const weightMinor = weights.map(moneyToMinorUnits);
  const weightTotal = weightMinor.reduce((sum, value) => sum + value, 0n);
  if (totalMinor < 0n || weightMinor.some((value) => value < 0n)) {
    throw new Error('Allocation values cannot be negative');
  }
  if (totalMinor > weightTotal) throw new Error('Allocation exceeds its weights');
  if (weights.length === 0) return [];

  let allocated = 0n;
  return weightMinor.map((weight, index) => {
    const share =
      index === weightMinor.length - 1
        ? totalMinor - allocated
        : weightTotal === 0n
          ? 0n
          : (totalMinor * weight) / weightTotal;
    allocated += share;
    return minorUnitsToMoney(share);
  });
}
