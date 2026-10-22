// Creates, or re-keys, the software owner's super admin account. Run it on the server:
//
//   SUPER_ADMIN_USERNAME=taha SUPER_ADMIN_PASSWORD='…' npm run bootstrap:super-admin --workspace @pharmacy/api
//
// The account gets the SUPER_ADMIN role in every shop, so it can sign in at any of them. It can
// only be created from the server: no screen can grant the role to itself or to anyone else
// except an existing super admin.
import { hash } from 'argon2';
import { parseEnvironment } from '@pharmacy/config';
import { createDatabase } from '@pharmacy/database';
import { PASSWORD_MIN_LENGTH } from '@pharmacy/shared';

const username = process.env.SUPER_ADMIN_USERNAME?.trim();
const password = process.env.SUPER_ADMIN_PASSWORD;
const displayName = process.env.SUPER_ADMIN_DISPLAY_NAME?.trim() || 'Super admin';
if (!username || username.length < 3 || !password || password.length < PASSWORD_MIN_LENGTH) {
  throw new Error(
    `SUPER_ADMIN_USERNAME (3+ characters) and a ${String(PASSWORD_MIN_LENGTH)}+ character SUPER_ADMIN_PASSWORD are required`,
  );
}
const adminUsername = username;
const adminPassword = password;

const environment = parseEnvironment();
const database = createDatabase(process.env.DATABASE_ADMIN_URL ?? environment.DATABASE_URL, {
  max: 1,
});

try {
  const passwordHash = await hash(adminPassword, {
    type: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
  const shops = await database.begin(async (transaction) => {
    const [role] = await transaction<Array<{ id: string }>>`
      select id::text from roles where code = 'SUPER_ADMIN'
    `;
    if (!role) throw new Error('Run npm run db:migrate first: the SUPER_ADMIN role is missing');
    const [user] = await transaction<Array<{ id: string }>>`
      insert into users (username, display_name, password_hash)
      values (${adminUsername}, ${displayName}, ${passwordHash})
      on conflict (lower(username)) where deleted_at is null
      do update set password_hash = excluded.password_hash, is_active = true,
        failed_login_count = 0, locked_until = null
      returning id::text
    `;
    if (!user) throw new Error('Super admin bootstrap failed');
    const branches = await transaction<Array<{ id: string; terminal_id: string | null }>>`
      select branches.id::text,
        (select terminals.id::text from terminals where terminals.branch_id = branches.id
          order by (terminals.terminal_type = 'ADMIN') desc, terminals.id limit 1) as terminal_id
      from branches order by branches.id
    `;
    if (branches.length === 0) throw new Error('Create a shop first (npm run bootstrap:owner)');
    for (const branch of branches) {
      await transaction`
        insert into user_branch_roles (user_id, branch_id, role_id)
        values (${user.id}, ${branch.id}, ${role.id})
        on conflict do nothing
      `;
      await transaction`
        insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id)
        values (${branch.id}, ${user.id}, ${branch.terminal_id}, 'SYSTEM.SUPER_ADMIN_BOOTSTRAPPED',
          'user', ${user.id})
      `;
    }
    return branches.length;
  });
  process.stdout.write(`Super admin ${adminUsername} is ready in ${String(shops)} shop(s)\n`);
} finally {
  await database.end();
}
