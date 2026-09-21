/**
 * Column headings accepted in a catalog file, mapped to the import contract field.
 * Pharmacies export from many different systems, so the common spellings of each
 * heading are accepted rather than forcing the operator to rename columns.
 */
const COLUMN_ALIASES: Readonly<Record<string, string>> = {
  sku: 'sku',
  code: 'sku',
  itemcode: 'sku',
  name: 'name',
  medicine: 'name',
  brand: 'name',
  brandname: 'name',
  generic: 'genericName',
  genericname: 'genericName',
  salt: 'genericName',
  strength: 'strength',
  form: 'dosageForm',
  dosageform: 'dosageForm',
  packsize: 'packSize',
  pack: 'packSize',
  unit: 'unitName',
  unitname: 'unitName',
  barcode: 'barcode',
  ean: 'barcode',
  requiresprescription: 'requiresPrescription',
  prescription: 'requiresPrescription',
  rx: 'requiresPrescription',
  storageclass: 'storageClass',
  storage: 'storageClass',
  requiressecuredstorage: 'requiresSecuredStorage',
  hscode: 'hsCode',
  taxrate: 'taxRate',
  tax: 'taxRate',
  fbruom: 'fbrUom',
  uom: 'fbrUom',
  fbrsaletype: 'fbrSaleType',
  saletype: 'fbrSaleType',
};

const BOOLEAN_FIELDS = new Set(['requiresPrescription', 'requiresSecuredStorage']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'rx']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', '']);

export function normalizeHeading(heading: string): string | null {
  const key = heading
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]/g, '');
  return COLUMN_ALIASES[key] ?? null;
}

/** RFC 4180 field splitting: quoted fields may contain commas, newlines, and `""`. */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r') {
      index += 1;
      continue;
    }
    if (character === '\n') {
      endRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

export interface CatalogFileParseResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly recognizedColumns: readonly string[];
  readonly ignoredColumns: readonly string[];
}

/**
 * Turns a catalog file into import rows. Unknown columns are reported rather than
 * dropped silently, and blank cells are omitted so the server applies its own
 * defaults instead of receiving an empty string.
 */
export function parseCatalogFile(text: string): CatalogFileParseResult {
  const table = parseCsv(text);
  const [heading, ...body] = table;
  if (!heading) return { rows: [], recognizedColumns: [], ignoredColumns: [] };

  const mapped = heading.map((column) => ({ column, field: normalizeHeading(column) }));
  const recognizedColumns = mapped
    .filter((entry) => entry.field !== null)
    .map((entry) => entry.column.trim());
  const ignoredColumns = mapped
    .filter((entry) => entry.field === null && entry.column.trim() !== '')
    .map((entry) => entry.column.trim());

  const rows = body.map((cells) => {
    const record: Record<string, unknown> = {};
    for (const [index, entry] of mapped.entries()) {
      if (!entry.field) continue;
      const raw = (cells[index] ?? '').trim();
      if (BOOLEAN_FIELDS.has(entry.field)) {
        const lowered = raw.toLowerCase();
        if (TRUE_VALUES.has(lowered)) record[entry.field] = true;
        else if (FALSE_VALUES.has(lowered)) record[entry.field] = false;
        else record[entry.field] = raw;
        continue;
      }
      if (raw === '') continue;
      record[entry.field] = entry.field === 'storageClass' ? raw.toUpperCase() : raw;
    }
    return record;
  });

  return { rows, recognizedColumns, ignoredColumns };
}
