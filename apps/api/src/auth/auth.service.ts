import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import type { LoginRequest } from '@pharmacy/shared';
import { DATABASE, ENVIRONMENT } from '../database.module.js';
import type { AuthenticatedUser } from './auth.types.js';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=1,t=3$Qmtqvlr9uuf0LHmWB9gtWQ$bqjEBg5g/m9jpoCKjF9k6ylMJbHj2GZxzLiSk8jQy3Q';

interface LoginThrottleScope {
  readonly hash: Buffer;
  readonly lockKey: string;
  readonly type: 'IP' | 'USERNAME';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private loginThrottleScopes(input: LoginRequest, ipAddress?: string): LoginThrottleScope[] {
    const definitions = [
      { type: 'IP' as const, value: ipAddress?.trim() || 'unknown' },
      { type: 'USERNAME' as const, value: input.username.trim().toLocaleLowerCase('en-US') },
    ];
    return definitions.map((scope) => {
      const lockKey = `AUTH.LOGIN:${scope.type}:${scope.value}`;
      return {
        hash: createHash('sha256').update(lockKey).digest(),
        lockKey,
        type: scope.type,
      };
    });
  }

  private async consumeLoginAttempt(scopes: readonly LoginThrottleScope[]): Promise<boolean> {
    return this.database.begin(async (transaction) => {
      await transaction`
        delete from auth_login_throttles where ctid in (
          select ctid from auth_login_throttles
          where updated_at < now() -
            (${this.environment.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 2} * interval '1 minute')
          order by updated_at limit 100
        )
      `;
      const orderedScopes = [...scopes].sort((left, right) =>
        left.lockKey.localeCompare(right.lockKey),
      );
      for (const scope of orderedScopes) {
        await transaction`select pg_advisory_xact_lock(hashtextextended(${scope.lockKey}, 0))`;
      }

      const states = new Map<
        string,
        {
          readonly attempt_count: number;
          readonly blocked: boolean;
          readonly window_expired: boolean;
        }
      >();
      for (const scope of orderedScopes) {
        const [state] = await transaction<
          Array<{ attempt_count: number; blocked: boolean; window_expired: boolean }>
        >`
          select attempt_count, coalesce(blocked_until > now(), false) as blocked,
            window_started_at <= now() -
              (${this.environment.LOGIN_RATE_LIMIT_WINDOW_MINUTES} * interval '1 minute')
              as window_expired
          from auth_login_throttles
          where scope_type = ${scope.type} and scope_hash = ${scope.hash}
          for update
        `;
        if (state) states.set(scope.lockKey, state);
      }

      for (const scope of orderedScopes) {
        const state = states.get(scope.lockKey);
        if (state?.blocked) return false;
        if (
          state &&
          !state.window_expired &&
          state.attempt_count >= this.environment.LOGIN_RATE_LIMIT_ATTEMPTS
        ) {
          await transaction`
            update auth_login_throttles
            set blocked_until = now() +
                (${this.environment.LOGIN_RATE_LIMIT_WINDOW_MINUTES} * interval '1 minute'),
              updated_at = now()
            where scope_type = ${scope.type} and scope_hash = ${scope.hash}
          `;
          return false;
        }
      }

      for (const scope of orderedScopes) {
        const state = states.get(scope.lockKey);
        if (!state) {
          await transaction`
            insert into auth_login_throttles (
              scope_type, scope_hash, attempt_count, window_started_at
            ) values (${scope.type}, ${scope.hash}, 1, now())
          `;
        } else if (state.window_expired) {
          await transaction`
            update auth_login_throttles
            set attempt_count = 1, window_started_at = now(), blocked_until = null,
              updated_at = now()
            where scope_type = ${scope.type} and scope_hash = ${scope.hash}
          `;
        } else {
          await transaction`
            update auth_login_throttles set attempt_count = attempt_count + 1, updated_at = now()
            where scope_type = ${scope.type} and scope_hash = ${scope.hash}
          `;
        }
      }
      return true;
    });
  }

  private async recordFailedPassword(userId: string): Promise<void> {
    await this.database`
      with state as (
        select id,
          case
            when failed_login_window_started_at is null
              or failed_login_window_started_at <= now() -
                (${this.environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
            then 1 else failed_login_count + 1
          end as next_count,
          case
            when failed_login_window_started_at is null
              or failed_login_window_started_at <= now() -
                (${this.environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
            then now() else failed_login_window_started_at
          end as next_window
        from users
        where id = ${userId} and (locked_until is null or locked_until <= now())
        for update
      )
      update users set failed_login_count = state.next_count,
        failed_login_window_started_at = state.next_window,
        locked_until = case
          when state.next_count >= ${this.environment.ACCOUNT_LOCKOUT_FAILURES}
          then now() + (${this.environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
          else null
        end
      from state where users.id = state.id
    `;
  }

  private async auditRejectedLogin(
    eventType: 'AUTH.LOGIN_FAILED' | 'AUTH.LOGIN_RATE_LIMITED',
    input: LoginRequest,
    ipAddress?: string,
  ): Promise<void> {
    await this.database`
      insert into audit_events (event_type, ip_address, metadata)
      values (
        ${eventType}, ${ipAddress ?? null},
        ${this.database.json({ username: input.username, terminalCode: input.terminalCode })}
      )
    `;
  }

