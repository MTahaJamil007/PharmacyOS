import { expect, test } from '@playwright/test';

import { json, openCashSession, receiptFor, scan, sessionWith, signIn } from './support.js';

const BARCODE = '8961100098765';

const gateMedicine = {
  availableQuantity: '100.000',
  barcode: BARCODE,
  daysToExpiry: 486,
  genericName: 'Digital medicine',
  id: '101',
  manufacturer: 'Digital fixture',
  name: 'Digital Gate Medicine',
  nearestExpiry: '2027-12-31',
  salePrice: '1.00',
  shelf: 'SIM-01',
  strength: '1 mg',
};

function invoice(ordinal: number): string {
  return `DIGITAL-${String(ordinal).padStart(6, '0')}`;
}

test('digital gate completes 20 consecutive scanner-and-keyboard sales with print and reprint', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const clientRequestIds = new Set<string>();
  let draftOrdinal = 0;
  let finalizedOrdinal = 0;
  let reprintCount = 0;

  await page.addInitScript(() => {
    const state = window as Window & { __printCount?: number };
    state.__printCount = 0;
    window.print = () => {
      state.__printCount = (state.__printCount ?? 0) + 1;
    };
  });
  await signIn(page, sessionWith(['pos.search', 'pos.create_draft', 'sale.finalize_payment']));
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, { data: [gateMedicine] }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) => json(route, openCashSession));
  await page.route('**/api/v1/pos/drafts', (route) => {
    draftOrdinal += 1;
    return json(route, { id: String(2_000 + draftOrdinal), status: 'DRAFT', total: '1.00' }, 201);
  });
  await page.route('**/api/v1/pos/drafts/*/reserve', (route) => {
    const id = /drafts\/(\d+)\/reserve/.exec(route.request().url())?.[1] ?? '0';
    return json(
      route,
      {
        id,
        reservationCount: 1,
        reservedUntil: '2026-09-01T08:10:00.000Z',
        status: 'RESERVED',
        subtotal: '1.00',
        total: '1.00',
      },
      201,
    );
  });
  await page.route('**/api/v1/pos/sales/finalize', (route) => {
    const body = route.request().postDataJSON() as { clientRequestId: string };
    clientRequestIds.add(body.clientRequestId);
    finalizedOrdinal += 1;
    const saleId = String(1_000 + finalizedOrdinal);
    return json(
      route,
      {
        fiscalStatus: 'NOT_REQUIRED',
        id: saleId,
        invoiceNumber: invoice(finalizedOrdinal),
        returnLookupPath: '/returns/token',
        returnLookupToken: `00000000-0000-4000-8000-${saleId.padStart(12, '0')}`,
        total: '1.00',
      },
      201,
    );
  });
  await page.route('**/api/v1/pos/sales/*/receipt', (route) => {
    const saleId = /sales\/(\d+)\/receipt/.exec(route.request().url())?.[1] ?? '0';
    return json(route, receiptFor(saleId, invoice(Number(saleId) - 1_000), { total: '1.00' }));
  });
  await page.route(/\/api\/v1\/pos\/sales(\?.*)?$/, (route) =>
    json(route, {
      data: [
        {
          cashier_name: 'E2E Operator',
          created_at: '2026-09-01T08:00:00.000Z',
          id: '1020',
          invoice_number: invoice(20),
          total: '1.00',
        },
      ],
    }),
  );
  await page.route('**/api/v1/pos/sales/1020/reprint', (route) => {
    reprintCount += 1;
    return json(route, receiptFor('1020', invoice(20), { total: '1.00' }), 201);
  });

  await page.goto('/#/pos');
  await expect(page.getByRole('textbox', { name: 'Find medicine' })).toBeVisible();
  for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
    await scan(page, BARCODE);
    await expect(page.getByLabel('Digital Gate Medicine quantity')).toHaveValue('1');
    await page.keyboard.press('F8');
    await expect(page.getByRole('dialog', { name: 'Take payment' })).toBeVisible();
    await page.keyboard.press('F8');
    const saleReceipt = page.getByRole('dialog', { name: /Sale complete/ });
    await expect(saleReceipt).toContainText(invoice(ordinal));
    if (ordinal === 20) {
      await saleReceipt.getByRole('button', { name: 'Print receipt' }).click();
    }
    await saleReceipt.getByRole('button', { name: 'New sale' }).click();
    await expect(page.getByText('No items yet')).toBeVisible();
  }

  await page.keyboard.press('F6');
  const reprint = page.getByRole('dialog', { name: 'Find a receipt' });
  await reprint.getByRole('row', { name: new RegExp(invoice(20)) }).click();
  await expect(page.getByRole('dialog', { name: /Sale complete/ })).toContainText(invoice(20));

  expect(finalizedOrdinal).toBe(20);
  // Each sale is a separate intent, so each carries its own idempotency key.
  expect(clientRequestIds.size).toBe(20);
  expect(reprintCount).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __printCount?: number }).__printCount ?? 0),
    )
    .toBe(1);
});
