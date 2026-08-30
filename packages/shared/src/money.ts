const MONEY_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

export function moneyToMinorUnits(value: string): bigint {
  if (!MONEY_PATTERN.test(value)) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const minorUnits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -minorUnits : minorUnits;
}

export function minorUnitsToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function sumMoney(values: readonly string[]): string {
  return minorUnitsToMoney(values.reduce((total, value) => total + moneyToMinorUnits(value), 0n));
}
