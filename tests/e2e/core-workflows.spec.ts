import { expect, test } from '@playwright/test';

import {
  baseSession,
  json,
  openCashSession,
  panadol,
  receiptFor,
  scan,
  sessionWith,
  signIn,
} from './support.js';

const cashier = sessionWith([
  'pos.search',
  'pos.create_draft',
  'sale.finalize_payment',
  'cash.open_session',
  'cash.close_session',
  'returns.lookup',
  'returns.request',
  'returns.approve',
  'returns.refund',
  'returns.refund_cash',
  'inventory.shelf.read',
  'inventory.shelf.recommendation.review',
  'inventory.expiry.read',
  'procurement.reorder.review',
]);

test('staff signs in and signs out', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => json(route, { message: 'Not mocked' }, 404));
  await page.route('**/api/v1/auth/login', (route) => json(route, cashier));
  await page.route('**/api/v1/auth/logout', (route) => json(route, { revoked: true }));
  await page.goto('/');
  await page.getByLabel('Username').fill('cashier');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByLabel('Terminal code').fill('COUNTER-01');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('textbox', { name: 'Find medicine' })).toBeVisible();
  await page.getByRole('button', { name: /E2E Operator/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The terminal code is remembered for the next sign-in on this computer.
  await expect(page.getByLabel('Terminal code')).toHaveValue('COUNTER-01');
});

test('cashier scans, split-tenders, prints, and reprints a sale', async ({ page }) => {
  await signIn(page, cashier);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, openCashSession));
  await page.route('**/api/v1/pos/drafts', (route) =>
    json(route, { id: '20', status: 'DRAFT', total: '35.00' }, 201),
  );
  await page.route('**/api/v1/pos/drafts/20/reserve', (route) =>
    json(
      route,
      {
        id: '20',
        reservationCount: 1,
        reservedUntil: '2026-08-31T20:08:00.000Z',
        status: 'RESERVED',
        subtotal: '35.00',
        total: '35.00',
      },
      201,
    ),
  );
  let finalizeBody: unknown = null;
  await page.route('**/api/v1/pos/sales/finalize', (route) => {
    finalizeBody = route.request().postDataJSON();
    return json(
      route,
      {
        fiscalStatus: 'NOT_REQUIRED',
        id: '30',
        invoiceNumber: 'MAIN-20260831-000001',
        returnLookupPath: '/returns/token',
        returnLookupToken: '00000000-0000-4000-8000-000000000030',
        total: '35.00',
      },
      201,
    );
  });
  const receipt = receiptFor('30', 'MAIN-20260831-000001', {
    payments: [
      {
        amount: '15.00',
        change_amount: '5.00',
        method: 'CASH',
        reference: null,
        tendered_amount: '20.00',
      },
      {
        amount: '20.00',
        change_amount: null,
        method: 'CARD',
        reference: 'AUTH-7',
        tendered_amount: null,
      },
    ],
  });
  await page.route('**/api/v1/pos/sales/30/receipt', (route) => json(route, receipt));
  await page.route(/\/api\/v1\/pos\/sales(\?.*)?$/, (route) =>
    json(route, {
      data: [
        {
          cashier_name: 'E2E Operator',
          created_at: '2026-08-31T12:00:00.000Z',
          id: '30',
          invoice_number: 'MAIN-20260831-000001',
          total: '35.00',
        },
      ],
    }),
  );
  await page.route('**/api/v1/pos/sales/30/reprint', (route) => json(route, receipt, 201));

  await page.goto('/#/pos');
  await expect(page.getByRole('textbox', { name: 'Find medicine' })).toBeVisible();
  await scan(page, panadol.barcode);
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('1');

  await page.keyboard.press('F8');
  const payment = page.getByRole('dialog', { name: 'Take payment' });
  await expect(payment).toContainText('Rs 35.00');
  await payment.getByRole('group', { name: 'Card' }).getByLabel('Amount').fill('20');
  await payment
    .getByRole('group', { name: 'Card' })
    .getByLabel(/Card slip/)
    .fill('AUTH-7');
  await expect(
    payment.getByRole('group', { name: 'Cash' }).getByLabel('Cash for this sale'),
  ).toHaveValue('15.00');
  await payment.getByRole('group', { name: 'Cash' }).getByLabel('Customer gave').fill('20');
  await expect(payment).toContainText('Fully paid');
  await expect(payment.locator('.change-due')).toHaveText('Rs 5.00');
  await page.keyboard.press('F8');

  const done = page.getByRole('dialog', { name: /Sale complete/ });
  await expect(done).toContainText('MAIN-20260831-000001');
  await expect(done).toContainText('Change');
  await expect(done.getByAltText('Return lookup code')).toBeVisible();
  expect(finalizeBody).toMatchObject({
    cashSessionId: '10',
    draftId: '20',
    payments: [
      { amount: '15.00', method: 'CASH', tenderedAmount: '20.00' },
      { amount: '20.00', method: 'CARD', reference: 'AUTH-7' },
    ],
  });
  await done.getByRole('button', { name: 'New sale' }).click();
  await expect(page.getByText('No items yet')).toBeVisible();

  await page.keyboard.press('F6');
  const reprint = page.getByRole('dialog', { name: 'Find a receipt' });
  await reprint.getByRole('row', { name: /MAIN-20260831-000001/ }).click();
  await expect(page.getByRole('dialog', { name: /Sale complete/ })).toContainText(
    'MAIN-20260831-000001',
  );
});

