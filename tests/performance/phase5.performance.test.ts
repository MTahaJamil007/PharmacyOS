import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from '../integration/harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from '../integration/harness/database.js';

const ACCESS_TOKEN = 'phase5-performance-token';
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

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1);
  const result = ordered[index];
  if (result === undefined) throw new Error('Performance sample set was empty');
  return result;
}

async function sample(milliseconds: number[], operation: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await operation();
  milliseconds.push(performance.now() - started);
}

describe('Phase 5 representative-volume performance', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let branchId: string;
  let cashSessionId: string;
  let hotMedicineId: string;
  let terminalId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase5_performance');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P5-PERF', 'Phase 5 Performance')
      returning id::text
    `;
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('phase5-perf', 'Phase 5 Performance', 'token-auth-only') returning id::text
    `;
    const [role] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('P5_PERF', 'Phase 5 Performance')
      returning id::text
    `;
    if (!branch || !user || !role) throw new Error('Performance identity fixture failed');
    branchId = branch.id;
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branchId}, 'P5-PERF', 'Performance Counter', 'CASHIER') returning id::text
    `;
    if (!terminal) throw new Error('Performance terminal fixture failed');
    terminalId = terminal.id;
    await database.admin`
      insert into operational_intelligence_policies (branch_id) values (${branchId})
    `;
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
    await database.admin`
      insert into medicines (sku, name, generic_name, pack_size, unit_name, hs_code, tax_rate)
      select 'PERF-' || lpad(sequence::text, 5, '0'),
        'Perf Medicine ' || lpad(sequence::text, 5, '0'),
        'Generic ' || lpad((sequence % 500)::text, 3, '0'), 1, 'unit', '3004.9000', 18
      from generate_series(1, 10000) sequence
    `;
    await database.admin`
      insert into medicine_barcodes (medicine_id, barcode, is_primary)
      select id, '99000000' || lpad(row_number() over (order by id)::text, 5, '0'), true
      from medicines
    `;
    const [hotMedicine] = await database.admin<{ id: string }[]>`
      select id::text from medicines where sku = 'PERF-05000'
    `;
    if (!hotMedicine) throw new Error('Performance medicine fixture failed');
    hotMedicineId = hotMedicine.id;

    // Zero-quantity historical rows reconcile to an empty ledger. Disabling the deferred
    // row trigger only avoids 200,000 redundant fixture-validation queries in this isolated DB.
    await database.admin`alter table inventory_batches disable trigger inventory_batches_ledger_balance`;
    await database.admin`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status
      )
      select ${branchId}, medicines.id,
        'PERF-' || medicines.id::text || '-' || batch_sequence::text,
        current_date + 365 + batch_sequence, 90, 118, 0, 'DEPLETED'
      from medicines cross join generate_series(1, 20) batch_sequence
    `;
    await database.admin`alter table inventory_batches enable trigger inventory_batches_ledger_balance`;
    await database.admin.begin(async (transaction) => {
      const [batch] = await transaction<{ id: string }[]>`
        insert into inventory_batches (
          branch_id, medicine_id, batch_number, expiry_date,
          cost_price, sale_price, current_qty, status
        ) values (
          ${branchId}, ${hotMedicineId}, 'PERF-HOT', current_date + 180,
          90, 118, 15, 'SELLABLE'
        ) returning id::text
      `;
      if (!batch) throw new Error('Performance stock fixture failed');
      await transaction`
        insert into stock_movements (
          branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
        ) values (${branchId}, ${batch.id}, 'ADJUSTMENT_IN', 15, 15, 'Performance fixture')
      `;
    });
    await database.admin`
      insert into cash_sessions (
        branch_id, terminal_id, cashier_user_id, opening_float, status, open_client_request_id
      ) values (${branchId}, ${terminalId}, ${user.id}, 1000, 'OPEN', 'phase5-perf-open')
      returning id
    `;
    const [cashSession] = await database.admin<{ id: string }[]>`
      select id::text from cash_sessions where open_client_request_id = 'phase5-perf-open'
    `;
    if (!cashSession) throw new Error('Performance cash fixture failed');
    cashSessionId = cashSession.id;
    await database.admin`
      insert into dashboard_daily_metrics (
        branch_id, metric_date, net_sales, gross_profit_estimate,
        cash_collected, non_cash_collected, refunds, invoice_count, metrics
      ) values (
        ${branchId}, (now() at time zone 'Asia/Karachi')::date,
        1000, 200, 800, 200, 0, 10, '{}'::jsonb
      )
    `;
    await database.admin`analyze medicines`;
    await database.admin`analyze medicine_barcodes`;
    await database.admin`analyze inventory_batches`;
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  it('meets the documented p95 targets at 10k medicines and 200k historical batches', async () => {
    const searchSamples: number[] = [];
    const barcodeSamples: number[] = [];
    const dashboardSamples: number[] = [];
    const finalizeSamples: number[] = [];

    await api.app.inject({
      headers: AUTHORIZATION,
      method: 'GET',
      url: '/api/v1/catalog/medicines/search?query=Perf%20Medicine%20050&limit=20',
    });
    for (let index = 0; index < 25; index += 1) {
      await sample(searchSamples, async () => {
        const response = await api.app.inject({
          headers: AUTHORIZATION,
          method: 'GET',
          url: '/api/v1/catalog/medicines/search?query=Perf%20Medicine%20050&limit=20',
        });
        expect(response.statusCode).toBe(200);
      });
      await sample(barcodeSamples, async () => {
        const response = await api.app.inject({
          headers: AUTHORIZATION,
          method: 'GET',
          url: '/api/v1/catalog/medicines/search?query=9900000005000&limit=20',
        });
        expect(response.statusCode).toBe(200);
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await sample(dashboardSamples, async () => {
        const response = await api.app.inject({
          headers: AUTHORIZATION,
          method: 'GET',
          url: '/api/v1/dashboard/owner',
        });
        expect(response.statusCode).toBe(200);
      });
    }
    for (let index = 0; index < 12; index += 1) {
      const draftResponse = await api.app.inject({
        headers: AUTHORIZATION,
        method: 'POST',
        payload: { items: [{ medicineId: hotMedicineId, quantity: '1' }], terminalId },
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
      await sample(finalizeSamples, async () => {
        const response = await api.app.inject({
          headers: AUTHORIZATION,
          method: 'POST',
          payload: {
            cashSessionId,
            clientRequestId: `phase5-perf-sale-${index}`,
            draftId,
            payments: [{ amount: '118.00', method: 'CASH' }],
          },
          url: '/api/v1/pos/sales/finalize',
        });
        expect(response.statusCode, response.body).toBe(201);
      });
    }

    const result = {
      barcodeP95Ms: percentile95(barcodeSamples),
      dashboardP95Ms: percentile95(dashboardSamples),
      finalizeP95Ms: percentile95(finalizeSamples),
      searchP95Ms: percentile95(searchSamples),
    };
    process.stdout.write(`PHASE5_PERFORMANCE ${JSON.stringify(result)}\n`);
    expect(result.searchP95Ms).toBeLessThan(150);
    expect(result.barcodeP95Ms).toBeLessThan(80);
    expect(result.finalizeP95Ms).toBeLessThan(300);
    expect(result.dashboardP95Ms).toBeLessThan(2000);
  });
});
