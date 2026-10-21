import { expect, test } from '@playwright/test';

import { json, panadol, sessionWith, signIn } from './support.js';

const manager = sessionWith([
  'inventory.purchase',
  'procurement.purchase_draft.approve',
  'procurement.supplier_price.read',
  'reports.view_basic',
  'reports.view_financial',
]);

const orderLine = {
  base_units_per_order_unit: '10.000',
  bonus_qty: '0.000',
  id: '91',
  line_discount: '0.00',
  medicine_id: '101',
  medicine_name: 'Panadol',
  ordered_qty: '20.000',
  received_bonus_qty: '0.000',
  received_qty: '0.000',
  // Stored at the database's 8-decimal cost scale.
  unit_cost: '100.00000000',
};

test('inventory manager orders from a supplier and receives goods into a batch', async ({
  page,
}) => {
  await signIn(page, manager);
  let status = 'NONE';
  let createBody: unknown = null;
  let receiveBody: unknown = null;
  const detail = () => ({
    cancel_reason: null,
    cancelled_at: null,
    created_at: '2026-09-01T08:00:00.000Z',
    id: '55',
    items: [status === 'RECEIVED' ? { ...orderLine, received_qty: '20.000' } : orderLine],
    order_number: 'PO-20260901-0055',
    ordered_at: status === 'DRAFT' ? null : '2026-09-01T09:00:00.000Z',
    receipts:
      status === 'RECEIVED'
        ? [
            {
              id: '1',
              received_at: '2026-09-02T10:00:00.000Z',
              received_base_quantity: '200.000',
              received_by: 'E2E Operator',
              supplier_invoice_number: 'INV-900',
            },
          ]
        : [],
    received_at: status === 'RECEIVED' ? '2026-09-02T10:00:00.000Z' : null,
    status,
    supplier_id: '7',
    supplier_invoice_number: 'INV-900',
    supplier_name: 'Karachi Distributors',
    total_cost: '2000.00',
  });
  await page.route('**/api/v1/suppliers', (route) =>
    json(route, {
      data: [
        {
          code: 'KD',
          id: '7',
          isActive: true,
          leadTimeDays: 2,
          name: 'Karachi Distributors',
          phone: null,
        },
      ],
    }),
  );
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [panadol] }),
  );
  await page.route(/\/api\/v1\/purchase-orders(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      createBody = route.request().postDataJSON();
      status = 'DRAFT';
      return json(route, detail(), 201);
    }
    return json(route, {
      data:
        status === 'NONE'
          ? []
          : [
              {
                created_at: '2026-09-01T08:00:00.000Z',
                id: '55',
                line_count: 1,
                order_number: 'PO-20260901-0055',
                ordered_at: null,
                ordered_quantity: '20.000',
                received_at: null,
                received_quantity: '0.000',
                status,
                supplier_id: '7',
                supplier_invoice_number: 'INV-900',
                supplier_name: 'Karachi Distributors',
                total_cost: '2000.00',
              },
            ],
    });
  });
  await page.route('**/api/v1/purchase-orders/55', (route) => json(route, detail()));
  await page.route('**/api/v1/purchase-orders/55/order', (route) => {
    status = 'ORDERED';
    return json(route, detail(), 201);
  });
  await page.route('**/api/v1/purchase-orders/55/receive', (route) => {
    receiveBody = route.request().postDataJSON();
    status = 'RECEIVED';
    return json(route, detail(), 201);
  });

  await page.goto('/#/purchasing');
  await page.getByRole('button', { name: 'New purchase order' }).click();
  const builder = page.getByRole('dialog', { name: 'New purchase order' });
  await builder.getByLabel('Supplier', { exact: true }).selectOption('7');
  await builder.getByLabel(/Supplier invoice/).fill('INV-900');
  await builder.getByRole('combobox', { name: 'Add a medicine to this order' }).fill('Panadol');
  await builder.getByRole('option', { name: /Panadol/ }).click();
  await builder.getByLabel('Packs of Panadol', { exact: true }).fill('20');
  await builder.getByLabel('Units per pack of Panadol').fill('10');
  await builder.getByLabel('Cost per pack of Panadol').fill('100');
  await expect(builder).toContainText('Rs 2,000.00');
  await builder.getByRole('button', { name: 'Save draft' }).click();
  await expect
    .poll(() => createBody)
    .toMatchObject({
      items: [
        {
          baseUnitsPerOrderUnit: '10',
          bonusQuantity: '0',
          lineDiscount: '0',
          medicineId: '101',
          orderedQuantity: '20',
          unitCost: '100',
        },
      ],
      supplierId: '7',
      supplierInvoiceNumber: 'INV-900',
    });

  const drawer = page.getByRole('dialog', { name: 'Purchase order PO-20260901-0055' });
  // The stored 8-decimal cost still produces an exact line total.
  await expect(drawer.getByRole('row', { name: /Panadol/ })).toContainText('Rs 2,000.00');
  await drawer.getByRole('button', { name: 'Place order' }).click();
  await page
    .getByRole('dialog', { name: /Place PO-20260901-0055/ })
    .getByRole('button', { name: 'Place order' })
    .click();
  await drawer.getByRole('button', { name: 'Receive delivery' }).click();

  const receive = page.getByRole('dialog', { name: /Receive delivery/ });
  await receive.getByLabel('Batch number of Panadol').fill('BX-2291');
  await receive.getByLabel('Expiry date of Panadol').fill('2028-03-31');
  await receive.getByLabel('Sale price per unit of Panadol').fill('13.50');
  await receive.getByLabel('Printed MRP per unit of Panadol').fill('13.00');
  await expect(receive).toContainText('Sale price is above the printed MRP');
  await expect(receive.getByRole('button', { name: 'Receive into stock' })).toBeDisabled();
  await receive.getByLabel('Printed MRP per unit of Panadol').fill('14.00');
  await receive.getByRole('button', { name: 'Receive into stock' }).click();
  await expect(page.getByText('Delivery received')).toBeVisible();
  expect(receiveBody).toMatchObject({
    lines: [
      {
        batchNumber: 'BX-2291',
        expiryDate: '2028-03-31',
        maximumRetailPricePerBaseUnit: '14.00',
        purchaseOrderItemId: '91',
        receivedBonusQuantity: '0',
        receivedQuantity: '20',
        salePricePerBaseUnit: '13.50',
      },
    ],
    supplierInvoiceNumber: 'INV-900',
  });
});

