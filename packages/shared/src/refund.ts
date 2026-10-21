import { decimalToScaledInteger } from './decimal.js';
import { minorUnitsToMoney, moneyToMinorUnits } from './money.js';
import { allocateMoneyProportionally } from './tax.js';

/**
 * What the customer actually paid for each sale line. Counter prices are tax-inclusive, so
 * the line total already contains tax; the invoice-level discount is spread over the lines
 * with the same proportional allocation finalization used for the fiscal record, in sale
 * line order. Refunding `line_total` alone would hand back the invoice discount as cash.
 */
export function netPaidPerSaleLine(
  lineTotals: readonly string[],
  invoiceDiscount: string,
): readonly string[] {
  const allocations = allocateMoneyProportionally(invoiceDiscount, lineTotals);
  return lineTotals.map((lineTotal, index) =>
    minorUnitsToMoney(moneyToMinorUnits(lineTotal) - moneyToMinorUnits(allocations[index] ?? '0')),
  );
}

export interface CumulativeRefundInput {
  /** Net amount paid for the whole sale line (see `netPaidPerSaleLine`). */
  readonly netPaid: string;
  readonly soldQuantity: string;
  /** Quantity already returned or pending return on earlier, non-rejected returns. */
  readonly previouslyReturnedQuantity: string;
  /** Refund value already assigned to those earlier returns. */
  readonly previouslyRefunded: string;
  readonly quantity: string;
}

/**
 * Refund for returning `quantity` more units of one sale line. The value is computed from the
 * cumulative returned quantity rather than per request, so a line returned in several parts
 * refunds exactly its net paid amount in total and rounding can never over-refund it.
 */
export function cumulativeRefundAmount(input: CumulativeRefundInput): string {
  const netMinor = moneyToMinorUnits(input.netPaid);
  const sold = decimalToScaledInteger(input.soldQuantity, 3);
  const previous = decimalToScaledInteger(input.previouslyReturnedQuantity, 3);
  const quantity = decimalToScaledInteger(input.quantity, 3);
  const previouslyRefunded = moneyToMinorUnits(input.previouslyRefunded);
  if (sold <= 0n) throw new Error('Sold quantity must be positive');
  if (quantity <= 0n) throw new Error('Return quantity must be positive');
  if (previous < 0n || previous + quantity > sold) {
    throw new Error('Return quantity exceeds remaining sold quantity');
  }
  if (netMinor < 0n || previouslyRefunded < 0n) throw new Error('Amounts cannot be negative');

  const cumulative = previous + quantity;
  const target = cumulative === sold ? netMinor : (netMinor * cumulative * 2n + sold) / (sold * 2n);
  const refund = target - previouslyRefunded;
  return minorUnitsToMoney(refund > 0n ? refund : 0n);
}
