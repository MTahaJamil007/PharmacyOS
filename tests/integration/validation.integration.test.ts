import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const ACCESS_TOKEN = 'phase-2-validation-token';
const AUTHORIZATION = { authorization: `Bearer ${ACCESS_TOKEN}` };

describe('API request validation boundary', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let terminalId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('validation');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('VALID', 'Validation Branch') returning id::text
    `;
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('validation-user', 'Validation User', 'not-used-by-token-auth') returning id::text
    `;
    const [role] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('VALIDATION_ROLE', 'Validation Role') returning id::text
    `;
    if (!branch || !user || !role) throw new Error('Failed to create validation identities');
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branch.id}, 'COUNTER-01', 'Validation Counter', 'SALES_COUNTER')
      returning id::text
    `;
    if (!terminal) throw new Error('Failed to create validation terminal');
    terminalId = terminal.id;
    for (const permissionCode of [
      PERMISSIONS.POS_CREATE_DRAFT,
      PERMISSIONS.POS_SEND_TO_CASHIER,
      PERMISSIONS.SALE_FINALIZE_PAYMENT,
    ]) {
      const [permission] = await database.admin<{ id: string }[]>`
        insert into permissions (code, description)
        values (${permissionCode}, ${`Validation ${permissionCode}`}) returning id::text
      `;
      if (!permission) throw new Error('Failed to create validation permission');
      await database.admin`
        insert into role_permissions (role_id, permission_id)
        values (${role.id}, ${permission.id})
      `;
    }
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id)
      values (${user.id}, ${branch.id}, ${role.id})
    `;
    await database.admin`
      insert into sessions (
        user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
      ) values (
        ${user.id}, ${branch.id}, ${terminal.id},
        ${createHash('sha256').update(ACCESS_TOKEN).digest()},
        now() + interval '30 minutes', now() + interval '12 hours'
      )
    `;
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    await api.close();
    await database.dispose();
  });

  it.each(['0', '0.000', '1000000000'])(
    'rejects draft quantity %s before database work',
    async (quantity) => {
      const response = await api.app.inject({
        headers: AUTHORIZATION,
        method: 'POST',
        payload: { items: [{ medicineId: '1', quantity }], terminalId },
        url: '/api/v1/pos/drafts',
      });
      expect(response.statusCode).toBe(400);
    },
  );

  it('rejects zero payment and oversized bigint identifiers as bad requests', async () => {
    const payment = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      payload: {
        cashSessionId: '1',
        clientRequestId: 'validation-request',
        draftId: '1',
        payments: [{ amount: '0', method: 'CASH' }],
      },
      url: '/api/v1/pos/sales/finalize',
    });
    const identifier = await api.app.inject({
      headers: AUTHORIZATION,
      method: 'POST',
      url: '/api/v1/pos/drafts/9223372036854775808/reserve',
    });
    expect(payment.statusCode).toBe(400);
    expect(identifier.statusCode).toBe(400);
  });

  it('rejects prototype-pollution keys at the global pipe', async () => {
    const response = await api.app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload:
        '{"username":"validation-user","password":"not-the-password","terminalCode":"COUNTER-01","__proto__":{"polluted":true}}',
      url: '/api/v1/auth/login',
    });
    expect(response.statusCode).toBe(400);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
