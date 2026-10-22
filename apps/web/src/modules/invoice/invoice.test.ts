import { DEFAULT_INVOICE_LAYOUT, type SaleReceipt } from '@pharmacy/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asciiDosage, buildEscPosInvoice, columnsFor, toBase64 } from './escpos';
import { buildInvoiceModel, displayQuantity, sampleReceipt } from './invoice-model';
import { loadPrinterProfile, printInvoice, savePrinterProfile } from './printers';

const shop = {
  name: 'Al-Shifa Pharmacy',
  address: 'Main Boulevard, Lahore',
  phone: '042-1111111',
  email: null,
  drugLicenseNumber: 'DSL-42',
  sellerNtnCnic: '1234567',
  sellerStrn: null,
  businessName: 'Al-Shifa Pharmacy',
};

function receipt(fbrEnabled: boolean, invoiceNumber: string | null = 'FBR-0001'): SaleReceipt {
  const base = sampleReceipt(shop, { enabled: fbrEnabled, posRegistrationNumber: '123456' });
  return {
    ...base,
    fbr: {
      enabled: fbrEnabled,
      status: invoiceNumber ? 'SUBMITTED' : 'PENDING',
      invoiceNumber: fbrEnabled ? invoiceNumber : null,
      qrPayload: fbrEnabled ? invoiceNumber : null,
      posRegistrationNumber: '123456',
      lastError: null,
    },
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('invoice model', () => {
  it('prints the shop profile, every line with its timing, and the totals', () => {
    const model = buildInvoiceModel(receipt(false));
    expect(model.shopName).toBe('Al-Shifa Pharmacy');
    expect(model.shopLines).toEqual([
      'Main Boulevard, Lahore',
      'Phone: 042-1111111',
      'Drug license: DSL-42',
      'NTN: 1234567',
    ]);
    expect(model.lines[0]).toMatchObject({
      name: 'Panadol 500mg Tablets',
      quantity: '20',
      dosage: {
        code: '1+0+1 after meal',
        english: 'Morning 1 · Night 1 · after meal',
        urdu: 'صبح 1 · رات 1 · کھانے کے بعد',
      },
    });
    expect(model.lines[1]?.discount).toBe('50.00');
    expect(model.totals).toMatchObject({ total: '1300.00', discount: '50.00', units: '27' });
    expect(model.change).toBe('200.00');
  });

  it('has no FBR block or FBR QR when FBR invoicing is off', () => {
    expect(buildInvoiceModel(receipt(false)).fbr).toBeNull();
    expect(buildInvoiceModel(receipt(true)).fbr).toEqual({
      posRegistrationNumber: '123456',
      invoiceNumber: 'FBR-0001',
      qrPayload: 'FBR-0001',
      pending: false,
    });
    expect(buildInvoiceModel(receipt(true, null)).fbr).toMatchObject({
      qrPayload: null,
      pending: true,
    });
  });

  it('hides what the layout switches off', () => {
    const model = buildInvoiceModel(receipt(false), {
      ...DEFAULT_INVOICE_LAYOUT,
      showDosage: false,
      showBatch: false,
      showReturnQr: false,
      showAddress: false,
      showCashier: false,
    });
    expect(model.lines[0]?.dosage).toBeNull();
    expect(model.lines[0]?.batch).toBeNull();
    expect(model.returnQr).toBeNull();
    expect(model.cashier).toBeNull();
    expect(model.shopLines).not.toContain('Main Boulevard, Lahore');
  });

  it('shows whole and fractional quantities plainly', () => {
    expect(displayQuantity('20.000')).toBe('20');
    expect(displayQuantity('2.500')).toBe('2.5');
    expect(displayQuantity('0.000')).toBe('0');
  });
});

describe('ESC/POS invoice', () => {
  it('fits the paper width and prints timing in ASCII', () => {
    expect(columnsFor(buildInvoiceModel(receipt(false)))).toBe(48);
    expect(
      columnsFor(
        buildInvoiceModel(receipt(false), { ...DEFAULT_INVOICE_LAYOUT, paperWidth: '58mm' }),
      ),
    ).toBe(32);
    expect(asciiDosage('½+0+½')).toBe('1/2+0+1/2');
    expect(asciiDosage('1½+¼+0 before meal')).toBe('1-1/2+1/4+0 before meal');
    const text = decode(
      buildEscPosInvoice(buildInvoiceModel(receipt(false)), { openDrawer: false }),
    );
    expect(text).toContain('Al-Shifa Pharmacy');
    expect(text).toContain('Dose 1+0+1 after meal');
    expect(text).toContain('Dose 1/2+0+1/2');
    expect(text).toContain('1,300.00');
    // Item, total and payment rows are laid out to fit the 48-column roll exactly.
    const rows = text
      .split('\n')
      .filter((line) => /^( {2}\d| {4}|Subtotal|Cash|Change)/.test(line));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(48);
  });

  it('prints the FBR QR only while FBR invoicing is on', () => {
    const fbrQrStore = (bytes: Uint8Array): boolean => decode(bytes).includes('1P0FBR-0001');
    expect(
      fbrQrStore(buildEscPosInvoice(buildInvoiceModel(receipt(true)), { openDrawer: false })),
    ).toBe(true);
    const off = buildEscPosInvoice(buildInvoiceModel(receipt(false)), { openDrawer: false });
    expect(decode(off)).not.toContain('FBR INVOICE');
    expect(fbrQrStore(off)).toBe(false);
  });

  it('repeats copies with a cut each and opens the drawer once', () => {
    const bytes = buildEscPosInvoice(
      buildInvoiceModel(receipt(false), { ...DEFAULT_INVOICE_LAYOUT, copies: 2 }),
      { openDrawer: true },
    );
    const sequence = (needle: readonly number[]): number =>
      Array.from(bytes).filter((_, index) =>
        needle.every((value, offset) => bytes[index + offset] === value),
      ).length;
    expect(sequence([0x1d, 0x56, 0x42, 0x03])).toBe(2);
    expect(sequence([0x1b, 0x70, 0x00, 0x19, 0xfa])).toBe(1);
    expect(atob(toBase64(bytes)).length).toBe(bytes.length);
  });
});

describe('printer transports', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'serial');
  });

  it('remembers this counter’s printer and ignores tampered values', () => {
    savePrinterProfile({
      method: 'NETWORK',
      networkHost: '192.168.1.50',
      networkPort: 9101,
      baudRate: 9600,
      openDrawer: true,
      autoPrint: false,
    });
    expect(loadPrinterProfile()).toMatchObject({ method: 'NETWORK', networkPort: 9101 });
    localStorage.setItem(
      'pharmacy-printer-profile-v1',
      JSON.stringify({ method: 'FAX', networkPort: 80 }),
    );
    expect(loadPrinterProfile()).toMatchObject({ method: 'BROWSER', networkPort: 9100 });
  });

  it('reuses an allowed serial port without asking again', async () => {
    const write = vi.fn(() => Promise.resolve());
    const port = {
      open: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      writable: { getWriter: () => ({ write, releaseLock: vi.fn() }) },
    };
    const requestPort = vi.fn();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { getPorts: () => Promise.resolve([port]), requestPort },
    });
    await printInvoice(
      buildInvoiceModel(receipt(false)),
      {
        method: 'SERIAL',
        networkHost: '',
        networkPort: 9100,
        baudRate: 19200,
        openDrawer: false,
        autoPrint: false,
      },
      { token: 't', element: null },
    );
    expect(requestPort).not.toHaveBeenCalled();
    expect(port.open).toHaveBeenCalledWith({ baudRate: 19200 });
    expect(write).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('sends A4 invoices through the browser and refuses raw A4', async () => {
    await expect(
      printInvoice(
        buildInvoiceModel(receipt(false), { ...DEFAULT_INVOICE_LAYOUT, paperWidth: 'A4' }),
        {
          method: 'USB',
          networkHost: '',
          networkPort: 9100,
          baudRate: 9600,
          openDrawer: false,
          autoPrint: false,
        },
        { token: 't', element: null },
      ),
    ).rejects.toThrow('A4 invoices print through');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const element = document.createElement('div');
    document.body.append(element);
    await printInvoice(
      buildInvoiceModel(receipt(false), { ...DEFAULT_INVOICE_LAYOUT, paperWidth: 'A4' }),
      {
        method: 'BROWSER',
        networkHost: '',
        networkPort: 9100,
        baudRate: 9600,
        openDrawer: false,
        autoPrint: false,
      },
      { token: 't', element },
    );
    expect(print).toHaveBeenCalledOnce();
    expect(document.getElementById('invoice-page-size')?.textContent).toContain('size: A4');
  });
});
