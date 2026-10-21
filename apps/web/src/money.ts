import { multiplyMoneyByQuantity, sumMoney } from '@pharmacy/shared';

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
