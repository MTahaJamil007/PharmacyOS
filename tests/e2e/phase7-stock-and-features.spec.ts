import { expect, test, type Page, type Route } from '@playwright/test';
import { resolveFeatures } from '@pharmacy/shared';

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

async function signIn(page: Page, permissions: readonly string[]) {
  await page.addInitScript(
    (stored) => {
      localStorage.setItem('pharmacy-session', JSON.stringify(stored));
      window.print = () => undefined;
    },
    {
      accessToken: 'phase7-token',
      absoluteExpiresAt: '2099-09-01T08:00:00.000Z',
      expiresAt: '2099-08-31T20:30:00.000Z',
      sessionId: 'phase7-session',
      user: {
        id: '8',
        branchId: '1',
        branchTimezone: 'Asia/Karachi',
        displayName: 'Stock Keeper',
        permissions,
        terminalCode: 'STORE-1',
        terminalId: '4',
        terminalName: 'Store room',
        username: 'store',
      },
    },
  );
  // Anything not mocked below answers empty rather than reaching a real server.
  await page.route('**/api/v1/**', (route) => json(route, {}));
}

const GTIN_PANADOL = '08964000121238';
const GTIN_UNKNOWN = '08964000999998';

function scanResult(gtin: string, medicine: Record<string, unknown> | null, batch: string) {
  return {
    scan: {
      raw: `01${gtin}17300630` + `10${batch}`,
      kind: 'GS1',
      gtin,
      lookupKeys: [gtin],
      batch,
      expiryDate: '2030-06-30',
      productionDate: null,
      serial: null,
      needsReview: false,
      problems: [],
    },
    medicine,
    defaults: medicine
      ? {
          supplierId: medicine.id === '101' ? '3' : null,
          supplierName: medicine.id === '101' ? 'Muller Distributors' : null,
          costPerPack: medicine.id === '101' ? '100.00' : null,
          unitsPerPack: '10.000',
          salePricePerUnit: '12.50',
          lastReceivedAt: null,
        }
      : null,
    existingBatch: null,
    warnings: [],
  };
}

const panadolMedicine = {
  id: '101',
  name: 'Panadol',
  genericName: 'Paracetamol',
  strength: '500mg',
  dosageForm: 'tablets',
  manufacturer: 'GSK',
  packSize: '10.000',
  unitName: 'tablet',
  storageClass: 'AMBIENT',
  requiresSecured: false,
  requiresPrescription: false,
};
const brufenMedicine = { ...panadolMedicine, id: '102', name: 'Brufen', strength: '400mg' };

