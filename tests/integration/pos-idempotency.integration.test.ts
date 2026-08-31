import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { runConcurrently } from './harness/concurrency.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const ACCESS_TOKEN = 'phase-2-pos-idempotency-token';
const AUTHORIZATION = { authorization: `Bearer ${ACCESS_TOKEN}` };

interface PosFixture {
  readonly branchId: string;
  readonly cashSessionId: string;
  readonly medicineId: string;
  readonly terminalId: string;
}

function recordBody(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Expected an object response body');
  }
  return parsed as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`Expected ${key} to be a string`);
  return value;
}

async function seedPosFixture(database: IsolatedDatabase): Promise<PosFixture> {
  const [branch] = await database.admin<{ id: string }[]>`
    insert into branches (code, name) values ('IDEMP', 'Idempotency Branch') returning id::text
  `;
  const [user] = await database.admin<{ id: string }[]>`
    insert into users (username, display_name, password_hash)
    values ('phase2cashier', 'Phase 2 Cashier', 'not-used-by-token-auth') returning id::text
  `;
  const [role] = await database.admin<{ id: string }[]>`
    insert into roles (code, name) values ('PHASE2_CASHIER', 'Phase 2 Cashier') returning id::text
  `;
  if (!branch || !user || !role) throw new Error('Failed to create POS identity fixtures');

  const [terminal] = await database.admin<{ id: string }[]>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branch.id}, 'COUNTER-01', 'Counter 01', 'SALES_COUNTER') returning id::text
  `;
  if (!terminal) throw new Error('Failed to create terminal fixture');

  for (const permissionCode of [
    PERMISSIONS.POS_CREATE_DRAFT,
    PERMISSIONS.POS_SEND_TO_CASHIER,
    PERMISSIONS.SALE_FINALIZE_PAYMENT,
  ]) {
    const [permission] = await database.admin<{ id: string }[]>`
      insert into permissions (code, description)
      values (${permissionCode}, ${`Integration permission ${permissionCode}`}) returning id::text
    `;
    if (!permission) throw new Error('Failed to create permission fixture');
    await database.admin`
      insert into role_permissions (role_id, permission_id) values (${role.id}, ${permission.id})
    `;
  }
  await database.admin`
    insert into user_branch_roles (user_id, branch_id, role_id)
    values (${user.id}, ${branch.id}, ${role.id})
  `;
  await database.admin`
    insert into sessions (user_id, branch_id, terminal_id, token_hash, expires_at)
    values (
      ${user.id}, ${branch.id}, ${terminal.id},
      ${createHash('sha256').update(ACCESS_TOKEN).digest()}, now() + interval '1 hour'
    )
  `;
  const [cashSession] = await database.admin<{ id: string }[]>`
    insert into cash_sessions (branch_id, terminal_id, cashier_user_id, opening_float)
    values (${branch.id}, ${terminal.id}, ${user.id}, 1000) returning id::text
  `;
  const [medicine] = await database.admin<{ id: string }[]>`
    insert into medicines (name, pack_size, unit_name)
    values ('Concurrency Medicine', 1, 'unit') returning id::text
  `;
  if (!cashSession || !medicine) throw new Error('Failed to create POS transaction fixtures');

  await database.admin.begin(async (transaction) => {
    const [batch] = await transaction<{ id: string }[]>`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status
      ) values (
        ${branch.id}, ${medicine.id}, 'IDEMP-BATCH', current_date + 365,
        50, 100, 5, 'SELLABLE'
      ) returning id::text
    `;
    if (!batch) throw new Error('Failed to create inventory batch fixture');
    await transaction`
      insert into stock_movements (
        branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
      ) values (${branch.id}, ${batch.id}, 'ADJUSTMENT_IN', 5, 5, 'Integration fixture')
    `;
  });

  return {
    branchId: branch.id,
    cashSessionId: cashSession.id,
    medicineId: medicine.id,
    terminalId: terminal.id,
  };
}

describe('POS endpoint idempotency', () => {
  let database: IsolatedDatabase;
  let api: IntegrationApi;
  let fixture: PosFixture;

  beforeAll(async () => {
    database = await createIsolatedDatabase('pos_idempotency');
    fixture = await seedPosFixture(database);
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    await api.close();
    await database.dispose();
  });

  it('commits one sale and consumes one invoice number for simultaneous retries', async () => {
    const draftResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        items: [{ medicineId: fixture.medicineId, quantity: '1' }],
        terminalId: fixture.terminalId,
      },
      url: '/api/v1/pos/drafts',
    });
    expect(draftResponse.statusCode).toBe(201);
    const draftId = requiredString(recordBody(draftResponse.body), 'id');

    const reserveResponse = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      url: `/api/v1/pos/drafts/${draftId}/reserve`,
    });
    expect(reserveResponse.statusCode).toBe(201);

    const clientRequestId = 'phase2-same-sale-request';
    const results = await runConcurrently(8, async () => {
      const response = await api.app.inject({
        headers: AUTHORIZATION,
        method: 'POST',
        payload: {
          cashSessionId: fixture.cashSessionId,
          clientRequestId,
          draftId,
          payments: [{ amount: '100.00', method: 'CASH' }],
        },
        url: '/api/v1/pos/sales/finalize',
      });
      return { body: recordBody(response.body), statusCode: response.statusCode };
    });

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const responses = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(responses.map((response) => response.statusCode)).toEqual(Array(8).fill(201));
    expect(responses.filter((response) => response.body.idempotentReplay === false)).toHaveLength(
      1,
    );
    expect(responses.filter((response) => response.body.idempotentReplay === true)).toHaveLength(7);
    expect(new Set(responses.map((response) => response.body.id))).toHaveProperty('size', 1);

    const [evidence] = await database.admin<
      Array<{
        invoice_count: string;
        invoice_number: string;
        last_value: string;
        sale_count: string;
      }>
    >`
      select
        (select count(*) from fbr_invoices)::text as invoice_count,
        (select invoice_number from sales limit 1) as invoice_number,
        (select last_value from invoice_counters limit 1)::text as last_value,
        (select count(*) from sales)::text as sale_count
    `;
    expect(evidence).toMatchObject({ invoice_count: '1', last_value: '1', sale_count: '1' });
    expect(evidence?.invoice_number).toMatch(/-000001$/);
  });

  it('allows exactly one terminal to reserve the last unit', async () => {
    const [medicine] = await database.admin<{ id: string }[]>`
      insert into medicines (name, pack_size, unit_name)
      values ('Last Unit Medicine', 1, 'unit') returning id::text
    `;
    if (!medicine) throw new Error('Failed to create last-unit medicine');
    const batch = await database.admin.begin(async (transaction) => {
      const [createdBatch] = await transaction<{ id: string }[]>`
        insert into inventory_batches (
          branch_id, medicine_id, batch_number, expiry_date,
          cost_price, sale_price, current_qty, status
        ) values (
          ${fixture.branchId}, ${medicine.id}, 'LAST-UNIT', current_date + 365,
          25, 40, 1, 'SELLABLE'
        ) returning id::text
      `;
      if (!createdBatch) throw new Error('Failed to create last-unit batch');
      await transaction`
        insert into stock_movements (
          branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
        ) values (
          ${fixture.branchId}, ${createdBatch.id}, 'ADJUSTMENT_IN', 1, 1,
          'Integration fixture'
        )
      `;
      return createdBatch;
    });

    const draftIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const response = await api.app.inject({
        headers: AUTHORIZATION,
        method: 'POST',
        payload: {
          items: [{ medicineId: medicine.id, quantity: '1' }],
          terminalId: fixture.terminalId,
        },
        url: '/api/v1/pos/drafts',
      });
      expect(response.statusCode).toBe(201);
      draftIds.push(requiredString(recordBody(response.body), 'id'));
    }

    const results = await runConcurrently(8, async (clientIndex) => {
      const draftId = draftIds[clientIndex];
      if (draftId === undefined) throw new Error('Missing draft fixture');
      const response = await api.app.inject({
        headers: AUTHORIZATION,
        method: 'POST',
        url: `/api/v1/pos/drafts/${draftId}/reserve`,
      });
      return response.statusCode;
    });
    const statuses = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const [evidence] = await database.admin<
      Array<{ active_quantity: string; current_qty: string }>
    >`
      select batches.current_qty::text,
        coalesce(sum(reservations.quantity) filter (
          where reservations.status = 'ACTIVE' and reservations.expires_at > now()
        ), 0)::text as active_quantity
      from inventory_batches batches
      left join stock_reservations reservations on reservations.inventory_batch_id = batches.id
      where batches.id = ${batch.id}
      group by batches.id
    `;

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect(evidence).toEqual({ active_quantity: '1.000', current_qty: '1.000' });
  });
});
