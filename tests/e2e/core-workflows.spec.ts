import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'e2e-token',
  absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
  expiresAt: '2027-08-31T20:30:00.000Z',
  sessionId: 'e2e-session',
  user: {
    id: '1',
    branchId: '1',
    branchTimezone: 'Asia/Karachi',
    displayName: 'E2E Operator',
    permissions: [
      'cash.open_session',
      'cash.close_session',
      'inventory.shelf.read',
      'inventory.shelf.recommendation.review',
      'inventory.expiry.read',
      'procurement.reorder.review',
      'returns.lookup',
      'returns.request',
      'returns.approve',
      'returns.refund',
    ],
    terminalCode: 'COUNTER-01',
    terminalId: '1',
    terminalName: 'Front Counter',
    username: 'cashier',
  },
};

const cashSession = {
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

const panadol = {
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

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

async function authenticated(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem('pharmacy-session', JSON.stringify(value));
  }, session);
}

test('staff signs in and signs out', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (route) => json(route, session));
  await page.route('**/api/v1/auth/logout', (route) => json(route, { revoked: true }));
  await page.goto('/');
  await page.getByLabel('Username').fill('cashier');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Open counter' }).click();
  await expect(page.getByRole('heading', { name: 'Find medicine' })).toBeVisible();
  await page.getByRole('button', { name: /E2E Operator · Sign out/ }).click();
  await expect(page.getByRole('heading', { name: 'Open this terminal' })).toBeVisible();
});

test('cashier scans, split-tenders, prints, and reprints a sale', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, cashSession));
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
  await page.route('**/api/v1/pos/sales/finalize', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      cashSessionId: '10',
      draftId: '20',
      payments: [
        { amount: '15.00', method: 'CASH', tenderedAmount: '20.00' },
        { amount: '20.00', method: 'CARD', reference: 'AUTH-7' },
      ],
    });
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
  const receiptResponse = {
    items: [
      {
        batch_number: 'B-1',
        expiry_date: '2027-01-01',
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
    returnQrPayload: '00000000-0000-4000-8000-000000000030',
    sale: {
      branch_address: 'Karachi',
      branch_name: 'Main Pharmacy',
      branch_phone: '021-0000000',
      cashier_name: 'E2E Operator',
      created_at: '2026-08-31T12:00:00.000Z',
      discount_total: '0.00',
      fiscal_invoice_number: null,
      fiscal_status: 'NOT_REQUIRED',
      id: '30',
      invoice_number: 'MAIN-20260831-000001',
      return_lookup_token: '00000000-0000-4000-8000-000000000030',
      subtotal: '35.00',
      tax_total: '0.00',
      total: '35.00',
    },
  };
  await page.route('**/api/v1/pos/sales/30/receipt', (route) => json(route, receiptResponse));
  await page.route('**/api/v1/pos/sales?query=*', (route) =>
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
  await page.route('**/api/v1/pos/sales/30/reprint', (route) => json(route, receiptResponse, 201));

  await page.goto('/#/pos');
  await expect(page.getByRole('heading', { name: 'Find medicine' })).toBeVisible();
  await page.evaluate((barcode) => {
    for (const key of barcode) {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  }, panadol.barcode);
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('1');
  await page.keyboard.press('F8');
  const payment = page.getByRole('dialog', { name: 'Take payment' });
  await payment.getByRole('group', { name: 'Cash' }).getByLabel('Applied to sale').fill('15');
  await payment.getByRole('group', { name: 'Cash' }).getByLabel('Tendered').fill('20');
  await payment.getByRole('group', { name: 'Card' }).getByLabel('Amount').fill('20');
  await payment.getByRole('group', { name: 'Card' }).getByLabel('Reference').fill('AUTH-7');
  await expect(payment).toContainText('Change PKR 5.00');
  await page.keyboard.press('F8');
  const receipt = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(receipt).toContainText('MAIN-20260831-000001');
  await expect(receipt).toContainText('PKR 35.00');
  await expect(receipt).toContainText('Change');
  await expect(receipt).toContainText('PKR 5.00');
  await expect(receipt.getByAltText('Opaque return lookup token')).toBeVisible();
  await receipt.getByRole('button', { name: 'Close' }).click();

  await page.keyboard.press('F6');
  const reprint = page.getByRole('dialog', { name: 'Find and reprint receipt' });
  await reprint.getByRole('button', { name: /MAIN-20260831-000001/ }).click();
  await expect(page.getByRole('dialog', { name: 'Sale receipt' })).toContainText(
    'MAIN-20260831-000001',
  );
});

test('cart survives reload and keyboard controls remain complete', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.goto('/#/pos');
  const search = page.getByPlaceholder('Brand, generic, barcode or company');
  const quantity = page.getByLabel('Quantity', { exact: true });
  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol 500 mg/ })).toBeVisible();
  await search.press('Enter');
  await expect(quantity).toBeFocused();
  // There is no default quantity: Enter on an empty box asks for one instead of adding 1.
  await quantity.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a quantity');
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  await quantity.fill('2');
  await quantity.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('2');
  await search.fill('*3');
  await search.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');

  await page.reload();
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');
  await page.getByRole('heading', { name: 'Counter ticket' }).click();
  await page.keyboard.press('F4');
  await expect(page.getByRole('status')).toContainText('Cart held');
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  await page.keyboard.press('F4');
  await expect(page.getByRole('status')).toContainText('Held cart resumed');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('3');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();

  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol 500 mg/ })).toBeVisible();
  await search.press('Enter');
  await expect(quantity).toBeFocused();
  await page.keyboard.press('F2');
  await expect(page.getByRole('status')).toContainText('New sale ready');
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
});

