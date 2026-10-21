import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';

import type { IntegrationApi } from './api.js';
import type { IsolatedDatabase } from './database.js';

export interface BranchFixture {
  readonly branchId: string;
  readonly terminalId: string;
  readonly userId: string;
  readonly headers: { readonly authorization: string };
}

/**
 * One branch, one counter terminal, and one operator session holding every permission
 * (or the listed subset). Tests drive the real HTTP API with the returned headers.
 */
export async function createBranchFixture(
  database: IsolatedDatabase,
  label: string,
  options: { readonly permissions?: readonly string[]; readonly roleCode?: string } = {},
): Promise<BranchFixture> {
  const code =
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12) || 'BRANCH';
  const [branch] = await database.admin<{ id: string }[]>`
    insert into branches (code, name, address) values (${code}, ${`${label} Pharmacy`}, 'Main Road')
    returning id::text
  `;
  const [user] = await database.admin<{ id: string }[]>`
    insert into users (username, display_name, password_hash)
    values (${`${label}-operator`}, ${`${label} Operator`}, 'token-auth-only') returning id::text
  `;
  const [role] = await database.admin<{ id: string }[]>`
    insert into roles (code, name) values (${options.roleCode ?? `${code}_ROLE`}, ${`${label} role`})
    on conflict (code) do update set name = excluded.name
    returning id::text
  `;
  if (!branch || !user || !role) throw new Error('Branch fixture failed');
  await database.admin`
    insert into operational_intelligence_policies (branch_id) values (${branch.id})
    on conflict (branch_id) do nothing
  `;
  const [terminal] = await database.admin<{ id: string }[]>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branch.id}, ${`${code}-01`}, 'Counter', 'CASHIER') returning id::text
  `;
  if (!terminal) throw new Error('Terminal fixture failed');
  for (const permission of Object.values(PERMISSIONS)) {
    await database.admin`
      insert into permissions (code, description) values (${permission}, ${permission})
      on conflict (code) do nothing
    `;
  }
  const granted = options.permissions ?? Object.values(PERMISSIONS);
  await database.admin`
    insert into role_permissions (role_id, permission_id)
    select ${role.id}, id from permissions where code in ${database.admin(granted)}
    on conflict do nothing
  `;
  await database.admin`
    insert into user_branch_roles (user_id, branch_id, role_id)
    values (${user.id}, ${branch.id}, ${role.id})
  `;
  const token = `${label}-session-token`;
  await database.admin`
    insert into sessions (
      user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
    ) values (
      ${user.id}, ${branch.id}, ${terminal.id}, ${createHash('sha256').update(token).digest()},
      now() + interval '1 hour', now() + interval '12 hours'
    )
  `;
  return {
    branchId: branch.id,
    headers: { authorization: `Bearer ${token}` },
    terminalId: terminal.id,
    userId: user.id,
  };
}

/** A medicine with one sellable batch whose opening balance is on the stock ledger. */
export async function createStockedMedicine(
  database: IsolatedDatabase,
  branchId: string,
  input: {
    readonly name: string;
    readonly quantity: string;
    readonly salePrice: string;
    readonly costPrice?: string;
    readonly taxRate?: string;
    readonly expiryDays?: number;
  },
): Promise<{ readonly medicineId: string; readonly batchId: string }> {
  return database.admin.begin(async (transaction) => {
    const [medicine] = await transaction<{ id: string }[]>`
      insert into medicines (name, pack_size, unit_name, tax_rate)
      values (${input.name}, 1, 'tablet', ${input.taxRate ?? '0'}) returning id::text
    `;
    if (!medicine) throw new Error('Medicine fixture failed');
    const [batch] = await transaction<{ id: string }[]>`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date, cost_price, sale_price, current_qty
      ) values (
        ${branchId}, ${medicine.id}, ${`${input.name.slice(0, 8).toUpperCase()}-B1`},
        current_date + ${input.expiryDays ?? 365}::int, ${input.costPrice ?? '1.00'},
        ${input.salePrice}, ${input.quantity}
      ) returning id::text
    `;
    if (!batch) throw new Error('Batch fixture failed');
    await transaction`
      insert into stock_movements (
        branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
      ) values (
        ${branchId}, ${batch.id}, 'ADJUSTMENT_IN', ${input.quantity}, ${input.quantity},
        'Integration fixture opening balance'
      )
    `;
    return { batchId: batch.id, medicineId: medicine.id };
  });
}

export function jsonBody<T = Record<string, unknown>>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

export interface CounterSaleInput {
  readonly items: ReadonlyArray<{ readonly medicineId: string; readonly quantity: string }>;
  readonly invoiceDiscount?: string;
  readonly customerId?: string;
  readonly payments?: ReadonlyArray<Record<string, unknown>>;
  readonly requestId: string;
}

/** Runs the counter flow (draft → optional discount → reserve → finalize) over HTTP. */
export async function sellAtCounter(
  api: IntegrationApi,
  fixture: BranchFixture,
  cashSessionId: string,
  input: CounterSaleInput,
): Promise<Record<string, unknown> & { readonly id: string; readonly total: string }> {
  const draftResponse = await api.app.inject({
    headers: fixture.headers,
    method: 'POST',
    payload: { items: input.items, terminalId: fixture.terminalId },
    url: '/api/v1/pos/drafts',
  });
  if (draftResponse.statusCode !== 201) throw new Error(`Draft failed: ${draftResponse.body}`);
  const draft = jsonBody<{ id: string }>(draftResponse);
  if (input.invoiceDiscount) {
    const discount = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: {
        clientRequestId: `${input.requestId}-discount`,
        invoiceDiscount: input.invoiceDiscount,
        lineDiscounts: [],
        reason: 'Integration discount',
      },
      url: `/api/v1/pos/drafts/${draft.id}/discount`,
    });
    if (discount.statusCode !== 201) throw new Error(`Discount failed: ${discount.body}`);
  }
  const reserve = await api.app.inject({
    headers: fixture.headers,
    method: 'POST',
    url: `/api/v1/pos/drafts/${draft.id}/reserve`,
  });
  if (reserve.statusCode !== 201) throw new Error(`Reserve failed: ${reserve.body}`);
  const reserved = jsonBody<{ total: string }>(reserve);
  const finalize = await api.app.inject({
    headers: fixture.headers,
    method: 'POST',
    payload: {
      cashSessionId,
      clientRequestId: input.requestId,
      draftId: draft.id,
      payments: input.payments ?? [
        { amount: reserved.total, method: 'CASH', tenderedAmount: reserved.total },
      ],
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
    url: '/api/v1/pos/sales/finalize',
  });
  if (finalize.statusCode !== 201) throw new Error(`Finalize failed: ${finalize.body}`);
  return jsonBody(finalize);
}

export async function openCashSession(
  api: IntegrationApi,
  fixture: BranchFixture,
  requestId: string,
): Promise<string> {
  const response = await api.app.inject({
    headers: fixture.headers,
    method: 'POST',
    payload: { clientRequestId: requestId, openingFloat: '1000.00' },
    url: '/api/v1/cash-sessions/open',
  });
  if (response.statusCode !== 201) throw new Error(`Open session failed: ${response.body}`);
  return jsonBody<{ id: string }>(response).id;
}
