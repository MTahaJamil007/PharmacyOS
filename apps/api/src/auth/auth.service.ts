import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import type { LoginRequest } from '@pharmacy/shared';
import { DATABASE, ENVIRONMENT } from '../database.module.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async login(input: LoginRequest, ipAddress?: string): Promise<Record<string, unknown>> {
    const [account] = await this.database<
      Array<{
        user_id: string;
        username: string;
        display_name: string;
        password_hash: string;
        branch_id: string;
        terminal_id: string;
        locked_until: Date | null;
      }>
    >`
      select users.id::text as user_id, users.username, users.display_name, users.password_hash,
        terminals.branch_id::text as branch_id, terminals.id::text as terminal_id, users.locked_until
      from users
      join terminals on lower(terminals.code) = lower(${input.terminalCode}) and terminals.is_active = true
      join user_branch_roles on user_branch_roles.user_id = users.id
        and user_branch_roles.branch_id = terminals.branch_id
      where lower(users.username) = lower(${input.username})
        and users.is_active = true and users.deleted_at is null
      limit 1
    `;

    const valid = account ? await verify(account.password_hash, input.password) : false;
    if (
      !account ||
      !valid ||
      (account.locked_until !== null && account.locked_until > new Date())
    ) {
      if (account) {
        await this.database`
          update users set
            failed_login_count = failed_login_count + 1,
            locked_until = case when failed_login_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
          where id = ${account.user_id}
        `;
      }
      await this.database`
        insert into audit_events (event_type, ip_address, metadata)
        values ('AUTH.LOGIN_FAILED', ${ipAddress ?? null}, ${this.database.json({ username: input.username, terminalCode: input.terminalCode })})
      `;
      throw new UnauthorizedException('Invalid credentials or terminal');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest();
    const expiresAt = new Date(Date.now() + this.environment.SESSION_TTL_MINUTES * 60_000);

    const [session] = await this.database.begin(async (transaction) => {
      await transaction`
        update users set failed_login_count = 0, locked_until = null, last_login_at = now()
        where id = ${account.user_id}
      `;
      const rows = await transaction<Array<{ session_id: string }>>`
        insert into sessions (user_id, branch_id, terminal_id, token_hash, expires_at)
        values (${account.user_id}, ${account.branch_id}, ${account.terminal_id}, ${tokenHash}, ${expiresAt})
        returning id::text as session_id
      `;
      const session = rows[0];
      if (!session) throw new Error('Session creation did not return an identifier');
      await transaction`
        insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id, ip_address)
        values (${account.branch_id}, ${account.user_id}, ${account.terminal_id}, 'AUTH.LOGIN_SUCCEEDED', 'session', ${session.session_id}, ${ipAddress ?? null})
      `;
      return rows;
    });
    const permissionRows = await this.database<Array<{ code: string }>>`
      select distinct permissions.code
      from user_branch_roles
      join role_permissions on role_permissions.role_id = user_branch_roles.role_id
      join permissions on permissions.id = role_permissions.permission_id
      where user_branch_roles.user_id = ${account.user_id}
        and user_branch_roles.branch_id = ${account.branch_id}
      order by permissions.code
    `;

    return {
      accessToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      sessionId: session?.session_id,
      user: {
        id: account.user_id,
        username: account.username,
        displayName: account.display_name,
        branchId: account.branch_id,
        terminalId: account.terminal_id,
        permissions: permissionRows.map((permission) => permission.code),
      },
    };
  }
}
