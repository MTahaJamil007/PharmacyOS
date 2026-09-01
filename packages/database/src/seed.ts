import './load-environment.js';

import { createDatabase } from './index.js';

const roles: ReadonlyArray<readonly [string, string]> = [
  ['SALESPERSON', 'Salesperson'],
  ['CASHIER', 'Cashier'],
  ['SUPERVISOR', 'Pharmacist / Supervisor'],
  ['INVENTORY_MANAGER', 'Inventory manager'],
  ['MANAGER', 'Manager'],
  ['OWNER', 'Owner'],
  ['SYSTEM_ADMIN', 'System administrator'],
];

const permissions = [
  'pos.search',
  'pos.create_draft',
  'pos.send_to_cashier',
  'sale.finalize_payment',
  'sale.discount.basic',
  'sale.discount.override',
  'customer.read',
  'customer.manage',
  'customer.credit',
  'customer.payment',
  'returns.request',
  'returns.approve',
  'returns.refund_cash',
  'inventory.purchase',
  'inventory.adjust',
  'reports.view_basic',
  'reports.view_financial',
  'cash.open_session',
  'cash.close_session',
  'cash.approve_variance',
  'fbr.view_status',
  'fbr.retry',
  'settings.manage_users',
  'settings.manage_system',
  'backup.restore',
  'inventory.shelf.read',
  'inventory.shelf.manage',
  'inventory.shelf.recommendation.review',
  'inventory.expiry.read',
  'inventory.expiry.manage',
  'procurement.supplier_price.read',
  'procurement.reorder.review',
  'procurement.purchase_draft.approve',
  'sales.budget_regimen.calculate',
  'sales.budget_regimen.verify',
  'returns.lookup',
  'returns.refund',
  'analytics.owner.read',
  'ai.owner.use',
  'ai.audit.read',
] as const;

const rolePermissions: Readonly<Record<string, readonly string[]>> = {
  SALESPERSON: [
    'pos.search',
    'pos.create_draft',
    'pos.send_to_cashier',
    'returns.request',
    'inventory.shelf.read',
    'sales.budget_regimen.calculate',
    'customer.read',
  ],
  CASHIER: [
    'pos.search',
    'pos.create_draft',
    'pos.send_to_cashier',
    'sale.finalize_payment',
    'sale.discount.basic',
    'returns.request',
    'returns.refund_cash',
    'reports.view_basic',
    'cash.open_session',
    'cash.close_session',
    'fbr.view_status',
    'returns.lookup',
    'returns.refund',
    'sales.budget_regimen.calculate',
    'customer.read',
    'customer.credit',
    'customer.payment',
  ],
  SUPERVISOR: [
    'pos.search',
    'pos.create_draft',
    'pos.send_to_cashier',
    'sale.finalize_payment',
    'sale.discount.basic',
    'sale.discount.override',
    'returns.request',
    'returns.approve',
    'returns.refund_cash',
    'inventory.purchase',
    'inventory.adjust',
    'reports.view_basic',
    'cash.open_session',
    'cash.close_session',
    'fbr.view_status',
    'inventory.shelf.read',
    'inventory.shelf.recommendation.review',
    'inventory.expiry.read',
    'sales.budget_regimen.calculate',
    'sales.budget_regimen.verify',
    'returns.lookup',
    'returns.refund',
    'customer.read',
    'customer.credit',
    'customer.payment',
  ],
  INVENTORY_MANAGER: [
    'pos.search',
    'inventory.purchase',
    'inventory.adjust',
    'reports.view_basic',
    'inventory.shelf.read',
    'inventory.shelf.manage',
    'inventory.shelf.recommendation.review',
    'inventory.expiry.read',
    'inventory.expiry.manage',
    'procurement.supplier_price.read',
    'procurement.reorder.review',
  ],
  MANAGER: permissions.filter(
    (permission) =>
      !permission.startsWith('settings.') &&
      permission !== 'backup.restore' &&
      permission !== 'ai.owner.use' &&
      permission !== 'ai.audit.read',
  ),
  OWNER: permissions,
  SYSTEM_ADMIN: ['fbr.retry', 'settings.manage_users', 'settings.manage_system', 'backup.restore'],
};

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');
  const database = createDatabase(connectionString, { max: 1 });

  try {
    await database.begin(async (transaction) => {
      for (const [code, name] of roles) {
        await transaction`
          insert into roles (code, name)
          values (${code}, ${name})
          on conflict (code) do update set name = excluded.name
        `;
      }
      for (const code of permissions) {
        await transaction`
          insert into permissions (code, description)
          values (${code}, ${code.replaceAll('.', ' ')})
          on conflict (code) do update set description = excluded.description
        `;
      }
      for (const [roleCode, permissionCodes] of Object.entries(rolePermissions)) {
        await transaction`
          insert into role_permissions (role_id, permission_id)
          select roles.id, permissions.id
          from roles cross join permissions
          where roles.code = ${roleCode}
            and permissions.code in ${transaction(permissionCodes)}
          on conflict do nothing
        `;
      }
    });
    process.stdout.write('Seeded roles and permissions\n');
  } finally {
    await database.end();
  }
}

await seed();
