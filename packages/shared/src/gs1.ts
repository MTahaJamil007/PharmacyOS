/**
 * Reads what a barcode scanner types: a GS1 DataMatrix from a medicine pack (GTIN, expiry, batch,
 * serial) or a plain EAN/UPC barcode.
 *
 * Scanners differ: some send the FNC1 group separator (ASCII 29), some a symbology prefix such as
 * "]d2", some the human-readable "(01)…(17)…" form, and some drop the separator entirely. The
 * parser accepts all of them. When it cannot be certain where a batch number ends, it says so in
 * `needsReview` instead of guessing, so a person confirms the batch before stock is received.
 *
 * Identification is never fuzzy: a product is matched only by an exact barcode key.
 */

export interface ScannedCode {
  readonly raw: string;
  readonly kind: 'GS1' | 'EAN' | 'OTHER';
  /** The 14-digit GTIN, when the code carries one with a valid check digit. */
  readonly gtin: string | null;
  /** Exact barcode strings to look up, most specific first. */
  readonly lookupKeys: readonly string[];
  readonly batch: string | null;
  /** ISO date; a GS1 day of 00 means the last day of that month. */
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly serial: string | null;
  /** True when a field boundary had to be inferred because the scanner sent no separator. */
  readonly needsReview: boolean;
  readonly problems: readonly string[];
}

const GROUP_SEPARATOR = '\u001d';
const SYMBOLOGY_PREFIX = /^\](?:d2|C1|Q3|e0|e1|J1)/;

/** Fixed lengths of the GS1 application identifiers seen on medicine packs. */
const FIXED_LENGTH: Readonly<Record<string, number>> = {
  '00': 18,
  '01': 14,
  '02': 14,
  '11': 6,
  '12': 6,
  '13': 6,
  '15': 6,
  '16': 6,
  '17': 6,
  '20': 2,
};

/** Variable-length identifiers and their maximum lengths. */
const VARIABLE_LENGTH: Readonly<Record<string, number>> = {
  '10': 20,
  '21': 20,
  '22': 20,
  '30': 8,
  '37': 8,
  '240': 30,
  '241': 30,
  '250': 30,
  '251': 30,
  '400': 30,
  '710': 20,
  '711': 20,
  '712': 20,
  '713': 20,
  '714': 20,
  '715': 20,
  '7003': 10,
  '8020': 25,
  '90': 30,
  '91': 90,
  '92': 90,
  '93': 90,
  '94': 90,
  '95': 90,
  '96': 90,
  '97': 90,
  '98': 90,
  '99': 90,
};