test('a delivery is received by scanning packs, and a new pack is linked only after confirming', async ({
  page,
}) => {
  await signIn(page, ['inventory.purchase', 'pos.search', 'inventory.shelf.manage']);
  let linked = false;
  const sent: { link: unknown; receipt: Record<string, unknown> | null; place: unknown } = {
    link: null,
    receipt: null,
    place: null,
  };
  await page.route('**/api/v1/admin/suppliers', (route) =>
    json(route, {
      data: [
        {
          id: '3',
          name: 'Muller Distributors',
          code: null,
          phone: null,
          leadTimeDays: 2,
          isActive: true,
        },
      ],
    }),
  );
  await page.route('**/api/v1/stock/scan?*', (route) => {
    const code = new URL(route.request().url()).searchParams.get('code') ?? '';
    if (code.includes(GTIN_PANADOL))
      return json(route, scanResult(GTIN_PANADOL, panadolMedicine, 'PN22'));
    return json(route, scanResult(GTIN_UNKNOWN, linked ? brufenMedicine : null, 'BR9'));
  });
  await page.route('**/api/v1/catalog/medicines/search**', (route) =>
    json(route, {
      data: [
        {
          id: '102',
          name: 'Brufen',
          genericName: 'Ibuprofen',
          strength: '400mg',
          dosageForm: 'tablets',
          manufacturer: 'Abbott',
          barcode: null,
          shelf: null,
          availableQuantity: '0.000',
          nearestExpiry: null,
          daysToExpiry: null,
          salePrice: null,
        },
      ],
    }),
  );
  await page.route('**/api/v1/stock/barcodes', (route) => {
    sent.link = route.request().postDataJSON();
    linked = true;
    return json(route, { medicineId: '102', barcode: GTIN_UNKNOWN.slice(1), alreadyLinked: false });
  });
  await page.route('**/api/v1/quick-receipts', (route) => {
    sent.receipt = route.request().postDataJSON() as Record<string, unknown>;
    return json(route, {
      receiptId: '5',
      purchaseOrderId: '9',
      orderNumber: 'DR-20261022-ABC',
      totalCost: '440.00',
      lineCount: 2,
      shelves: [
        { medicineId: '101', shelf: 'A-3' },
        { medicineId: '102', shelf: null },
      ],
      idempotentReplay: false,
    });
  });
  await page.route('**/api/v1/shelf-planner/alphabet/place', (route) => {
    sent.place = route.request().postDataJSON();
    return json(route, {
      target: { fixtureKey: 'f2', level: 2 },
      targetLabel: 'B-2',
      after: 'Augmentin',
      before: 'Calpol',
      moves: [],
      applied: true,
    });
  });

  await page.goto('/#/inventory');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  const scan = page.getByRole('textbox', { name: 'Scan a pack or type a medicine name' });
  await expect(scan).toBeVisible();
  await scan.fill(`01${GTIN_PANADOL}17300630` + `10PN22`);
  await scan.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Packs for Panadol', exact: true })).toHaveValue(
    '1',
  );
  await scan.fill(`01${GTIN_PANADOL}17300630` + `10PN22`);
  await scan.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Packs for Panadol', exact: true })).toHaveValue(
    '2',
  );
  await expect(page.getByRole('combobox', { name: 'Supplier' })).toHaveValue('3');

  await scan.fill(`01${GTIN_UNKNOWN}17300630` + `10BR9`);
  await scan.press('Enter');
  await expect(page.getByText('This pack is new to the shop.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Find the medicine by name' }).fill('Bru');
  await page.getByRole('button', { name: /Brufen 400mg tablets/ }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm the medicine' });
  await expect(confirm).toContainText('Brufen 400mg tablets');
  await confirm.getByRole('button', { name: 'Yes, it is this medicine' }).click();
  expect(sent.link).toEqual({ medicineId: '102', code: `01${GTIN_UNKNOWN}17300630` + `10BR9` });
  await expect(page.getByRole('textbox', { name: 'Batch for Brufen' })).toHaveValue('BR9');

  await page.getByRole('button', { name: 'Receive stock', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('Fix the 1 red line first');
  await page.getByRole('textbox', { name: 'Cost per pack for Brufen' }).fill('120');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Stock received' })).toContainText(
    'DR-20261022-ABC',
  );
  expect(sent.receipt).toMatchObject({ supplierId: '3' });
  const lines = sent.receipt?.lines as Array<Record<string, unknown>>;
  expect(lines.map((line) => [line.medicineId, line.quantity, line.batchNumber])).toEqual([
    ['102', '1', 'BR9'],
    ['101', '2', 'PN22'],
  ]);
  const received = page.getByRole('region', { name: 'Stock received' });
  await expect(received).toContainText('A-3');
  await received.getByRole('button', { name: 'Give it an A to Z place' }).click();
  await expect(received).toContainText('B-2 after Augmentin');
  expect(sent.place).toEqual({ medicineId: '102', apply: true });
});

