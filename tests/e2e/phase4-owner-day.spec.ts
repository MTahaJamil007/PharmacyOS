import { expect, test } from '@playwright/test';

import { json, openCashSession, sessionWith, signIn } from './support.js';

const owner = sessionWith([
  'customer.read',
  'customer.manage',
  'customer.payment',
  'cash.open_session',
  'inventory.adjust',
  'inventory.purchase',
  'reports.view_basic',
  'reports.view_financial',
  'analytics.owner.read',
]);

test('owner opens a khata account and records a payment against it', async ({ page }) => {
  await signIn(page, owner);
  const customer = {
    address: null,
    availableCredit: '400.00',
    balance: '100.00',
    createdAt: '2026-09-01T08:00:00.000Z',
    creditLimit: '500.00',
    id: '7',
    isActive: true,
    name: 'Regular Customer',
    phone: '03001234567',
  };
  let created = false;
  let createBody: unknown = null;
  let paymentBody: unknown = null;
  await page.route('**/api/v1/customers/receivables/aging', (route) =>
    json(route, {
      asOf: '2026-09-01',
      current: created ? '100.00' : '0.00',
      customerCount: created ? 1 : 0,
      days31To60: '0.00',
      days61To90: '0.00',
      over90Days: '0.00',
      total: created ? '100.00' : '0.00',
    }),
  );
  await page.route(/\/api\/v1\/customers(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      createBody = route.request().postDataJSON();
      created = true;
      return json(route, customer, 201);
    }
    return json(route, { data: created ? [customer] : [] });
  });
  await page.route('**/api/v1/customers/7/statement', (route) =>
    json(route, {
      customer,
      entries: [
        {
          amountDelta: '100.00',
          balanceAfter: '100.00',
          createdAt: '2026-09-01T08:00:00.000Z',
          entryType: 'OPENING_BALANCE',
          id: '1',
          invoiceNumber: null,
          paymentMethod: null,
          performedBy: 'E2E Operator',
          reason: 'Opening balance',
          reference: null,
          saleId: null,
        },
      ],
    }),
  );
  await page.route('**/api/v1/customers/7/payments', (route) => {
    paymentBody = route.request().postDataJSON();
    return json(route, { balance: '60.00', id: '9' }, 201);
  });
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, openCashSession));

  await page.goto('/#/customers');
  await page.getByRole('button', { name: 'New customer' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Full name').fill('Regular Customer');
  await form.getByLabel('Phone').fill('03001234567');
  await form.getByLabel('Credit limit (Rs)').fill('500');
  await form.getByLabel(/Already owes/).fill('100');
  await form.getByRole('button', { name: 'Create customer' }).click();
  await expect
    .poll(() => createBody)
    .toMatchObject({
      creditLimit: '500',
      name: 'Regular Customer',
      openingBalance: '100',
      phone: '03001234567',
    });

  await page.getByRole('row', { name: /Regular Customer/ }).click();
  await page.getByRole('button', { name: 'Receive payment' }).click();
  const payment = page.getByRole('dialog', { name: /Receive payment/ });
  await payment.getByLabel('Amount').fill('40');
  await payment
    .getByRole('button', { name: /Receive|Record|Save/ })
    .last()
    .click();
  await expect(page.getByText('Payment of Rs 40.00 received')).toBeVisible();
  expect(paymentBody).toMatchObject({ amount: '40', cashSessionId: '10', method: 'CASH' });
});

