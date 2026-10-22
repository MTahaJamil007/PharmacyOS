import {
  calculateBudgetRegimen,
  decimalToScaledInteger,
  dosageUnitsPerDay,
  minorUnitsToMoney,
  parseDosage,
  moneyToMinorUnits,
  type BudgetRegimenResult,
} from '@pharmacy/shared';

import { calculateCartTotal, formatPkrMoney } from '../../money';
import type { CartLine } from '../../store';

/** Entered once per medicine; the counter sells whole units so the increment is an integer. */
export interface RegimenEntry {
  readonly unitsPerDay: string;
  readonly saleIncrement: string;
}

export const DEFAULT_REGIMEN: RegimenEntry = { unitsPerDay: '1', saleIncrement: '1' };

/** A line's timing already says how much is taken a day, so the plan reads it from there. */
export function regimenForLine(line: CartLine): RegimenEntry {
  if (!line.dosage) return DEFAULT_REGIMEN;
  const parsed = parseDosage(line.dosage);
  return 'schedule' in parsed
    ? { unitsPerDay: dosageUnitsPerDay(parsed.schedule), saleIncrement: '1' }
    : DEFAULT_REGIMEN;
}

const UNITS_PATTERN = /^\d{1,6}(?:\.\d{1,3})?$/;
const INCREMENT_PATTERN = /^\d{1,6}$/;
const BUDGET_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

export function regimenEntryError(entry: RegimenEntry): string | null {
  const units = entry.unitsPerDay.trim();
  if (!UNITS_PATTERN.test(units) || decimalToScaledInteger(units, 3) <= 0n) {
    return 'Units per day must be a positive number (up to 3 decimals)';
  }
  const increment = entry.saleIncrement.trim();
  if (!INCREMENT_PATTERN.test(increment) || BigInt(increment) <= 0n) {
    return 'Sale step must be a whole number of units, 1 or more';
  }
  return null;
}

export interface BudgetAllocation {
  readonly budgetForPlan: string;
  readonly otherItemsTotal: string;
  readonly error?: string;
}

/**
 * The customer's money is for the whole ticket. When the unticked items stay in the cart, their
 * cost comes out of the budget first so the plan never promises days the customer cannot pay for.
 */
export function allocateBudget(
  budget: string,
  otherLines: readonly CartLine[],
  includeOtherItems: boolean,
): BudgetAllocation {
  const otherItemsTotal = calculateCartTotal(
    otherLines.map((line) => ({ quantity: line.quantity, unitPrice: line.medicine.salePrice })),
  );
  const trimmed = budget.trim();
  if (!BUDGET_PATTERN.test(trimmed)) {
    return {
      budgetForPlan: '0.00',
      otherItemsTotal,
      error: 'Enter the customer budget in rupees',
    };
  }
  const available =
    moneyToMinorUnits(trimmed) - (includeOtherItems ? moneyToMinorUnits(otherItemsTotal) : 0n);
  if (available <= 0n) {
    return {
      budgetForPlan: '0.00',
      otherItemsTotal,
      error: `The budget does not cover the other items on the ticket (${formatPkrMoney(otherItemsTotal)})`,
    };
  }
  return { budgetForPlan: minorUnitsToMoney(available), otherItemsTotal };
}

export function plannedQuantities(
  result: BudgetRegimenResult,
): { readonly quantities: Readonly<Record<string, number>> } | { readonly error: string } {
  if (result.completeDays < 1) {
    return { error: 'The budget does not cover one complete day of this regimen' };
  }
  const quantities: Record<string, number> = {};
  for (const line of result.lines) {
    const milli = decimalToScaledInteger(line.requiredQuantity, 3);
    if (milli % 1000n !== 0n) {
      return { error: `${line.medicineName} needs a part unit; use a whole-unit sale step` };
    }
    const units = Number(milli / 1000n);
    if (!Number.isSafeInteger(units) || units < 1) {
      return { error: `${line.medicineName} quantity is out of range` };
    }
    quantities[line.medicineId] = units;
  }
  return { quantities };
}

/** Offline training mode uses the same exact calculation as the server, priced from the cart. */
export function calculateBudgetLocally(
  budget: string,
  lines: readonly CartLine[],
  regimen: Readonly<Record<string, RegimenEntry>>,
): BudgetRegimenResult {
  return calculateBudgetRegimen(
    budget,
    lines.map((line) => {
      const entry = regimen[line.medicine.id] ?? regimenForLine(line);
      return {
        medicineId: line.medicine.id,
        medicineName: line.medicine.name,
        prescribedBaseUnitsPerDay: entry.unitsPerDay.trim(),
        minimumSaleIncrement: entry.saleIncrement.trim(),
        unitPrice: line.medicine.salePrice ?? '0.00',
        priceVersion: 'local',
      };
    }),
  );
}
