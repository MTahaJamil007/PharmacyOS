import {
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  scaledIntegerToDecimal,
} from '@pharmacy/shared';

import type { CartLine } from '../../store';

export type DiscountMode = 'PERCENT' | 'AMOUNT';

/**
 * What the cashier entered, not the resulting money. A percentage is kept as a percentage so a
 * quantity change after discounting still yields the right amount.
 */
export interface DiscountSpec {
  readonly mode: DiscountMode;
  readonly value: string;
}

export interface CartDiscounts {
  readonly lines: Readonly<Record<string, DiscountSpec>>;
  readonly invoice: DiscountSpec | null;
  readonly reason: string;
}

export const EMPTY_DISCOUNTS: CartDiscounts = { lines: {}, invoice: null, reason: '' };

export const DISCOUNT_REASONS = [
  'Regular customer',
  'Senior citizen',
  'Staff purchase',
  'Bulk purchase',
  'Price match',
  'Damaged packaging',
] as const;

const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/;
const AMOUNT_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

export function parseDiscountSpec(
  mode: DiscountMode,
  raw: string,
): { readonly spec: DiscountSpec | null; readonly error?: string } {
  const value = raw.trim();
  if (value === '') return { spec: null };
  if (mode === 'PERCENT') {
    if (!PERCENT_PATTERN.test(value)) {
      return { spec: null, error: 'Enter a percentage with up to 2 decimals' };
    }
    const hundredths = moneyToMinorUnits(value);
    if (hundredths === 0n) return { spec: null };
    if (hundredths > 10_000n) return { spec: null, error: 'A percentage cannot exceed 100%' };
    return { spec: { mode, value } };
  }
  if (!AMOUNT_PATTERN.test(value)) {
    return { spec: null, error: 'Enter an amount in rupees with up to 2 decimals' };
  }
  if (moneyToMinorUnits(value) === 0n) return { spec: null };
  return { spec: { mode, value } };
}

export function isDiscountSpec(value: unknown): value is DiscountSpec {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DiscountSpec>;
  if (candidate.mode !== 'PERCENT' && candidate.mode !== 'AMOUNT') return false;
  if (typeof candidate.value !== 'string') return false;
  const parsed = parseDiscountSpec(candidate.mode, candidate.value);
  return parsed.spec !== null && parsed.error === undefined;
}

/** Rounds half up to the nearest paisa, matching the server's money rounding. */
export function resolveDiscountMinor(spec: DiscountSpec, baseMinor: bigint): bigint {
  if (spec.mode === 'AMOUNT') return moneyToMinorUnits(spec.value);
  const hundredths = moneyToMinorUnits(spec.value);
  return (baseMinor * hundredths + 5_000n) / 10_000n;
}

export function describeDiscountSpec(spec: DiscountSpec): string {
  return spec.mode === 'PERCENT' ? `${spec.value}%` : `PKR ${spec.value}`;
}

export interface DiscountedLine {
  readonly medicineId: string;
  readonly gross: string;
  readonly discount: string;
  readonly net: string;
}

export interface DiscountPlan {
  readonly lines: readonly DiscountedLine[];
  readonly gross: string;
  readonly lineDiscountTotal: string;
  readonly invoiceDiscount: string;
  readonly discountTotal: string;
  readonly total: string;
  readonly discountPercent: string;
  readonly hasDiscount: boolean;
  readonly errors: readonly string[];
}

export function buildDiscountPlan(
  cart: readonly CartLine[],
  discounts: CartDiscounts,
): DiscountPlan {
  const errors: string[] = [];
  let grossMinor = 0n;
  let lineDiscountMinor = 0n;
  const lines = cart.map((line) => {
    const gross = moneyToMinorUnits(
      multiplyMoneyByQuantity(line.medicine.salePrice ?? '0.00', line.quantity.toString()),
    );
    const spec = discounts.lines[line.medicine.id];
    let discount = spec ? resolveDiscountMinor(spec, gross) : 0n;
    if (discount > gross) {
      errors.push(`${line.medicine.name}: discount is more than the line value`);
      discount = gross;
    }
    grossMinor += gross;
    lineDiscountMinor += discount;
    return {
      medicineId: line.medicine.id,
      gross: minorUnitsToMoney(gross),
      discount: minorUnitsToMoney(discount),
      net: minorUnitsToMoney(gross - discount),
    };
  });
  const afterLines = grossMinor - lineDiscountMinor;
  let invoiceMinor = discounts.invoice ? resolveDiscountMinor(discounts.invoice, afterLines) : 0n;
  if (invoiceMinor > afterLines) {
    errors.push('Invoice discount is more than the discounted subtotal');
    invoiceMinor = afterLines;
  }
  const discountMinor = lineDiscountMinor + invoiceMinor;
  const hasDiscount = discountMinor > 0n;
  if (hasDiscount && discountMinor >= grossMinor) {
    errors.push('Discount must leave something to pay');
  }
  if (hasDiscount && discounts.reason.trim().length < 3) {
    errors.push('Choose or type a discount reason');
  }
  const percentHundredths =
    grossMinor > 0n ? (discountMinor * 10_000n + grossMinor / 2n) / grossMinor : 0n;
  return {
    lines,
    gross: minorUnitsToMoney(grossMinor),
    lineDiscountTotal: minorUnitsToMoney(lineDiscountMinor),
    invoiceDiscount: minorUnitsToMoney(invoiceMinor),
    discountTotal: minorUnitsToMoney(discountMinor),
    total: minorUnitsToMoney(grossMinor - discountMinor),
    discountPercent: scaledIntegerToDecimal(percentHundredths, 2),
    hasDiscount,
    errors,
  };
}

export function discountRequestBody(plan: DiscountPlan): {
  readonly lineDiscounts: ReadonlyArray<{ readonly medicineId: string; readonly amount: string }>;
  readonly invoiceDiscount: string;
} {
  return {
    lineDiscounts: plan.lines
      .filter((line) => moneyToMinorUnits(line.discount) > 0n)
      .map((line) => ({ medicineId: line.medicineId, amount: line.discount })),
    invoiceDiscount: plan.invoiceDiscount,
  };
}

/** Identifies the exact money the server must apply; empty when there is no discount. */
export function discountSignature(plan: DiscountPlan, reason: string): string {
  if (!plan.hasDiscount) return '';
  const body = discountRequestBody(plan);
  return [
    ...body.lineDiscounts.map((line) => `${line.medicineId}:${line.amount}`).sort(),
    `invoice:${body.invoiceDiscount}`,
    `reason:${reason.trim()}`,
  ].join('|');
}
