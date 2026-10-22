import { expect, test, type Page, type Route } from '@playwright/test';

const baseUser = {
  id: '1',
  branchId: '1',
  branchTimezone: 'Asia/Karachi',
  displayName: 'Shop Owner',
  terminalCode: 'ADMIN-01',
  terminalId: '1',
  terminalName: 'Owner desk',
  username: 'owner',
};

function session(permissions: readonly string[], displayName = 'Shop Owner') {
  return {
    accessToken: 'phase6-token',
    absoluteExpiresAt: '2099-09-01T08:00:00.000Z',
    expiresAt: '2099-08-31T20:30:00.000Z',
    sessionId: 'phase6-session',
    user: { ...baseUser, displayName, permissions },
  };
}

const ownerPermissions = [
  'pos.search',
  'sale.finalize_payment',
  'settings.manage_users',
  'settings.manage_system',
];

const shop = {
  id: '1',
  code: 'MAIN',
  name: 'Al-Shifa Pharmacy',
  address: 'Main Boulevard, Lahore',
  phone: '042-1111111',
  email: null,
  drugLicenseNumber: 'DSL-42',
  isActive: true,
  sellerNtnCnic: '1234567',
  sellerStrn: null,
  posRegistrationNumber: '654321',
  businessName: 'Al-Shifa Pharmacy',
  province: 'Punjab',
  scenarioId: null,
  fbr: {
    invoicingEnabled: false,
    invoicingChangedAt: null,
    transmissionApproved: true,
    transmissionApprovedAt: '2026-10-01T08:00:00.000Z',
    serverMode: 'SANDBOX',
    serverTokenConfigured: true,
    registrationGaps: [],
  },
  users: 3,
  terminals: 2,
  salesToday: 14,
};

const defaultLayout = {
  paperWidth: '80mm',
  fontScale: 'NORMAL',
  title: 'Sales invoice',
  headerNote: '',
  footerNote: 'Medicines are returnable within 7 days with this invoice and in original packing.',
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showDrugLicense: true,
  showNtn: true,
  showCashier: true,
  showCustomer: true,
  showBatch: true,
  showExpiry: true,
  showDosage: true,
  showDosageUrdu: true,
  showDiscount: true,
  showTaxSummary: true,
  showReturnQr: true,
  copies: 1,
};

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({ body: JSON.stringify(value), contentType: 'application/json', status });
}

async function signIn(page: Page, value: ReturnType<typeof session>): Promise<void> {
  await page.addInitScript((stored) => {
    localStorage.setItem('pharmacy-session', JSON.stringify(stored));
    const state = window as Window & { __printCount?: number };
    state.__printCount = 0;
    window.print = () => {
      state.__printCount = (state.__printCount ?? 0) + 1;
    };
  }, value);
}

function receipt(fbrEnabled: boolean) {
  return {
    sale: {
      id: '77',
      invoice_number: 'MAIN-20261022-000077',
      subtotal: '300.00',
      discount_total: '0.00',
      tax_total: '0.00',
      total: '300.00',
      created_at: '2026-10-22T09:30:00.000Z',
      branch_name: 'Al-Shifa Pharmacy',
      branch_address: 'Main Boulevard, Lahore',
      branch_phone: '042-1111111',
      cashier_name: 'Counter One',
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      return_lookup_token: '00000000-0000-4000-8000-000000000077',
      fiscal_status: fbrEnabled ? 'SUBMITTED' : 'NOT_REQUIRED',
      fiscal_invoice_number: fbrEnabled ? 'FBR-123456' : null,
    },
    items: [
      {
        id: '1',
        name: 'Panadol',
        strength: '500mg Tablets',
        batch_number: 'PN1',
        expiry_date: '2027-06-30',
        quantity: '20.000',
        unit_price: '15.00',
        line_total: '300.00',
        dosage_instruction: '1+0+1 after meal',
      },
    ],
    payments: [
      {
        method: 'CASH',
        amount: '300.00',
        tendered_amount: '500.00',
        change_amount: '200.00',
        reference: null,
      },
    ],
    returnQrPayload: '00000000-0000-4000-8000-000000000077',
    shop: {
      name: 'Al-Shifa Pharmacy',
      address: 'Main Boulevard, Lahore',
      phone: '042-1111111',
      email: null,
      drugLicenseNumber: 'DSL-42',
      sellerNtnCnic: '1234567',
      sellerStrn: null,
      businessName: 'Al-Shifa Pharmacy',
    },
    layout: defaultLayout,
    fbr: {
      enabled: fbrEnabled,
      status: fbrEnabled ? 'SUBMITTED' : 'NOT_REQUIRED',
      invoiceNumber: fbrEnabled ? 'FBR-123456' : null,
      qrPayload: fbrEnabled ? 'FBR-123456' : null,
      posRegistrationNumber: '654321',
      lastError: null,
    },
  };
}

