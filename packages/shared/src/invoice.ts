import { z } from 'zod';

/**
 * How a shop's printed invoice looks. The shop owner edits it; every printer path (browser,
 * USB, serial, network) renders from the same layout so the preview is what comes out.
 */
export const PAPER_WIDTHS = ['58mm', '80mm', 'A4'] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

export const FONT_SCALES = ['SMALL', 'NORMAL', 'LARGE'] as const;

const noteSchema = (max: number) => z.string().trim().max(max);

export const invoiceLayoutSchema = z
  .object({
    paperWidth: z.enum(PAPER_WIDTHS).default('80mm'),
    fontScale: z.enum(FONT_SCALES).default('NORMAL'),
    title: noteSchema(40).default('Sales invoice'),
    headerNote: noteSchema(160).default(''),
    footerNote: noteSchema(240).default(
      'Medicines are returnable within 7 days with this invoice and in original packing.',
    ),
    showAddress: z.boolean().default(true),
    showPhone: z.boolean().default(true),
    showEmail: z.boolean().default(false),
    showDrugLicense: z.boolean().default(true),
    showNtn: z.boolean().default(true),
    showCashier: z.boolean().default(true),
    showCustomer: z.boolean().default(true),
    showBatch: z.boolean().default(true),
    showExpiry: z.boolean().default(true),
    showDosage: z.boolean().default(true),
    showDosageUrdu: z.boolean().default(true),
    showDiscount: z.boolean().default(true),
    showTaxSummary: z.boolean().default(true),
    showReturnQr: z.boolean().default(true),
    copies: z.number().int().min(1).max(3).default(1),
  })
  .strict();

export type InvoiceLayout = z.infer<typeof invoiceLayoutSchema>;

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = invoiceLayoutSchema.parse({});

/**
 * Reads a stored layout leniently: every valid field is kept and anything missing or invalid falls
 * back to its default, so an older or damaged layout never stops an invoice from printing.
 */
export function resolveInvoiceLayout(stored: unknown): InvoiceLayout {
  const full = invoiceLayoutSchema.safeParse(stored);
  if (full.success) return full.data;
  if (typeof stored !== 'object' || stored === null) return DEFAULT_INVOICE_LAYOUT;
  const shape = invoiceLayoutSchema.shape;
  const accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    const field = shape[key as keyof typeof shape];
    if (field?.safeParse(value).success) accepted[key] = value;
  }
  return invoiceLayoutSchema.parse(accepted);
}

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/** Shop identity printed on invoices and sent to FBR. Only the super admin edits it. */
export const shopProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    address: optionalText(300),
    phone: optionalText(40),
    email: z
      .string()
      .trim()
      .max(160)
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email address')
      .nullable()
      .optional(),
    drugLicenseNumber: optionalText(80),
    sellerNtnCnic: z
      .string()
      .trim()
      .regex(/^\d{7}(?:\d{2}|\d{6})?$/, 'NTN is 7 or 9 digits, CNIC is 13 digits')
      .nullable()
      .optional(),
    sellerStrn: optionalText(64),
    posRegistrationNumber: optionalText(120),
    businessName: z.string().trim().min(2).max(200).nullable().optional(),
    province: z.string().trim().min(2).max(120).nullable().optional(),
    scenarioId: z
      .string()
      .trim()
      .regex(/^SN\d{3}$/, 'Scenario looks like SN001')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

export type ShopProfileUpdate = z.infer<typeof shopProfileSchema>;

export const createShopSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,20}$/, 'Code uses capital letters, digits and dashes'),
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

export const fbrInvoicingToggleSchema = z.object({ enabled: z.boolean() }).strict();

export const fbrTransmissionApprovalSchema = z
  .object({ approved: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();

export interface ShopFiscalIdentity {
  readonly sellerNtnCnic: string | null;
  readonly posRegistrationNumber: string | null;
  readonly businessName: string | null;
  readonly province: string | null;
  readonly address: string | null;
}

/** What FBR needs before a shop may switch fiscal invoicing on. */
export function fbrRegistrationGaps(shop: ShopFiscalIdentity): readonly string[] {
  const gaps: string[] = [];
  if (!shop.sellerNtnCnic) gaps.push('NTN or CNIC');
  if (!shop.posRegistrationNumber) gaps.push('FBR POS registration number');
  if (!shop.businessName) gaps.push('Registered business name');
  if (!shop.province) gaps.push('Province');
  if (!shop.address) gaps.push('Address');
  return gaps;
}

/** Raw ESC/POS bytes relayed to a LAN receipt printer (JetDirect / RAW port). */
export const networkPrintSchema = z
  .object({
    host: z
      .string()
      .trim()
      .regex(/^\d{1,3}(?:\.\d{1,3}){3}$/, 'Use the printer IPv4 address, e.g. 192.168.1.50'),
    port: z.number().int().min(9100).max(9109).default(9100),
    data: z
      .string()
      .min(4)
      .max(700_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Print data must be base64'),
  })
  .strict();

/**
 * Only printers on the shop's own network may be reached, so the relay can never be used to
 * reach the internet or another service on the server.
 */
export function isPrivatePrinterAddress(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return false;
  }
  const [a = -1, b = -1] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 127 && octets.join('.') !== '127.0.0.0')
  );
}

export type NetworkPrintRequest = z.infer<typeof networkPrintSchema>;
