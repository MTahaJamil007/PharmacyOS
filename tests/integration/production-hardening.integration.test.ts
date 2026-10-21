import { createHash } from 'node:crypto';

import { hash } from 'argon2';
import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import {
  createBranchFixture,
  createStockedMedicine,
  jsonBody,
  openCashSession,
  sellAtCounter,
  type BranchFixture,
} from './harness/fixtures.js';

describe('production hardening', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let owner: BranchFixture;

  beforeAll(async () => {
    database = await createIsolatedDatabase('production_hardening');
    owner = await createBranchFixture(database, 'hardening', { roleCode: 'OWNER' });
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  async function sessionFor(roleCode: string, permissions: readonly string[], label: string) {
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values (${label}, ${label}, 'token-auth-only') returning id::text
    `;
    const [role] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values (${roleCode}, ${roleCode})
      on conflict (code) do update set name = excluded.name returning id::text
    `;
    if (!user || !role) throw new Error('Session fixture failed');
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${role.id}, id from permissions where code in ${database.admin(permissions)}
      on conflict do nothing
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${user.id}, ${owner.branchId}, ${role.id})
    `;
    const token = `${label}-token`;
    await database.admin`
      insert into sessions (
        user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
      ) values (
        ${user.id}, ${owner.branchId}, ${owner.terminalId},
        ${createHash('sha256').update(token).digest()},
        now() + interval '1 hour', now() + interval '12 hours'
      )
    `;
    return { headers: { authorization: `Bearer ${token}` }, userId: user.id };
  }

  async function createSupplier(name: string): Promise<string> {
    const response = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { leadTimeDays: 2, name },
      url: '/api/v1/admin/suppliers',
    });
    expect(response.statusCode, response.body).toBe(201);
    return String(jsonBody(response).id);
  }

  async function orderedPurchase(supplierId: string, medicineId: string, requestId: string) {
    const created = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: {
        clientRequestId: requestId,
        items: [{ medicineId, orderedQuantity: '10', unitCost: '50.00' }],
        supplierId,
      },
      url: '/api/v1/purchase-orders',
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = jsonBody<{ id: string; items: Array<{ id: string }> }>(created);
    const ordered = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { clientRequestId: `${requestId}-order` },
      url: `/api/v1/purchase-orders/${order.id}/order`,
    });
    expect(ordered.statusCode, ordered.body).toBe(201);
    return { id: order.id, itemId: order.items[0]?.id ?? '' };
  }

  it('lets an inventory manager see suppliers to order from without system settings', async () => {
    await createSupplier('Hardening Distributor');
    const manager = await sessionFor(
      'HARDENING_INVENTORY',
      [PERMISSIONS.INVENTORY_PURCHASE, PERMISSIONS.POS_SEARCH],
      'hardening-inventory',
    );
    const response = await api.app.inject({
      headers: manager.headers,
      method: 'GET',
      url: '/api/v1/suppliers',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(jsonBody<{ data: Array<{ name: string }> }>(response).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Hardening Distributor' })]),
    );
  });

  it('receives goods with an initial price history and never revives a recalled lot', async () => {
    const supplierId = await createSupplier('Recall Supplier');
    const [medicine] = await database.admin<{ id: string }[]>`
      insert into medicines (name) values ('Recall Capsule') returning id::text
    `;
    if (!medicine) throw new Error('Medicine fixture failed');
    const order = await orderedPurchase(supplierId, medicine.id, 'hardening-recall-po');
    const receive = (requestId: string, quantity: string) =>
      api.app.inject({
        headers: owner.headers,
        method: 'POST',
        payload: {
          clientRequestId: requestId,
          lines: [
            {
              batchNumber: 'RC-1',
              expiryDate: '2030-01-31',
              maximumRetailPricePerBaseUnit: '80.00',
              purchaseOrderItemId: order.itemId,
              receivedQuantity: quantity,
              salePricePerBaseUnit: '75.00',
            },
          ],
        },
        url: `/api/v1/purchase-orders/${order.id}/receive`,
      });
    const first = await receive('hardening-recall-receive-1', '4');
    expect(first.statusCode, first.body).toBe(201);
    const [history] = await database.admin<{ change_type: string; new_sale_price: string }[]>`
      select change_type, new_sale_price::text from inventory_batch_price_history
      join inventory_batches on inventory_batches.id = inventory_batch_price_history.inventory_batch_id
      where inventory_batches.medicine_id = ${medicine.id}
    `;
    expect(history).toEqual({ change_type: 'INITIAL', new_sale_price: '75.00' });

    await database.admin`
      update inventory_batches set status = 'RECALLED' where medicine_id = ${medicine.id}
    `;
    const second = await receive('hardening-recall-receive-2', '6');
    expect(second.statusCode, second.body).toBe(201);
    const [batch] = await database.admin<{ status: string; current_qty: string }[]>`
      select status, current_qty::text from inventory_batches where medicine_id = ${medicine.id}
    `;
    expect(batch).toEqual({ current_qty: '10.000', status: 'RECALLED' });
  });

  it('cancels an ordered purchase that has received nothing, and only that', async () => {
    const supplierId = await createSupplier('Cancel Supplier');
    const [medicine] = await database.admin<{ id: string }[]>`
      insert into medicines (name) values ('Cancel Syrup') returning id::text
    `;
    if (!medicine) throw new Error('Medicine fixture failed');
    const order = await orderedPurchase(supplierId, medicine.id, 'hardening-cancel-po');
    const payload = { clientRequestId: 'hardening-cancel-1', reason: 'Supplier out of stock' };
    const cancel = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload,
      url: `/api/v1/purchase-orders/${order.id}/cancel`,
    });
    expect(cancel.statusCode, cancel.body).toBe(201);
    expect(jsonBody(cancel)).toMatchObject({
      cancel_reason: 'Supplier out of stock',
      status: 'CANCELLED',
    });
    const replay = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload,
      url: `/api/v1/purchase-orders/${order.id}/cancel`,
    });
    expect(jsonBody(replay)).toMatchObject({ idempotentReplay: true });
    const receiveCancelled = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: {
        clientRequestId: 'hardening-cancel-receive',
        lines: [
          {
            batchNumber: 'X',
            expiryDate: '2030-01-01',
            purchaseOrderItemId: order.itemId,
            receivedQuantity: '1',
            salePricePerBaseUnit: '1.00',
          },
        ],
      },
      url: `/api/v1/purchase-orders/${order.id}/receive`,
    });
    expect(receiveCancelled.statusCode).toBe(409);
  });

  it('loads opening stock once, validates without writing, and shows it in the stock overview', async () => {
    const created = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { barcode: '8960000000101', name: 'Opening Tablet', sku: 'OPEN-101', taxRate: '0' },
      url: '/api/v1/admin/medicines',
    });
    expect(created.statusCode, created.body).toBe(201);
    const rows = [
      {
        batchNumber: 'OP-1',
        costPrice: '8.00',
        expiryDate: '2031-06-30',
        quantity: '120',
        salePrice: '10.00',
        sku: 'OPEN-101',
      },
      {
        barcode: '8960000000101',
        batchNumber: 'OP-2',
        costPrice: '8.50',
        expiryDate: '2031-12-31',
        quantity: '30',
        salePrice: '10.00',
      },
      {
        batchNumber: 'BAD',
        costPrice: '1.00',
        expiryDate: '2031-01-01',
        quantity: '1',
        salePrice: '1.00',
        sku: 'NOPE',
      },
    ];
    const validation = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { clientRequestId: 'hardening-opening-validate', mode: 'VALIDATE', rows },
      url: '/api/v1/stock/opening-stock/import',
    });
    expect(validation.statusCode, validation.body).toBe(201);
    expect(jsonBody(validation)).toMatchObject({ accepted: 2, applied: false, rejected: 1 });

    const blocked = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { clientRequestId: 'hardening-opening-blocked', mode: 'APPLY', rows },
      url: '/api/v1/stock/opening-stock/import',
    });
    expect(jsonBody(blocked)).toMatchObject({ applied: false });

    const apply = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: {
        clientRequestId: 'hardening-opening-apply',
        mode: 'APPLY',
        rows: rows.slice(0, 2),
      },
      url: '/api/v1/stock/opening-stock/import',
    });
    expect(apply.statusCode, apply.body).toBe(201);
    expect(jsonBody(apply)).toMatchObject({
      accepted: 2,
      applied: true,
      totalQuantity: '150.000',
      valueAtCost: '1215.00',
    });
    const again = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: {
        clientRequestId: 'hardening-opening-again',
        mode: 'APPLY',
        rows: rows.slice(0, 2),
      },
      url: '/api/v1/stock/opening-stock/import',
    });
    expect(jsonBody(again)).toMatchObject({ applied: false, rejected: 2 });

    const overview = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: '/api/v1/stock?query=OPEN-101',
    });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(jsonBody<{ data: unknown[] }>(overview).data).toEqual([
      expect.objectContaining({
        availableQuantity: '150.000',
        name: 'Opening Tablet',
        valueAtCost: '1215.00',
      }),
    ]);
  });

  it('sets a reorder level and reports the medicine as low once stock falls to it', async () => {
    const medicine = await createStockedMedicine(database, owner.branchId, {
      name: 'Reorder Drops',
      quantity: '4',
      salePrice: '90.00',
    });
    const policy = await api.app.inject({
      headers: owner.headers,
      method: 'PUT',
      payload: { minimumStock: '5' },
      url: `/api/v1/stock/medicines/${medicine.medicineId}/reorder-policy`,
    });
    expect(policy.statusCode, policy.body).toBe(200);
    const low = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: '/api/v1/stock?filter=LOW',
    });
    expect(jsonBody<{ data: Array<{ name: string }> }>(low).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Reorder Drops', status: 'LOW' })]),
    );
    const detail = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: `/api/v1/stock/medicines/${medicine.medicineId}`,
    });
    expect(jsonBody(detail)).toMatchObject({ policy: { minimumStock: '5.000' } });
  });

  it('releases reserved stock when the counter cancels a sale', async () => {
    const medicine = await createStockedMedicine(database, owner.branchId, {
      name: 'Cancel Counter',
      quantity: '3',
      salePrice: '15.00',
    });
    const draft = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: {
        items: [{ medicineId: medicine.medicineId, quantity: '3' }],
        terminalId: owner.terminalId,
      },
      url: '/api/v1/pos/drafts',
    });
    const draftId = String(jsonBody(draft).id);
    await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      url: `/api/v1/pos/drafts/${draftId}/reserve`,
    });
    const search = async () =>
      jsonBody<{ data: Array<{ availableQuantity: string }> }>(
        await api.app.inject({
          headers: owner.headers,
          method: 'GET',
          url: '/api/v1/catalog/medicines/search?query=Cancel%20Counter',
        }),
      ).data[0]?.availableQuantity;
    expect(await search()).toBe('0.000');
    const cancel = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      url: `/api/v1/pos/drafts/${draftId}/cancel`,
    });
    expect(cancel.statusCode, cancel.body).toBe(201);
    expect(jsonBody(cancel)).toMatchObject({ releasedReservations: 1, status: 'CANCELLED' });
    expect(await search()).toBe('3.000');
  });

  it('locks a supervisor account after repeated wrong approval passwords at the counter', async () => {
    const passwordHash = await hash('Correct-Supervisor-1', { type: 2 });
    const [supervisor] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('hardening-supervisor', 'Supervisor', ${passwordHash}) returning id::text
    `;
    if (!supervisor) throw new Error('Supervisor fixture failed');
    const cashier = await sessionFor(
      'HARDENING_CASHIER',
      [PERMISSIONS.POS_CREATE_DRAFT, PERMISSIONS.SALE_DISCOUNT_BASIC, PERMISSIONS.POS_SEARCH],
      'hardening-cashier',
    );
    const medicine = await createStockedMedicine(database, owner.branchId, {
      name: 'Discount Probe',
      quantity: '5',
      salePrice: '100.00',
    });
    const draft = await api.app.inject({
      headers: cashier.headers,
      method: 'POST',
      payload: {
        items: [{ medicineId: medicine.medicineId, quantity: '1' }],
        terminalId: owner.terminalId,
      },
      url: '/api/v1/pos/drafts',
    });
    const draftId = String(jsonBody(draft).id);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await api.app.inject({
        headers: cashier.headers,
        method: 'POST',
        payload: {
          approverPassword: `wrong-password-${attempt}`,
          approverUsername: 'hardening-supervisor',
          clientRequestId: `hardening-guess-${attempt}`,
          invoiceDiscount: '50.00',
          lineDiscounts: [],
          reason: 'Guessing',
        },
        url: `/api/v1/pos/drafts/${draftId}/discount`,
      });
      expect(response.statusCode).toBe(403);
    }
    const [locked] = await database.admin<{ locked: boolean }[]>`
      select locked_until > now() as locked from users where id = ${supervisor.id}
    `;
    expect(locked?.locked).toBe(true);
  });

  it('does not let a user administrator grant or take over an owner account', async () => {
    const admin = await sessionFor(
      'HARDENING_SYSADMIN',
      [PERMISSIONS.SETTINGS_MANAGE_USERS],
      'hardening-sysadmin',
    );
    const [ownerRole] = await database.admin<{ id: string }[]>`
      select id::text from roles where code = 'OWNER'
    `;
    if (!ownerRole) throw new Error('Owner role fixture missing');
    const promote = await api.app.inject({
      headers: admin.headers,
      method: 'PATCH',
      payload: { roles: ['OWNER'] },
      url: `/api/v1/admin/users/${admin.userId}`,
    });
    expect(promote.statusCode).toBe(403);
    const reset = await api.app.inject({
      headers: admin.headers,
      method: 'POST',
      payload: { password: 'Taken-Over-Password-1' },
      url: `/api/v1/admin/users/${owner.userId}/password`,
    });
    expect(reset.statusCode).toBe(403);
    const create = await api.app.inject({
      headers: admin.headers,
      method: 'POST',
      payload: {
        displayName: 'Shadow Owner',
        password: 'Shadow-Owner-Password-1',
        roles: ['OWNER'],
        username: 'shadow-owner',
      },
      url: '/api/v1/admin/users',
    });
    expect(create.statusCode).toBe(403);
  });

  it('reports sales on the branch-local business day and nets refunds', async () => {
    const cashSessionId = await openCashSession(api, owner, 'hardening-report-session');
    const medicine = await createStockedMedicine(database, owner.branchId, {
      costPrice: '40.00',
      name: 'Report Tablet',
      quantity: '10',
      salePrice: '100.00',
    });
    const sale = await sellAtCounter(api, owner, cashSessionId, {
      items: [{ medicineId: medicine.medicineId, quantity: '2' }],
      requestId: 'hardening-report-sale',
    });
    // 01:30 Karachi on 2026-03-02 is 20:30 UTC on 2026-03-01.
    await database.admin`
      update sales set created_at = '2026-03-01T20:30:00Z' where id = ${sale.id}
    `;
    const report = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: '/api/v1/reports/tables/daily-sales?from=2026-03-01&to=2026-03-02',
    });
    expect(report.statusCode, report.body).toBe(200);
    const rows = jsonBody<{ rows: Array<{ date: string; invoices: number; sales: string }> }>(
      report,
    ).rows;
    expect(rows.find((row) => row.date === '2026-03-02')).toMatchObject({
      invoices: 1,
      sales: '200.00',
    });
    expect(rows.find((row) => row.date === '2026-03-01')).toMatchObject({ invoices: 0 });

    const profit = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: '/api/v1/reports/tables/profit?from=2026-03-02&to=2026-03-02',
    });
    expect(jsonBody<{ rows: unknown[] }>(profit).rows[0]).toMatchObject({
      costOfGoods: '80.00',
      grossProfit: '120.00',
      netSales: '200.00',
    });

    const basic = await sessionFor(
      'HARDENING_BASIC_REPORTS',
      [PERMISSIONS.REPORTS_VIEW_BASIC],
      'hardening-basic-reports',
    );
    const forbidden = await api.app.inject({
      headers: basic.headers,
      method: 'GET',
      url: '/api/v1/reports/tables/profit',
    });
    expect(forbidden.statusCode).toBe(403);
    const items = await api.app.inject({
      headers: basic.headers,
      method: 'GET',
      url: '/api/v1/reports/tables/item-sales?from=2026-03-02&to=2026-03-02',
    });
    expect(items.statusCode, items.body).toBe(200);
    expect(items.body).not.toContain('costOfGoods');
  });

  it('serves a live owner dashboard with today’s money', async () => {
    const response = await api.app.inject({
      headers: owner.headers,
      method: 'GET',
      url: '/api/v1/dashboard/overview?date=2026-03-02',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(jsonBody(response)).toMatchObject({
      date: '2026-03-02',
      sales: { grossProfit: '120.00', invoiceCount: 1, netSales: '200.00' },
    });
  });

  it('explains a broken constraint instead of a generic database error', async () => {
    const first = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { barcode: '8960000000999', name: 'Barcode One' },
      url: '/api/v1/admin/medicines',
    });
    expect(first.statusCode, first.body).toBe(201);
    const duplicate = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { barcode: '8960000000999', name: 'Barcode Two' },
      url: '/api/v1/admin/medicines',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toContain('Another medicine already uses this barcode');
  });
});
