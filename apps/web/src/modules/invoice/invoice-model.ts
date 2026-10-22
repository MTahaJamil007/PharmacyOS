import {
  decimalToScaledInteger,
  DEFAULT_INVOICE_LAYOUT,
  describeDosage,
  describeDosageUrdu,
  minorUnitsToMoney,
  moneyToMinorUnits,
  parseDosage,
  scaledIntegerToDecimal,
  type InvoiceLayout,
  type InvoiceShop,
  type PaymentMethod,
  type SaleReceipt,
} from '@pharmacy/shared';

/**
 * Everything one printed invoice shows, already filtered by the shop's layout. The on-screen
 * document and the ESC/POS printer both render this, so the preview is what prints.
 */
export interface InvoiceLine {
  readonly name: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string | null;
  readonly amount: string;
  readonly batch: string | null;
  readonly expiry: string | null;
  readonly dosage: {
    readonly code: string;
    readonly english: string;
    readonly urdu: string | null;
  } | null;
}

export interface InvoiceModel {
  readonly layout: InvoiceLayout;
  readonly shopName: string;
  readonly shopLines: readonly string[];
  readonly title: string;
  readonly headerNote: string;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly cashier: string | null;
  readonly customer: string | null;
  readonly lines: readonly InvoiceLine[];
  readonly totals: {
    readonly subtotal: string;
    readonly discount: string | null;
    readonly tax: string | null;
    readonly total: string;
    readonly units: string;
  };
  readonly payments: ReadonlyArray<{ readonly label: string; readonly amount: string }>;
  readonly change: string | null;
  readonly fbr: {
    readonly posRegistrationNumber: string | null;
    readonly invoiceNumber: string | null;
    readonly qrPayload: string | null;
    readonly pending: boolean;
  } | null;
  readonly returnQr: string | null;
  readonly footerNote: string;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CREDIT: 'Customer credit',
};

/** "20.000" → "20", "2.500" → "2.5". */
export function displayQuantity(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;
}

function nonZero(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return moneyToMinorUnits(value) === 0n ? null : minorUnitsToMoney(moneyToMinorUnits(value));
  } catch {
    return null;
  }
}

function fallbackShop(receipt: SaleReceipt): InvoiceShop {
  return {
    name: receipt.sale.branch_name,
    address: receipt.sale.branch_address,
    phone: receipt.sale.branch_phone,
    email: null,
    drugLicenseNumber: null,
    sellerNtnCnic: null,
    sellerStrn: null,
    businessName: null,
  };
}