/** GS1 mod-10 check digit over every digit but the last. */
export function gtinCheckDigitValid(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

/** Every form a GTIN may have been stored in: 14, 13 and 12 digits. */
export function gtinLookupKeys(gtin14: string): string[] {
  const keys = [gtin14];
  if (gtin14.startsWith('0')) keys.push(gtin14.slice(1));
  if (gtin14.startsWith('00')) keys.push(gtin14.slice(2));
  return keys;
}

/** The form to store a newly linked GTIN in: 13 digits when it fits, like printed EAN-13. */
export function storedBarcodeForGtin(gtin14: string): string {
  return gtin14.startsWith('0') ? gtin14.slice(1) : gtin14;
}

function parseGs1Date(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === 0) day = lastDay;
  if (day > lastDay) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function identifierAt(text: string, position: number): string | null {
  for (const length of [2, 3, 4]) {
    const candidate = text.slice(position, position + length);
    if (candidate in FIXED_LENGTH || candidate in VARIABLE_LENGTH) return candidate;
  }
  return null;
}

/** Splits "(01)0896…(17)270630(10)AB12" into identifier/value pairs. */
function parseBracketed(text: string): Array<[string, string]> | null {
  const parts = [...text.matchAll(/\((\d{2,4})\)([^(]*)/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== text) return null;
  return parts.map((part) => [part[1]!, part[2]!.trim()]);
}

/**
 * Splits a raw element string. Variable fields end at a group separator; when the scanner sent
 * none, a variable field ends where a known fixed field (17, 11, 21 after 10 …) plausibly starts,
 * and the result is marked for review.
 */
function parseRaw(text: string): { fields: Array<[string, string]>; inferred: boolean } | null {
  const fields: Array<[string, string]> = [];
  let position = 0;
  let inferred = false;
  while (position < text.length) {
    if (text[position] === GROUP_SEPARATOR) {
      position += 1;
      continue;
    }
    const identifier = identifierAt(text, position);
    if (!identifier) return null;
    position += identifier.length;
    const fixed = FIXED_LENGTH[identifier];
    if (fixed !== undefined) {
      const value = text.slice(position, position + fixed);
      if (value.length !== fixed || !/^\d+$/.test(value)) return null;
      fields.push([identifier, value]);
      position += fixed;
      continue;
    }
    const maximum = VARIABLE_LENGTH[identifier]!;
    const separator = text.indexOf(GROUP_SEPARATOR, position);
    let end = separator === -1 ? text.length : separator;
    if (separator === -1 && end - position > 0) {
      // No separator: a following date field (17, 11, 15, 16 with a real date) ends this one;
      // failing that, a serial (21) at the end. Either way a person checks the result.
      const rest = text.slice(position);
      let boundary = -1;
      for (const match of rest.matchAll(/(?:17|11|15|16)(\d{6})(?=$|21|10)/g)) {
        if (match.index > 0 && parseGs1Date(match[1]!) !== null) {
          boundary = match.index;
          break;
        }
      }
      if (boundary === -1 && identifier === '10') {
        const serial = rest.lastIndexOf('21');
        if (serial > 0 && rest.length - serial - 2 >= 1 && rest.length - serial - 2 <= 20) {
          boundary = serial;
        }
      }
      if (boundary > 0) {
        end = position + boundary;
        inferred = true;
      }
    }
    if (end - position > maximum) end = position + maximum;
    fields.push([identifier, text.slice(position, end)]);
    position = end;
  }
  return { fields, inferred };
}

export function parseScannedCode(input: string): ScannedCode {
  const raw = input.replace(/[\r\n]+$/g, '');
  let text = raw.trim().replace(SYMBOLOGY_PREFIX, '');
  // Some keyboard-wedge scanners turn the separator into a visible stand-in.
  text = text.replace(/<GS>|\{GS\}|\\x1d/gi, GROUP_SEPARATOR);
  const problems: string[] = [];
  const empty = {
    raw,
    gtin: null,
    batch: null,
    expiryDate: null,
    productionDate: null,
    serial: null,
    needsReview: false,
    problems,
  };

  if (/^\d{8}$|^\d{12,14}$/.test(text)) {
    if (!gtinCheckDigitValid(text)) {
      return {
        ...empty,
        kind: 'OTHER',
        lookupKeys: [text],
        problems: ['The check digit is wrong'],
      };
    }
    const gtin = text.padStart(14, '0');
    const keys = [...new Set([text, ...gtinLookupKeys(gtin)])];
    return { ...empty, kind: 'EAN', gtin, lookupKeys: keys };
  }

  const parsed = text.startsWith('(')
    ? (() => {
        const fields = parseBracketed(text);
        return fields ? { fields, inferred: false } : null;
      })()
    : /^(?:01|02|00)\d/.test(text)
      ? parseRaw(text)
      : null;
  if (!parsed) {
    return { ...empty, kind: 'OTHER', lookupKeys: text ? [text] : [] };
  }

  const values = new Map<string, string>();
  for (const [identifier, value] of parsed.fields) {
    if (!values.has(identifier)) values.set(identifier, value);
  }
  const gtinValue = values.get('01') ?? values.get('02') ?? null;
  let gtin: string | null = null;
  if (gtinValue) {
    if (gtinCheckDigitValid(gtinValue)) gtin = gtinValue;
    else problems.push('The product number check digit is wrong');
  }
  const expiryText = values.get('17');
  const expiryDate = expiryText ? parseGs1Date(expiryText) : null;
  if (expiryText && !expiryDate) problems.push('The expiry date on the code is not a real date');
  const productionText = values.get('11');
  const batch = values.get('10')?.trim() || null;
  const serial = values.get('21')?.trim() || null;
  if (parsed.inferred) {
    problems.push('The scanner sent no separator, so check the batch number');
  }
  return {
    raw,
    kind: 'GS1',
    gtin,
    lookupKeys: gtin ? gtinLookupKeys(gtin) : [],
    batch,
    expiryDate,
    productionDate: productionText ? parseGs1Date(productionText) : null,
    serial,
    needsReview: parsed.inferred || problems.length > 0,
    problems,
  };
}