test('the counter offers only the exact same medicine when one is out of stock, and notes requests', async ({
  page,
}) => {
  await signIn(page, ['pos.search', 'pos.create_draft', 'pos.send_to_cashier']);
  const requests: unknown[] = [];
  const medicine = (overrides: Record<string, unknown>) => ({
    id: '101',
    name: 'Panadol',
    genericName: 'Paracetamol',
    strength: '500mg',
    dosageForm: 'tablets',
    manufacturer: 'GSK',
    barcode: null,
    shelf: null,
    availableQuantity: '0.000',
    nearestExpiry: null,
    daysToExpiry: null,
    salePrice: null,
    ...overrides,
  });
  await page.route('**/api/v1/catalog/medicines/search**', (route) => {
    const query = new URL(route.request().url()).searchParams.get('query') ?? '';
    return json(route, { data: query.startsWith('Pan') ? [medicine({})] : [] });
  });
  await page.route('**/api/v1/catalog/medicines/101/substitutes', (route) =>
    json(route, {
      formulation: 'Paracetamol 500mg tablet',
      data: [
        medicine({
          id: '105',
          name: 'Calpara',
          manufacturer: 'Getz',
          availableQuantity: '40.000',
          salePrice: '9.00',
          nearestExpiry: '2027-01-31',
          daysToExpiry: 200,
          matchedBy: 'SAME_FORMULATION',
        }),
      ],
    }),
  );
  await page.route('**/api/v1/stock/customer-requests', (route) => {
    requests.push(route.request().postDataJSON());
    return json(route, { id: String(requests.length), counted: true }, 201);
  });
  await page.goto('/#/pos');
  const search = page.getByPlaceholder('Brand, generic, barcode or company');

  await search.fill('zzzol');
  await page.getByRole('button', { name: 'Customer asked for “zzzol”' }).click();
  await expect(page.getByRole('button', { name: 'Noted ✓' })).toBeVisible();

  await search.fill('Panadol');
  await expect(page.getByRole('option', { name: /Panadol 500mg/ })).toContainText('tablets');
  await search.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Panadol is out of stock' });
  await expect(panel).toContainText('Same medicine: Paracetamol 500mg tablet');
  await panel.getByRole('button', { name: 'Customer asked for it' }).click();
  await expect(panel.getByRole('button', { name: 'Noted ✓' })).toBeVisible();
  await panel.getByRole('button', { name: /Calpara 500mg tablets/ }).click();
  await expect(page.locator('.staged-item')).toContainText('Calpara');
  expect(requests).toEqual([
    { requestedName: 'zzzol' },
    { medicineId: '101', requestedName: 'Panadol' },
  ]);
});

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
    registrationGaps: [],
  },
};

function catalog(plan: 'BASIC' | 'STANDARD' | 'PRO', overrides: Record<string, boolean> = {}) {
  const features = resolveFeatures(plan, []);
  return {
    plan,
    planLabel: plan === 'PRO' ? 'Pro' : plan === 'BASIC' ? 'Basic' : 'Standard',
    features: [
      {
        key: 'STUCK_STOCK',
        group: 'Inventory',
        label: 'Stuck stock',
        description: 'List stock that has not sold for a long time.',
        plans: ['STANDARD', 'PRO'],
        settingFields: [
          {
            key: 'days',
            label: 'Not sold for',
            kind: 'number',
            unit: 'days',
            min: 15,
            max: 730,
            defaultValue: 90,
          },
        ],
        ...features.STUCK_STOCK,
        enabled: overrides.STUCK_STOCK ?? features.STUCK_STOCK.enabled,
        overridden: overrides.STUCK_STOCK !== undefined,
      },
      {
        key: 'SHELF_PLANNER_3D',
        group: 'Shelves',
        label: '3D shop planner',
        description: 'Draw the shop in 3D.',
        plans: ['PRO'],
        settingFields: [],
        ...features.SHELF_PLANNER_3D,
      },
    ],
  };
}

