import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  scaledIntegerToDecimal,
  sumMoney,
} from '@pharmacy/shared';

/** One medicine and batch on the delivery being received. Every number is an exact decimal string. */
export interface ReceivingLine {
  /** Stable for the row's life, so editing its batch never re-creates the row. */
  readonly key: string;
  readonly medicineId: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly unitName: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly packs: string;
  readonly bonusPacks: string;
  readonly unitsPerPack: string;
  readonly costPerPack: string;
  readonly discount: string;
  readonly salePricePerUnit: string;
  readonly scannedCode: string | null;
  /** Things the scanner or the shelf-life rule wants a person to look at. */
  readonly notes: readonly string[];
  readonly checkBatch: boolean;
}

const QUANTITY = /^\d{1,7}(?:\.\d{1,3})?$/;
const MONEY = /^\d{1,10}(?:\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function lineKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}|${batchNumber.trim().toUpperCase()}`;
}

function addQuantity(left: string, right: string): string {
  return scaledIntegerToDecimal(
    decimalToScaledInteger(left, 3) + decimalToScaledInteger(right, 3),
    3,
  ).replace(/\.?0+$/, '');
}

/**
 * Adds a scanned or picked line. Scanning the same medicine and batch again counts one more
 * pack, so a delivery can be received by scanning every pack.
 */
export function addLine(lines: readonly ReceivingLine[], line: ReceivingLine): ReceivingLine[] {
  const same = (item: ReceivingLine) =>
    line.batchNumber.trim() !== '' &&
    lineKey(item.medicineId, item.batchNumber) === lineKey(line.medicineId, line.batchNumber);
  const existing = lines.find(same);
  if (!existing) return [line, ...lines];
  return lines.map((item) =>
    item === existing && QUANTITY.test(item.packs)
      ? { ...item, packs: addQuantity(item.packs, line.packs) }
      : item,
  );
}

export function updateLine(
  lines: readonly ReceivingLine[],
  key: string,
  patch: Partial<ReceivingLine>,
): ReceivingLine[] {
  return lines.map((line) => (line.key === key ? { ...line, ...patch, key } : line));
}

/** What the delivery line costs: packs × cost per pack, less the discount. */
export function lineTotal(line: ReceivingLine): string | null {
  if (!QUANTITY.test(line.packs) || !MONEY.test(line.costPerPack) || !MONEY.test(line.discount)) {
    return null;
  }
  const gross = moneyToMinorUnits(multiplyMoneyByQuantity(line.costPerPack, line.packs));
  return minorUnitsToMoney(gross - moneyToMinorUnits(line.discount));
}

export function receiptTotal(lines: readonly ReceivingLine[]): string {
  return sumMoney(lines.map((line) => lineTotal(line) ?? '0'));
}

export interface LineCheck {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Blocking errors stop receiving; warnings are shown but a person may accept them. */
export function checkLine(line: ReceivingLine, today: string): LineCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!line.batchNumber.trim()) errors.push('Batch number is missing');
  if (!DATE.test(line.expiryDate)) errors.push('Expiry date is missing');
  else if (line.expiryDate <= today) errors.push('This stock has expired');
  if (!QUANTITY.test(line.packs) || decimalToScaledInteger(line.packs, 3) === 0n) {
    errors.push('Packs must be more than 0');
  }
  if (!QUANTITY.test(line.bonusPacks)) errors.push('Bonus must be a number');
  if (!QUANTITY.test(line.unitsPerPack) || decimalToScaledInteger(line.unitsPerPack, 3) === 0n) {
    errors.push(`${line.unitName}s per pack must be more than 0`);
  }
  if (!MONEY.test(line.costPerPack)) errors.push('Cost per pack is missing');
  if (!MONEY.test(line.salePricePerUnit)) errors.push('Sale price is missing');
  if (!MONEY.test(line.discount)) errors.push('Discount must be an amount');
  const total = lineTotal(line);
  if (total !== null && moneyToMinorUnits(total) < 0n) {
    errors.push('Discount is more than the line');
  }
  if (
    errors.length === 0 &&
    moneyToMinorUnits(multiplyMoneyByQuantity(line.salePricePerUnit, line.unitsPerPack)) <
      moneyToMinorUnits(line.costPerPack)
  ) {
    warnings.push('Selling price is below cost');
  }
  return { errors, warnings: [...warnings, ...line.notes] };
}

const DRAFT_PREFIX = 'pharmacy-receiving-draft';

/** The delivery being received survives a reload or a crash on this terminal. */
export function loadDraft(terminalId: string): ReceivingLine[] {
  try {
    const stored = localStorage.getItem(`${DRAFT_PREFIX}:${terminalId}`);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? (parsed as ReceivingLine[]) : [];
  } catch {
    return [];
  }
}

export function saveDraft(terminalId: string, lines: readonly ReceivingLine[]): void {
  try {
    if (lines.length === 0) localStorage.removeItem(`${DRAFT_PREFIX}:${terminalId}`);
    else localStorage.setItem(`${DRAFT_PREFIX}:${terminalId}`, JSON.stringify(lines));
  } catch {
    // A device without storage still receives; it only cannot recover after a reload.
  }
}

/** A scanner types a whole code and Enter; a person types a name. */
export function looksLikeScan(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^\][A-Za-z]\d/.test(trimmed) ||
    trimmed.startsWith('(0') ||
    trimmed.includes('\u001d') ||
    /^\d{8,}/.test(trimmed)
  );
}