export function buildInvoiceModel(
  receipt: SaleReceipt,
  layoutOverride?: InvoiceLayout,
): InvoiceModel {
  const layout = layoutOverride ?? receipt.layout ?? DEFAULT_INVOICE_LAYOUT;
  const shop = receipt.shop ?? fallbackShop(receipt);
  const shopLines = [
    layout.showAddress ? shop.address : null,
    layout.showPhone && shop.phone ? `Phone: ${shop.phone}` : null,
    layout.showEmail ? shop.email : null,
    layout.showDrugLicense && shop.drugLicenseNumber
      ? `Drug license: ${shop.drugLicenseNumber}`
      : null,
    layout.showNtn && shop.sellerNtnCnic ? `NTN: ${shop.sellerNtnCnic}` : null,
    layout.showNtn && shop.sellerStrn ? `STRN: ${shop.sellerStrn}` : null,
  ].filter((line): line is string => Boolean(line));

  let units = 0n;
  const lines = receipt.items.map((item): InvoiceLine => {
    try {
      units += decimalToScaledInteger(item.quantity, 3);
    } catch {
      // A malformed quantity only affects the unit count shown under the lines.
    }
    const parsed = item.dosage_instruction ? parseDosage(item.dosage_instruction) : null;
    const schedule = parsed && 'schedule' in parsed ? parsed.schedule : null;
    return {
      name: [item.name, item.strength].filter(Boolean).join(' '),
      quantity: displayQuantity(item.quantity),
      unitPrice: item.unit_price,
      discount: layout.showDiscount ? nonZero(item.discount_amount) : null,
      amount: item.line_total,
      batch: layout.showBatch ? item.batch_number : null,
      expiry: layout.showExpiry ? item.expiry_date.slice(0, 10) : null,
      dosage:
        layout.showDosage && item.dosage_instruction
          ? {
              code: item.dosage_instruction,
              english: schedule ? describeDosage(schedule) : item.dosage_instruction,
              urdu: layout.showDosageUrdu && schedule ? describeDosageUrdu(schedule) : null,
            }
          : null,
    };
  });

  const change = receipt.payments
    .map((payment) => payment.change_amount)
    .filter((amount): amount is string => nonZero(amount) !== null);
  const fbr = receipt.fbr?.enabled
    ? {
        posRegistrationNumber: receipt.fbr.posRegistrationNumber,
        invoiceNumber: receipt.fbr.invoiceNumber,
        qrPayload: receipt.fbr.invoiceNumber ? receipt.fbr.qrPayload : null,
        pending: receipt.fbr.invoiceNumber === null,
      }
    : null;

  return {
    layout,
    shopName: shop.name,
    shopLines,
    title: layout.title,
    headerNote: layout.headerNote,
    invoiceNumber: receipt.sale.invoice_number,
    issuedAt: new Date(receipt.sale.created_at).toLocaleString('en-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    cashier: layout.showCashier ? receipt.sale.cashier_name : null,
    customer:
      layout.showCustomer && receipt.sale.customer_name
        ? [receipt.sale.customer_name, receipt.sale.customer_phone].filter(Boolean).join(' · ')
        : null,
    lines,
    totals: {
      subtotal: receipt.sale.subtotal,
      discount: nonZero(receipt.sale.discount_total),
      tax: layout.showTaxSummary ? nonZero(receipt.sale.tax_total) : null,
      total: receipt.sale.total,
      units: displayQuantity(scaledIntegerToDecimal(units, 3)),
    },
    payments: receipt.payments.map((payment) => ({
      label: PAYMENT_LABELS[payment.method] ?? payment.method,
      amount: payment.amount,
    })),
    change: change[0] ?? null,
    fbr,
    returnQr: layout.showReturnQr ? receipt.returnQrPayload : null,
    footerNote: layout.footerNote,
  };
}

/** A realistic sale for previewing a layout before any real sale exists. */
export function sampleReceipt(
  shop: InvoiceShop,
  fbr: { readonly enabled: boolean; readonly posRegistrationNumber: string | null },
): SaleReceipt {
  return {
    sale: {
      id: 'preview',
      invoice_number: 'MAIN-20261022-000123',
      subtotal: '1350.00',
      discount_total: '50.00',
      tax_total: '0.00',
      total: '1300.00',
      created_at: new Date().toISOString(),
      branch_name: shop.name,
      branch_address: shop.address,
      branch_phone: shop.phone,
      cashier_name: 'Counter staff',
      customer_id: null,
      customer_name: 'Walk-in customer',
      customer_phone: null,
      return_lookup_token: '00000000-0000-4000-8000-000000000123',
      fiscal_status: fbr.enabled ? 'SUBMITTED' : 'NOT_REQUIRED',
      fiscal_invoice_number: fbr.enabled ? 'PREVIEW-FBR-0001' : null,
    },
    items: [
      {
        id: '1',
        name: 'Panadol',
        strength: '500mg Tablets',
        batch_number: 'PN2407',
        expiry_date: '2027-06-30',
        quantity: '20.000',
        unit_price: '15.00',
        line_total: '300.00',
        dosage_instruction: '1+0+1 after meal',
        discount_amount: '0.00',
      },
      {
        id: '2',
        name: 'Augmentin',
        strength: '625mg Tablets',
        batch_number: 'AG1188',
        expiry_date: '2026-12-31',
        quantity: '6.000',
        unit_price: '150.00',
        line_total: '850.00',
        dosage_instruction: '1+1+1',
        discount_amount: '50.00',
      },
      {
        id: '3',
        name: 'Calpol',
        strength: '120mg/5ml Syrup',
        batch_number: 'CP5521',
        expiry_date: '2027-03-31',
        quantity: '1.000',
        unit_price: '200.00',
        line_total: '200.00',
        dosage_instruction: '½+0+½',
        discount_amount: '0.00',
      },
    ],
    payments: [
      {
        method: 'CASH',
        amount: '1300.00',
        tendered_amount: '1500.00',
        change_amount: '200.00',
        reference: null,
      },
    ],
    returnQrPayload: '00000000-0000-4000-8000-000000000123',
    shop,
    fbr: {
      enabled: fbr.enabled,
      status: fbr.enabled ? 'SUBMITTED' : 'NOT_REQUIRED',
      invoiceNumber: fbr.enabled ? 'PREVIEW-FBR-0001' : null,
      qrPayload: fbr.enabled ? 'PREVIEW-FBR-0001' : null,
      posRegistrationNumber: fbr.posRegistrationNumber,
      lastError: null,
    },
  };
}
