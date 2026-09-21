import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const OPERATOR_TOKEN = 'phase6-operator-token';
const LIMITED_TOKEN = 'phase6-limited-token';
const OPERATOR = { authorization: `Bearer ${OPERATOR_TOKEN}` };
const LIMITED = { authorization: `Bearer ${LIMITED_TOKEN}` };

function recordBody(response: { readonly body: string }): Record<string, unknown> {
  const value: unknown = JSON.parse(response.body);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object response');
  }
  return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new TypeError(`Expected ${key} to be an array`);
  return value;
}

describe('Phase 6 operations surfaces', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let branchId: string;
  let failedInvoiceId: string;
  let submittedInvoiceId: string;
  let otherBranchInvoiceId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase6_operations');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P6', 'Phase 6 Pharmacy') returning id::text
    `;
    const [otherBranch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P6B', 'Phase 6 Other') returning id::text
    `;
    const [operator] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('phase6-operator', 'Phase 6 Operator', 'token-auth-only') returning id::text
    `;
    const [limited] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('phase6-limited', 'Phase 6 Cashier', 'token-auth-only') returning id::text
    `;
    const [operatorRole] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('PHASE6_OPS', 'Phase 6 Operations') returning id::text
    `;
    const [limitedRole] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('PHASE6_LIMITED', 'Phase 6 Limited') returning id::text
    `;
    if (!branch || !otherBranch || !operator || !limited || !operatorRole || !limitedRole) {
      throw new Error('Phase 6 identity fixture failed');
    }
    branchId = branch.id;

    for (const code of Object.values(PERMISSIONS)) {
      await database.admin`
        insert into permissions (code, description) values (${code}, ${code})
        on conflict (code) do nothing
      `;
    }
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${operatorRole.id}, id from permissions
    `;
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${limitedRole.id}, id from permissions where code = ${PERMISSIONS.POS_SEARCH}
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${operator.id}, ${branchId}, ${operatorRole.id})
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${limited.id}, ${branchId}, ${limitedRole.id})
    `;
    for (const [userId, token] of [
      [operator.id, OPERATOR_TOKEN],
      [limited.id, LIMITED_TOKEN],
    ] as const) {
      const [terminal] = await database.admin<{ id: string }[]>`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${branchId}, ${`P6-${token.slice(-6)}`}, 'Phase 6 Terminal', 'CASHIER')
        returning id::text
      `;
      if (!terminal) throw new Error('Phase 6 terminal fixture failed');
      await database.admin`
        insert into sessions (
          user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
        ) values (
          ${userId}, ${branchId}, ${terminal.id},
          ${createHash('sha256').update(token).digest()},
          now() + interval '1 hour', now() + interval '12 hours'
        )
      `;
    }

    // Three fiscal records: one retryable failure, one already submitted, and one
    // belonging to a different branch that must never be visible or retryable here.
    const fixtures = [
      { branch: branchId, fiscalNumber: null, invoice: 'P6-0001', status: 'FAILED_NEEDS_REVIEW' },
      { branch: branchId, fiscalNumber: 'FBR-9001', invoice: 'P6-0002', status: 'SUBMITTED' },
      {
        branch: otherBranch.id,
        fiscalNumber: null,
        invoice: 'P6B-0001',
        status: 'FAILED_RETRYABLE',
      },
    ] as const;
    const created: string[] = [];
    for (const fixture of fixtures) {
      const [sale] = await database.admin<{ id: string }[]>`
        insert into sales (
          branch_id, terminal_id, invoice_number, status, subtotal, discount_total,
          tax_total, total
        ) values (
          ${fixture.branch},
          (select id from terminals where branch_id = ${fixture.branch} limit 1),
          ${fixture.invoice}, 'FINALIZED', 100, 0, 0, 100
        ) returning id::text
      `;
      if (!sale) throw new Error('Phase 6 sale fixture failed');
      const [invoice] = await database.admin<{ id: string }[]>`
        insert into fbr_invoices (sale_id, mode, status, payload, fiscal_invoice_number)
        values (${sale.id}, 'DISABLED', ${fixture.status}, '{}'::jsonb, ${fixture.fiscalNumber})
        returning id::text
      `;
      if (!invoice) throw new Error('Phase 6 fiscal fixture failed');
      created.push(invoice.id);
    }
    [failedInvoiceId, submittedInvoiceId, otherBranchInvoiceId] = created as [
      string,
      string,
      string,
    ];
    await database.admin`
      insert into fbr_invoice_attempts (
        fbr_invoice_id, attempt_number, request_payload, outcome, operation, error_message
      ) values (
        ${failedInvoiceId}, 1, '{}'::jsonb, 'PERMANENT_FAILURE', 'SUBMIT',
        'Outbound fiscal submission is disabled'
      )
    `;
    await database.admin`
      insert into backup_runs (
        branch_id, backup_type, status, destination, encrypted, size_bytes, checksum,
        started_at, finished_at
      ) values (
        ${branchId}, 'LOGICAL', 'SUCCEEDED', '/backups/nightly', true, 1024, 'sha256:test',
        now() - interval '2 hours', now() - interval '2 hours' + interval '40 seconds'
      )
    `;

    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  it('lists only this branch fiscal records and marks retry eligibility', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'GET',
      url: '/api/v1/fiscal/invoices',
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = recordBody(response);
    const invoices = arrayField(body, 'invoices') as ReadonlyArray<Record<string, unknown>>;
    expect(invoices).toHaveLength(2);
    expect(invoices.map((invoice) => invoice.invoiceNumber).sort()).toEqual(['P6-0001', 'P6-0002']);
    expect(invoices.find((invoice) => invoice.id === failedInvoiceId)?.retryable).toBe(true);
    expect(invoices.find((invoice) => invoice.id === submittedInvoiceId)?.retryable).toBe(false);
    expect(body.outboundEnabled).toBe(false);
  });

  it('returns the durable attempt history for one fiscal record', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'GET',
      url: `/api/v1/fiscal/invoices/${failedInvoiceId}/attempts`,
    });
    expect(response.statusCode, response.body).toBe(200);
    const attempts = arrayField(recordBody(response), 'attempts') as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe('PERMANENT_FAILURE');
  });

  it('hides another branch fiscal record behind a 404 rather than a 403', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'GET',
      url: `/api/v1/fiscal/invoices/${otherBranchInvoiceId}/attempts`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('requeues a failed submission exactly once for one client request id', async () => {
    const payload = {
      clientRequestId: 'phase6-retry-001',
      reason: 'Integrator confirmed that no fiscal number was issued',
    };
    const [first, second] = await Promise.all([
      api.app.inject({
        headers: OPERATOR,
        method: 'POST',
        payload,
        url: `/api/v1/fiscal/invoices/${failedInvoiceId}/retry`,
      }),
      api.app.inject({
        headers: OPERATOR,
        method: 'POST',
        payload,
        url: `/api/v1/fiscal/invoices/${failedInvoiceId}/retry`,
      }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);

    const [invoice] = await database.admin<{ status: string }[]>`
      select status from fbr_invoices where id = ${failedInvoiceId}
    `;
    expect(invoice?.status).toBe('PENDING');
    const jobs = await database.admin<{ status: string; attempts: number }[]>`
      select status, attempts from outbox_jobs where job_type = 'FBR_SUBMIT'
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ attempts: 0, status: 'PENDING' });
    const audits = await database.admin<{ total: number }[]>`
      select count(*)::int as total from audit_events
      where event_type = 'FISCAL.RETRY_REQUESTED' and request_id = ${payload.clientRequestId}
    `;
    expect(audits[0]?.total).toBe(1);
  });

  it('refuses to resubmit an invoice that already carries a fiscal number', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'POST',
      payload: {
        clientRequestId: 'phase6-retry-002',
        reason: 'Attempting to resubmit an already-numbered invoice',
      },
      url: `/api/v1/fiscal/invoices/${submittedInvoiceId}/retry`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('official fiscal number');
  });

  it('reports the recorded backup evidence', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'GET',
      url: '/api/v1/operations/backups',
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = recordBody(response);
    expect(arrayField(body, 'runs')).toHaveLength(1);
    expect(body.lastSuccessfulBackup).toMatchObject({
      backupType: 'LOGICAL',
      durationSeconds: 40,
      encrypted: true,
    });
    expect(body.lastSuccessfulRestoreDrill).toBeNull();
  });

  it('denies the operations surfaces to a session without the permissions', async () => {
    for (const url of [
      '/api/v1/fiscal/invoices',
      '/api/v1/operations/backups',
      '/api/v1/owner-ai/audits',
    ]) {
      const response = await api.app.inject({ headers: LIMITED, method: 'GET', url });
      expect(response.statusCode, `${url} -> ${response.body}`).toBe(403);
    }
  });

  it('validates a catalog file without writing, then applies it idempotently', async () => {
    const rows = [
      { barcode: '8964000900001', name: 'Phase Six Tablet', packSize: '10', taxRate: '17' },
      { barcode: '8964000900002', name: 'X', packSize: '10' },
      { barcode: '8964000900001', name: 'Duplicate Barcode', packSize: '5' },
    ];

    const validation = await api.app.inject({
      headers: OPERATOR,
      method: 'POST',
      payload: { clientRequestId: 'phase6-import-dry', mode: 'VALIDATE', rows },
      url: '/api/v1/admin/medicines/import',
    });
    expect(validation.statusCode, validation.body).toBe(201);
    const validationBody = recordBody(validation);
    expect(validationBody.applied).toBe(false);
    expect(validationBody.rejected).toBe(2);
    const [beforeCount] = await database.admin<{ total: number }[]>`
      select count(*)::int as total from medicines where name = 'Phase Six Tablet'
    `;
    expect(beforeCount?.total).toBe(0);

    const payload = {
      clientRequestId: 'phase6-import-apply',
      mode: 'APPLY',
      rows: [rows[0]],
    };
    const applied = await api.app.inject({
      headers: OPERATOR,
      method: 'POST',
      payload,
      url: '/api/v1/admin/medicines/import',
    });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(recordBody(applied)).toMatchObject({ applied: true, created: 1, updated: 0 });

    const replay = await api.app.inject({
      headers: OPERATOR,
      method: 'POST',
      payload,
      url: '/api/v1/admin/medicines/import',
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(recordBody(replay)).toMatchObject({ created: 1, idempotentReplay: true });

    const [afterCount] = await database.admin<{ total: number }[]>`
      select count(*)::int as total from medicines where name = 'Phase Six Tablet'
    `;
    expect(afterCount?.total).toBe(1);
  });

  it('updates an existing medicine matched by barcode instead of creating a second one', async () => {
    const response = await api.app.inject({
      headers: OPERATOR,
      method: 'POST',
      payload: {
        clientRequestId: 'phase6-import-update',
        mode: 'APPLY',
        rows: [
          {
            barcode: '8964000900001',
            name: 'Phase Six Tablet Renamed',
            packSize: '20',
            taxRate: '18',
          },
        ],
      },
      url: '/api/v1/admin/medicines/import',
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(recordBody(response)).toMatchObject({ created: 0, updated: 1 });

    const rows = await database.admin<{ name: string; pack_size: string; tax_rate: string }[]>`
      select medicines.name, medicines.pack_size::text, medicines.tax_rate::text
      from medicines
      join medicine_barcodes on medicine_barcodes.medicine_id = medicines.id
      where medicine_barcodes.barcode = '8964000900001'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Phase Six Tablet Renamed');
  });
});
