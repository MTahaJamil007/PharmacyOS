import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INVOICE_LAYOUT,
  fbrRegistrationGaps,
  invoiceLayoutSchema,
  isPrivatePrinterAddress,
  networkPrintSchema,
  resolveInvoiceLayout,
  shopProfileSchema,
} from './invoice.js';
import { createUserSchema, PASSWORD_MIN_LENGTH } from './schemas.js';

describe('invoice layout', () => {
  it('fills every field with a default', () => {
    expect(DEFAULT_INVOICE_LAYOUT).toMatchObject({
      paperWidth: '80mm',
      fontScale: 'NORMAL',
      showDosage: true,
      showReturnQr: true,
      copies: 1,
    });
  });

  it('keeps valid stored fields and drops damaged ones instead of failing to print', () => {
    expect(
      resolveInvoiceLayout({ paperWidth: '58mm', copies: 9, showBatch: 'yes', unknown: 1 }),
    ).toEqual({ ...DEFAULT_INVOICE_LAYOUT, paperWidth: '58mm' });
    expect(resolveInvoiceLayout(null)).toEqual(DEFAULT_INVOICE_LAYOUT);
    expect(resolveInvoiceLayout({})).toEqual(DEFAULT_INVOICE_LAYOUT);
  });

  it('rejects unknown fields and out-of-range values on save', () => {
    expect(invoiceLayoutSchema.safeParse({ ...DEFAULT_INVOICE_LAYOUT, copies: 4 }).success).toBe(
      false,
    );
    expect(invoiceLayoutSchema.safeParse({ ...DEFAULT_INVOICE_LAYOUT, logo: 'x' }).success).toBe(
      false,
    );
    expect(
      invoiceLayoutSchema.safeParse({ ...DEFAULT_INVOICE_LAYOUT, title: 'x'.repeat(41) }).success,
    ).toBe(false);
  });
});

describe('shop profile and FBR readiness', () => {
  it('validates NTN, email and scenario formats', () => {
    expect(shopProfileSchema.safeParse({ sellerNtnCnic: '1234567' }).success).toBe(true);
    expect(shopProfileSchema.safeParse({ sellerNtnCnic: '3520212345678' }).success).toBe(true);
    expect(shopProfileSchema.safeParse({ sellerNtnCnic: '12345' }).success).toBe(false);
    expect(shopProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(shopProfileSchema.safeParse({ scenarioId: 'SN01' }).success).toBe(false);
    expect(shopProfileSchema.safeParse({}).success).toBe(false);
  });

  it('lists what FBR needs before invoicing can be switched on', () => {
    expect(
      fbrRegistrationGaps({
        sellerNtnCnic: null,
        posRegistrationNumber: '123456',
        businessName: 'Shop',
        province: null,
        address: 'Lahore',
      }),
    ).toEqual(['NTN or CNIC', 'Province']);
  });
});

describe('network printing', () => {
  it('only reaches printers on the shop network', () => {
    expect(isPrivatePrinterAddress('192.168.1.50')).toBe(true);
    expect(isPrivatePrinterAddress('10.0.0.9')).toBe(true);
    expect(isPrivatePrinterAddress('172.20.1.1')).toBe(true);
    expect(isPrivatePrinterAddress('127.0.0.1')).toBe(true);
    expect(isPrivatePrinterAddress('172.32.0.1')).toBe(false);
    expect(isPrivatePrinterAddress('8.8.8.8')).toBe(false);
    expect(isPrivatePrinterAddress('192.168.1.300')).toBe(false);
  });

  it('accepts only the raw printing ports and base64 data', () => {
    expect(networkPrintSchema.safeParse({ host: '192.168.1.5', data: 'G0A=' }).success).toBe(true);
    expect(
      networkPrintSchema.safeParse({ host: '192.168.1.5', port: 80, data: 'G0A=' }).success,
    ).toBe(false);
    expect(networkPrintSchema.safeParse({ host: 'printer.local', data: 'G0A=' }).success).toBe(
      false,
    );
  });
});

describe('short staff passwords', () => {
  it(`accepts ${String(PASSWORD_MIN_LENGTH)} characters and rejects fewer`, () => {
    const user = { username: 'counter1', displayName: 'Counter one', roles: ['CASHIER'] };
    expect(createUserSchema.safeParse({ ...user, password: '123456' }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...user, password: '12345' }).success).toBe(false);
  });
});
