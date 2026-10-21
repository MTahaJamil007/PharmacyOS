/**
 * Display formatting. Values arrive from the API as exact decimal strings; these helpers
 * never convert money to a floating-point number and accept any number of decimal places,
 * rounding half away from zero, so an unexpected scale can never crash a screen.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function toScaled(value: string, scale: number): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const [, sign, whole = '0', fraction = ''] = match;
  const kept = fraction.slice(0, scale).padEnd(scale, '0');
  const factor = 10n ** BigInt(scale);
  let scaled = BigInt(whole) * factor + BigInt(kept || '0');
  const next = fraction.charCodeAt(scale);
  if (!Number.isNaN(next) && next >= 53) scaled += 1n;
  return sign ? -scaled : scaled;
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function normalizeMoney(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const scaled = toScaled(String(value), 2);
  if (scaled === null) return null;
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  return `${negative ? '-' : ''}${(absolute / 100n).toString()}.${(absolute % 100n)
    .toString()
    .padStart(2, '0')}`;
}

/** Rs 1,234.50 — the form used on Pakistani receipts and invoices. */
export function formatMoney(
  value: string | number | null | undefined,
  options: { readonly symbol?: boolean; readonly empty?: string } = {},
): string {
  const normalized = normalizeMoney(value);
  if (normalized === null) return options.empty ?? '—';
  const negative = normalized.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? normalized.slice(1) : normalized).split('.');
  const body = `${group(whole)}.${fraction}`;
  const symbol = options.symbol === false ? '' : 'Rs ';
  return negative ? `−${symbol}${body}` : `${symbol}${body}`;
}

/** Quantities are stored with three decimals; show them without trailing zeros. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const scaled = toScaled(String(value), 3);
  if (scaled === null) return String(value);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = group((absolute / 1000n).toString());
  const fraction = (absolute % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function formatCount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const scaled = toScaled(String(value), 0);
  return scaled === null ? String(value) : group(scaled.toString());
}

export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${String(value)}%`;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/**
 * A plain calendar date (YYYY-MM-DD, already branch-local) is shown without any timezone
 * shift. A full timestamp is shown as the terminal's local calendar date, so a sale at
 * 00:30 Pakistan time is not reported under the previous (UTC) day.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return dateFormatter.format(instant);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return dateFormatter.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : dateTimeFormatter.format(parsed);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : timeFormatter.format(parsed);
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days < 0) return `expired ${String(-days)}d ago`;
  if (days === 0) return 'expires today';
  if (days === 1) return '1 day';
  if (days < 60) return `${String(days)} days`;
  return `${String(Math.round(days / 30))} months`;
}

/** YYYY-MM-DD for a date in the given IANA timezone (the branch clock). */
export function isoDateIn(timeZone: string | undefined, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

export function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function isNegative(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().startsWith('-') && /[1-9]/.test(value));
}

export function isZero(value: string | null | undefined): boolean {
  return !value || !/[1-9]/.test(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const words = code.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MONEY_TEXT = /^\d+(?:\.\d{1,2})?$/;
const QUANTITY_TEXT = /^\d+(?:\.\d{1,3})?$/;

/** Matches the API's money format: non-negative, at most two decimals. */
export function isMoneyText(value: string): boolean {
  return MONEY_TEXT.test(value.trim());
}

/** Matches the API's quantity format: non-negative, at most three decimals. */
export function isQuantityText(value: string): boolean {
  return QUANTITY_TEXT.test(value.trim());
}

export function isPositiveQuantityText(value: string): boolean {
  return isQuantityText(value) && /[1-9]/.test(value);
}
