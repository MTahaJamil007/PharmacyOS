import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  scaledIntegerToDecimal,
  sumMoney,
} from '@pharmacy/shared';

export interface PurchaseLineAmounts {
  readonly unitCost: string;
  readonly orderedQuantity: string;
  readonly lineDiscount: string;
}

/**
 * Mirrors `ProcurementService.createPurchaseOrder`: gross is quantity x unit cost,
 * the line discount is subtracted in minor units, and a discount may never exceed gross.
 * The server recomputes this; the counter must never show a different number.
 */
export function calculatePurchaseLineTotal(line: PurchaseLineAmounts): string {
  const gross = moneyToMinorUnits(multiplyMoneyByQuantity(line.unitCost, line.orderedQuantity));
  const discount = moneyToMinorUnits(line.lineDiscount);
  if (discount < 0n) throw new Error('Line discount cannot be negative');
  if (discount > gross) throw new Error('Line discount cannot exceed the line gross cost');
  return minorUnitsToMoney(gross - discount);
}

export function calculatePurchaseOrderTotal(lines: readonly PurchaseLineAmounts[]): string {
  return sumMoney(lines.map(calculatePurchaseLineTotal));
}

export interface ReceivableLine {
  readonly ordered_qty: string;
  readonly received_qty: string;
}

/** Remaining order quantity, in the order unit, as an exact 3-decimal quantity string. */
export function outstandingOrderQuantity(line: ReceivableLine): string {
  const ordered = decimalToScaledInteger(line.ordered_qty, 3);
  const received = decimalToScaledInteger(line.received_qty, 3);
  const remaining = ordered - received;
  return scaledIntegerToDecimal(remaining > 0n ? remaining : 0n, 3);
}

export function hasOutstandingQuantity(lines: readonly ReceivableLine[]): boolean {
  return lines.some((line) => decimalToScaledInteger(outstandingOrderQuantity(line), 3) > 0n);
}

/**
 * A goods-receipt line is only submittable when every field the server requires is
 * present and the quantity is positive; blank rows are dropped rather than rejected.
 */
export interface GoodsReceiptDraftLine {
  readonly purchaseOrderItemId: string;
  readonly receivedQuantity: string;
  readonly receivedBonusQuantity: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly salePricePerBaseUnit: string;
}

export function selectSubmittableReceiptLines(
  lines: readonly GoodsReceiptDraftLine[],
): readonly GoodsReceiptDraftLine[] {
  return lines.filter((line) => {
    if (!line.batchNumber.trim() || !line.expiryDate || !line.salePricePerBaseUnit.trim()) {
      return false;
    }
    try {
      return decimalToScaledInteger(line.receivedQuantity, 3) > 0n;
    } catch {
      return false;
    }
  });
}