test('owner designs the invoice with a live preview and switches FBR on', async ({ page }) => {
  await signIn(page, session(ownerPermissions));
  let savedLayout: unknown = null;
  let fbrBody: unknown = null;
  await page.route('**/api/v1/admin/users', (route) => json(route, { data: [] }));
  await page.route('**/api/v1/admin/policies', (route) =>
    json(route, { basicDiscountLimitPercent: '5.00', cashVarianceApprovalThreshold: '100.00' }),
  );
  await page.route('**/api/v1/admin/shop', (route) => json(route, shop));
  await page.route('**/api/v1/admin/shop/invoice-layout', (route) => {
    if (route.request().method() === 'PUT') {
      savedLayout = route.request().postDataJSON();
      return json(route, { layout: savedLayout, updatedAt: '2026-10-22T10:00:00.000Z' });
    }
    return json(route, { layout: defaultLayout, updatedAt: null });
  });
  await page.route('**/api/v1/admin/shop/fbr-invoicing', (route) => {
    fbrBody = route.request().postDataJSON();
    return json(route, { ...shop, fbr: { ...shop.fbr, invoicingEnabled: true } });
  });

  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'invoice layout' }).click();
  const preview = page.getByRole('article', { name: 'Invoice' });
  await expect(preview).toContainText('Al-Shifa Pharmacy');
  await expect(preview).toContainText('Dose 1+0+1 after meal');
  await expect(preview).toContainText('Drug license: DSL-42');
  await expect(preview.getByAltText('Opaque return lookup token')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save layout' })).toBeDisabled();

  await page.getByRole('button', { name: '58mm roll' }).click();
  await page.getByLabel('Return QR code').uncheck();
  await page.getByLabel('Invoice title').fill('Cash memo');
  await expect(preview).toHaveClass(/paper-58mm/);
  await expect(preview).toContainText('Cash memo');
  await expect(preview.getByAltText('Opaque return lookup token')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('status')).toContainText('Invoice layout saved');
  expect(savedLayout).toMatchObject({
    paperWidth: '58mm',
    showReturnQr: false,
    title: 'Cash memo',
  });

  await page.getByRole('button', { name: 'shop & FBR' }).click();
  await expect(page.getByText('654321')).toBeVisible();
  const fbrSwitch = page.getByRole('switch', { name: 'FBR invoicing' });
  await expect(fbrSwitch).toHaveAttribute('aria-checked', 'false');
  await fbrSwitch.click();
  await expect(page.getByRole('status')).toContainText('FBR invoicing is on');
  expect(fbrBody).toEqual({ enabled: true });
  await expect(page.getByRole('link', { name: 'Super admin' })).toHaveCount(0);
});