test('an expired API session can re-authenticate without losing the counter', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { message: 'Session expired' }, 401),
  );
  await page.route('**/api/v1/auth/login', (route) => json(route, session));
  await page.goto('/#/pos');
  await page.getByPlaceholder('Brand, generic, barcode or company').fill('Panadol');
  const reauth = page.getByRole('dialog');
  await expect(reauth).toContainText('Session expired');
  await reauth.getByLabel('Password').fill('correct-password');
  await reauth.getByRole('button', { name: 'Continue' }).click();
  await expect(reauth).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Find medicine' })).toBeVisible();
});

test('operator reviews safe shelf and reorder recommendations', async ({ page }) => {
  await authenticated(page);
  let shelfOpen = true;
  let reorderOpen = true;
  await page.route('**/api/v1/inventory-intelligence/attention', (route) =>
    json(route, { critical_expiry: '1', expired: '1', open_reorders: '1', pending_shelf: '1' }),
  );
  await page.route('**/api/v1/expiry-risk**', (route) =>
    json(route, {
      data: [
        {
          batch_id: '1',
          batch_number: 'EXP-1',
          days_to_expiry: 10,
          expiry_date: '2026-09-10',
          medicine_name: 'Expiry Medicine',
          quantity: '2.000',
          risk_bucket: 'DAYS_0_30',
          status: 'SELLABLE',
          value_at_risk: '20.00',
        },
      ],
    }),
  );
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
  await page.goto('/#/inventory');
  await expect(page.getByText('Fast Picker')).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Fast Picker')).toBeHidden();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByText('Low Stock')).toBeHidden();
});

test('authorized return moves from lookup through refund', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/returns/lookup/**', async (route) => {
    if (route.request().method() === 'GET') {
      return json(route, {
        items: [
          {
            batch_number: 'B-1',
            eligible_quantity: '1.000',
            id: '1',
            medicine_name: 'Panadol',
            returned_quantity: '0.000',
            sold_quantity: '1.000',
          },
        ],
        sale: {
          created_at: '2026-08-31T12:00:00.000Z',
          id: '30',
          invoice_number: 'MAIN-000001',
          total: '35.00',
        },
      });
    }
    return json(route, { id: '40', returnNumber: 'RET-1', status: 'REQUESTED' }, 201);
  });
  await page.route('**/api/v1/returns/40/approve', (route) =>
    json(route, { id: '40', status: 'APPROVED' }, 201),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, cashSession));
  await page.route('**/api/v1/returns/40/refund', (route) =>
    json(route, { id: '40', refundAmount: '35.00', status: 'REFUNDED' }, 201),
  );
  await page.goto('/#/returns');
  await page.getByLabel('Scan or paste receipt token').fill('00000000-0000-4000-8000-000000000030');
  await page.getByRole('button', { name: 'Find receipt' }).click();
  await page.getByLabel('Return quantity').fill('1');
  await page.getByLabel('Disposition').selectOption('SCRAP');
  await page.getByLabel('Return reason').fill('Damaged pack');
  await page.getByRole('button', { name: 'Submit return request' }).click();
  await page.getByRole('button', { name: 'Approve return' }).click();
  await page.getByRole('button', { name: 'Issue cash refund' }).click();
  await expect(page.getByText('Status: REFUNDED')).toBeVisible();
  await expect(page.getByText('Refunded PKR 35.00')).toBeVisible();
});