test('owner records a physical count on a batch from the stock list', async ({ page }) => {
  await signIn(page, owner);
  const row = {
    availableQuantity: '5.000',
    averageDailySales: '1.000',
    barcode: null,
    daysOfCover: '5.0',
    daysToExpiry: 400,
    expiredQuantity: '0.000',
    genericName: 'Gate generic',
    manufacturer: 'Gate Pharma',
    medicineId: '55',
    minimumStock: '2.000',
    name: 'Gate Medicine',
    nearestExpiry: '2027-10-01',
    quarantinedQuantity: '0.000',
    reservedQuantity: '0.000',
    salePrice: '10.00',
    sellableQuantity: '5.000',
    sku: 'GATE-1',
    status: 'OK',
    strength: '5 mg',
    valueAtCost: '25.00',
    valueAtRetail: '50.00',
  };
  let adjustment: unknown = null;
  await page.route('**/api/v1/stock?**', (route) =>
    json(route, {
      data: [row],
      totals: {
        expiring: 0,
        low: 0,
        matching: 1,
        out: 0,
        valueAtCost: '25.00',
        valueAtRetail: '50.00',
      },
    }),
  );
  await page.route('**/api/v1/stock/medicines/55', (route) =>
    json(route, {
      batches: [
        {
          batchNumber: 'GATE-B1',
          costPrice: '5.00000000',
          currentQuantity: '5.000',
          daysToExpiry: 400,
          expiryDate: '2027-10-01',
          id: '501',
          maximumRetailPrice: null,
          receivedAt: '2026-08-01T08:00:00.000Z',
          salePrice: '10.00',
          source: 'Purchase',
          status: 'SELLABLE',
        },
      ],
      medicine: { ...row, packSize: '10.000', unitName: 'tablet' },
      movements: [],
      policy: null,
    }),
  );
  await page.route('**/api/v1/inventory/batches/501/adjustments', (route) => {
    adjustment = route.request().postDataJSON();
    return json(route, { quantityAfter: '3.000' }, 201);
  });

  await page.goto('/#/inventory');
  await page.getByRole('row', { name: /Gate Medicine/ }).click();
  const drawer = page.getByRole('dialog', { name: /Gate Medicine/ });
  await drawer.getByRole('button', { name: 'Count' }).click();
  const count = page.getByRole('dialog', { name: 'Record a physical count' });
  await count.getByLabel('Units counted on the shelf').fill('3');
  await count.getByRole('button', { name: 'Save count' }).click();
  await expect(page.getByText('Count saved')).toBeVisible();
  expect(adjustment).toMatchObject({
    countedQuantity: '3',
    reason: 'Monthly stock count',
    type: 'COUNT',
  });
});

test('owner dashboard shows exact daily figures and what needs attention', async ({ page }) => {
  await signIn(page, owner);
  await page.route('**/api/v1/dashboard/overview**', (route) =>
    json(route, {
      continuity: { lastRestoreDrillAt: null, lastSuccessfulBackupAt: null },
      date: '2026-09-01',
      generatedAt: '2026-09-01T10:00:00.000Z',
      position: {
        expiryValueAtRisk: '0.00',
        failedFiscalSubmissions: 0,
        lowStockCount: 1,
        openAlerts: 0,
        openCashSessions: 1,
        outOfStockCount: 0,
        pendingReturns: 2,
        pendingVariances: 0,
        receivables: '250.00',
        stockValueAtCost: '12000.00',
      },
      sales: {
        averageTicket: '45.00',
        bankTransfer: '0.00',
        card: '30.00',
        cash: '60.00',
        costOfGoods: '54.00',
        credit: '0.00',
        creditCollected: '40.00',
        discounts: '5.00',
        grossProfit: '36.00',
        grossSales: '95.00',
        invoiceCount: 2,
        netSales: '90.00',
        refunds: '0.00',
      },
      topItems: [{ medicineId: '1', name: 'Panadol', netSales: '90.00', quantity: '3.000' }],
      trend: [
        { date: '2026-08-31', grossProfit: '20.00', invoiceCount: 1, netSales: '50.00' },
        { date: '2026-09-01', grossProfit: '36.00', invoiceCount: 2, netSales: '90.00' },
      ],
    }),
  );
  await page.goto('/#/owner');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Rs 90.00').first()).toBeVisible();
  await expect(page.getByText('40.0% margin')).toBeVisible();
  await expect(page.getByText('No successful backup has been recorded')).toBeVisible();
  await expect(page.getByText('2 return(s) are waiting for approval or refund.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Panadol/ })).toContainText('Rs 90.00');
});
