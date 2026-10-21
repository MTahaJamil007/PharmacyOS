import { parseCsv } from './catalog-csv';

/** Headings accepted in an opening-stock file, mapped to the import contract field. */
const COLUMN_ALIASES: Readonly<Record<string, string>> = {
  barcode: 'barcode',
  batch: 'batchNumber',
  batchno: 'batchNumber',
  batchnumber: 'batchNumber',
  code: 'sku',
  cost: 'costPrice',
  costprice: 'costPrice',
  ean: 'barcode',
  exp: 'expiryDate',
  expiry: 'expiryDate',
  expirydate: 'expiryDate',
  itemcode: 'sku',
  lot: 'batchNumber',
  maximumretailprice: 'maximumRetailPrice',
  mrp: 'maximumRetailPrice',
  price: 'salePrice',
  purchaseprice: 'costPrice',
  qty: 'quantity',
  quantity: 'quantity',
  retailprice: 'salePrice',
  saleprice: 'salePrice',
  sku: 'sku',
  stock: 'quantity',
  tradeprice: 'costPrice',
};

export function normalizeOpeningStockHeading(heading: string): string | null {
  const key = heading
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_.\-/]/g, '');
  return COLUMN_ALIASES[key] ?? null;
}

const MONTHS: Readonly<Record<string, number>> = {
  apr: 4,
  aug: 8,
  dec: 12,
  feb: 2,
  jan: 1,
  jul: 7,
  jun: 6,
  mar: 3,
  may: 5,
  nov: 11,
  oct: 10,
  sep: 9,
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Expiry dates arrive in whatever the old system exported. Accepts 2027-03-31,
 * 31/03/2027 (day first, as written in Pakistan), and month-only forms printed on packs
 * such as 03/2027 or MAR-27, which mean "usable until the end of that month".
 * Anything else is passed through unchanged so the server reports it on the right row.
 */
export function normalizeExpiryDate(raw: string): string {
  const value = raw.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3])) ?? value;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const year = Number(match[3]?.length === 2 ? `20${match[3]}` : match[3]);
    return iso(year, Number(match[2]), Number(match[1])) ?? value;
  }
  match = /^(\d{1,2})[/.-](\d{4})$/.exec(value);
  if (match) {
    const year = Number(match[2]);
    const month = Number(match[1]);
    return month >= 1 && month <= 12
      ? (iso(year, month, lastDayOfMonth(year, month)) ?? value)
      : value;
  }
  match = /^([a-z]{3})[a-z]*[\s/.-]*(\d{2}|\d{4})$/i.exec(value);
  if (match) {
    const month = MONTHS[(match[1] ?? '').toLowerCase()];
    const year = Number(match[2]?.length === 2 ? `20${match[2]}` : match[2]);
    if (month) return iso(year, month, lastDayOfMonth(year, month)) ?? value;
  }
  return value;
}

export interface OpeningStockFileParseResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly recognizedColumns: readonly string[];
  readonly ignoredColumns: readonly string[];
}

/** Money and quantity cells often carry thousands separators or a currency prefix. */
function cleanNumber(raw: string): string {
  return raw
    .replace(/^(rs\.?|pkr)\s*/i, '')
    .replaceAll(',', '')
    .trim();
}

export function parseOpeningStockFile(text: string): OpeningStockFileParseResult {
  const [heading, ...body] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!heading) return { ignoredColumns: [], recognizedColumns: [], rows: [] };
  const mapped = heading.map((column) => ({ column, field: normalizeOpeningStockHeading(column) }));
  const rows = body.map((cells) => {
    const record: Record<string, unknown> = {};
    for (const [index, entry] of mapped.entries()) {
      if (!entry.field) continue;
      const raw = (cells[index] ?? '').trim();
      if (raw === '') continue;
      if (entry.field === 'expiryDate') record[entry.field] = normalizeExpiryDate(raw);
      else if (['quantity', 'costPrice', 'salePrice', 'maximumRetailPrice'].includes(entry.field)) {
        record[entry.field] = cleanNumber(raw);
      } else record[entry.field] = raw;
    }
    return record;
  });
  return {
    ignoredColumns: mapped
      .filter((entry) => !entry.field && entry.column.trim())
      .map((entry) => entry.column.trim()),
    recognizedColumns: mapped.filter((entry) => entry.field).map((entry) => entry.column.trim()),
    rows,
  };
}

export const OPENING_STOCK_TEMPLATE =
  'sku,barcode,batch,expiry,quantity,cost_price,sale_price,mrp\r\n' +
  'PANADOL-500,8964000000011,B2341,2027-06-30,200,1.10,1.60,1.75\r\n';