test('cashier budgets and discounts ticked lines, then releases the reservation', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('pharmacy-session', JSON.stringify(value)),
    {
      ...session,
      user: {
        ...session.user,
        permissions: [
          ...session.user.permissions,
          'sale.discount.basic',
          'sales.budget_regimen.calculate',
        ],
      },
    },
  );
  const stockedPanadol = { ...panadol, availableQuantity: '100.000' };
  const risek = {
    ...panadol,
    availableQuantity: '50.000',
    barcode: '8961100000103',
    genericName: 'Omeprazole',
    id: '103',
    name: 'Risek',
    salePrice: '470.00',
    strength: '20 mg',
  };
  let cancelled = false;
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [stockedPanadol, risek] }),
  );
  await page.route('**/api/v1/budget-regimen/calculate', (route) => {
    // The unticked Risek (PKR 470) comes out of the PKR 2,000 budget before planning.
    expect(route.request().postDataJSON()).toMatchObject({
      budget: '1530.00',
      items: [{ medicineId: '101', minimumSaleIncrement: '1', prescribedBaseUnitsPerDay: '3.000' }],
    });
    return json(route, {
      completeDays: 14,
      lines: [
        {
          lineCost: '1470.00',
          medicineId: '101',
          medicineName: 'Panadol',
          priceVersion: 'v1',
          requiredQuantity: '42.000',
          unitPrice: '35.00',
        },
      ],
      oneDayCost: '105.00',
      remainder: '60.00',
      safetyMessage: 'Affordability only',
      totalCost: '1470.00',
    });
  });
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, cashSession));
  await page.route('**/api/v1/pos/drafts', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      items: [
        { dosageInstruction: '1+1+1 after meal', medicineId: '101', quantity: '42' },
        { medicineId: '103', quantity: '1' },
      ],
    });
    return json(route, { id: '21', status: 'DRAFT', total: '1940.00' }, 201);
  });
  await page.route('**/api/v1/pos/drafts/21/discount', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      invoiceDiscount: '0.00',
      lineDiscounts: [{ amount: '147.00', medicineId: '101' }],
      reason: 'Senior citizen',
    });
    return json(route, { approvalLevel: 'BASIC', total: '1793.00' }, 201);
  });
  await page.route('**/api/v1/pos/drafts/21/reserve', (route) =>
    json(
      route,
      { id: '21', reservedUntil: '2099-01-01T00:00:00.000Z', status: 'RESERVED', total: '1793.00' },
      201,
    ),
  );
  await page.route('**/api/v1/pos/drafts/21/cancel', (route) => {
    cancelled = true;
    return json(route, { id: '21', status: 'CANCELLED' }, 201);
  });

  await page.goto('/#/pos');
  const search = page.getByPlaceholder('Brand, generic, barcode or company');
  const quantity = page.getByLabel('Quantity', { exact: true });
  const timing = page.getByLabel('Timing', { exact: true });
  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol 500 mg/ })).toBeVisible();
  await search.press('Enter');
  await quantity.fill('6');
  await timing.fill('111a');
  await timing.press('Enter');
  await expect(page.getByLabel('Panadol timing')).toHaveValue('1+1+1 after meal');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('6');
  const risekSearch = page.waitForResponse((response) => response.url().includes('query=Risek'));
  await search.fill('Risek');
  await risekSearch;
  await expect(page.getByRole('option', { name: /Risek 20 mg/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await quantity.fill('1');
  await quantity.press('Enter');
  await expect(page.getByLabel('Risek quantity')).toHaveValue('1');

  // The plan reads Panadol's 3 a day from its timing; no popup and no second entry of the dose.
  await page.getByLabel('Tick Panadol').check();
  await page.keyboard.press('F3');
  const budget = page.getByLabel('Customer budget (PKR)');
  await expect(budget).toBeFocused();
  await budget.fill('2000');
  await budget.press('Enter');
  await expect(page.getByText('plan → 42')).toBeVisible();
  await budget.press('Enter');
  await expect(page.getByLabel('Panadol quantity')).toHaveValue('42');
  await expect(page.getByLabel('Risek quantity')).toHaveValue('1');
  await expect(page.getByRole('status')).toContainText('14 complete days for 1 medicine');

  await page.getByLabel('Discount for ticked lines').fill('10');
  await page.getByLabel('Discount for ticked lines').press('Enter');
  await expect(page.getByLabel('Panadol discount', { exact: true })).toHaveValue('10%');
  await page.keyboard.press('F8');
  await expect(page.getByRole('alert')).toContainText('discount reason');
  await page.getByRole('radio', { name: 'Senior citizen' }).click();

  await page.getByRole('button', { name: /Take payment/ }).click();
  const payment = page.getByRole('dialog', { name: 'Take payment' });
  await expect(payment).toContainText('PKR 1,793.00');
  await payment.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Panadol quantity')).toBeDisabled();
  await page.getByRole('button', { name: 'Release & edit' }).click();
  await expect(page.getByRole('status')).toContainText('Reservation released');
  await expect(page.getByLabel('Panadol quantity')).toBeEnabled();
  expect(cancelled).toBe(true);
});
