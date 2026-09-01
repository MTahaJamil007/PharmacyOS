import { createHash } from 'node:crypto';

import { parseEnvironment } from '@pharmacy/config';
import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DurableWorker } from '../../apps/worker/src/worker.js';
import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const ACCESS_TOKEN = 'phase4-owner-day-token';
const AUTHORIZATION = { authorization: `Bearer ${ACCESS_TOKEN}` };

function body(response: { readonly body: string }): Record<string, unknown> {
  const value: unknown = JSON.parse(response.body);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object response');
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`Expected ${key}`);
  return value;
}

describe('Phase 4 owner-day exit scenario', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let branchId: string;
  let terminalId: string;
  let cashSessionId: string;
  let medicineId: string;
  let batchId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase4_owner_day');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P4', 'Phase 4 Pharmacy') returning id::text
    `;
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('phase4-owner', 'Phase 4 Owner', 'token-auth-only') returning id::text
    `;
    const [role] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('OWNER', 'Owner') returning id::text
    `;
    if (!branch || !user || !role) throw new Error('Phase 4 identity fixture failed');
    branchId = branch.id;
    await database.admin`
      insert into operational_intelligence_policies (branch_id) values (${branchId})
    `;
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branchId}, 'P4-COUNTER', 'Phase 4 Counter', 'CASHIER') returning id::text
    `;
    if (!terminal) throw new Error('Phase 4 terminal fixture failed');
    terminalId = terminal.id;

    for (const code of Object.values(PERMISSIONS)) {
      await database.admin`
        insert into permissions (code, description) values (${code}, ${code})
        on conflict (code) do nothing
      `;
    }
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${role.id}, id from permissions
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${user.id}, ${branchId}, ${role.id})
    `;
    await database.admin`
      insert into sessions (
        user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
      ) values (
        ${user.id}, ${branchId}, ${terminalId},
        ${createHash('sha256').update(ACCESS_TOKEN).digest()},
        now() + interval '1 hour', now() + interval '12 hours'
      )
    `;
    const [medicine] = await database.admin<{ id: string }[]>`
      insert into medicines (name, pack_size, unit_name)
      values ('Phase 4 Medicine', 1, 'unit') returning id::text
    `;
    if (!medicine) throw new Error('Phase 4 transaction fixture failed');
    medicineId = medicine.id;
    const batch = await database.admin.begin(async (transaction) => {
      const [created] = await transaction<{ id: string }[]>`
        insert into inventory_batches (
          branch_id, medicine_id, batch_number, expiry_date,
          cost_price, sale_price, maximum_retail_price, current_qty, status
        ) values (
          ${branchId}, ${medicineId}, 'P4-BATCH', current_date + 365,
          60, 100, 120, 5, 'SELLABLE'
        ) returning id::text
      `;
      if (!created) throw new Error('Phase 4 batch fixture failed');
      await transaction`
        insert into stock_movements (
          branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
        ) values (${branchId}, ${created.id}, 'ADJUSTMENT_IN', 5, 5, 'Phase 4 fixture')
      `;
      return created;
    });
    batchId = batch.id;
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    await api.close();
    await database.dispose();
  });

  it('runs credit sale, payment, discount, count, close, report, and dashboard without SQL', async () => {
    const openResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { clientRequestId: 'phase4-open-session', openingFloat: '1000.00' },
      url: '/api/v1/cash-sessions/open',
    });
    expect(openResponse.statusCode).toBe(201);
    cashSessionId = stringField(body(openResponse), 'id');

    const customerResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        creditLimit: '500.00',
        name: 'Regular Customer',
        openingBalance: '10.00',
        phone: '0300-1234567',
      },
      url: '/api/v1/customers',
    });
    expect(customerResponse.statusCode).toBe(201);
    const customerId = stringField(body(customerResponse), 'id');

    const draftResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { items: [{ medicineId, quantity: '1' }], terminalId },
      url: '/api/v1/pos/drafts',
    });
    expect(draftResponse.statusCode).toBe(201);
    const draftId = stringField(body(draftResponse), 'id');

    const discountResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase4-discount-request',
        invoiceDiscount: '10.00',
        lineDiscounts: [],
        reason: 'Owner loyalty discount',
      },
      url: `/api/v1/pos/drafts/${draftId}/discount`,
    });
    expect(discountResponse.statusCode).toBe(201);
    expect(body(discountResponse)).toMatchObject({ approvalLevel: 'OVERRIDE', total: '90.00' });

    const reserveResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      url: `/api/v1/pos/drafts/${draftId}/reserve`,
    });
    expect(reserveResponse.statusCode).toBe(201);
    expect(body(reserveResponse).total).toBe('90.00');

    const saleResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        cashSessionId,
        clientRequestId: 'phase4-credit-sale',
        customerId,
        draftId,
        payments: [{ amount: '90.00', method: 'CREDIT' }],
      },
      url: '/api/v1/pos/sales/finalize',
    });
    expect(saleResponse.statusCode).toBe(201);
    expect(body(saleResponse)).toMatchObject({ customerBalance: '100.00', total: '90.00' });

    const paymentResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        amount: '40.00',
        cashSessionId,
        clientRequestId: 'phase4-account-payment',
        method: 'CASH',
      },
      url: `/api/v1/customers/${customerId}/payments`,
    });
    expect(paymentResponse.statusCode).toBe(201);
    expect(body(paymentResponse)).toMatchObject({ balance: '60.00', idempotentReplay: false });

    const replayResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        amount: '40.00',
        cashSessionId,
        clientRequestId: 'phase4-account-payment',
        method: 'CASH',
      },
      url: `/api/v1/customers/${customerId}/payments`,
    });
    expect(body(replayResponse)).toMatchObject({ balance: '60.00', idempotentReplay: true });

    const adjustmentResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase4-cycle-count',
        countedQuantity: '3',
        reason: 'Monthly cycle count',
        type: 'COUNT',
      },
      url: `/api/v1/inventory/batches/${batchId}/adjustments`,
    });
    expect(adjustmentResponse.statusCode).toBe(201);
    expect(body(adjustmentResponse)).toMatchObject({ quantityAfter: '3.000' });

    const priceResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase4-price-change',
        maximumRetailPrice: '120.00',
        reason: 'Approved retail price update',
        salePrice: '110.00',
      },
      url: `/api/v1/inventory/batches/${batchId}/price`,
    });
    expect(priceResponse.statusCode).toBe(201);

    const closeResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase4-close-session',
        closingNotes: 'Phase 4 owner-day close',
        countedCash: '1040.00',
      },
      url: `/api/v1/cash-sessions/${cashSessionId}/close`,
    });
    expect(closeResponse.statusCode).toBe(201);
    expect(body(closeResponse)).toMatchObject({
      accountPayments: '40.00',
      expectedCash: '1040.00',
      status: 'CLOSED',
      variance: '0.00',
    });

    const statementResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: `/api/v1/customers/${customerId}/statement`,
    });
    expect(statementResponse.statusCode).toBe(200);
    const statement = body(statementResponse);
    expect(statement.customer).toEqual(expect.objectContaining({ balance: '60.00' }));
    expect(statement.entries).toHaveLength(3);

    const salesReport = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/reports/sales',
    });
    expect(salesReport.statusCode).toBe(200);
    expect(body(salesReport).facts).toEqual(
      expect.objectContaining({ gross_sales: '90.00', invoice_count: '1' }),
    );

    await database.application`
      insert into outbox_jobs (job_type, deduplication_key, payload)
      values (
        'REFRESH_DASHBOARD_METRICS', 'phase4-dashboard-refresh',
        ${database.application.json({ branchId, runKey: 'phase4-exit' })}
      )
    `;
    const environment = parseEnvironment({
      AI_ENABLED: 'false',
      DATABASE_URL: database.applicationUrl,
      FBR_MODE: 'DISABLED',
      NODE_ENV: 'test',
      SESSION_SECRET: 'phase4-worker-session-secret-at-least-32-bytes',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      WORKER_HEALTH_FILE: 'phase4-test-worker-health.json',
      WORKER_ID: 'phase4-integration-worker',
    });
    expect(await new DurableWorker(database.application, environment).processNext()).toBe(true);

    const dashboardResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/dashboard/owner',
    });
    expect(dashboardResponse.statusCode).toBe(200);
    const dashboard = body(dashboardResponse);
    expect(dashboard.status).toBe('READY');
    expect(dashboard.data).toEqual(
      expect.objectContaining({ invoiceCount: '1', netSales: '90.00' }),
    );

    const [evidence] = await database.admin<Array<Record<string, string>>>`
      select
        (select count(*) from discount_approvals)::text as discount_approvals,
        (select count(*) from customer_ledger_entries)::text as customer_entries,
        (select count(*) from stock_adjustments)::text as stock_adjustments,
        (select count(*) from inventory_batch_price_history
          where change_type = 'MANUAL')::text as price_changes,
        (select count(*) from dashboard_daily_metrics)::text as dashboard_rows
    `;
    expect(evidence).toEqual({
      customer_entries: '3',
      dashboard_rows: '1',
      discount_approvals: '1',
      price_changes: '1',
      stock_adjustments: '1',
    });
  });

  it('operates the remaining day-two administration resources through the API', async () => {
    const userResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        displayName: 'Relief Pharmacist',
        password: 'Phase4-Initial-Password!',
        roles: ['OWNER'],
        username: 'phase4-relief',
      },
      url: '/api/v1/admin/users',
    });
    expect(userResponse.statusCode, userResponse.body).toBe(201);
    const userId = stringField(body(userResponse), 'id');

    const passwordResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { password: 'Phase4-Replaced-Password!' },
      url: `/api/v1/admin/users/${userId}/password`,
    });
    expect(passwordResponse.statusCode).toBe(201);
    expect(body(passwordResponse)).toMatchObject({ sessionsRevoked: true });

    const medicineResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        barcode: '8964000000001',
        name: 'Day Two Medicine',
        packSize: '10',
        sku: 'DAY-2-MED',
        unitName: 'tablet',
      },
      url: '/api/v1/admin/medicines',
    });
    expect(medicineResponse.statusCode).toBe(201);
    const administeredMedicineId = stringField(body(medicineResponse), 'id');

    const supplierResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { code: 'DAY-2-SUP', leadTimeDays: 2, name: 'Day Two Supplier' },
      url: '/api/v1/admin/suppliers',
    });
    expect(supplierResponse.statusCode).toBe(201);

    const shelfResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { code: 'DAY-2-A1', name: 'Day Two Shelf' },
      url: '/api/v1/admin/shelves',
    });
    expect(shelfResponse.statusCode).toBe(201);
    const shelfId = stringField(body(shelfResponse), 'id');
    const assignmentResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { isPrimary: true, medicineId: administeredMedicineId },
      url: `/api/v1/admin/shelves/${shelfId}/assign`,
    });
    expect(assignmentResponse.statusCode).toBe(201);

    const terminalResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { code: 'DAY-2-ADMIN', name: 'Day Two Admin', terminalType: 'ADMIN' },
      url: '/api/v1/admin/terminals',
    });
    expect(terminalResponse.statusCode).toBe(201);

    const policyResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'PATCH',
      payload: { basicDiscountLimitPercent: '4.00', cashVarianceApprovalThreshold: '75.00' },
      url: '/api/v1/admin/policies',
    });
    expect(policyResponse.statusCode).toBe(200);
    expect(body(policyResponse)).toMatchObject({ updated: true });
    const policiesResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/admin/policies',
    });
    expect(policiesResponse.statusCode).toBe(200);
    expect(body(policiesResponse)).toMatchObject({
      basicDiscountLimitPercent: '4.00',
      cashVarianceApprovalThreshold: '75.00',
    });

    const [evidence] = await database.admin<Array<Record<string, string>>>`
      select
        (select count(*) from users where username = 'phase4-relief')::text as users,
        (select count(*) from suppliers where code = 'DAY-2-SUP')::text as suppliers,
        (select count(*) from shelves where code = 'DAY-2-A1')::text as shelves,
        (select count(*) from terminals where code = 'DAY-2-ADMIN')::text as terminals,
        (select count(*) from medicine_shelf_locations
          where medicine_id = ${administeredMedicineId})::text as shelf_assignments
    `;
    expect(evidence).toEqual({
      shelf_assignments: '1',
      shelves: '1',
      suppliers: '1',
      terminals: '1',
      users: '1',
    });
  });
});