test('cart survives reload and keyboard controls remain complete', async ({ page }) => {
  await signIn(page, cashier);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, openCashSession));
  await page.goto('/#/pos');
  const search = page.getByRole('textbox', { name: 'Find medicine' });
  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol/ })).toBeVisible();
  await search.press('Enter');
  await search.fill('*3');
  await search.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');

  await page.reload();
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');
  await page.keyboard.press('F4');
  await expect(page.getByText('Sale put on hold')).toBeVisible();
  await expect(page.getByText('No items yet')).toBeVisible();
  await page.keyboard.press('F4');
  await expect(page.getByText('Held sale resumed')).toBeVisible();
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');

  await page.getByRole('button', { name: 'Remove Panadol' }).click();
  await expect(page.getByText('No items yet')).toBeVisible();

  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol/ })).toBeVisible();
  await search.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('1');
  await page.keyboard.press('F2');
  await expect(page.getByText('No items yet')).toBeVisible();
});

test('an expired API session can re-authenticate without losing the counter', async ({ page }) => {
  await signIn(page, cashier);
  let authenticated = false;
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    authenticated
      ? json(route, { data: [panadol] })
      : json(route, { message: 'Session expired' }, 401),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    authenticated = true;
    return json(route, cashier);
  });
  await page.goto('/#/pos');
  await page.getByRole('textbox', { name: 'Find medicine' }).fill('Panadol');
  const reauth = page.getByRole('dialog', { name: 'Your session has ended' });
  await expect(reauth).toBeVisible();
  await reauth.getByLabel('Password').fill('correct-password');
  await reauth.getByRole('button', { name: 'Continue' }).click();
  await expect(reauth).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Find medicine' })).toHaveValue('Panadol');
});

