import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'phase6-e2e-token',
  absoluteExpiresAt: '2027-09-01T08:00:00.000Z',
  expiresAt: '2027-08-31T20:30:00.000Z',
  sessionId: 'phase6-e2e-session',
  user: {
    id: '1',
    branchId: '1',
    branchTimezone: 'Asia/Karachi',
    displayName: 'System Manager',
    permissions: [
      'fbr.view_status',
      'fbr.retry',
      'backup.restore',
      'ai.audit.read',
      'settings.manage_system',
    ],
    terminalCode: 'BACK-01',
    terminalId: '1',
    terminalName: 'Back Office',
    username: 'systems',
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

const failedInvoice = {
  attemptCount: 2,
  fiscalInvoiceNumber: null,
  id: '9',
  invoiceNumber: 'MAIN-20260920-000044',
  lastErrorCode: 'FBR_OUTBOUND_APPROVAL_REQUIRED',
  lastErrorMessage: 'Outbound fiscal submission is disabled pending operator approval',
  mode: 'DISABLED',
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
};

test('system manager inspects a failed fiscal submission and queues one retry', async ({
  page,
}) => {
  await authenticated(page);
  let retried = false;
  let retryPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/fiscal/invoices?*', (route) =>
    json(route, {
      counts: {
        FAILED_NEEDS_REVIEW: retried ? 0 : 1,
        FAILED_RETRYABLE: 0,
        NOT_REQUIRED: 3,
        PENDING: retried ? 1 : 0,
        SUBMITTED: 1,
        SUBMITTING: 0,
        VALIDATED: 0,
        VALIDATING: 0,
        VOID_OR_CREDIT_NOTE_PENDING: 0,
      },
      invoices: [
        retried ? { ...failedInvoice, status: 'PENDING' } : failedInvoice,
        submittedInvoice,
      ],
      mode: 'DISABLED',
      outboundEnabled: false,
    }),
  );
  await page.route('**/api/v1/fiscal/invoices/9/attempts', (route) =>
    json(route, {
      attempts: [
        {
          attemptNumber: 2,
          attemptedAt: '2026-09-20T09:05:00.000Z',
          correlationId: 'req-2',
          durationMs: 12,
          errorMessage: 'Outbound fiscal submission is disabled pending operator approval',
          httpStatus: null,
          id: '102',
          operation: 'SUBMIT',
          outcome: 'PERMANENT_FAILURE',
        },
      ],
      invoice: retried ? { ...failedInvoice, retryable: false, status: 'PENDING' } : failedInvoice,
    }),
  );
  await page.route('**/api/v1/fiscal/invoices/9/retry', async (route) => {
    retryPayload = route.request().postDataJSON() as Record<string, unknown>;
    retried = true;
    await json(route, { id: '9', idempotentReplay: false, status: 'PENDING' }, 201);
  });
  await page.route('**/api/v1/operations/backups*', (route) =>
    json(route, { lastSuccessfulBackup: null, lastSuccessfulRestoreDrill: null, runs: [] }),
  );
  await page.route('**/api/v1/owner-ai/audits*', (route) => json(route, { data: [] }));

  await page.goto('/#/operations');
  await expect(page.getByRole('heading', { name: /Fiscal, backup, and assistant/ })).toBeVisible();
  await expect(page.getByText('outbound transmission disabled')).toBeVisible();

  await page
    .getByRole('row', { name: /MAIN-20260920-000044/ })
    .getByRole('button')
    .click();
  await expect(page.getByRole('heading', { name: /attempt history/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PERMANENT FAILURE' })).toBeVisible();

  await page.getByLabel('Reason for retry').fill('Integrator confirmed no invoice number issued');
  await page.getByRole('button', { name: 'Queue resubmission' }).click();
  await expect(page.getByText(/Queued for resubmission/)).toBeVisible();
  expect(retryPayload).toMatchObject({
    reason: 'Integrator confirmed no invoice number issued',
  });
  expect(
    String((retryPayload as unknown as { clientRequestId: string }).clientRequestId).length,
  ).toBeGreaterThanOrEqual(8);
});

test('an invoice that already holds a fiscal number offers no retry', async ({ page }) => {
  await authenticated(page);
  await page.route('**/api/v1/fiscal/invoices?*', (route) =>
    json(route, {
      counts: {
        FAILED_NEEDS_REVIEW: 0,
        FAILED_RETRYABLE: 0,
        NOT_REQUIRED: 0,
        PENDING: 0,
        SUBMITTED: 1,
        SUBMITTING: 0,
        VALIDATED: 0,
        VALIDATING: 0,
        VOID_OR_CREDIT_NOTE_PENDING: 0,
      },
      invoices: [submittedInvoice],
      mode: 'SANDBOX',
      outboundEnabled: true,
    }),
  );
  await page.route('**/api/v1/fiscal/invoices/10/attempts', (route) =>
    json(route, { attempts: [], invoice: submittedInvoice }),
  );
  await page.route('**/api/v1/operations/backups*', (route) =>
    json(route, {
      lastSuccessfulBackup: {
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
      },
      lastSuccessfulRestoreDrill: null,
      runs: [
        {
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
        },
      ],
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
  await page
    .getByRole('row', { name: /MAIN-20260920-000045/ })
    .getByRole('button')
    .click();
  await expect(page.getByText(/already carries an official fiscal number/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Queue resubmission' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Backups and restore drills' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '5.0 MB' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'get_sales_summary' })).toBeVisible();
});

test('catalog import validates a file before anything is written', async ({ page }) => {
  await authenticated(page);
  let applied = false;
  let lastMode = '';

  await page.route('**/api/v1/admin/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/admin/medicines/import')) {
      const body = route.request().postDataJSON() as { mode: string };
      lastMode = body.mode;
      if (body.mode === 'VALIDATE') {
        await json(route, {
          applied: false,
          created: 2,
          idempotentReplay: false,
          issues: [],
          mode: 'VALIDATE',
          rejected: 0,
          totalRows: 2,
          unchanged: 0,
          updated: 0,
        });
        return;
      }
      applied = true;
      await json(route, {
        applied: true,
        created: 2,
        idempotentReplay: false,
        issues: [],
        mode: 'APPLY',
        rejected: 0,
        totalRows: 2,
        unchanged: 0,
        updated: 0,
      });
      return;
    }
    await json(route, { data: [] });
  });

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Import medicine catalog' })).toBeVisible();

  await page.getByLabel('Catalog file').setInputFiles({
    buffer: Buffer.from(
      'Brand Name,Generic,Pack,Barcode\nPanadol,Paracetamol,20,8964000123456\nBrufen,Ibuprofen,10,8964000654321\n',
    ),
    mimeType: 'text/csv',
    name: 'catalog.csv',
  });
  await expect(page.getByText('catalog.csv')).toBeVisible();

  // Applying is refused until the file has actually been validated.
  await expect(page.getByRole('button', { name: /^Apply/ })).toBeDisabled();

  await page.getByRole('button', { name: 'Validate file' }).click();
  await expect(page.getByText('Validation passed; this file is safe to apply')).toBeVisible();
  expect(lastMode).toBe('VALIDATE');
  expect(applied).toBe(false);

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Applied: 2 created, 0 updated')).toBeVisible();
  expect(applied).toBe(true);
});
