import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const OWNER_TOKEN = 'phase7-software-owner-token';
const CASHIER_TOKEN = 'phase7-cashier-only-token';
const OWNER = { authorization: `Bearer ${OWNER_TOKEN}` };
const CASHIER = { authorization: `Bearer ${CASHIER_TOKEN}` };

describe('Phase 7 features per shop', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let branchId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase7_features');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P7F', 'Plan Pharmacy') returning id::text`;
    branchId = branch!.id;
    await database.admin`insert into operational_intelligence_policies (branch_id) values (${branchId})`;
    for (const code of Object.values(PERMISSIONS)) {
      await database.admin`
        insert into permissions (code, description) values (${code}, ${code})
        on conflict (code) do nothing`;
    }
    const people = [
      { username: 'p7-platform', token: OWNER_TOKEN, permissions: Object.values(PERMISSIONS) },
      { username: 'p7-cashier', token: CASHIER_TOKEN, permissions: [PERMISSIONS.POS_SEARCH] },
    ];
    for (const [index, person] of people.entries()) {
      const [user] = await database.admin<{ id: string }[]>`
        insert into users (username, display_name, password_hash)
        values (${person.username}, ${person.username}, 'token-auth-only') returning id::text`;
      const [role] = await database.admin<{ id: string }[]>`
        insert into roles (code, name) values (${`P7F_${index}`}, ${person.username})
        returning id::text`;
      await database.admin`
        insert into role_permissions (role_id, permission_id)
        select ${role!.id}, id from permissions
        where code in ${database.admin([...person.permissions])}`;
      await database.admin`
        insert into user_branch_roles (user_id, branch_id, role_id)
        values (${user!.id}, ${branchId}, ${role!.id})`;
      const [terminal] = await database.admin<{ id: string }[]>`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${branchId}, ${`P7F-${index}`}, 'Desk', 'CASHIER') returning id::text`;
      await database.admin`
        insert into sessions (
          user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
        ) values (
          ${user!.id}, ${branchId}, ${terminal!.id},
          ${createHash('sha256').update(person.token).digest()},
          now() + interval '1 hour', now() + interval '12 hours'
        )`;
    }
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  const call = (method: 'GET' | 'PUT' | 'PATCH', url: string, headers = OWNER, payload?: unknown) =>
    api.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...headers, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });

  it('starts every existing shop on the full plan', async () => {
    const response = await call('GET', '/features', CASHIER);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      plan: string;
      features: Record<string, { enabled: boolean }>;
    };
    expect(body.plan).toBe('PRO');
    expect(Object.values(body.features).every((feature) => feature.enabled)).toBe(true);
    expect((await call('GET', '/stock/stuck')).statusCode).toBe(200);
  });

  it('switches features off by plan and back on per shop, with settings', async () => {
    expect(
      (await call('PUT', `/platform/shops/${branchId}/plan`, OWNER, { plan: 'BASIC' })).statusCode,
    ).toBe(200);
    const blocked = await call('GET', '/stock/stuck');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('not switched on for your shop');
    expect((await call('GET', '/stock/expiring')).statusCode).toBe(200);

    const enabled = await call('PATCH', `/platform/shops/${branchId}/features/STUCK_STOCK`, OWNER, {
      enabled: true,
      settings: { days: 45 },
    });
    expect(enabled.statusCode).toBe(200);
    const stuck = await call('GET', '/stock/stuck');
    expect(stuck.statusCode).toBe(200);
    expect((JSON.parse(stuck.body) as { days: number }).days).toBe(45);
  });

  it('lets the shop tune settings within range but not switch features', async () => {
    const tooShort = await call('PATCH', '/features/STUCK_STOCK/settings', OWNER, {
      settings: { days: 5 },
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.body).toContain('between 15 and 730 days');
    const tuned = await call('PATCH', '/features/STUCK_STOCK/settings', OWNER, {
      settings: { days: 60 },
    });
    expect(tuned.statusCode).toBe(200);
    const notOwned = await call('PATCH', '/features/OWNER_AI/settings', OWNER, { settings: {} });
    expect(notOwned.statusCode).toBe(400);
    expect(notOwned.body).toContain('not switched on');
  });

  it('keeps plan and feature switches for the software owner only', async () => {
    expect(
      (await call('PUT', `/platform/shops/${branchId}/plan`, CASHIER, { plan: 'PRO' })).statusCode,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/platform/shops/${branchId}/features/OWNER_AI`, CASHIER, {
          enabled: true,
        })
      ).statusCode,
    ).toBe(403);
    const [audits] = await database.admin<Array<{ count: number }>>`
      select count(*)::int as count from audit_events
      where branch_id = ${branchId}
        and event_type in ('PLATFORM.PLAN_CHANGED', 'PLATFORM.FEATURE_CHANGED',
          'SHOP.FEATURE_SETTINGS_CHANGED')`;
    expect(audits?.count).toBe(3);
  });
});