test('operator opens, adjusts, and closes the cash drawer', async ({ page }) => {
  await signIn(page, cashier);
  let current: Record<string, unknown> | null = null;
  let movement: unknown = null;
  let closeBody: unknown = null;
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, current));
  await page.route('**/api/v1/cash-sessions/open', (route) => {
    current = { ...openCashSession };
    return json(route, current, 201);
  });
  await page.route('**/api/v1/cash-sessions/10/movements', (route) => {
    movement = route.request().postDataJSON();
    current = { ...openCashSession, cashOut: '200.00', expectedCash: '4800.00' };
    return json(route, { session: current }, 201);
  });
  await page.route('**/api/v1/cash-sessions/10/close', (route) => {
    closeBody = route.request().postDataJSON();
    current = null;
    return json(
      route,
      { ...openCashSession, countedCash: '4800.00', status: 'CLOSED', variance: '0.00' },
      201,
    );
  });
  await page.goto('/#/cash');
  await page.getByLabel('Starting cash (opening float)').fill('5000');
  await page.getByRole('button', { name: 'Open drawer' }).click();
  await expect(page.getByRole('heading', { name: 'Drawer is open' })).toBeVisible();

  await page.getByRole('button', { name: 'Cash in / out' }).click();
  const movementDialog = page.getByRole('dialog', { name: 'Cash in / out' });
  await movementDialog.getByLabel('Amount').fill('200');
  await movementDialog.getByRole('button', { name: 'Record' }).click();
  await expect(movementDialog).toBeHidden();
  expect(movement).toMatchObject({ amount: '200', movementType: 'CASH_OUT' });

  await page.getByRole('button', { name: 'Count and close' }).click();
  const closeDialog = page.getByRole('dialog', { name: 'Count and close the drawer' });
  await closeDialog.getByRole('button', { name: 'Enter total' }).click();
  await closeDialog.getByLabel('Counted cash').fill('4800');
  await closeDialog.getByRole('button', { name: 'Submit count' }).click();
  await expect(page.getByRole('heading', { name: 'Open the drawer' })).toBeVisible();
  expect(closeBody).toMatchObject({ countedCash: '4800.00' });
});

test('stock controller reviews shelf and reorder recommendations', async ({ page }) => {
  await signIn(page, cashier);
  let shelfOpen = true;
  let reorderOpen = true;
  await page.route('**/api/v1/shelf-recommendations?**', (route) =>
    json(route, {
      data: shelfOpen
        ? [
            {
              confidence: 'HIGH',
              current_location: 'A-9',
              demand_class: 'A',
              id: '1',
              medicine_name: 'Fast Picker',
              pick_count: '20',
              reason_snapshot: {},
              status: 'PENDING_REVIEW',
              suggested_location: 'A-1',
            },
          ]
        : [],
    }),
  );
  await page.route('**/api/v1/shelf-recommendations/1/review', (route) => {
    shelfOpen = false;
    return json(route, { id: '1', status: 'APPLIED' }, 201);
  });
  await page.route('**/api/v1/reorder-suggestions?**', (route) =>
    json(route, {
      data: reorderOpen
        ? [
            {
              confidence: 'LOW',
              current_sellable_stock: '5.000',
              effective_lead_time_days: 3,
              expiry_risk_flag: true,
              id: '2',
              medicine_name: 'Low Stock',
              reason: {},
              status: 'GENERATED',
              suggested_qty: '12.000',
            },
          ]
        : [],
    }),
  );
  await page.route('**/api/v1/reorder-suggestions/2/review', (route) => {
    reorderOpen = false;
    return json(route, { id: '2', status: 'REVIEWED' }, 201);
  });
  await page.route('**/api/v1/expiry-risk**', (route) => json(route, { data: [] }));
  await page.goto('/#/inventory');
  await page.getByRole('tab', { name: 'Shelf placement' }).click();
  await expect(page.getByText('Fast Picker')).toBeVisible();
  await page.getByRole('button', { name: 'Moved it' }).click();
  await expect(page.getByText('Fast Picker')).toBeHidden();
  await page.getByRole('tab', { name: 'Reorder suggestions' }).click();
  await expect(page.getByText('Low Stock')).toBeVisible();
  await page
    .getByRole('row', { name: /Low Stock/ })
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(page.getByText('Low Stock')).toBeHidden();
});

