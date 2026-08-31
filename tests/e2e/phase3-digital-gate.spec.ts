import { expect, test, type Page, type Route } from '@playwright/test';

const BARCODE = '8961100098765';
const TOKEN = 'phase3-digital-gate-token';

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

function receipt(saleId: string, ordinal: number) {
  const suffix = String(ordinal).padStart(12, '0');
  return {
    items: [
      {
        batch_number: 'DIGITAL-BATCH',
        expiry_date: '2027-12-31',
        id: String(ordinal),
        line_total: '1.00',
        name: 'Digital Gate Medicine',
        quantity: '1.000',
        strength: '1 mg',
        unit_price: '1.00',
      },
    ],
    payments: [
      {
        amount: '1.00',
        change_amount: '0.00',
        method: 'CASH',
        reference: null,
        tendered_amount: '1.00',
      },
    ],
    returnQrPayload: `00000000-0000-4000-8000-${suffix}`,
    sale: {
      branch_address: 'Digital test branch',
      branch_name: 'PharmacyOS Digital Gate',
      branch_phone: null,
      cashier_name: 'Digital Operator',
      created_at: '2026-09-01T08:00:00.000Z',
      discount_total: '0.00',
      fiscal_invoice_number: null,
      fiscal_status: 'NOT_REQUIRED',
      id: saleId,
      invoice_number: `DIGITAL-${String(ordinal).padStart(6, '0')}`,
      return_lookup_token: `00000000-0000-4000-8000-${suffix}`,
      subtotal: '1.00',
      tax_total: '0.00',
      total: '1.00',
    },
  };
}

async function scan(page: Page): Promise<void> {
  await page.evaluate((barcode) => {
    for (const key of barcode) {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  }, BARCODE);
}

test('digital gate completes 20 consecutive scanner-and-keyboard sales with print and reprint', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const clientRequestIds = new Set<string>();
  let draftOrdinal = 0;
  let finalizedOrdinal = 0;
  let reprintCount = 0;

  await page.addInitScript(
    ({ session, token }) => {
      localStorage.setItem('pharmacy-session', JSON.stringify(session));
      const state = window as Window & { __phase3PrintCount?: number };
      state.__phase3PrintCount = 0;
      window.print = () => {
        state.__phase3PrintCount = (state.__phase3PrintCount ?? 0) + 1;
      };
      sessionStorage.setItem('phase3-digital-token', token);
    },
    {
      token: TOKEN,
      session: {
        accessToken: TOKEN,
        absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
        expiresAt: '2027-09-01T07:00:00.000Z',
        sessionId: 'phase3-digital-session',
        user: {
          branchId: '1',
          branchTimezone: 'Asia/Karachi',
          displayName: 'Digital Operator',
          id: '1',
          permissions: ['sale.finalize_payment', 'pos.create_draft', 'pos.search'],
          terminalCode: 'DIGITAL-01',
          terminalId: '1',
          terminalName: 'Digital Counter',
          username: 'digital-operator',
        },
      },
    },
  );
  await page.route('**/api/v1/health/ready', (route) => json(route, { status: 'ready' }));
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, {
      data: [
        {
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
        },
      ],
    }),
  );
  await page.route('**/api/v1/cash-sessions/current', (route) =>
    json(route, {
      cashIn: '0.00',
      cashOut: '0.00',
      cashRefunds: '0.00',
      cashSales: '0.00',
      cashierName: 'Digital Operator',
      cashierUserId: '1',
      closedAt: null,
      closingNotes: null,
      countedCash: null,
      expectedCash: '1000.00',
      id: '10',
      openedAt: '2026-09-01T07:00:00.000Z',
      openingFloat: '1000.00',
      status: 'OPEN',
      variance: null,
      varianceApprovalThreshold: '100.00',
    }),
  );
  await page.route('**/api/v1/pos/drafts', (route) => {
    draftOrdinal += 1;
    return json(route, { id: String(2_000 + draftOrdinal), status: 'DRAFT', total: '1.00' }, 201);
  });
  await page.route('**/api/v1/pos/drafts/*/reserve', (route) =>
    json(
      route,
      {
        id: route
          .request()
          .url()
          .match(/drafts\/(\d+)\/reserve/)?.[1],
        reservationCount: 1,
        reservedUntil: '2027-09-01T08:00:00.000Z',
        status: 'RESERVED',
        subtotal: '1.00',
        total: '1.00',
      },
      201,
    ),
  );
  await page.route('**/api/v1/pos/sales/finalize', (route) => {
    const body = route.request().postDataJSON() as {
      clientRequestId: string;
      payments: unknown;
    };
    expect(body.payments).toEqual([{ amount: '1.00', method: 'CASH', tenderedAmount: '1.00' }]);
    expect(clientRequestIds.has(body.clientRequestId)).toBe(false);
    clientRequestIds.add(body.clientRequestId);
    finalizedOrdinal += 1;
    const saleId = String(1_000 + finalizedOrdinal);
    return json(
      route,
      {
        fiscalStatus: 'NOT_REQUIRED',
        id: saleId,
        invoiceNumber: `DIGITAL-${String(finalizedOrdinal).padStart(6, '0')}`,
        returnLookupPath: '/returns/token',
        returnLookupToken: `00000000-0000-4000-8000-${String(finalizedOrdinal).padStart(12, '0')}`,
        total: '1.00',
      },
      201,
    );
  });
  await page.route('**/api/v1/pos/sales/*/receipt', (route) => {
    const saleId =
      route
        .request()
        .url()
        .match(/sales\/(\d+)\/receipt/)?.[1] ?? '0';
    return json(route, receipt(saleId, Number(saleId) - 1_000));
  });
  await page.route('**/api/v1/pos/sales?query=*', (route) =>
    json(route, {
      data: [
        {
          cashier_name: 'Digital Operator',
          created_at: '2026-09-01T08:00:00.000Z',
          id: '1020',
          invoice_number: 'DIGITAL-000020',
          total: '1.00',
        },
      ],
    }),
  );
  await page.route('**/api/v1/pos/sales/1020/reprint', (route) => {
    reprintCount += 1;
    return json(route, receipt('1020', 20), 201);
  });

  await page.goto('/#/pos');
  await expect(page.getByRole('heading', { name: 'Find medicine' })).toBeVisible();
  for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
    await scan(page);
    await expect(page.getByLabel('Digital Gate Medicine quantity')).toHaveValue('1');
    await page.keyboard.press('F8');
    await expect(page.getByRole('dialog', { name: 'Take payment' })).toBeVisible();
    await page.keyboard.press('F8');
    const saleReceipt = page.getByRole('dialog', { name: 'Sale receipt' });
    await expect(saleReceipt).toContainText(`DIGITAL-${String(ordinal).padStart(6, '0')}`);
    if (ordinal === 20) {
      await saleReceipt.getByRole('button', { name: 'Browser print' }).click();
    }
    await saleReceipt.getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('F2');
  }

  await page.keyboard.press('F6');
  const reprint = page.getByRole('dialog', { name: 'Find and reprint receipt' });
  await reprint.getByRole('button', { name: /DIGITAL-000020/ }).click();
  await expect(page.getByRole('dialog', { name: 'Sale receipt' })).toContainText('DIGITAL-000020');

  expect(finalizedOrdinal).toBe(20);
  expect(clientRequestIds.size).toBe(20);
  expect(reprintCount).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __phase3PrintCount?: number }).__phase3PrintCount ?? 0,
      ),
    )
    .toBe(1);
});
