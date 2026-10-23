import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

async function signIn(page: Page, permissions: readonly string[], terminalName: string) {
  await page.addInitScript(
    (stored) => {
      localStorage.setItem('pharmacy-session', JSON.stringify(stored));
      window.print = () => undefined;
    },
    {
      accessToken: 'cash-counter-token',
      absoluteExpiresAt: '2099-09-01T08:00:00.000Z',
      expiresAt: '2099-08-31T20:30:00.000Z',
      sessionId: 'cash-counter-session',
      user: {
        id: '5',
        branchId: '1',
        branchTimezone: 'Asia/Karachi',
        displayName: 'Counter Staff',
        permissions,
        terminalCode: 'DESK-1',
        terminalId: '3',
        terminalName,
        username: 'staff',
      },
    },
  );
}

const panadol = {
  availableQuantity: '100.000',
  barcode: '8961100098765',
  daysToExpiry: 300,
  genericName: 'Paracetamol',
  id: '101',
  manufacturer: 'GSK',
  name: 'Panadol',
  nearestExpiry: '2027-06-30',
  salePrice: '15.00',
  shelf: 'A-01',
  strength: '500 mg',
};

function summary(overrides: Record<string, string | null>) {
  return {
    id: '10',
    status: 'OPEN',
    cashierUserId: '5',
    cashierName: 'Counter Staff',
    openingFloat: '3000.00',
    cashSales: '0.00',
    accountPayments: '0.00',
    cashRefunds: '0.00',
    cashIn: '0.00',
    cashOut: '0.00',
    expectedCash: '3000.00',
    countedCash: null,
    variance: null,
    varianceApprovalThreshold: '100.00',
    openedAt: '2026-10-22T03:00:00.000Z',
    closedAt: null,
    closingNotes: null,
    ...overrides,
  };
}

function receipt(id: string, invoiceNumber: string, total: string) {
  return {
    sale: {
      id,
      invoice_number: invoiceNumber,
      subtotal: total,
      discount_total: '0.00',
      tax_total: '0.00',
      total,
      created_at: '2026-10-22T09:30:00.000Z',
      branch_name: 'Al-Shifa Pharmacy',
      branch_address: null,
      branch_phone: null,
      cashier_name: 'Counter Staff',
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      return_lookup_token: '00000000-0000-4000-8000-000000000090',
      fiscal_status: 'NOT_REQUIRED',
      fiscal_invoice_number: null,
    },
    items: [
      {
        id: '1',
        name: 'Panadol',
        strength: '500 mg',
        batch_number: 'PN1',
        expiry_date: '2027-06-30',
        quantity: '20.000',
        unit_price: '15.00',
        line_total: '300.00',
        dosage_instruction: '1+0+1',
      },
    ],
    payments: [
      {
        method: 'CASH',
        amount: total,
        tendered_amount: total,
        change_amount: '0.00',
        reference: null,
      },
    ],
    returnQrPayload: '00000000-0000-4000-8000-000000000090',
  };
}

