const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function decimalToScaledInteger(value: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (fraction.length > scale) throw new Error(`Decimal ${value} exceeds scale ${scale}`);
  const factor = 10n ** BigInt(scale);
  const scaled = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, '0') || '0');
  return negative ? -scaled : scaled;
}

export function scaledIntegerToDecimal(value: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0) throw new Error(`Invalid scale: ${scale}`);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = absolute / factor;
  if (scale === 0) return `${negative ? '-' : ''}${whole.toString()}`;
  const fraction = (absolute % factor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function multiplyMoneyByQuantity(money: string, quantity: string): string {
  const minorUnits = decimalToScaledInteger(money, 2);
  const milliUnits = decimalToScaledInteger(quantity, 3);
  const numerator = minorUnits * milliUnits;
  const roundedMinorUnits =
    numerator >= 0n ? (numerator + 500n) / 1000n : (numerator - 500n) / 1000n;
  return scaledIntegerToDecimal(roundedMinorUnits, 2);
}