  async login(input: LoginRequest, ipAddress?: string): Promise<Record<string, unknown>> {
    const throttleScopes = this.loginThrottleScopes(input, ipAddress);
    if (!(await this.consumeLoginAttempt(throttleScopes))) {
      await this.auditRejectedLogin('AUTH.LOGIN_RATE_LIMITED', input, ipAddress);
      throw new UnauthorizedException('Invalid credentials or terminal');
    }

    const [account] = await this.database<
      Array<{
        user_id: string;
        username: string;
        display_name: string;
        password_hash: string;
        branch_id: string;
        branch_timezone: string;
        terminal_id: string;
        terminal_code: string;
        terminal_name: string;
        locked_until: Date | null;
      }>
    >`
      select users.id::text as user_id, users.username, users.display_name, users.password_hash,
        terminals.branch_id::text as branch_id, branches.timezone as branch_timezone,
        terminals.id::text as terminal_id, terminals.code as terminal_code,
        terminals.name as terminal_name, users.locked_until
      from users
      join terminals on lower(terminals.code) = lower(${input.terminalCode}) and terminals.is_active = true
      join branches on branches.id = terminals.branch_id and branches.is_active = true
      where lower(users.username) = lower(${input.username})
        and users.is_active = true and users.deleted_at is null
        and exists (
          select 1 from user_branch_roles
          where user_branch_roles.user_id = users.id
            and user_branch_roles.branch_id = terminals.branch_id
        )
      order by terminals.branch_id, terminals.id
      limit 1
    `;

    const valid = await verify(account?.password_hash ?? DUMMY_PASSWORD_HASH, input.password);
    const accountLocked = account
      ? account.locked_until !== null && account.locked_until > new Date()
      : false;
    if (!account || !valid || accountLocked) {
      if (account && !valid) await this.recordFailedPassword(account.user_id);
      await this.auditRejectedLogin('AUTH.LOGIN_FAILED', input, ipAddress);
      throw new UnauthorizedException('Invalid credentials or terminal');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest();
    const expiresAt = new Date(Date.now() + this.environment.SESSION_TTL_MINUTES * 60_000);
    const absoluteExpiresAt = new Date(
      Date.now() + this.environment.SESSION_ABSOLUTE_TTL_MINUTES * 60_000,
    );
    const usernameScope = throttleScopes.find((scope) => scope.type === 'USERNAME');

    const session = await this.database.begin(async (transaction) => {
      await transaction`
        update users set failed_login_count = 0, failed_login_window_started_at = null,
          locked_until = null, last_login_at = now()
        where id = ${account.user_id}
      `;
      const permissionRows = await transaction<Array<{ code: string }>>`
        select distinct permissions.code
        from user_branch_roles
        join role_permissions on role_permissions.role_id = user_branch_roles.role_id
        join permissions on permissions.id = role_permissions.permission_id
        where user_branch_roles.user_id = ${account.user_id}
          and user_branch_roles.branch_id = ${account.branch_id}
        order by permissions.code
      `;
      const permissionSnapshot = permissionRows.map((permission) => permission.code);
      const rows = await transaction<Array<{ session_id: string }>>`
        insert into sessions (
          user_id, branch_id, terminal_id, token_hash, expires_at, absolute_expires_at,
          permission_snapshot
        ) values (
          ${account.user_id}, ${account.branch_id}, ${account.terminal_id}, ${tokenHash},
          ${expiresAt}, ${absoluteExpiresAt}, ${permissionSnapshot}
        )
        returning id::text as session_id
      `;
      const session = rows[0];
      if (!session) throw new Error('Session creation did not return an identifier');
      await transaction`
        insert into audit_events (branch_id, user_id, terminal_id, event_type, entity_type, entity_id, ip_address)
        values (${account.branch_id}, ${account.user_id}, ${account.terminal_id}, 'AUTH.LOGIN_SUCCEEDED', 'session', ${session.session_id}, ${ipAddress ?? null})
      `;
      if (usernameScope) {
        await transaction`
          delete from auth_login_throttles
          where scope_type = 'USERNAME' and scope_hash = ${usernameScope.hash}
        `;
      }
      return { ...session, permissions: permissionSnapshot };
    });

    return {
      accessToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      sessionId: session.session_id,
      user: {
        id: account.user_id,
        username: account.username,
        displayName: account.display_name,
        branchId: account.branch_id,
        branchTimezone: account.branch_timezone,
        terminalId: account.terminal_id,
        terminalCode: account.terminal_code,
        terminalName: account.terminal_name,
        permissions: session.permissions,
      },
    };
  }

  async logout(user: AuthenticatedUser, ipAddress?: string): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [revoked] = await transaction<Array<{ id: string }>>`
        update sessions set revoked_at = now(), revoke_reason = 'USER_LOGOUT'
        where id = ${user.sessionId} and user_id = ${user.id} and branch_id = ${user.branchId}
          and revoked_at is null
        returning id::text
      `;
      if (revoked) {
        await transaction`
          insert into audit_events (
            branch_id, user_id, terminal_id, event_type, entity_type, entity_id, ip_address
          ) values (
            ${user.branchId}, ${user.id}, ${user.terminalId}, 'AUTH.LOGOUT', 'session',
            ${user.sessionId}, ${ipAddress ?? null}
          )
        `;
      }
      return { revoked: Boolean(revoked), idempotentReplay: !revoked };
    });
  }
}
