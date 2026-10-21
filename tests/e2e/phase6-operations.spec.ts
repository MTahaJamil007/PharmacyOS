import { expect, test, type Page } from '@playwright/test';

import { json, sessionWith, signIn } from './support.js';

const systems = sessionWith([
  'fbr.view_status',
  'fbr.retry',
  'backup.restore',
  'ai.audit.read',
  'settings.manage_system',
]);

const failedInvoice = {
  attemptCount: 2,
  fiscalInvoiceNumber: null,
  id: '9',
  invoiceNumber: 'MAIN-20260920-000044',
  lastErrorCode: 'FBR_OUTBOUND_APPROVAL_REQUIRED',
  lastErrorMessage: 'Outbound fiscal submission is disabled pending operator approval',
  mode: 'SANDBOX',
  retryable: true,
  saleCreatedAt: '2026-09-20T09:00:00.000Z',
  saleId: '44',
  status: 'FAILED_NEEDS_REVIEW',
  submittedAt: null,
  total: '1280.00',
  updatedAt: '2026-09-20T09:05:00.000Z',
};

const submittedInvoice = {
  ...failedInvoice,
  attemptCount: 1,
  fiscalInvoiceNumber: 'FBR-000-111',
  id: '10',
  invoiceNumber: 'MAIN-20260920-000045',
  lastErrorCode: null,
  lastErrorMessage: null,
  retryable: false,
  saleId: '45',
  status: 'SUBMITTED',
  submittedAt: '2026-09-20T09:01:00.000Z',
};

const counts = {
  FAILED_NEEDS_REVIEW: 1,
  FAILED_RETRYABLE: 0,
  NOT_REQUIRED: 0,
  PENDING: 0,
  SUBMITTED: 1,
  SUBMITTING: 0,
  VALIDATED: 0,
  VALIDATING: 0,
  VOID_OR_CREDIT_NOTE_PENDING: 0,
};

const backupRun = {
  backupType: 'LOGICAL',
  checksum: 'abc',
  destination: '/backups/nightly',
  durationSeconds: 42,
  encrypted: true,
  errorMessage: null,
  finishedAt: '2026-09-21T01:00:42.000Z',
  id: '5',
  sizeBytes: '5242880',
  startedAt: '2026-09-21T01:00:00.000Z',
  status: 'SUCCEEDED',
};

async function mockFiscal(page: Page): Promise<{ retryBody: () => unknown }> {
  let retryBody: unknown = null;
  await page.route('**/api/v1/fiscal/invoices?*', (route) =>
    json(route, {
      counts,
      invoices: [failedInvoice, submittedInvoice],
      mode: 'SANDBOX',
      outboundEnabled: false,
    }),
  );
  await page.route('**/api/v1/fiscal/invoices/9/attempts', (route) =>
    json(route, {
      attempts: [
        {
          attemptNumber: 1,
          attemptedAt: '2026-09-20T09:01:00.000Z',
          correlationId: 'c-1',
          durationMs: 120,
          errorMessage: 'Outbound fiscal submission is disabled pending operator approval',
          httpStatus: null,
          id: '1',
          operation: 'SUBMIT',
          outcome: 'PERMANENT_FAILURE',
        },
      ],
      invoice: failedInvoice,
    }),
  );
  await page.route('**/api/v1/fiscal/invoices/10/attempts', (route) =>
    json(route, { attempts: [], invoice: submittedInvoice }),
  );
  await page.route('**/api/v1/fiscal/invoices/9/retry', (route) => {
    retryBody = route.request().postDataJSON();
    return json(route, { id: '9', status: 'PENDING' }, 201);
  });
  return { retryBody: () => retryBody };
}

test('system manager inspects a failed fiscal submission and queues one retry', async ({
  page,
}) => {
  await signIn(page, systems);
  const fiscal = await mockFiscal(page);
  await page.goto('/#/operations');
  await expect(page.getByText(/FBR submission is off/)).toBeVisible();
  await page.getByRole('row', { name: /MAIN-20260920-000044/ }).click();
  const drawer = page.getByRole('dialog', { name: /Invoice MAIN-20260920-000044/ });
  await expect(drawer.getByText('Permanent failure')).toBeVisible();
  await drawer.getByRole('button', { name: 'Send to FBR again' }).click();
  const retry = page.getByRole('dialog', { name: /Retry MAIN-20260920-000044/ });
  await retry.getByLabel('What was fixed?').fill('Integrator confirmed no invoice number issued');
  await retry.getByRole('button', { name: 'Queue retry' }).click();
  await expect(page.getByText('Queued for another attempt')).toBeVisible();
  expect(fiscal.retryBody()).toMatchObject({
    reason: 'Integrator confirmed no invoice number issued',
  });
});