test('cashier starts the day, clears a bill from the order desk, and ends the day', async ({
  page,
}) => {
  await signIn(
    page,
    ['pos.search', 'sale.finalize_payment', 'cash.open_session', 'cash.close_session'],
    'Cash counter',
  );
  let current: Record<string, unknown> | null = null;
  let cleared = false;
  const captured: { clear?: Record<string, unknown> } = {};
  const bill = {
    id: '55',
    total: '1300.00',
    invoiceDiscount: '0.00',
    queuedAt: new Date().toISOString(),
    reservedUntil: new Date(Date.now() + 600_000).toISOString(),
    status: 'RESERVED',
    orderTaker: 'Ali',
    counterName: 'Order desk 1',
    customerName: null,
    items: [
      {
        name: 'Augmentin',
        strength: '625mg',
        quantity: '6.000',
        lineTotal: '900.00',
        dosage: '1+1+1',
      },
      { name: 'Panadol', strength: '500mg', quantity: '20.000', lineTotal: '400.00', dosage: null },
    ],
  };
  await page.route('**/api/v1/pos/counter-settings', (route) =>
    json(route, { cashSessionsEnabled: true }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, current));
  await page.route('**/api/v1/cash-sessions/open', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ openingFloat: '3000' });
    current = summary({});
    return json(route, current, 201);
  });
  await page.route('**/api/v1/pos/cash-counter/queue', (route) =>
    json(
      route,
      cleared
        ? {
            data: [],
            recent: [
              {
                id: '90',
                invoiceNumber: 'MAIN-20261022-000090',
                total: '1300.00',
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : { data: [bill], recent: [] },
    ),
  );
  await page.route('**/api/v1/pos/cash-counter/55/clear', (route) => {
    captured.clear = route.request().postDataJSON() as Record<string, unknown>;
    cleared = true;
    current = summary({ cashSales: '1300.00', expectedCash: '4300.00' });
    return json(
      route,
      {
        id: '90',
        invoiceNumber: 'MAIN-20261022-000090',
        total: '1300.00',
        fiscalStatus: 'NOT_REQUIRED',
        returnLookupToken: '00000000-0000-4000-8000-000000000090',
        returnLookupPath: '/returns/x',
      },
      201,
    );
  });
  await page.route('**/api/v1/pos/sales/90/receipt', (route) =>
    json(route, receipt('90', 'MAIN-20261022-000090', '1300.00')),
  );
  await page.route('**/api/v1/cash-sessions/10/close', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ countedCash: '4300' });
    current = null;
    return json(
      route,
      summary({
        status: 'CLOSED',
        cashSales: '1300.00',
        expectedCash: '4300.00',
        countedCash: '4300.00',
        variance: '0.00',
      }),
      201,
    );
  });

  await page.goto('/#/cash');
  await expect(page.getByRole('heading', { name: 'Start the day' })).toBeVisible();
  await page.getByLabel('How much cash is in the drawer right now? (PKR)').fill('3000');
  await page.getByRole('button', { name: 'Start day' }).click();
  await expect(page.getByRole('status')).toContainText('Day started');

  const card = page.getByRole('article', { name: 'Bill #55' });
  await expect(card).toContainText('PKR 1,300.00');
  await expect(card).toContainText('Augmentin 625mg');
  await card.getByLabel('Cash received (optional)').fill('1000');
  await expect(card).toContainText('Less than the bill');
  await expect(card.getByRole('button', { name: 'Payment received ✓' })).toBeDisabled();
  await card.getByLabel('Cash received (optional)').fill('2000');
  await expect(card).toContainText('Give back PKR 700.00');
  await card.getByRole('button', { name: 'Payment received ✓' }).click();

  const sale = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(sale).toContainText('MAIN-20261022-000090');
  expect(captured.clear).toMatchObject({ cashSessionId: '10', tenderedAmount: '2000' });
  expect(typeof captured.clear?.clientRequestId).toBe('string');
  await sale.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText('No bills waiting')).toBeVisible();
  await expect(page.locator('.drawer-expected')).toContainText('PKR 4,300.00');
  await expect(page.locator('.recent-payments')).toContainText('MAIN-20261022-000090');

  const count = page.getByLabel('Count the cash in the drawer (PKR)');
  await count.fill('4200');
  await expect(page.locator('.closing-check')).toContainText('PKR 100.00 short of the system');
  await count.fill('4300');
  await expect(page.locator('.closing-check')).toContainText('Exact');
  await page.getByRole('button', { name: 'End day' }).click();
  await expect(page.getByRole('heading', { name: 'Day closed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start the day' })).toBeVisible();
});

