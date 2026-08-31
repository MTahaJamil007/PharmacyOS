import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'e2e-token',
  absoluteExpiresAt: '2026-09-01T08:00:00.000Z',
  expiresAt: '2026-08-31T20:30:00.000Z',
  user: {
    branchId: '1',
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
    terminalId: '1',
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

test('cashier completes a sale and receives the printable receipt', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, {
      data: [
        {
          availableQuantity: '5.000',
          barcode: '123',
          genericName: 'Paracetamol',
          id: '101',
          manufacturer: 'GSK',
          name: 'Panadol',
          nearestExpiry: '2027-01-01',
          salePrice: '35.00',
          shelf: 'A-01',
          strength: '500 mg',
        },
      ],
    }),
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
  await page.route('**/api/v1/pos/sales/finalize', (route) =>
    json(
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
    ),
  );
  await page.route('**/api/v1/pos/sales/30/receipt', (route) =>
    json(route, {
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
      payments: [{ amount: '35.00', method: 'CASH', reference: null }],
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
    }),
  );
  await page.goto('/#pos');
  await page.getByPlaceholder('Brand, generic, barcode or company').fill('Panadol');
  await page.getByRole('button', { name: /Panadol 500 mg/ }).click();
  await page.getByRole('button', { name: /Reserve and take cash/ }).click();
  const receipt = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(receipt).toContainText('MAIN-20260831-000001');
  await expect(receipt).toContainText('PKR 35.00');
  await expect(receipt.getByAltText('Opaque return lookup token')).toBeVisible();
});

test('operator opens, adjusts, and closes a cash session', async ({ page }) => {
  await authenticated(page);
  let current: Record<string, unknown> | null = null;
  let movementRecorded = false;
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, current));
  await page.route('**/api/v1/cash-sessions/open', (route) => {
    current = { ...cashSession };
    return json(route, current, 201);
  });
  await page.route('**/api/v1/cash-sessions/10/movements', (route) => {
    movementRecorded = true;
    current = { ...cashSession, cashOut: '200.00', expectedCash: '4800.00' };
    return json(route, { session: current }, 201);
  });
  await page.route('**/api/v1/cash-sessions/10/close', (route) => {
    current = null;
    return json(route, { ...cashSession, countedCash: '4800.00', status: 'CLOSED' }, 201);
  });
  await page.goto('/#cash');
  await page.getByRole('button', { name: 'Open cash session' }).click();
  await expect(page.getByRole('heading', { name: 'OPEN' })).toBeVisible();
  await page.getByLabel('Amount').fill('200');
  await page.getByLabel('Reason').fill('Bank deposit');
  await page.getByRole('button', { name: 'Record movement' }).click();
  await expect.poll(() => movementRecorded).toBe(true);
  await page.getByLabel('Counted cash (PKR)').fill('4800');
  await page.getByRole('button', { name: 'Submit count' }).click();
  await expect(page.getByRole('heading', { name: 'Open this terminal’s till' })).toBeVisible();
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
  await page.goto('/#inventory');
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
  await page.goto('/#returns');
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
