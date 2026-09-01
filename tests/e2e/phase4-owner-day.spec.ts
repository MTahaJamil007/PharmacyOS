import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'phase4-e2e-token',
  absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
  expiresAt: '2027-08-31T20:30:00.000Z',
  sessionId: 'phase4-e2e-session',
  user: {
    id: '1',
    branchId: '1',
    branchTimezone: 'Asia/Karachi',
    displayName: 'Phase 4 Owner',
    permissions: [
      'customer.read',
      'customer.manage',
      'customer.payment',
      'inventory.adjust',
      'inventory.shelf.read',
      'reports.view_financial',
    ],
    terminalCode: 'OWNER-01',
    terminalId: '1',
    terminalName: 'Owner Terminal',
    username: 'owner',
  },
};

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

async function authenticated(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem('pharmacy-session', JSON.stringify(value));
  }, session);
}

test('owner operates customer payment, cycle count, and deterministic dashboard screens', async ({
  page,
}) => {
  await authenticated(page);
  let balance = '100.00';
  let customerCreated = false;
  let paymentRecorded = false;
  let countRecorded = false;
  const customer = () => ({
    address: null,
    availableCredit: balance === '100.00' ? '400.00' : '440.00',
    balance,
    createdAt: '2026-09-01T08:00:00.000Z',
    creditLimit: '500.00',
    id: '200',
    isActive: true,
    name: 'Regular Customer',
    phone: '03001234567',
  });

  await page.route('**/api/v1/customers**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/customers')) {
      expect(request.postDataJSON()).toMatchObject({
        creditLimit: '500',
        name: 'Regular Customer',
        openingBalance: '100',
      });
      customerCreated = true;
      return json(route, customer(), 201);
    }
    if (request.method() === 'POST' && path.endsWith('/customers/200/payments')) {
      expect(request.postDataJSON()).toMatchObject({ amount: '40', method: 'CASH' });
      balance = '60.00';
      paymentRecorded = true;
      return json(route, { balance, idempotentReplay: false }, 201);
    }
    if (path.endsWith('/customers/200/statement')) {
      return json(route, {
        customer: customer(),
        entries: [
          {
            amountDelta: balance === '100.00' ? '100.00' : '-40.00',
            balanceAfter: balance,
            createdAt: '2026-09-01T08:00:00.000Z',
            entryType: balance === '100.00' ? 'OPENING_BALANCE' : 'PAYMENT',
            id: balance === '100.00' ? '1' : '2',
            invoiceNumber: null,
            paymentMethod: balance === '100.00' ? null : 'CASH',
            reason: 'Phase 4 browser gate',
          },
        ],
      });
    }
    return json(route, { data: customerCreated ? [customer()] : [] });
  });
  await page.route('**/api/v1/cash-sessions/current', (route) =>
    json(route, { id: '10', status: 'OPEN' }),
  );

  await page.goto('/#/customers');
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('name').fill('Regular Customer');
  await page.getByLabel('phone').fill('03001234567');
  await page.getByLabel('credit Limit').fill('500');
  await page.getByLabel('opening Balance').fill('100');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect.poll(() => customerCreated).toBe(true);
  await expect(page.getByRole('heading', { name: 'Regular Customer' })).toBeVisible();
  await page.getByLabel('Payment amount').fill('40');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect.poll(() => paymentRecorded).toBe(true);
  await expect(page.getByRole('status')).toContainText('Account payment recorded');

  await page.route('**/api/v1/inventory-intelligence/attention', (route) =>
    json(route, { critical_expiry: '0', expired: '0', open_reorders: '0', pending_shelf: '0' }),
  );
  await page.route('**/api/v1/expiry-risk**', (route) => json(route, { data: [] }));
  await page.route('**/api/v1/shelf-recommendations**', (route) => json(route, { data: [] }));
  await page.route('**/api/v1/reorder-suggestions**', (route) => json(route, { data: [] }));
  await page.route('**/api/v1/inventory/batches**', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({
        countedQuantity: '3',
        type: 'COUNT',
      });
      countRecorded = true;
      return json(route, { quantityAfter: '3.000' }, 201);
    }
    return json(route, {
      data: [
        {
          batchNumber: 'P4-BATCH',
          currentQuantity: '5.000',
          expiryDate: '2027-09-01',
          id: '300',
          maximumRetailPrice: '120.00',
          medicineId: '301',
          medicineName: 'Gate Medicine',
          salePrice: '100.00',
          status: 'SELLABLE',
        },
      ],
    });
  });
  await page.goto('/#/inventory');
  await page.getByRole('button', { name: /Gate Medicine/ }).click();
  await page.getByLabel('Counted quantity').fill('3');
  await page.getByRole('button', { name: 'Commit count' }).click();
  await expect.poll(() => countRecorded).toBe(true);
  await expect(page.getByRole('status')).toContainText('Stock record saved');

  await page.route('**/api/v1/dashboard/owner**', (route) =>
    json(route, {
      data: {
        cashCollected: '40.00',
        grossProfitEstimate: '30.00',
        invoiceCount: '1',
        metricDate: '2026-09-01',
        metrics: {
          deadStockValue: '0.00',
          expiryValueAtRisk: '0.00',
          failedFiscalSubmissions: 0,
          lastRestoreDrill: null,
          lastSuccessfulBackup: null,
          lowStockCount: 0,
          netCashVariance: '0.00',
          receivables: '60.00',
          topMovers: [
            { medicineId: '301', name: 'Gate Medicine', netSales: '90.00', quantity: '1.000' },
          ],
        },
        netSales: '90.00',
        nonCashCollected: '0.00',
        refunds: '0.00',
        updatedAt: '2026-09-01T18:00:00.000Z',
      },
      dataBasis: 'Worker-refreshed deterministic branch-local daily metrics',
      status: 'READY',
    }),
  );
  await page.goto('/#/owner');
  await expect(
    page.getByRole('heading', { name: 'Know the day before asking why.' }),
  ).toBeVisible();
  await expect(page.getByText('PKR 90.00')).toBeVisible();
  await expect(page.getByText('PKR 60.00')).toBeVisible();
});