test('drawer variance requires another manager and can then be approved', async ({ page }) => {
  await signIn(page, ['cash.open_session', 'cash.approve_variance'], 'Cash counter');
  const own = summary({ status: 'CLOSING', countedCash: '200.00', variance: '-2800.00' });
  const other = summary({
    id: '11',
    cashierUserId: '6',
    cashierName: 'Other cashier',
    status: 'CLOSING',
    countedCash: '200.00',
    variance: '-2800.00',
  });
  let approved = false;
  const approvalRequests: string[] = [];
  await page.route('**/api/v1/pos/counter-settings', (route) =>
    json(route, { cashSessionsEnabled: true }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, own));
  await page.route('**/api/v1/cash-sessions/pending-variance', (route) =>
    json(route, { data: approved ? [own] : [own, other] }),
  );
  await page.route('**/api/v1/cash-sessions/11/approve-variance', (route) => {
    const body = route.request().postDataJSON() as { notes: string; clientRequestId: string };
    expect(body).toMatchObject({ notes: 'Reviewed count and shortage' });
    approvalRequests.push(body.clientRequestId);
    if (approvalRequests.length === 1) return route.abort('connectionfailed');
    approved = true;
    return json(route, { ...other, status: 'VARIANCE_APPROVED' });
  });
  await page.goto('/#/cash');
  await expect(
    page.getByText('This day is waiting for variance approval.', { exact: false }),
  ).toBeVisible();
  const ownRow = page.locator('.variance-row').filter({ hasText: 'Counter Staff' });
  await ownRow.getByRole('textbox').fill('Count reviewed');
  await expect(ownRow.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(ownRow).toContainText('Another authorized manager');
  const otherRow = page.locator('.variance-row').filter({ hasText: 'Other cashier' });
  await otherRow.getByRole('textbox').fill('Reviewed count and shortage');
  await otherRow.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the pharmacy service');
  await otherRow.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Difference approved' })).toBeVisible();
  expect(approved).toBe(true);
  expect(approvalRequests).toHaveLength(2);
  expect(approvalRequests[0]).toBe(approvalRequests[1]);
});

async function orderDesk(page: Page, settings: { cashSessionsEnabled: boolean }) {
  await signIn(page, ['pos.search', 'pos.create_draft', 'pos.send_to_cashier'], 'Order desk 1');
  await page.route('**/api/v1/pos/counter-settings', (route) => json(route, settings));
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.route('**/api/v1/pos/drafts', (route) =>
    json(route, { id: '20', status: 'DRAFT', total: '300.00' }, 201),
  );
  await page.route('**/api/v1/pos/drafts/20/reserve', (route) => {
    // Match Fastify's parser: declaring JSON on an empty POST rejects the reservation.
    if (
      route.request().headers()['content-type']?.includes('application/json') &&
      !route.request().postData()
    ) {
      return json(
        route,
        { message: 'Body cannot be empty when content-type is set to application/json' },
        400,
      );
    }
    return json(
      route,
      { id: '20', reservedUntil: '2099-01-01T00:00:00.000Z', status: 'RESERVED', total: '300.00' },
      201,
    );
  });
  await page.goto('/#/pos');
  const search = page.getByPlaceholder('Brand, generic, barcode or company');
  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol 500 mg/ })).toBeVisible();
  await search.press('Enter');
  const quantity = page.getByLabel('Quantity', { exact: true });
  await quantity.fill('20');
  await quantity.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('20');
}

test('order desk sends the bill to the cash counter with one key', async ({ page }) => {
  let sent = false;
  await page.route('**/api/v1/pos/drafts/20/send-to-cashier', (route) => {
    sent = true;
    return json(route, { id: '20', total: '300.00' }, 201);
  });
  await orderDesk(page, { cashSessionsEnabled: true });
  await expect(page.getByRole('button', { name: /Send to cash counter/ })).toBeVisible();
  await page.keyboard.press('F8');
  await expect(page.getByRole('status')).toContainText(
    'Sent to the cash counter · order #20 · PKR 300.00',
  );
  expect(sent).toBe(true);
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  await expect(page.getByPlaceholder('Brand, generic, barcode or company')).toBeFocused();
});

test('without cash sessions the order desk prints the invoice itself', async ({ page }) => {
  const captured: { invoice?: Record<string, unknown> } = {};
  await page.route('**/api/v1/pos/drafts/20/complete-invoice', (route) => {
    captured.invoice = route.request().postDataJSON() as Record<string, unknown>;
    return json(
      route,
      {
        id: '91',
        invoiceNumber: 'MAIN-20261022-000091',
        total: '300.00',
        fiscalStatus: 'NOT_REQUIRED',
        returnLookupToken: '00000000-0000-4000-8000-000000000091',
        returnLookupPath: '/returns/x',
      },
      201,
    );
  });
  await page.route('**/api/v1/pos/sales/91/receipt', (route) =>
    json(route, receipt('91', 'MAIN-20261022-000091', '300.00')),
  );
  await orderDesk(page, { cashSessionsEnabled: false });
  await expect(page.getByRole('button', { name: /Print invoice/ })).toBeVisible();
  await page.keyboard.press('F8');
  const sale = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(sale).toContainText('MAIN-20261022-000091');
  await expect(sale).toContainText('Dose 1+0+1');
  expect(typeof captured.invoice?.clientRequestId).toBe('string');
});

