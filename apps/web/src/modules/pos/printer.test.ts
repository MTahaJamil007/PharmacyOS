import type { SaleReceipt } from '@pharmacy/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { printEscPosReceipt } from './printer';

const receipt: SaleReceipt = {
  items: [
    {
      batch_number: 'B-1',
      expiry_date: '2027-12-31',
      id: '1',
      line_total: '35.00',
      name: 'Panadol',
      quantity: '1.000',
      strength: '500 mg',
      unit_price: '35.00',
    },
  ],
  payments: [
    {
      amount: '35.00',
      change_amount: '5.00',
      method: 'CASH',
      reference: null,
      tendered_amount: '40.00',
    },
  ],
  returnQrPayload: '00000000-0000-4000-8000-000000000030',
  sale: {
    branch_address: 'Karachi',
    branch_name: 'Main Pharmacy',
    branch_phone: '021-0000000',
    cashier_name: 'Operator',
    created_at: '2026-09-01T08:00:00.000Z',
    discount_total: '0.00',
    fiscal_invoice_number: null,
    fiscal_status: 'NOT_REQUIRED',
    id: '30',
    invoice_number: 'MAIN-000030',
    return_lookup_token: '00000000-0000-4000-8000-000000000030',
    subtotal: '35.00',
    tax_total: '0.00',
    total: '35.00',
  },
};

describe('ESC/POS receipt transport', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    vi.restoreAllMocks();
  });

  it('writes an 80 mm receipt with QR, cut, and drawer-pulse commands', async () => {
    let written: Uint8Array | undefined;
    const writer = {
      releaseLock: vi.fn(),
      write: vi.fn((data: Uint8Array) => {
        written = data;
        return Promise.resolve();
      }),
    };
    const port = {
      close: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
      writable: { getWriter: () => writer },
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
    });

    await printEscPosReceipt(receipt, { kickDrawer: true });

    expect(port.open).toHaveBeenCalledWith({ baudRate: 9_600 });
    expect(writer.write).toHaveBeenCalledOnce();
    expect(writer.releaseLock).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
    const bytes = Array.from(written ?? []);
    const drawerPulse = [0x1b, 0x70, 0x00, 0x19, 0xfa];
    expect(
      bytes.some((_, index) =>
        drawerPulse.every((expected, offset) => bytes[index + offset] === expected),
      ),
    ).toBe(true);
    expect(bytes.slice(-3)).toEqual([0x1d, 0x56, 0x00]);
    expect(new TextDecoder().decode(written)).toContain('MAIN-000030');
    expect(new TextDecoder().decode(written)).toContain(receipt.returnQrPayload);
  });
});