test('owner reads a typed report with totals and exports it', async ({ page }) => {
  await signIn(page, manager);
  await page.route('**/api/v1/reports/tables/daily-sales**', (route) =>
    json(route, {
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'invoices', label: 'Invoices', type: 'count' },
        { key: 'netSales', label: 'Net sales', type: 'money' },
      ],
      dataBasis: 'Finalized sales by branch-local day.',
      from: '2026-08-26',
      report: 'daily-sales',
      rows: [
        { date: '2026-08-31', invoices: 40, netSales: '18000.00' },
        { date: '2026-09-01', invoices: 4, netSales: '420.50' },
      ],
      title: 'Daily sales',
      to: '2026-09-01',
      totals: { date: null, invoices: 44, netSales: '18420.50' },
    }),
  );
  await page.route('**/api/v1/reports/tables/stock-valuation**', (route) =>
    json(route, {
      columns: [
        { key: 'name', label: 'Medicine', type: 'text' },
        { key: 'quantity', label: 'Units', type: 'quantity' },
      ],
      dataBasis: 'Sellable stock right now.',
      from: null,
      report: 'stock-valuation',
      rows: [{ name: 'Panadol', quantity: '120.000' }],
      title: 'Stock valuation',
      to: null,
      totals: null,
    }),
  );
  await page.goto('/#/reports');
  await expect(page.getByRole('cell', { name: 'Rs 18,000.00' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Total/ })).toContainText('Rs 18,420.50');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('daily-sales_2026-08-26_to_2026-09-01.csv');

  await page.getByRole('button', { name: /Stock valuation/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Units' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Panadol' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '120', exact: true })).toBeVisible();
});
