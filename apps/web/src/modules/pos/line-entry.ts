import { dosageQuantityForDays, parseDosage, type DosageSchedule } from '@pharmacy/shared';

import type { DiscountSpec } from './discount';

export const MAX_LINE_QUANTITY = 9_999;

export type QuantityEntry =
  { readonly quantity: number; readonly days?: number } | { readonly error: string };

/**
 * What the cashier typed in the quantity box: units ("20") or days of the chosen timing ("5d").
 * There is deliberately no default, so a line is never added at a quantity nobody chose.
 */
export function parseQuantityEntry(raw: string, schedule: DosageSchedule | null): QuantityEntry {
  const value = raw.trim().toLowerCase();
  if (value === '') return { error: 'Enter a quantity, or days such as 5d' };
  const units = /^\d{1,4}$/.exec(value);
  if (units) {
    const quantity = Number(value);
    return quantity >= 1 ? { quantity } : { error: 'Quantity must be at least 1' };
  }
  const days = /^(\d{1,3})\s*d(?:ays?)?$/.exec(value);
  if (days) {
    if (!schedule) return { error: 'Choose a timing first to sell by days' };
    const dayCount = Number(days[1]);
    if (dayCount < 1) return { error: 'Days must be at least 1' };
    const quantity = dosageQuantityForDays(schedule, dayCount);
    return quantity <= MAX_LINE_QUANTITY
      ? { quantity, days: dayCount }
      : { error: 'That is more than one line can hold' };
  }
  return { error: 'Type units (20) or days (5d)' };
}

/** Parses an optional timing box: empty is fine, anything else must be a valid schedule. */
export function parseTimingEntry(
  raw: string,
): { readonly schedule: DosageSchedule | null } | { readonly error: string } {
  if (raw.trim() === '') return { schedule: null };
  const parsed = parseDosage(raw);
  return 'schedule' in parsed ? { schedule: parsed.schedule } : { error: parsed.error };
}

/**
 * Discount shorthand typed into a single box: "10" or "10%" is a percentage, "50r", "rs50" or
 * "Rs 50" is rupees. Empty clears the discount.
 */
export function parseDiscountShorthand(
  raw: string,
): { readonly spec: DiscountSpec | null } | { readonly error: string } {
  const value = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (value === '' || value === '0' || value === '0%') return { spec: null };
  const percent = /^(\d{1,3}(?:\.\d{1,2})?)%?$/.exec(value);
  if (percent) {
    const amount = Number(percent[1]);
    if (amount > 100) return { error: 'A percentage cannot exceed 100' };
    return amount === 0 ? { spec: null } : { spec: { mode: 'PERCENT', value: percent[1] ?? '' } };
  }
  const rupees = /^(?:rs\.?|pkr)?(\d{1,10}(?:\.\d{1,2})?)(?:r|rs|pkr|\/-)?$/.exec(value);
  if (rupees && /[a-z/]/.test(value)) {
    const amount = rupees[1] ?? '';
    return Number(amount) === 0 ? { spec: null } : { spec: { mode: 'AMOUNT', value: amount } };
  }
  return { error: 'Type 10 for 10% or 50r for Rs 50' };
}

/** The shorthand that reproduces a spec, for showing it back in an editable box. */
export function discountShorthand(spec: DiscountSpec | null | undefined): string {
  if (!spec) return '';
  return spec.mode === 'PERCENT' ? `${spec.value}%` : `${spec.value}r`;
}
