import { hash } from 'argon2';
import { parseEnvironment } from '@pharmacy/config';
import { createDatabase } from '@pharmacy/database';

const username = process.env.BOOTSTRAP_OWNER_USERNAME;
const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
if (!username || !password || password.length < 12) {
  throw new Error(
    'BOOTSTRAP_OWNER_USERNAME and a 12+ character BOOTSTRAP_OWNER_PASSWORD are required',
  );
}
const ownerUsername = username;
const ownerPassword = password;

const environment = parseEnvironment();
const database = createDatabase(environment.DATABASE_URL, { max: 1 });

try {
  const passwordHash = await hash(ownerPassword, {
    type: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
  await database.begin(async (transaction) => {
    const [branch] = await transaction<Array<{ id: string }>>`
      insert into branches (code, name) values ('MAIN', 'Main pharmacy')
      on conflict (code) do update set name = excluded.name
      returning id::text
    `;
    if (!branch) throw new Error('Branch bootstrap failed');
    const [terminal] = await transaction<Array<{ id: string }>>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branch.id}, 'ADMIN-01', 'Owner / admin', 'ADMIN')
      on conflict (branch_id, code) do update set name = excluded.name, is_active = true
      returning id::text
    `;
    if (!terminal) throw new Error('Terminal bootstrap failed');
    const [user] = await transaction<Array<{ id: string }>>`
      insert into users (username, display_name, password_hash)
      values (${ownerUsername}, 'Pharmacy owner', ${passwordHash})
      on conflict (lower(username)) where deleted_at is null
      do update set password_hash = excluded.password_hash, is_active = true
      returning id::text
    `;
    if (!user) throw new Error('Owner bootstrap failed');
    await transaction`
      insert into user_branch_roles (user_id, branch_id, role_id)
      select ${user.id}, ${branch.id}, roles.id from roles where code = 'OWNER'
      on conflict do nothing
    `;
    await transaction`
      insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id)
      values (${branch.id}, ${user.id}, ${terminal.id}, 'SYSTEM.OWNER_BOOTSTRAPPED', 'user', ${user.id})
    `;
  });
  process.stdout.write(`Owner ${ownerUsername} is ready on terminal ADMIN-01\n`);
} finally {
  await database.end();
}
