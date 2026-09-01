import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash, verify } from 'argon2';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import type { CreateUserRequest, UpdateUserRequest } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

const HASH_OPTIONS = { type: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;
type AuditMetadata = Readonly<
  Record<string, string | number | boolean | null | readonly string[] | undefined>
>;

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async list(user: AuthenticatedUser) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select users.id::text, users.username, users.display_name as "displayName",
        users.is_active as "isActive", users.locked_until as "lockedUntil",
        users.last_login_at as "lastLoginAt", users.created_at as "createdAt",
        coalesce(array_agg(roles.code order by roles.code)
          filter (where roles.code is not null), '{}') as roles
      from users
      join user_branch_roles on user_branch_roles.user_id = users.id
        and user_branch_roles.branch_id = ${user.branchId}
      join roles on roles.id = user_branch_roles.role_id
      where users.deleted_at is null
      group by users.id order by users.display_name, users.id
    `;
    return { data };
  }

  async roles() {
    const data = await this.database<Array<Record<string, unknown>>>`
      select code, name, description from roles order by code
    `;
    return { data };
  }

  async create(user: AuthenticatedUser, input: CreateUserRequest) {
    const passwordHash = await hash(input.password, HASH_OPTIONS);
    const roleCodes = [...new Set(input.roles)];
    return this.database.begin(async (transaction) => {
      const roleIds = await this.resolveRoleIds(transaction, roleCodes);
      const [created] = await transaction<Array<{ id: string }>>`
        insert into users (username, display_name, password_hash)
        values (${input.username}, ${input.displayName}, ${passwordHash}) returning id::text
      `;
      if (!created) throw new Error('User creation did not return an identifier');
      for (const roleId of roleIds) {
        await transaction`
          insert into user_branch_roles (user_id, branch_id, role_id, granted_by_user_id)
          values (${created.id}, ${user.branchId}, ${roleId}, ${user.id})
        `;
      }
      await this.audit(transaction, user, 'USER.CREATED', created.id, {
        username: input.username,
        roles: roleCodes,
      });
      return { id: created.id, username: input.username, roles: roleCodes };
    });
  }

  async update(user: AuthenticatedUser, userId: bigint, input: UpdateUserRequest) {
    const id = userId.toString();
    if (id === user.id && input.isActive === false) {
      throw new ConflictException('You cannot deactivate your own account');
    }
    const roleCodes = input.roles ? [...new Set(input.roles)] : undefined;
    return this.database.begin(async (transaction) => {
      const [target] = await transaction<Array<{ id: string; is_active: boolean }>>`
        select users.id::text, users.is_active from users
        where users.id = ${id} and users.deleted_at is null
          and exists (select 1 from user_branch_roles
            where user_id = users.id and branch_id = ${user.branchId})
        for update
      `;
      if (!target) throw new NotFoundException('User not found');

      const targetIsOwner = await this.isOwner(transaction, user.branchId, id);
      const keepsOwner = roleCodes?.includes('OWNER') ?? targetIsOwner;
      const remainsActive = input.isActive ?? target.is_active;
      if (targetIsOwner && (!keepsOwner || !remainsActive)) {
        const [owners] = await transaction<Array<{ count: number }>>`
          select count(distinct users.id)::int as count from users
          join user_branch_roles on user_branch_roles.user_id = users.id
          join roles on roles.id = user_branch_roles.role_id and roles.code = 'OWNER'
          where user_branch_roles.branch_id = ${user.branchId}
            and users.is_active and users.deleted_at is null
        `;
        if ((owners?.count ?? 0) <= 1) {
          throw new ConflictException('The branch must retain at least one active owner');
        }
      }

      const hasDisplayName = input.displayName !== undefined;
      const hasActive = input.isActive !== undefined;
      await transaction`
        update users set
          display_name = case when ${hasDisplayName} then ${input.displayName ?? null} else display_name end,
          is_active = case when ${hasActive} then ${input.isActive ?? target.is_active} else is_active end,
          locked_until = case when ${input.isActive === true} then null else locked_until end,
          failed_login_count = case when ${input.isActive === true} then 0 else failed_login_count end
        where id = ${id}
      `;
      if (roleCodes) {
        const roleIds = await this.resolveRoleIds(transaction, roleCodes);
        await transaction`
          delete from user_branch_roles where user_id = ${id} and branch_id = ${user.branchId}
        `;
        for (const roleId of roleIds) {
          await transaction`
            insert into user_branch_roles (user_id, branch_id, role_id, granted_by_user_id)
            values (${id}, ${user.branchId}, ${roleId}, ${user.id})
          `;
        }
      }
      if (input.isActive === false) {
        await transaction`
          update sessions set revoked_at = now(), revoke_reason = 'USER_DEACTIVATED'
          where user_id = ${id} and revoked_at is null
        `;
      }
      await this.audit(transaction, user, 'USER.UPDATED', id, {
        fields: Object.keys(input),
        roles: roleCodes,
      });
      return { id, updated: true };
    });
  }

  async resetPassword(user: AuthenticatedUser, userId: bigint, password: string) {
    const passwordHash = await hash(password, HASH_OPTIONS);
    const id = userId.toString();
    return this.database.begin(async (transaction) => {
      const [updated] = await transaction<Array<{ id: string }>>`
        update users set password_hash = ${passwordHash}, failed_login_count = 0, locked_until = null
        where id = ${id} and deleted_at is null
          and exists (select 1 from user_branch_roles
            where user_id = users.id and branch_id = ${user.branchId})
        returning id::text
      `;
      if (!updated) throw new NotFoundException('User not found');
      await transaction`
        update sessions set revoked_at = now(), revoke_reason = 'PASSWORD_RESET'
        where user_id = ${id} and revoked_at is null
      `;
      await this.audit(transaction, user, 'USER.PASSWORD_RESET', id, {});
      return { id, sessionsRevoked: true };
    });
  }

  async changeOwnPassword(user: AuthenticatedUser, currentPassword: string, newPassword: string) {
    const [account] = await this.database<Array<{ password_hash: string }>>`
      select password_hash from users where id = ${user.id} and is_active and deleted_at is null
    `;
    if (!account || !(await verify(account.password_hash, currentPassword))) {
      throw new ForbiddenException('Current password is incorrect');
    }
    if (await verify(account.password_hash, newPassword)) {
      throw new ConflictException('New password must differ from the current password');
    }
    const passwordHash = await hash(newPassword, HASH_OPTIONS);
    return this.database.begin(async (transaction) => {
      await transaction`update users set password_hash = ${passwordHash} where id = ${user.id}`;
      await transaction`
        update sessions set revoked_at = now(), revoke_reason = 'PASSWORD_CHANGED'
        where user_id = ${user.id} and id <> ${user.sessionId} and revoked_at is null
      `;
      await this.audit(transaction, user, 'USER.PASSWORD_CHANGED', user.id, {});
      return { id: user.id, otherSessionsRevoked: true };
    });
  }

  private async resolveRoleIds(transaction: DatabaseTransaction, codes: readonly string[]) {
    const roles = await transaction<Array<{ id: string; code: string }>>`
      select id::text, code from roles where code in ${transaction(codes)} order by code
    `;
    if (roles.length !== codes.length) throw new ConflictException('One or more roles are invalid');
    return roles.map((role) => role.id);
  }

  private async isOwner(transaction: DatabaseTransaction, branchId: string, userId: string) {
    const [row] = await transaction<Array<{ owner: boolean }>>`
      select exists (select 1 from user_branch_roles
        join roles on roles.id = user_branch_roles.role_id
        where user_branch_roles.branch_id = ${branchId}
          and user_branch_roles.user_id = ${userId} and roles.code = 'OWNER') as owner
    `;
    return row?.owner ?? false;
  }

  private async audit(
    transaction: DatabaseTransaction,
    actor: AuthenticatedUser,
    eventType: string,
    entityId: string,
    metadata: AuditMetadata,
  ) {
    await transaction`
      insert into audit_events (
        branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
      ) values (
        ${actor.branchId}, ${actor.id}, ${actor.terminalId}, ${eventType}, 'user',
        ${entityId}, ${transaction.json(metadata)}
      )
    `;
  }
}