test('super admin switches cash sessions per shop', async ({ page }) => {
  await signIn(page, ['pos.search', 'platform.super_admin'], 'Owner desk');
  let body: unknown = null;
  const shop = {
    id: '1',
    code: 'MAIN',
    name: 'Al-Shifa Pharmacy',
    address: 'Lahore',
    phone: null,
    email: null,
    drugLicenseNumber: null,
    isActive: true,
    cashSessionsEnabled: true,
    sellerNtnCnic: null,
    sellerStrn: null,
    posRegistrationNumber: null,
    businessName: null,
    province: null,
    scenarioId: null,
    fbr: {
      invoicingEnabled: false,
      invoicingChangedAt: null,
      transmissionApproved: false,
      transmissionApprovedAt: null,
      serverMode: 'DISABLED',
      serverTokenConfigured: false,
      registrationGaps: ['NTN or CNIC'],
    },
  };
  await page.route('**/api/v1/platform/shops', (route) => json(route, { data: [shop] }));
  await page.route('**/api/v1/platform/shops/1/cash-sessions', (route) => {
    body = route.request().postDataJSON();
    return json(route, { ...shop, cashSessionsEnabled: false });
  });
  await page.goto('/#/platform');
  const toggle = page.getByRole('switch', { name: 'Cash sessions for Al-Shifa Pharmacy' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(page.getByRole('status')).toContainText('cash sessions off');
  expect(body).toEqual({ enabled: false });
});

test('with several cash counters the order desk picks one, and a claimed bill is left alone', async ({
  page,
}) => {
  let body: unknown = null;
  await page.route('**/api/v1/pos/cash-counters', (route) =>
    json(route, {
      data: [
        { id: '31', code: 'C1', name: 'Counter 1', cashier: 'Ali', waiting: 0 },
        { id: '32', code: 'C2', name: 'Counter 2', cashier: null, waiting: 2 },
      ],
    }),
  );
  await page.route('**/api/v1/pos/drafts/20/send-to-cashier', (route) => {
    body = route.request().postDataJSON();
    return json(route, { id: '20', total: '300.00' }, 201);
  });
  await orderDesk(page, { cashSessionsEnabled: true });
  const choice = page.getByRole('group', { name: 'Send bills to' });
  await expect(choice.getByRole('button', { name: 'Any counter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await choice.getByRole('button', { name: /Counter 2/ }).click();
  await page.keyboard.press('F8');
  await expect(page.getByRole('status')).toContainText('Sent to Counter 2 · order #20');
  expect(body).toEqual({ cashCounterTerminalId: '32' });
});

test('a cashier sees bills for this counter first and cannot take one being paid elsewhere', async ({
  page,
}) => {
  await signIn(
    page,
    ['pos.search', 'sale.finalize_payment', 'cash.open_session', 'cash.close_session'],
    'Counter 2',
  );
  let claimed = '';
  const bill = (id: string, overrides: Record<string, unknown>) => ({
    id,
    total: '300.00',
    invoiceDiscount: '0.00',
    queuedAt: new Date().toISOString(),
    reservedUntil: new Date(Date.now() + 600_000).toISOString(),
    status: 'RESERVED',
    orderTaker: 'Ali',
    counterName: 'Order desk 1',
    customerName: null,
    items: [
      { name: 'Panadol', strength: '500mg', quantity: '20.000', lineTotal: '300.00', dosage: null },
    ],
    ...overrides,
  });
  await page.route('**/api/v1/pos/counter-settings', (route) =>
    json(route, { cashSessionsEnabled: true }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, summary({})));
  await page.route('**/api/v1/pos/cash-counter/queue', (route) =>
    json(route, {
      data: [
        bill('61', { forThisCounter: true, cashCounterName: 'Counter 2', cashCounterId: '32' }),
        bill('62', { claimedBy: 'Counter 1', claimedHere: false }),
      ],
      recent: [],
    }),
  );
  await page.route('**/api/v1/pos/cash-counter/*/claim', (route) => {
    claimed = route.request().url().split('/').at(-2) ?? '';
    return json(route, { id: claimed, claimed: true }, 201);
  });
  await page.goto('/#/cash');
  const mine = page.getByRole('article', { name: 'Bill #61' });
  const elsewhere = page.getByRole('article', { name: 'Bill #62' });
  await expect(mine).toContainText('For this counter');
  await expect(elsewhere).toContainText('Being paid at Counter 1');
  await expect(elsewhere.getByRole('button', { name: 'Payment received ✓' })).toBeDisabled();
  await mine.getByRole('textbox').focus();
  await expect.poll(() => claimed).toBe('61');
});