test('an invoice that already holds a fiscal number offers no retry', async ({ page }) => {
  await signIn(page, systems);
  await mockFiscal(page);
  await page.route('**/api/v1/operations/backups*', (route) =>
    json(route, {
      lastSuccessfulBackup: backupRun,
      lastSuccessfulRestoreDrill: null,
      runs: [backupRun],
    }),
  );
  await page.route('**/api/v1/owner-ai/audits*', (route) =>
    json(route, {
      data: [
        {
          createdAt: '2026-09-20T11:00:00.000Z',
          errorCode: null,
          id: '3',
          latencyMs: 812,
          model: 'gemini-2.0-flash',
          provider: 'GEMINI',
          status: 'SUCCEEDED',
          toolName: 'get_sales_summary',
          userDisplayName: 'Owner',
        },
      ],
    }),
  );
  await page.goto('/#/operations');
  await page.getByRole('row', { name: /MAIN-20260920-000045/ }).click();
  const drawer = page.getByRole('dialog', { name: /Invoice MAIN-20260920-000045/ });
  await expect(drawer).toContainText('FBR-000-111');
  await expect(drawer.getByRole('button', { name: 'Send to FBR again' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: 'Backups' }).click();
  await expect(page.getByRole('cell', { name: '5.0 MB' })).toBeVisible();
  await expect(page.getByText('Last restore drill')).toBeVisible();
  await page.getByRole('tab', { name: 'Assistant log' }).click();
  await expect(page.getByRole('cell', { name: 'Get sales summary' })).toBeVisible();
});

test('catalog import checks the whole file before anything is written', async ({ page }) => {
  await signIn(page, systems);
  const modes: string[] = [];
  await page.route(/\/api\/v1\/admin\/(users|medicines|suppliers|terminals)(\?.*)?$/, (route) =>
    json(route, { data: [] }),
  );
  await page.route('**/api/v1/admin/medicines/import', (route) => {
    const body = route.request().postDataJSON() as { mode: 'VALIDATE' | 'APPLY'; rows: unknown[] };
    modes.push(body.mode);
    return json(route, {
      applied: body.mode === 'APPLY',
      created: 2,
      idempotentReplay: false,
      issues: [],
      mode: body.mode,
      rejected: 0,
      totalRows: body.rows.length,
      unchanged: 0,
      updated: 0,
    });
  });

  await page.goto('/#/admin');
  await page.getByRole('tab', { name: 'Data import' }).click();
  await page.getByLabel('1. Medicine list file').setInputFiles({
    buffer: Buffer.from(
      'Brand Name,Generic,Pack,Barcode\nPanadol,Paracetamol,20,8964000123456\nBrufen,Ibuprofen,10,8964000654321\n',
    ),
    mimeType: 'text/csv',
    name: 'catalog.csv',
  });
  await expect(page.getByText('catalog.csv')).toBeVisible();
  // Nothing can be applied until the file has been checked.
  await expect(page.getByRole('button', { name: 'Import medicines' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Check file' }).first().click();
  await expect(page.getByRole('button', { name: 'Import medicines' })).toBeVisible();
  expect(modes).toEqual(['VALIDATE']);

  await page.getByRole('button', { name: 'Import medicines' }).click();
  await expect(page.getByText('Import complete')).toBeVisible();
  expect(modes).toEqual(['VALIDATE', 'APPLY']);
});

test('catalog import reports problems by spreadsheet line and refuses to apply', async ({
  page,
}) => {
  await signIn(page, systems);
  await page.route(/\/api\/v1\/admin\/(users|medicines|suppliers|terminals)(\?.*)?$/, (route) =>
    json(route, { data: [] }),
  );
  await page.route('**/api/v1/admin/medicines/import', (route) =>
    json(route, {
      applied: false,
      created: 1,
      idempotentReplay: false,
      issues: [
        { field: 'name', message: 'Too small: expected string to have >=2 characters', row: 2 },
      ],
      mode: 'VALIDATE',
      rejected: 1,
      totalRows: 2,
      unchanged: 0,
      updated: 0,
    }),
  );
  await page.goto('/#/admin');
  await page.getByRole('tab', { name: 'Data import' }).click();
  await page.getByLabel('1. Medicine list file').setInputFiles({
    buffer: Buffer.from('name,barcode\nPanadol,8964000123456\nX,8964000654321\n'),
    mimeType: 'text/csv',
    name: 'catalog.csv',
  });
  await page.getByRole('button', { name: 'Check file' }).first().click();
  await expect(page.getByText(/1 problem\(s\) found — nothing has been saved/)).toBeVisible();
  // Server row 2 of the first chunk is spreadsheet line 3 (line 1 is the heading).
  await expect(page.getByRole('row', { name: /^3 name/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import medicines' })).toHaveCount(0);
});