test('the invoice prints timing in English and Urdu, and the FBR QR only while FBR is on', async ({
  page,
}) => {
  await signIn(page, session(ownerPermissions));
  let fbrOn = true;
  await page.route('**/api/v1/catalog/medicines/search**', (route) => json(route, { data: [] }));
  await page.route('**/api/v1/pos/sales?query=*', (route) =>
    json(route, {
      data: [
        {
          cashier_name: 'Counter One',
          created_at: '2026-10-22T09:30:00.000Z',
          id: '77',
          invoice_number: 'MAIN-20261022-000077',
          total: '300.00',
        },
      ],
    }),
  );
  await page.route('**/api/v1/pos/sales/77/reprint', (route) => json(route, receipt(fbrOn), 201));

  await page.goto('/#/pos');
  await expect(page.getByRole('heading', { name: 'Find medicine' })).toBeVisible();
  await page.keyboard.press('F6');
  await page
    .getByRole('dialog', { name: 'Find and reprint receipt' })
    .getByRole('button', { name: /MAIN-20261022-000077/ })
    .click();
  const sale = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(sale).toContainText('Dose 1+0+1 after meal');
  await expect(sale).toContainText('Morning 1 · Night 1 · after meal');
  await expect(sale).toContainText('صبح 1 · رات 1 · کھانے کے بعد');
  await expect(sale).toContainText('FBR No: FBR-123456');
  await expect(sale).toContainText('POS ID: 654321');
  await expect(sale.getByAltText('FBR invoice QR code')).toBeVisible();
  await sale.getByRole('button', { name: 'Browser print' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __printCount?: number }).__printCount))
    .toBe(1);
  await sale.getByRole('button', { name: 'Close' }).click();

  fbrOn = false;
  await page.keyboard.press('F6');
  await page
    .getByRole('dialog', { name: 'Find and reprint receipt' })
    .getByRole('button', { name: /MAIN-20261022-000077/ })
    .click();
  const noFbr = page.getByRole('dialog', { name: 'Sale receipt' });
  await expect(noFbr).toContainText('Dose 1+0+1 after meal');
  await expect(noFbr).not.toContainText('FBR No');
  await expect(noFbr.getByAltText('FBR invoice QR code')).toHaveCount(0);
});

test('super admin controls shops, FBR approval and every account', async ({ page }) => {
  await signIn(
    page,
    session([...ownerPermissions, 'platform.super_admin', 'fbr.view_status'], 'Software Owner'),
  );
  const patches: Array<{ readonly url: string; readonly body: unknown }> = [];
  let createdUser: unknown = null;
  await page.route('**/api/v1/platform/shops', (route) => json(route, { data: [shop] }));
  await page.route('**/api/v1/platform/shops/1**', (route) => {
    patches.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return json(route, shop);
  });
  await page.route('**/api/v1/platform/users', (route) => {
    if (route.request().method() === 'POST') {
      createdUser = route.request().postDataJSON();
      return json(route, { id: '9', username: 'owner2', roles: ['OWNER'] }, 201);
    }
    return json(route, {
      data: [
        {
          id: '2',
          username: 'owner',
          displayName: 'Shop Owner',
          isActive: true,
          lockedUntil: null,
          failedLoginCount: 0,
          lastLoginAt: null,
          access: [{ branchId: '1', branchName: 'Al-Shifa Pharmacy', role: 'OWNER' }],
        },
      ],
    });
  });

  await page.goto('/#/pos');
  await page.getByRole('link', { name: 'Super admin' }).click();
  await expect(page.getByRole('heading', { name: 'Super admin', level: 1 })).toBeVisible();
  const card = page.getByRole('article', { name: 'Shop Al-Shifa Pharmacy' });
  await expect(card).toContainText('14 sales today');
  await card.getByLabel('NTN (7/9 digits) or CNIC (13 digits)').fill('123');
  await card.getByRole('button', { name: 'Save profile' }).click();
  await expect(card.getByRole('alert')).toContainText('NTN is 7 or 9 digits');
  await card.getByLabel('NTN (7/9 digits) or CNIC (13 digits)').fill('7654321');
  await card.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('profile saved');
  expect(patches[0]).toMatchObject({ body: { sellerNtnCnic: '7654321' } });

  const withdraw = card.getByRole('button', { name: 'Withdraw approval' });
  await expect(withdraw).toBeDisabled();
  await card.getByLabel('Reason (recorded in the audit log)').fill('Shop closed for audit');
  await withdraw.click();
  await expect(page.getByRole('status')).toContainText('live FBR sending withdrawn');
  expect(patches[1]).toMatchObject({
    body: { approved: false, reason: 'Shop closed for audit' },
  });

  await page.getByRole('button', { name: 'All users' }).click();
  await expect(page.getByText('Al-Shifa Pharmacy: OWNER')).toBeVisible();
  await page.getByLabel('Username').fill('owner2');
  await page.getByLabel('Display name').fill('Second owner');
  await page.getByLabel(/Password/).fill('abc123');
  await page.getByRole('combobox', { name: 'Role' }).selectOption('OWNER');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('status')).toContainText('User created');
  expect(createdUser).toEqual({
    branchId: '1',
    username: 'owner2',
    displayName: 'Second owner',
    password: 'abc123',
    roles: ['OWNER'],
  });
});
