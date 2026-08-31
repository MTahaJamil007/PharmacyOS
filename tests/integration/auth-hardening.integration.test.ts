import { hash } from 'argon2';
import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

const PASSWORD = 'phase-2-auth-password';

function responseRecord(body: string): Record<string, unknown> {
  const value: unknown = JSON.parse(body);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object response');
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new TypeError(`Expected ${field} to be a string`);
  return value;
}

describe('authentication hardening', () => {
  let api: IntegrationApi;
  let branchId: string;
  let database: IsolatedDatabase;
  let terminalId: string;
  let userId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('auth_hardening');
    const branches = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values
        ('AUTH-A', 'Authentication Branch A'),
        ('AUTH-B', 'Authentication Branch B')
      returning id::text
    `;
    const firstBranch = branches[0];
    const secondBranch = branches[1];
    if (!firstBranch || !secondBranch) throw new Error('Failed to create auth branches');
    branchId = firstBranch.id;

    const terminals = await database.admin<{ branch_id: string; id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type) values
        (${firstBranch.id}, 'COUNTER-01', 'Branch A Counter', 'SALES_COUNTER'),
        (${secondBranch.id}, 'COUNTER-01', 'Branch B Counter', 'SALES_COUNTER')
      returning id::text, branch_id::text
    `;
    const firstTerminal = terminals.find((terminal) => terminal.branch_id === firstBranch.id);
    if (!firstTerminal) throw new Error('Failed to create deterministic terminal fixture');
    terminalId = firstTerminal.id;

    const passwordHash = await hash(PASSWORD, {
      memoryCost: 65_536,
      parallelism: 1,
      timeCost: 3,
      type: 2,
    });
    const [user] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('auth-cashier', 'Auth Cashier', ${passwordHash}) returning id::text
    `;
    const [emptyUser] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('empty-role-user', 'Empty Role User', ${passwordHash}) returning id::text
    `;
    const [cashierRole] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('AUTH_CASHIER', 'Auth Cashier') returning id::text
    `;
    const [emptyRole] = await database.admin<{ id: string }[]>`
      insert into roles (code, name) values ('AUTH_EMPTY', 'Auth Empty') returning id::text
    `;
    const [permission] = await database.admin<{ id: string }[]>`
      insert into permissions (code, description)
      values (${PERMISSIONS.POS_SEARCH}, 'Authentication integration search') returning id::text
    `;
    if (!user || !emptyUser || !cashierRole || !emptyRole || !permission) {
      throw new Error('Failed to create auth role fixtures');
    }
    userId = user.id;
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      values (${cashierRole.id}, ${permission.id})
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id) values
        (${user.id}, ${firstBranch.id}, ${cashierRole.id}),
        (${user.id}, ${secondBranch.id}, ${cashierRole.id}),
        (${emptyUser.id}, ${firstBranch.id}, ${emptyRole.id})
    `;
    const emptyToken = 'phase-2-empty-role-token';
    await database.admin`
      insert into sessions (
        user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
      ) values (
        ${emptyUser.id}, ${firstBranch.id}, ${firstTerminal.id},
        ${createHash('sha256').update(emptyToken).digest()},
        now() + interval '5 minutes', now() + interval '30 minutes'
      )
    `;

    api = await createIntegrationApi(database.applicationUrl, {
      ACCOUNT_LOCKOUT_FAILURES: '5',
      ACCOUNT_LOCKOUT_MINUTES: '15',
      LOGIN_RATE_LIMIT_ATTEMPTS: '3',
      LOGIN_RATE_LIMIT_WINDOW_MINUTES: '5',
      SESSION_ABSOLUTE_TTL_MINUTES: '30',
      SESSION_TTL_MINUTES: '5',
    });
  });

  afterAll(async () => {
    await api.close();
    await database.dispose();
  });

  it('atomically throttles repeated unknown-account attempts', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await api.app.inject({
        method: 'POST',
        payload: {
          password: 'unknown-account-password',
          terminalCode: 'COUNTER-01',
          username: 'unknown-auth-user',
        },
        url: '/api/v1/auth/login',
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401]);
    const [events] = await database.admin<Array<{ failed: string; rate_limited: string }>>`
      select
        count(*) filter (where event_type = 'AUTH.LOGIN_FAILED')::text as failed,
        count(*) filter (where event_type = 'AUTH.LOGIN_RATE_LIMITED')::text as rate_limited
      from audit_events
    `;
    expect(events).toEqual({ failed: '3', rate_limited: '1' });
    await database.admin`delete from auth_login_throttles`;
  });

  it('resets an expired account failure window instead of extending lockout forever', async () => {
    await database.admin`
      update users set failed_login_count = 5,
        failed_login_window_started_at = now() - interval '20 minutes',
        locked_until = now() - interval '1 minute'
      where id = ${userId}
    `;
    const response = await api.app.inject({
      method: 'POST',
      payload: {
        password: 'incorrect-password',
        terminalCode: 'COUNTER-01',
        username: 'auth-cashier',
      },
      url: '/api/v1/auth/login',
    });
    expect(response.statusCode).toBe(401);
    const [account] = await database.admin<
      Array<{ failed_login_count: number; locked_until: Date | null }>
    >`
      select failed_login_count, locked_until from users where id = ${userId}
    `;
    expect(account).toEqual({ failed_login_count: 1, locked_until: null });
    await database.admin`delete from auth_login_throttles`;
  });

  it('binds duplicate terminal codes deterministically and slides only to an absolute expiry', async () => {
    const login = await api.app.inject({
      method: 'POST',
      payload: { password: PASSWORD, terminalCode: 'COUNTER-01', username: 'auth-cashier' },
      url: '/api/v1/auth/login',
    });
    expect(login.statusCode).toBe(201);
    const loginBody = responseRecord(login.body);
    const token = stringField(loginBody, 'accessToken');
    const sessionId = stringField(loginBody, 'sessionId');
    const loginUser = loginBody.user;
    if (typeof loginUser !== 'object' || loginUser === null || Array.isArray(loginUser)) {
      throw new TypeError('Expected login user object');
    }
    expect(loginUser).toMatchObject({ branchId, terminalId });

    await database.admin`
      update sessions set expires_at = now() + interval '1 minute' where id = ${sessionId}
    `;
    const [before] = await database.admin<Array<{ absolute_expires_at: Date; expires_at: Date }>>`
      select expires_at, absolute_expires_at from sessions where id = ${sessionId}
    `;
    const search = await api.app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/api/v1/catalog/medicines/search?query=none',
    });
    expect(search.statusCode).toBe(200);
    const [after] = await database.admin<
      Array<{ absolute_expires_at: Date; expires_at: Date; last_seen_at: Date }>
    >`
      select expires_at, absolute_expires_at, last_seen_at from sessions where id = ${sessionId}
    `;
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (!before || !after) throw new Error('Missing sliding-session evidence');
    expect(after.expires_at.getTime()).toBeGreaterThan(before.expires_at.getTime());
    expect(after.expires_at.getTime()).toBeLessThanOrEqual(after.absolute_expires_at.getTime());

    const logout = await api.app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    expect(logout.statusCode).toBe(201);
    expect(responseRecord(logout.body)).toMatchObject({ revoked: true });
    const rejected = await api.app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/api/v1/catalog/medicines/search?query=none',
    });
    expect(rejected.statusCode).toBe(401);
  });

  it('authenticates a zero-permission role and rejects the operation with 403', async () => {
    const response = await api.app.inject({
      headers: { authorization: 'Bearer phase-2-empty-role-token' },
      method: 'GET',
      url: '/api/v1/catalog/medicines/search?query=none',
    });
    expect(response.statusCode).toBe(403);
  });
});
