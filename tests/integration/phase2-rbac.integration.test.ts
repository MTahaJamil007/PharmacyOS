import { createHash } from 'node:crypto';

import { PERMISSIONS } from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

interface RouteCase {
  readonly method: 'GET' | 'POST';
  readonly name: string;
  readonly payload?: Record<string, unknown>;
  readonly url: string;
}

const FULL_TOKEN = 'phase2-rbac-full-token';
const EMPTY_TOKEN = 'phase2-rbac-empty-token';
const SYSTEM_TOKEN = 'phase2-rbac-system-token';
const AI_ONLY_TOKEN = 'phase2-rbac-ai-only-token';
const LOOKUP_TOKEN = '00000000-0000-4000-8000-000000000001';

const routes: readonly RouteCase[] = [
  { method: 'GET', name: 'attention summary', url: '/api/v1/inventory-intelligence/attention' },
  { method: 'GET', name: 'shelf queue', url: '/api/v1/shelf-recommendations' },
  {
    method: 'POST',
    name: 'shelf review',
    payload: { decision: 'DISMISS' },
    url: '/api/v1/shelf-recommendations/1/review',
  },
  { method: 'GET', name: 'expiry queue', url: '/api/v1/expiry-risk' },
  {
    method: 'POST',
    name: 'expiry action',
    payload: { action: 'REVIEWED', notes: 'Reviewed by P0 matrix' },
    url: '/api/v1/expiry-work-items/1/action',
  },
  {
    method: 'POST',
    name: 'supplier quote',
    payload: {
      baseUnitsPerQuoteUnit: '1',
      medicineId: '1',
      quoteUnit: 'box',
      quotedUnitCost: '10.00',
      source: 'P0 matrix',
      supplierId: '1',
    },
    url: '/api/v1/supplier-quotes',
  },
  { method: 'GET', name: 'purchase-order queue', url: '/api/v1/purchase-orders' },
  { method: 'GET', name: 'purchase-order detail', url: '/api/v1/purchase-orders/1' },
  {
    method: 'POST',
    name: 'purchase-order create',
    payload: {
      clientRequestId: 'p0-create-po',
      items: [{ medicineId: '1', orderedQuantity: '1', unitCost: '1.00' }],
      supplierId: '1',
    },
    url: '/api/v1/purchase-orders',
  },
  {
    method: 'POST',
    name: 'purchase-order order',
    payload: { clientRequestId: 'p0-order-po' },
    url: '/api/v1/purchase-orders/1/order',
  },
  {
    method: 'POST',
    name: 'goods receipt',
    payload: {
      clientRequestId: 'p0-receive-po',
      lines: [
        {
          batchNumber: 'P0',
          expiryDate: '2027-12-31',
          purchaseOrderItemId: '1',
          receivedQuantity: '1',
          salePricePerBaseUnit: '2.00',
        },
      ],
    },
    url: '/api/v1/purchase-orders/1/receive',
  },
  {
    method: 'GET',
    name: 'supplier comparison',
    url: '/api/v1/products/1/supplier-comparison',
  },
  { method: 'GET', name: 'reorder queue', url: '/api/v1/reorder-suggestions' },
  {
    method: 'POST',
    name: 'reorder review',
    payload: { decision: 'REVIEW' },
    url: '/api/v1/reorder-suggestions/1/review',
  },
  {
    method: 'POST',
    name: 'reorder draft purchase order',
    payload: { clientRequestId: 'p0-reorder-draft', quantity: '1', supplierId: '1' },
    url: '/api/v1/reorder-suggestions/1/create-draft-po',
  },
  {
    method: 'POST',
    name: 'budget regimen',
    payload: {
      budget: '10.00',
      items: [{ medicineId: '1', prescribedBaseUnitsPerDay: '1' }],
    },
    url: '/api/v1/budget-regimen/calculate',
  },
  { method: 'GET', name: 'return lookup', url: `/api/v1/returns/lookup/${LOOKUP_TOKEN}` },
  {
    method: 'POST',
    name: 'return request',
    payload: {
      clientRequestId: 'p0-return-request',
      items: [{ disposition: 'SCRAP', quantity: '1', saleItemId: '1' }],
      reason: 'P0 matrix',
    },
    url: `/api/v1/returns/lookup/${LOOKUP_TOKEN}/request`,
  },
  { method: 'POST', name: 'return approval', url: '/api/v1/returns/1/approve' },
  {
    method: 'POST',
    name: 'return refund',
    payload: { method: 'CARD', reference: 'P0' },
    url: '/api/v1/returns/1/refund',
  },
  {
    method: 'POST',
    name: 'owner AI',
    payload: { arguments: {}, question: 'How did sales perform?', tool: 'get_sales_summary' },
    url: '/api/v1/owner-ai/chat',
  },
  { method: 'GET', name: 'failed jobs', url: '/api/v1/operations/jobs/failed' },
];

