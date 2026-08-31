import {
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  sumMoney,
} from '@pharmacy/shared';

interface PricedCartLine {
  readonly quantity: number;
  readonly unitPrice: string | null;
}

export function calculateCartLineTotal(line: PricedCartLine): string {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) {
    throw new Error('Cart quantity must be a non-negative safe integer');
  }
  return multiplyMoneyByQuantity(line.unitPrice ?? '0.00', line.quantity.toString());
}

export function calculateCartTotal(lines: readonly PricedCartLine[]): string {
  return sumMoney(lines.map(calculateCartLineTotal));
}

export function formatPkrMoney(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const normalized = minorUnitsToMoney(moneyToMinorUnits(value));
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = '00'] = unsigned.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `PKR ${negative ? '-' : ''}${groupedWhole}.${fraction}`;
}
