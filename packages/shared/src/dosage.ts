import { decimalToScaledInteger, scaledIntegerToDecimal } from './decimal.js';

/**
 * Optional "when to take it" instruction written on a medicine at the counter, in the local
 * morning + evening + night convention ("1+0+1"). It is printed for the patient and never changes
 * the quantity sold; affordability tools may read its daily total.
 */
export type MealRelation = 'BEFORE' | 'AFTER';

export interface DosageSchedule {
  /** Doses per slot in thousandths of a unit, so ½ is 500. */
  readonly morning: number;
  readonly evening: number;
  readonly night: number;
  readonly meal: MealRelation | null;
}

export const DOSAGE_SLOTS = ['morning', 'evening', 'night'] as const;

/** The common schedules, in the order a counter reaches for them. */
export const DOSAGE_PRESETS: readonly string[] = [
  '1+0+0',
  '0+0+1',
  '1+0+1',
  '1+1+1',
  '½+0+½',
  '½+0+0',
  '0+0+½',
  '1+1+0',
  '2+0+2',
  '2+2+2',
];

const MAX_SLOT_MILLI = 9_000;
const CODE_CHARACTERS: Readonly<Record<string, number>> = {
  q: 250,
  h: 500,
  t: 750,
};
const GLYPHS: Readonly<Record<string, number>> = { '¼': 250, '½': 500, '¾': 750 };
const GLYPH_BY_MILLI: Readonly<Record<number, string>> = { 250: '¼', 500: '½', 750: '¾' };

function parseSlot(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (value in CODE_CHARACTERS) return CODE_CHARACTERS[value] ?? null;
  // "1½", "½", "1 1/2", "1/2", "0.5", "2"
  const glyph = /^(\d?)\s*([¼½¾])$/.exec(value);
  if (glyph) return Number(glyph[1] || '0') * 1000 + (GLYPHS[glyph[2] ?? ''] ?? 0);
  const fraction = /^(?:(\d)\s+)?([1-3])\/([24])$/.exec(value);
  if (fraction) {
    const numerator = Number(fraction[2]);
    const denominator = Number(fraction[3]);
    if (numerator >= denominator) return null;
    return Number(fraction[1] ?? '0') * 1000 + (numerator * 1000) / denominator;
  }
  if (/^\d(?:\.\d{1,2})?$/.test(value)) {
    const milli = Number(decimalToScaledInteger(value, 3));
    return milli % 250 === 0 ? milli : null;
  }
  return null;
}

function readMeal(input: string): { readonly rest: string; readonly meal: MealRelation | null } {
  const match = /^(.*?)(?:\s*\(?\s*(a|b|after(?: meal)?|before(?: meal)?)\s*\)?)$/i.exec(input);
  if (!match) return { rest: input, meal: null };
  const word = (match[2] ?? '').toLowerCase();
  return { rest: match[1] ?? '', meal: word.startsWith('a') ? 'AFTER' : 'BEFORE' };
}

/**
 * Accepts what a cashier types fastest — "101", "h0h", "111a" (one character per slot; h = ½,
 * q = ¼, t = ¾) — and the written forms "1+0+1", "½+0+½", "1/2-0-1/2", "1.5+0+1.5 after meal".
 */
export function parseDosage(
  input: string,
): { readonly schedule: DosageSchedule } | { readonly error: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { error: 'Enter a timing such as 1+0+1' };
  const { rest, meal } = readMeal(trimmed);
  const body = rest.trim();
  let parts: string[];
  if (/^[0-9hqt]{3}$/i.test(body)) parts = [...body];
  else parts = body.split(/\s*[+\-,]\s*|\s+(?=[0-9¼½¾hqt])/i).filter((part) => part !== '');
  if (parts.length !== 3) {
    return { error: 'Use three slots: morning + evening + night, e.g. 1+0+1 or 101' };
  }
  const slots = parts.map(parseSlot);
  if (slots.some((slot) => slot === null || slot > MAX_SLOT_MILLI)) {
    return { error: 'Each slot takes 0–9 in steps of ¼ (h = ½, q = ¼, t = ¾)' };
  }
  const [morning = 0, evening = 0, night = 0] = slots as number[];
  if (morning + evening + night === 0) return { error: 'At least one slot needs a dose' };
  return { schedule: { morning, evening, night, meal } };
}

function formatSlot(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = GLYPH_BY_MILLI[milli % 1000] ?? '';
  if (whole === 0) return fraction || '0';
  return `${String(whole)}${fraction}`;
}

/** Canonical text stored with the sale line and printed: "1+0+1" or "½+0+½ after meal". */
export function formatDosage(schedule: DosageSchedule): string {
  const slots = `${formatSlot(schedule.morning)}+${formatSlot(schedule.evening)}+${formatSlot(schedule.night)}`;
  if (!schedule.meal) return slots;
  return `${slots} ${schedule.meal === 'AFTER' ? 'after' : 'before'} meal`;
}

/** Normalizes any accepted spelling to the canonical text, or returns null when invalid. */
export function normalizeDosage(input: string): string | null {
  const parsed = parseDosage(input);
  return 'schedule' in parsed ? formatDosage(parsed.schedule) : null;
}

export function describeDosage(schedule: DosageSchedule): string {
  const named = DOSAGE_SLOTS.filter((slot) => schedule[slot] > 0).map(
    (slot) => `${slot[0]?.toUpperCase() ?? ''}${slot.slice(1)} ${formatSlot(schedule[slot])}`,
  );
  const meal = schedule.meal ? ` · ${schedule.meal === 'AFTER' ? 'after' : 'before'} meal` : '';
  return `${named.join(' · ')}${meal}`;
}

/** Urdu wording for the printed receipt: صبح / شام / رات, کھانے سے پہلے / بعد. */
export function describeDosageUrdu(schedule: DosageSchedule): string {
  const words: Record<(typeof DOSAGE_SLOTS)[number], string> = {
    morning: 'صبح',
    evening: 'شام',
    night: 'رات',
  };
  const named = DOSAGE_SLOTS.filter((slot) => schedule[slot] > 0).map(
    (slot) => `${words[slot]} ${formatSlot(schedule[slot])}`,
  );
  const meal = schedule.meal
    ? ` · ${schedule.meal === 'AFTER' ? 'کھانے کے بعد' : 'کھانے سے پہلے'}`
    : '';
  return `${named.join(' · ')}${meal}`;
}

/** Units taken per day as an exact 3-decimal quantity, e.g. "2.000" for 1+0+1. */
export function dosageUnitsPerDay(schedule: DosageSchedule): string {
  return scaledIntegerToDecimal(BigInt(schedule.morning + schedule.evening + schedule.night), 3);
}

/** Whole units needed for a number of days, rounded up so no dose is left short. */
export function dosageQuantityForDays(schedule: DosageSchedule, days: number): number {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('Days must be a positive integer');
  const milliPerDay = schedule.morning + schedule.evening + schedule.night;
  return Math.ceil((milliPerDay * days) / 1000);
}