describe('Phase 2 endpoint RBAC matrix', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase2_rbac');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('P0-RBAC', 'P0 RBAC') returning id::text
    `;
    if (!branch) throw new Error('Failed to create RBAC branch');
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branch.id}, 'P0-RBAC', 'P0 RBAC', 'ADMIN') returning id::text
    `;
    if (!terminal) throw new Error('Failed to create RBAC terminal');
    const users = await database.admin<Array<{ id: string; username: string }>>`
      insert into users (username, display_name, password_hash) values
        ('p0-rbac-full', 'P0 Full', 'not-used'),
        ('p0-rbac-empty', 'P0 Empty', 'not-used'),
        ('p0-rbac-system', 'P0 System', 'not-used'),
        ('p0-rbac-ai-only', 'P0 AI Only', 'not-used')
      returning id::text, username
    `;
    const roles = await database.admin<Array<{ code: string; id: string }>>`
      insert into roles (code, name) values
        ('P0_RBAC_FULL', 'P0 Full'),
        ('P0_RBAC_EMPTY', 'P0 Empty'),
        ('P0_RBAC_SYSTEM', 'P0 System'),
        ('P0_RBAC_AI_ONLY', 'P0 AI Only')
      returning id::text, code
    `;
    const userId = (username: string): string => {
      const user = users.find((candidate) => candidate.username === username);
      if (!user) throw new Error(`Missing RBAC user ${username}`);
      return user.id;
    };
    const roleId = (code: string): string => {
      const role = roles.find((candidate) => candidate.code === code);
      if (!role) throw new Error(`Missing RBAC role ${code}`);
      return role.id;
    };
    for (const permissionCode of Object.values(PERMISSIONS)) {
      await database.admin`
        insert into permissions (code, description) values (${permissionCode}, ${permissionCode})
        on conflict (code) do nothing
      `;
    }
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${roleId('P0_RBAC_FULL')}, id from permissions
    `;
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${roleId('P0_RBAC_SYSTEM')}, id from permissions
      where code = ${PERMISSIONS.SETTINGS_MANAGE_SYSTEM}
    `;
    await database.admin`
      insert into role_permissions (role_id, permission_id)
      select ${roleId('P0_RBAC_AI_ONLY')}, id from permissions
      where code = ${PERMISSIONS.AI_OWNER_USE}
    `;
    await database.admin`
      insert into user_branch_roles (user_id, branch_id, role_id) values
        (${userId('p0-rbac-full')}, ${branch.id}, ${roleId('P0_RBAC_FULL')}),
        (${userId('p0-rbac-empty')}, ${branch.id}, ${roleId('P0_RBAC_EMPTY')}),
        (${userId('p0-rbac-system')}, ${branch.id}, ${roleId('P0_RBAC_SYSTEM')}),
        (${userId('p0-rbac-ai-only')}, ${branch.id}, ${roleId('P0_RBAC_AI_ONLY')})
    `;
    for (const [username, token] of [
      ['p0-rbac-full', FULL_TOKEN],
      ['p0-rbac-empty', EMPTY_TOKEN],
      ['p0-rbac-system', SYSTEM_TOKEN],
      ['p0-rbac-ai-only', AI_ONLY_TOKEN],
    ] as const) {
      await database.admin`
        insert into sessions (
          user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at
        ) values (
          ${userId(username)}, ${branch.id}, ${terminal.id},
          ${createHash('sha256').update(token).digest()},
          now() + interval '30 minutes', now() + interval '12 hours'
        )
      `;
    }
    api = await createIntegrationApi(database.applicationUrl);
  });

  afterAll(async () => {
    await api.close();
    await database.dispose();
  });

  it.each(routes)(
    'allows the authorized identity and denies the empty role: $name',
    async (route) => {
      const denied = await api.app.inject({
        headers: { authorization: `Bearer ${EMPTY_TOKEN}` },
        method: route.method,
        ...(route.payload ? { payload: route.payload } : {}),
        url: route.url,
      });
      const allowed = await api.app.inject({
        headers: { authorization: `Bearer ${FULL_TOKEN}` },
        method: route.method,
        ...(route.payload ? { payload: route.payload } : {}),
        url: route.url,
      });

      expect(denied.statusCode).toBe(403);
      expect(allowed.statusCode).not.toBe(401);
      expect(allowed.statusCode).not.toBe(403);
      expect(allowed.statusCode).toBeLessThan(500);
    },
  );

  it('does not let a system administrator inherit business grants', async () => {
    const systemEndpoint = await api.app.inject({
      headers: { authorization: `Bearer ${SYSTEM_TOKEN}` },
      method: 'GET',
      url: '/api/v1/operations/jobs/failed',
    });
    const businessEndpoint = await api.app.inject({
      headers: { authorization: `Bearer ${SYSTEM_TOKEN}` },
      method: 'GET',
      url: '/api/v1/expiry-risk',
    });

    expect(systemEndpoint.statusCode).toBe(200);
    expect(businessEndpoint.statusCode).toBe(403);
  });

  it('re-checks the selected owner tool after the outer AI endpoint grant', async () => {
    const response = await api.app.inject({
      headers: { authorization: `Bearer ${AI_ONLY_TOKEN}` },
      method: 'POST',
      payload: { arguments: {}, question: 'How did sales perform?', tool: 'get_sales_summary' },
      url: '/api/v1/owner-ai/chat',
    });
    const health = await api.app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(403);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
  });
});
