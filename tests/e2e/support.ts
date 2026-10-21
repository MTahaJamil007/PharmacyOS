import type { Page, Route } from '@playwright/test';

/**
 * Shared fixtures for the browser suite. Every spec runs the real web app against mocked
 * API responses, so these tests cover the screens and their requests, not the server.
 */

export const baseSession = {
  absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
  accessToken: 'e2e-token',
  expiresAt: '2027-08-31T20:30:00.000Z',
  sessionId: 'e2e-session',
  user: {
    branchId: '1',
    branchTimezone: 'Asia/Karachi',
    displayName: 'E2E Operator',
    id: '1',
    permissions: [] as string[],
    terminalCode: 'COUNTER-01',
    terminalId: '1',
    terminalName: 'Front Counter',
    username: 'cashier',
  },
};

export type TestSession = typeof baseSession;

export function sessionWith(permissions: readonly string[]): TestSession {
  return { ...baseSession, user: { ...baseSession.user, permissions: [...permissions] } };
}

export function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

/**
 * Signs the browser in before the app boots and answers any request a spec did not mock
 * with an empty 404, so an unexpected call shows up as a visible error instead of hanging.
 * Routes registered later take precedence over this fallback.
 */
export async function signIn(page: Page, session: TestSession): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem('pharmacy-session', JSON.stringify(value));
  }, session);
  await page.route('**/api/v1/**', (route) => json(route, { message: 'Not mocked' }, 404));
  await page.route('**/api/v1/health/ready', (route) => json(route, { status: 'ready' }));
}

export const openCashSession = {
  accountPayments: '0.00',
  cashIn: '0.00',
  cashOut: '0.00',
  cashRefunds: '0.00',
  cashSales: '0.00',
  cashierName: 'E2E Operator',
  cashierUserId: '1',
  closedAt: null,
  closingNotes: null,
  countedCash: null,
  expectedCash: '5000.00',
  id: '10',
  openedAt: '2026-08-31T08:00:00.000Z',
  openingFloat: '5000.00',
  status: 'OPEN',
  variance: null,
  varianceApprovalThreshold: '100.00',
} as const;

export const panadol = {
  availableQuantity: '5.000',
  barcode: '8961100098765',
  daysToExpiry: 122,
  genericName: 'Paracetamol',
  id: '101',
  manufacturer: 'GSK',
  name: 'Panadol',
  nearestExpiry: '2027-01-01',
  salePrice: '35.00',
  shelf: 'A-01',
  strength: '500 mg',
} as const;

export function receiptFor(
  saleId: string,
  invoiceNumber: string,
  overrides: {
    readonly total?: string;
    readonly payments?: readonly Record<string, unknown>[];
  } = {},
) {
  const total = overrides.total ?? '35.00';
  return {
    items: [
      {
        batch_number: 'B-1',
        discount_amount: '0.00',
        expiry_date: '2027-01-01',
        id: '1',
        line_total: total,
        name: 'Panadol',
        quantity: '1.000',
        strength: '500 mg',
        tax_amount: '0.00',
        tax_rate: '0.00',
        unit_price: total,
      },
    ],
    payments: overrides.payments ?? [
      {
        amount: total,
        change_amount: '0.00',
        method: 'CASH',
        reference: null,
        tendered_amount: total,
      },
    ],
    returnQrPayload: `00000000-0000-4000-8000-${saleId.padStart(12, '0')}`,
    sale: {
      branch_address: 'Karachi',
      branch_name: 'Main Pharmacy',
      branch_phone: '021-0000000',
      cashier_name: 'E2E Operator',
      created_at: '2026-08-31T12:00:00.000Z',
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      discount_total: '0.00',
      fiscal_invoice_number: null,
      fiscal_status: 'NOT_REQUIRED',
      id: saleId,
      invoice_number: invoiceNumber,
      pos_registration_number: null,
      return_lookup_token: `00000000-0000-4000-8000-${saleId.padStart(12, '0')}`,
      seller_ntn_cnic: null,
      seller_strn: null,
      subtotal: total,
      tax_total: '0.00',
      terminal_name: 'Front Counter',
      total,
    },
  };
}

/** Types a barcode the way a USB scanner does: fast key events ending in Enter. */
export async function scan(page: Page, barcode: string): Promise<void> {
  await page.evaluate((code) => {
    for (const key of code) {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  }, barcode);
}
