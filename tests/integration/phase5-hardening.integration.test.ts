import { createHash } from 'node:crypto';

import { parseEnvironment } from '@pharmacy/config';
import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DurableWorker } from '../../apps/worker/src/worker.js';
import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const ACCESS_TOKEN = 'phase5-hardening-token';
const AUTHORIZATION = { authorization: `Bearer ${ACCESS_TOKEN}` };

function recordBody(response: { readonly body: string }): Record<string, unknown> {
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

describe('Phase 5 fiscal and operational hardening', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let branchId: string;
  let cashSessionId: string;
  let medicineId: string;
  let roleId: string;
  let supplierId: string;
  let terminalId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase5_hardening');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (
        code, name, address, seller_ntn_cnic, seller_strn,
        fbr_pos_registration_number, fbr_business_name, fbr_province, fbr_scenario_id
      ) values (
        'P5', 'Phase 5 Pharmacy', 'Phase 5 Test Address', '1234567', '1234567-8',
        'POS-P5', 'Phase 5 Pharmacy', 'Punjab', 'SN001'
      ) returning id::text
    `;
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('phase5-owner', 'Phase 5 Owner', 'token-auth-only') returning id::text
    `;
    const [role] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('PHASE5_OWNER', 'Phase 5 Owner') returning id::text
    `;
    if (!branch || !user || !role) throw new Error('Phase 5 identity fixture failed');
    branchId = branch.id;
    roleId = role.id;
    await database.admin`
      insert into operational_intelligence_policies (
        branch_id, cash_variance_approval_threshold
      ) values (${branchId}, 0.01)
    `;
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branchId}, 'P5-COUNTER', 'Phase 5 Counter', 'CASHIER') returning id::text
    `;
    if (!terminal) throw new Error('Phase 5 terminal fixture failed');
    terminalId = terminal.id;

    for (const code of Object.values(PERMISSIONS)) {
      await database.admin`
        insert into permissions (code, description) values (${code}, ${code})
        on conflict (code) do nothing
      `;
    }
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${roleId}, id from permissions
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${user.id}, ${branchId}, ${roleId})
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
      insert into medicines (
        name, pack_size, unit_name, hs_code, tax_rate, fbr_uom, fbr_sale_type
      ) values (
        'Tax Inclusive Medicine', 1, 'unit', '3004.9000', 18,
        'Numbers, pieces, units', 'Goods at standard rate (default)'
      ) returning id::text
    `;
    const [supplier] = await database.admin<{ id: string }[]>`
      insert into suppliers (branch_id, code, name)
      values (${branchId}, 'P5-SUP', 'Phase 5 Supplier') returning id::text
    `;
    if (!medicine || !supplier) throw new Error('Phase 5 catalog fixture failed');
    medicineId = medicine.id;
    supplierId = supplier.id;
    await database.admin.begin(async (transaction) => {
      const [batch] = await transaction<{ id: string }[]>`
        insert into inventory_batches (
          branch_id, medicine_id, batch_number, expiry_date,
          cost_price, sale_price, maximum_retail_price, current_qty, status
        ) values (
          ${branchId}, ${medicineId}, 'P5-TAX-BATCH', current_date + 365,
          90, 118, 118, 5, 'SELLABLE'
        ) returning id::text
      `;
      if (!batch) throw new Error('Phase 5 batch fixture failed');
      await transaction`
        insert into stock_movements (
          branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
        ) values (${branchId}, ${batch.id}, 'ADJUSTMENT_IN', 5, 5, 'Phase 5 fixture')
      `;
    });
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  it('persists exact inclusive tax and exposes actionable operational alerts', async () => {
    const openResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { clientRequestId: 'phase5-open', openingFloat: '100.00' },
      url: '/api/v1/cash-sessions/open',
    });
    expect(openResponse.statusCode, openResponse.body).toBe(201);
    cashSessionId = stringField(recordBody(openResponse), 'id');

    const draftResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { items: [{ medicineId, quantity: '1' }], terminalId },
      url: '/api/v1/pos/drafts',
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draftId = stringField(recordBody(draftResponse), 'id');
    const reserveResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      url: `/api/v1/pos/drafts/${draftId}/reserve`,
    });
    expect(reserveResponse.statusCode, reserveResponse.body).toBe(201);
    const finalizeResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        cashSessionId,
        clientRequestId: 'phase5-tax-sale',
        draftId,
        payments: [{ amount: '118.00', method: 'CASH' }],
      },
      url: '/api/v1/pos/sales/finalize',
    });
    expect(finalizeResponse.statusCode, finalizeResponse.body).toBe(201);

    const [fiscalEvidence] = await database.admin<
      Array<{
        fbr_id: string;
        hs_code: string;
        item_tax: string;
        payload: Record<string, unknown>;
        sale_tax: string;
      }>
    >`
      select fbr_invoices.id::text as fbr_id, fbr_invoices.payload,
        sales.tax_total::text as sale_tax, sale_items.tax_amount::text as item_tax,
        sale_items.hs_code
      from sales join sale_items on sale_items.sale_id = sales.id
      join fbr_invoices on fbr_invoices.sale_id = sales.id
      where sales.client_request_id = 'phase5-tax-sale'
    `;
    expect(fiscalEvidence).toMatchObject({
      hs_code: '3004.9000',
      item_tax: '18.00',
      sale_tax: '18.00',
    });
    if (!fiscalEvidence) throw new Error('Fiscal evidence was not persisted');
    const payloadItems = fiscalEvidence?.payload.items;
    expect(Array.isArray(payloadItems) ? payloadItems[0] : null).toMatchObject({
      hsCode: '3004.9000',
      salesTaxApplicable: '18.00',
      totalValues: '118.00',
      valueSalesExcludingST: '100.00',
    });

    await database.admin`
      update fbr_invoices set status = 'FAILED_RETRYABLE',
        last_error_code = 'P5-FISCAL', last_error_message = 'Synthetic integration failure'
      where id = ${fiscalEvidence.fbr_id}
    `;
    const [job] = await database.admin<{ id: string }[]>`
      insert into outbox_jobs (job_type, deduplication_key, payload)
      values (
        'PHASE5_TEST', 'phase5-failed-job',
        ${database.admin.json({ branchId, source: 'integration-test' })}
      ) returning id::text
    `;
    if (!job) throw new Error('Failed-job fixture was not created');
    await database.admin`
      update outbox_jobs set status = 'FAILED', last_error = 'Synthetic integration failure'
      where id = ${job.id}
    `;
    const [backup] = await database.admin<{ id: string }[]>`
      insert into backup_runs (branch_id, backup_type, status, destination, encrypted)
      values (${branchId}, 'RESTORE_DRILL', 'RUNNING', 'phase5-test-disk', true)
      returning id::text
    `;
    if (!backup) throw new Error('Backup-run fixture was not created');
    await database.admin`
      update backup_runs set status = 'FAILED', finished_at = now(),
        error_message = 'Synthetic integration failure' where id = ${backup.id}
    `;
    const closeResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase5-close-with-variance',
        closingNotes: 'Phase 5 alert evidence',
        countedCash: '0.00',
      },
      url: `/api/v1/cash-sessions/${cashSessionId}/close`,
    });
    expect(closeResponse.statusCode, closeResponse.body).toBe(201);
    expect(recordBody(closeResponse).status).toBe('CLOSING');

    const alertsResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/operations/alerts?status=OPEN&limit=20',
    });
    expect(alertsResponse.statusCode, alertsResponse.body).toBe(200);
    const alertsBody = recordBody(alertsResponse);
    const alertsValue = alertsBody.alerts;
    if (!Array.isArray(alertsValue)) throw new TypeError('Expected alerts array');
    const alerts: readonly unknown[] = alertsValue;
    expect(
      new Set(
        alerts.map((alert) =>
          typeof alert === 'object' && alert !== null
            ? (alert as Record<string, unknown>).alertType
            : null,
        ),
      ),
    ).toEqual(
      new Set([
        'BACKUP_RESTORE_FAILURE',
        'CASH_VARIANCE',
        'FAILED_FISCAL_SUBMISSION',
        'FAILED_JOB',
      ]),
    );

    const firstAlert = alerts[0];
    if (typeof firstAlert !== 'object' || firstAlert === null) {
      throw new TypeError('Expected alert record');
    }
    const acknowledgeResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      url: `/api/v1/operations/alerts/${stringField(firstAlert as Record<string, unknown>, 'id')}/acknowledge`,
    });
    expect(acknowledgeResponse.statusCode, acknowledgeResponse.body).toBe(201);
    expect(recordBody(acknowledgeResponse).status).toBe('ACKNOWLEDGED');

    const metricsResponse = await api.app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(metricsResponse.statusCode, metricsResponse.body).toBe(200);
    for (const alertType of [
      'BACKUP_RESTORE_FAILURE',
      'CASH_VARIANCE',
      'FAILED_FISCAL_SUBMISSION',
      'FAILED_JOB',
    ]) {
      expect(metricsResponse.body).toContain(`pharmacy_operational_alerts{type="${alertType}"} 1`);
    }
  });

  it('receives a multi-line purchase order with one set-based stock operation', async () => {
    const medicines = await database.admin<{ id: string }[]>`
      insert into medicines (name, pack_size, unit_name)
      select 'Phase 5 Intake ' || sequence, 1, 'unit' from generate_series(1, 24) sequence
      returning id::text
    `;
    const medicineIds = [medicineId, ...medicines.map((medicine) => medicine.id)];
    const createResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase5-create-po',
        items: medicineIds.map((id) => ({
          baseUnitsPerOrderUnit: '1',
          bonusQuantity: '0',
          lineDiscount: '0.00',
          medicineId: id,
          orderedQuantity: '2',
          unitCost: '10.00',
        })),
        supplierId,
      },
      url: '/api/v1/purchase-orders',
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = recordBody(createResponse);
    const purchaseOrderId = stringField(created, 'id');
    const createdItems = created.items;
    if (!Array.isArray(createdItems)) throw new TypeError('Expected purchase-order items');

    const orderResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: { clientRequestId: 'phase5-order-po' },
      url: `/api/v1/purchase-orders/${purchaseOrderId}/order`,
    });
    expect(orderResponse.statusCode, orderResponse.body).toBe(201);
    const receiveResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        clientRequestId: 'phase5-receive-po',
        lines: createdItems.map((item, index) => {
          if (typeof item !== 'object' || item === null) throw new TypeError('Expected PO item');
          return {
            batchNumber: `P5-IN-${String(index + 1).padStart(2, '0')}`,
            expiryDate: '2035-12-31',
            purchaseOrderItemId: stringField(item as Record<string, unknown>, 'id'),
            receivedBonusQuantity: '0',
            receivedQuantity: '2',
            salePricePerBaseUnit: '15.00',
          };
        }),
      },
      url: `/api/v1/purchase-orders/${purchaseOrderId}/receive`,
    });
    expect(receiveResponse.statusCode, receiveResponse.body).toBe(201);
    expect(recordBody(receiveResponse).status).toBe('RECEIVED');

    const [evidence] = await database.admin<
      Array<{ batches: string; movements: string; receipt_items: string }>
    >`
      select
        (select count(*) from goods_receipt_items items
          join goods_receipts receipts on receipts.id = items.goods_receipt_id
          where receipts.purchase_order_id = ${purchaseOrderId})::text as receipt_items,
        (select count(*) from inventory_batches
          where purchase_order_item_id in (
            select id from purchase_order_items where purchase_order_id = ${purchaseOrderId}
          ))::text as batches,
        (select count(*) from stock_movements
          where purchase_order_item_id in (
            select id from purchase_order_items where purchase_order_id = ${purchaseOrderId}
          ) and movement_type = 'PURCHASE_RECEIPT')::text as movements
    `;
    expect(evidence).toEqual({ batches: '25', movements: '25', receipt_items: '25' });
  });

  it('records an auditable review state without fabricating sandbox submission', async () => {
    const [invoice] = await database.admin<{ id: string }[]>`
      update fbr_invoices set mode = 'SANDBOX', status = 'PENDING',
        fiscal_invoice_number = null, submitted_at = null
      where sale_id = (select id from sales where client_request_id = 'phase5-tax-sale')
      returning id::text
    `;
    if (!invoice) throw new Error('Fiscal worker fixture was not found');
    await database.admin`
      insert into outbox_jobs (job_type, deduplication_key, payload)
      values (
        'FBR_SUBMIT', 'phase5-blocked-fiscal',
        ${database.admin.json({ branchId, fbrInvoiceId: invoice.id })}
      )
    `;
    const environment = parseEnvironment({
      AI_ENABLED: 'false',
      DATABASE_URL: database.applicationUrl,
      FBR_API_TOKEN: 'phase5-not-transmitted-test-token',
      FBR_MODE: 'SANDBOX',
      NODE_ENV: 'test',
      SESSION_SECRET: 'phase5-worker-session-secret-at-least-32-bytes',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      WORKER_HEALTH_FILE: 'phase5-test-worker-health.json',
      WORKER_ID: 'phase5-integration-worker',
    });
    expect(await new DurableWorker(database.application, environment).processNext()).toBe(true);
    const [evidence] = await database.admin<
      Array<{
        attempt_count: string;
        error_code: string;
        fiscal_invoice_number: string | null;
        operation: string;
        status: string;
      }>
    >`
      select fbr_invoices.status, fbr_invoices.fiscal_invoice_number,
        fbr_invoices.last_error_code as error_code,
        count(attempts.id)::text as attempt_count, max(attempts.operation) as operation
      from fbr_invoices
      left join fbr_invoice_attempts attempts on attempts.fbr_invoice_id = fbr_invoices.id
      where fbr_invoices.id = ${invoice.id}
      group by fbr_invoices.id
    `;
    expect(evidence).toEqual({
      attempt_count: '1',
      error_code: 'FBR_OUTBOUND_APPROVAL_REQUIRED',
      fiscal_invoice_number: null,
      operation: 'SUBMIT',
      status: 'FAILED_NEEDS_REVIEW',
    });
  });

  it('revokes existing sessions when a role permission changes', async () => {
    await database.admin`
      delete from role_permissions where role_id = ${roleId}
        and permission_id = (
          select id from permissions where code = ${PERMISSIONS.SETTINGS_MANAGE_SYSTEM}
        )
    `;
    const response = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/admin/fiscal-settings',
    });
    expect(response.statusCode).toBe(401);
    const [session] = await database.admin<{ revoke_reason: string }[]>`
      select revoke_reason from sessions
      where token_hash = ${createHash('sha256').update(ACCESS_TOKEN).digest()}
    `;
    expect(session?.revoke_reason).toBe('ROLE_PERMISSION_CHANGED');
  });
});
