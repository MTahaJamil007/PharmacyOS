import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'procurement-e2e-token',
  absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
  expiresAt: '2027-08-31T20:30:00.000Z',
  sessionId: 'procurement-e2e-session',
  user: {
    id: '1',
    branchId: '1',
    branchTimezone: 'Asia/Karachi',
    displayName: 'Inventory Manager',
    permissions: [
      'pos.search',
      'inventory.purchase',
      'procurement.purchase_draft.approve',
      'procurement.supplier_price.read',
      'reports.view_basic',
      'reports.view_financial',
    ],
    terminalCode: 'STORE-01',
    terminalId: '1',
    terminalName: 'Store Room',
    username: 'inventory',
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

const medicine = {
  availableQuantity: '4.000',
  barcode: '8961100098765',
  daysToExpiry: 40,
  genericName: 'Paracetamol',
  id: '101',
  manufacturer: 'GSK',
  name: 'Panadol',
  nearestExpiry: '2026-11-01',
  salePrice: '35.00',
  shelf: 'A-01',
  strength: '500 mg',
} as const;

test('inventory manager orders from a supplier and receives goods into a batch', async ({
  page,
}) => {
  await authenticated(page);
  let status: 'DRAFT' | 'ORDERED' | 'RECEIVED' = 'DRAFT';
  let created = false;
  let receivedQuantity = '0.000';
  let receiptPayload: Record<string, unknown> | null = null;
  let createPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/admin/suppliers', (route) =>
    json(route, {
      data: [
        { code: 'S-1', id: '7', isActive: true, leadTimeDays: 3, name: 'Karachi Distributors' },
      ],
    }),
  );
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [medicine] }),
  );
  await page.route('**/api/v1/purchase-orders?*', (route) =>
    json(route, {
      data: created
        ? [
            {
              created_at: '2026-09-01T06:00:00.000Z',
              id: '55',
              line_count: 1,
              order_number: 'PO-20260901-AB12CD34EF',
              ordered_at: null,
              ordered_quantity: '20.000',
              received_at: null,
              received_quantity: receivedQuantity,
              status,
              supplier_id: '7',
              supplier_invoice_number: 'INV-900',
              supplier_name: 'Karachi Distributors',
              total_cost: '2000.00',
            },
          ]
        : [],
    }),
  );
  await page.route('**/api/v1/purchase-orders', async (route) => {
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    created = true;
    await json(
      route,
      {
        created_at: '2026-09-01T06:00:00.000Z',
        id: '55',
        items: [],
        order_number: 'PO-20260901-AB12CD34EF',
        ordered_at: null,
        received_at: null,
        status: 'DRAFT',
        supplier_id: '7',
        supplier_invoice_number: 'INV-900',
        supplier_name: 'Karachi Distributors',
        total_cost: '2000.00',
      },
      201,
    );
  });
  await page.route('**/api/v1/purchase-orders/55', (route) =>
    json(route, {
      created_at: '2026-09-01T06:00:00.000Z',
      id: '55',
      items: [
        {
          base_units_per_order_unit: '1.000',
          bonus_qty: '0.000',
          id: '77',
          line_discount: '0.00',
          medicine_id: '101',
          medicine_name: 'Panadol',
          ordered_qty: '20.000',
          received_bonus_qty: '0.000',
          received_qty: receivedQuantity,
          unit_cost: '100.00',
        },
      ],
      order_number: 'PO-20260901-AB12CD34EF',
      ordered_at: status === 'DRAFT' ? null : '2026-09-01T07:00:00.000Z',
      receipts: [],
      received_at: null,
      status,
      supplier_id: '7',
      supplier_invoice_number: 'INV-900',
      supplier_name: 'Karachi Distributors',
      total_cost: '2000.00',
    }),
  );
  await page.route('**/api/v1/purchase-orders/55/order', async (route) => {
    status = 'ORDERED';
    await json(route, { id: '55', status: 'ORDERED' }, 201);
  });
  await page.route('**/api/v1/purchase-orders/55/receive', async (route) => {
    receiptPayload = route.request().postDataJSON() as Record<string, unknown>;
    status = 'RECEIVED';
    receivedQuantity = '20.000';
    await json(route, { goodsReceiptId: '91', status: 'RECEIVED' }, 201);
  });

  await page.goto('/#/purchasing');
  await expect(page.getByRole('heading', { name: /Order from suppliers/ })).toBeVisible();

  await page.getByLabel('Supplier', { exact: true }).selectOption('7');
  await page.getByLabel('Supplier invoice number').first().fill('INV-900');
  await page.getByPlaceholder('Add medicine to the order').fill('panadol');
  await page.getByRole('button', { name: /Panadol/ }).click();

  await page.getByLabel('Qty').fill('20');
  await page.getByLabel('Unit cost', { exact: true }).fill('100.00');
  await expect(page.getByText('2000.00', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save purchase order' }).click();
  await expect(page.getByText(/saved as a draft/)).toBeVisible();
  expect(createPayload).toMatchObject({
    items: [{ lineDiscount: '0.00', medicineId: '101', orderedQuantity: '20', unitCost: '100.00' }],
    supplierId: '7',
    supplierInvoiceNumber: 'INV-900',
  });

  await page.getByRole('button', { name: 'Mark as ordered' }).click();
  await expect(page.getByText('Purchase order sent to the supplier')).toBeVisible();

  await page.getByRole('button', { name: 'Receive goods' }).click();
  await page.getByLabel('Batch').fill('BX-2291');
  await page.getByLabel('Expiry').fill('2028-03-31');
  await page.getByLabel('Sale price / base unit').fill('135.00');
  await page.getByRole('button', { name: 'Post goods receipt' }).click();

  await expect(page.getByText(/Goods receipt posted/)).toBeVisible();
  expect(receiptPayload).toMatchObject({
    lines: [
      {
        batchNumber: 'BX-2291',
        expiryDate: '2028-03-31',
        purchaseOrderItemId: '77',
        receivedQuantity: '20.000',
        salePricePerBaseUnit: '135.00',
      },
    ],
    supplierInvoiceNumber: 'INV-900',
  });
});

test('owner reads a deterministic report without the AI assistant', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/reports/sales**', (route) =>
    json(route, {
      dataBasis: 'Finalized non-voided sales from 2026-08-01 through 2026-09-01',
      facts: { average_ticket: '415.50', gross_sales: '18420.00', invoice_count: '44' },
      reportPath: '/owner?report=sales',
    }),
  );
  await page.route('**/api/v1/reports/low-stock**', (route) =>
    json(route, {
      dataBasis: 'Current sellable batch stock compared with active reorder policies',
      facts: [
        {
          average_daily_demand: '3.2',
          days_of_stock: '1.2',
          id: '101',
          minimum_stock: '10.000',
          name: 'Panadol',
          sellable_stock: '4.000',
        },
      ],
      reportPath: '/inventory?view=reorder',
    }),
  );

  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: /Read the day from the ledger/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gross sales' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '18420.00' })).toBeVisible();

  await page.getByLabel('Report').selectOption('low-stock');
  await expect(page.getByRole('columnheader', { name: 'Days of stock' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Panadol' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
});