test('the software owner picks a plan and switches single features for a shop', async ({
  page,
}) => {
  await signIn(page, ['pos.search', 'platform.super_admin']);
  const sent: unknown[] = [];
  let current = catalog('PRO');
  await page.route('**/api/v1/platform/shops', (route) => json(route, { data: [shop] }));
  await page.route('**/api/v1/platform/shops/1/features', (route) => json(route, current));
  await page.route('**/api/v1/platform/shops/1/plan', (route) => {
    sent.push(route.request().postDataJSON());
    current = catalog('BASIC');
    return json(route, current);
  });
  await page.route('**/api/v1/platform/shops/1/features/STUCK_STOCK', (route) => {
    sent.push(route.request().postDataJSON());
    current = catalog('BASIC', { STUCK_STOCK: true });
    return json(route, current);
  });
  await page.goto('/#/platform');
  await page.getByText('Plan and features').click();
  const plans = page.getByRole('group', { name: 'Plan for Al-Shifa Pharmacy' });
  await expect(plans.getByRole('button', { name: /Pro/ })).toHaveAttribute('aria-pressed', 'true');
  await plans.getByRole('button', { name: /Basic/ }).click();
  const stuck = page.getByRole('switch', { name: 'Stuck stock for Al-Shifa Pharmacy' });
  await expect(stuck).toHaveAttribute('aria-checked', 'false');
  await stuck.click();
  await expect(stuck).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Added for this shop')).toBeVisible();
  const days = page.getByRole('spinbutton', { name: 'Not sold for (Stuck stock)' });
  await days.fill('45');
  await days.blur();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent).toEqual([{ plan: 'BASIC' }, { enabled: true }, { settings: { days: 45 } }]);
});

test('a Basic shop sees only its features, and the owner tunes stock alerts in place', async ({
  page,
}) => {
  await signIn(page, [
    'inventory.purchase',
    'reports.view_basic',
    'settings.manage_system',
    'inventory.shelf.read',
    'pos.search',
  ]);
  let tuned: unknown = null;
  await page.route('**/api/v1/features', (route) =>
    json(route, { plan: 'BASIC', features: resolveFeatures('BASIC', []) }),
  );
  await page.route('**/api/v1/stock/low', (route) =>
    json(route, {
      lookbackDays: 30,
      coverDays: 7,
      data: [
        {
          id: '101',
          name: 'Panadol',
          strength: '500mg',
          dosageForm: 'tablets',
          manufacturer: 'GSK',
          packSize: '10.000',
          onHand: '12.000',
          dailySales: '6.00',
          daysLeft: 2,
          minimumStock: null,
          suggestedPacks: 4,
        },
      ],
    }),
  );
  await page.route('**/api/v1/stock/expiring', (route) =>
    json(route, {
      days: 90,
      data: [
        {
          batchId: '7',
          medicineId: '102',
          name: 'Brufen',
          strength: '400mg',
          dosageForm: 'tablets',
          manufacturer: 'Abbott',
          batchNumber: 'OLD-1',
          expiryDate: '2026-10-01',
          daysLeft: -21,
          quantity: '30.000',
          value: '150.00',
          shelf: 'B-2',
        },
      ],
    }),
  );
  await page.route('**/api/v1/features/LOW_STOCK/settings', (route) => {
    tuned = route.request().postDataJSON();
    return json(route, {});
  });
  await page.goto('/#/inventory');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav.getByRole('link', { name: 'Inventory' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Shelves' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Purchasing' })).toHaveCount(0);
  const sections = page.getByRole('navigation', { name: 'Stock sections' });
  await expect(sections.getByRole('button', { name: 'Order list' })).toHaveCount(0);
  await expect(sections.getByRole('button', { name: 'Customer requests' })).toHaveCount(0);
  await sections.getByRole('button', { name: 'Stock alerts' }).click();
  await expect(page.getByText('Running low: less than 7 days of stock')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which alert' }).getByRole('button')).toHaveText([
    'Running low',
    'Expiring',
  ]);
  const cover = page.getByRole('spinbutton', { name: 'Keep enough stock for' });
  await cover.fill('10');
  await cover.press('Enter');
  await expect.poll(() => tuned).toEqual({ settings: { coverDays: 10 } });
  await page.getByRole('button', { name: 'Expiring' }).click();
  await expect(page.getByRole('row', { name: /Brufen/ })).toContainText(
    'expired: take off the shelf',
  );
});