test('a return moves from invoice lookup through approval to a cash refund', async ({ page }) => {
  await signIn(page, cashier);
  const lookup = {
    items: [
      {
        batchNumber: 'B-1',
        eligibleQuantity: '1.000',
        expired: false,
        expiryDate: '2027-01-01',
        id: '1',
        medicineName: 'Panadol',
        netPaid: '35.00',
        returnedQuantity: '0.000',
        soldQuantity: '1.000',
        strength: '500 mg',
        unitPrice: '35.00',
      },
    ],
    payments: [{ amount: '35.00', method: 'CASH' }],
    returns: [],
    sale: {
      createdAt: '2026-08-31T12:00:00.000Z',
      customerId: null,
      customerName: null,
      discountTotal: '0.00',
      id: '30',
      invoiceNumber: 'MAIN-000001',
      lookupToken: '00000000-0000-4000-8000-000000000030',
      status: 'FINALIZED',
      total: '35.00',
    },
  };
  const queued = {
    customerId: null,
    customerName: null,
    id: '40',
    invoiceNumber: 'MAIN-000001',
    itemCount: 1,
    lookupToken: '00000000-0000-4000-8000-000000000030',
    reason: 'Damaged pack',
    refundAmount: '35.00',
    refundLimits: { cashOrCard: '35.00', customerAccount: '0.00' },
    refundMethod: null,
    rejectionReason: null,
    requestedAt: '2026-08-31T12:30:00.000Z',
    requestedBy: 'E2E Operator',
    returnNumber: 'RET-1',
    saleId: '30',
    status: 'REQUESTED',
  };
  let status = 'REQUESTED';
  let requestBody: unknown = null;
  let refundBody: unknown = null;
  await page.route('**/api/v1/returns/invoices/MAIN-000001', (route) => json(route, lookup));
  await page.route('**/api/v1/returns/lookup/*/request', (route) => {
    requestBody = route.request().postDataJSON();
    return json(route, { id: '40', returnNumber: 'RET-1', status: 'REQUESTED' }, 201);
  });
  await page.route(/\/api\/v1\/returns(\?.*)?$/, (route) =>
    json(route, { data: status === 'REFUNDED' ? [] : [{ ...queued, status }] }),
  );
  await page.route('**/api/v1/returns/40/approve', (route) => {
    status = 'APPROVED';
    return json(route, { id: '40', status: 'APPROVED' }, 201);
  });
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, openCashSession));
  await page.route('**/api/v1/returns/40/refund', (route) => {
    refundBody = route.request().postDataJSON();
    status = 'REFUNDED';
    return json(
      route,
      { id: '40', refundAmount: '35.00', refundMethod: 'CASH', status: 'REFUNDED' },
      201,
    );
  });

  await page.goto('/#/returns');
  await page.getByRole('searchbox', { name: 'Invoice number or receipt code' }).fill('MAIN-000001');
  await page.getByRole('button', { name: 'Find sale' }).click();
  await page.getByLabel('Return quantity for Panadol').fill('1');
  await page.getByLabel('Disposition for Panadol').selectOption('SCRAP');
  await page.getByLabel('Reason', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: /Request return/ }).click();
  await expect
    .poll(() => requestBody)
    .toMatchObject({
      items: [{ disposition: 'SCRAP', quantity: '1', saleItemId: '1' }],
    });

  await page.getByRole('tab', { name: /Return queue/ }).click();
  await page.getByRole('row', { name: /RET-1/ }).getByRole('button', { name: 'Approve' }).click();
  await page
    .getByRole('row', { name: /RET-1/ })
    .getByRole('button', { name: /Refund/ })
    .click();
  const refund = page.getByRole('dialog', { name: /Refund Rs 35.00/ });
  await expect(refund.getByRole('radio', { name: /Cash from drawer/ })).toBeChecked();
  await refund.getByRole('button', { name: /Refund/ }).click();
  await expect.poll(() => refundBody).toMatchObject({ cashSessionId: '10', method: 'CASH' });
});

test('a cashier without refund authority never sees the refund action', async ({ page }) => {
  await signIn(page, {
    ...baseSession,
    user: { ...baseSession.user, permissions: ['returns.lookup', 'returns.request'] },
  });
  await page.route(/\/api\/v1\/returns(\?.*)?$/, (route) => json(route, { data: [] }));
  await page.goto('/#/returns');
  await expect(
    page.getByRole('searchbox', { name: 'Invoice number or receipt code' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Refund/ })).toHaveCount(0);
});
