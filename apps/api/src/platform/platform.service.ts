import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'argon2';
import type { Environment } from '@pharmacy/config';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import type { ShopProfileUpdate } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { auditShopEvent, SHOP_COLUMNS, toShop, type ShopRow } from '../common/shop-profile.js';
import { DATABASE, ENVIRONMENT } from '../database.module.js';

const HASH_OPTIONS = { type: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export interface PlatformUserInput {
  readonly branchId: bigint;
  readonly username: string;
  readonly displayName: string;
  readonly password: string;
  readonly roles: readonly string[];
}

export interface PlatformUserUpdate {
  readonly displayName?: string | undefined;
  readonly isActive?: boolean | undefined;
  readonly branchId?: bigint | undefined;
  readonly roles?: readonly string[] | undefined;
}

/**
 * The software owner's controls. Every operation here works across shops, so each one names the
 * shop it acts on, locks what it changes, and writes the audit trail against that shop.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  system() {
    return {
      fbrMode: this.environment.FBR_MODE,
      fbrApiBaseUrl: this.environment.FBR_API_BASE_URL,
      fbrTokenConfigured: Boolean(this.environment.FBR_API_TOKEN),
      nodeVersion: process.version,
      environment: this.environment.NODE_ENV,
    };
  }

  async shops() {
    const rows = await this.database<
      Array<ShopRow & { users: number; terminals: number; sales_today: number }>
    >`
      select ${this.database.unsafe(SHOP_COLUMNS)},
        (select count(distinct user_id)::int from user_branch_roles
          where user_branch_roles.branch_id = branches.id) as users,
        (select count(*)::int from terminals
          where terminals.branch_id = branches.id and terminals.is_active) as terminals,
        (select count(*)::int from sales where sales.branch_id = branches.id
          and sales.created_at >= date_trunc('day', now() at time zone branches.timezone)
            at time zone branches.timezone) as sales_today
      from branches order by branches.id
    `;
    return {
      data: rows.map((row) => ({
        ...toShop(row, this.environment),
        users: row.users,
        terminals: row.terminals,
        salesToday: row.sales_today,
      })),
    };
  }

  async createShop(
    actor: AuthenticatedUser,
    input: { code: string; name: string; address?: string | undefined; phone?: string | undefined },
  ) {
    return this.database.begin(async (transaction) => {
      const [existing] = await transaction<Array<{ id: string }>>`
        select id::text from branches where code = ${input.code}
      `;
      if (existing) throw new ConflictException(`Shop code ${input.code} is already used`);
      const [branch] = await transaction<Array<{ id: string }>>`
        insert into branches (code, name, address, phone)
        values (${input.code}, ${input.name}, ${input.address ?? null}, ${input.phone ?? null})
        returning id::text
      `;
      if (!branch) throw new Error('Shop creation did not return an identifier');
      await transaction`insert into operational_intelligence_policies (branch_id) values (${branch.id})`;
      await transaction`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${branch.id}, ${`${input.code}-ADMIN`}, 'Owner / admin', 'ADMIN')
      `;
      await auditShopEvent(transaction, actor, 'PLATFORM.SHOP_CREATED', branch.id, {
        code: input.code,
      });
      return this.shopRow(transaction, branch.id);
    });
  }

  async updateShop(actor: AuthenticatedUser, branchId: bigint, input: ShopProfileUpdate) {
    const id = branchId.toString();
    return this.database.begin(async (transaction) => {
      await this.lockShop(transaction, id);
      const set = <T>(value: T | undefined) => value !== undefined;
      await transaction`
        update branches set
          name = case when ${set(input.name)} then ${input.name ?? null} else name end,
          address = case when ${set(input.address)} then ${input.address ?? null} else address end,
          phone = case when ${set(input.phone)} then ${input.phone ?? null} else phone end,
          email = case when ${set(input.email)} then ${input.email ?? null} else email end,
          drug_license_number = case when ${set(input.drugLicenseNumber)}
            then ${input.drugLicenseNumber ?? null} else drug_license_number end,
          seller_ntn_cnic = case when ${set(input.sellerNtnCnic)}
            then ${input.sellerNtnCnic ?? null} else seller_ntn_cnic end,
          seller_strn = case when ${set(input.sellerStrn)}
            then ${input.sellerStrn ?? null} else seller_strn end,
          fbr_pos_registration_number = case when ${set(input.posRegistrationNumber)}
            then ${input.posRegistrationNumber ?? null} else fbr_pos_registration_number end,
          fbr_business_name = case when ${set(input.businessName)}
            then ${input.businessName ?? null} else fbr_business_name end,
          fbr_province = case when ${set(input.province)}
            then ${input.province ?? null} else fbr_province end,
          fbr_scenario_id = case when ${set(input.scenarioId)}
            then ${input.scenarioId ?? null} else fbr_scenario_id end
        where id = ${id}
      `;
      const shop = await this.shopRow(transaction, id);
      // A shop that loses part of its registration cannot keep fiscalizing sales.
      if (shop.fbr.invoicingEnabled && shop.fbr.registrationGaps.length > 0) {
        await transaction`
          update branches set fbr_invoicing_enabled = false, fbr_invoicing_changed_at = now(),
            fbr_invoicing_changed_by = ${actor.id}
          where id = ${id}
        `;
      }
      await auditShopEvent(transaction, actor, 'PLATFORM.SHOP_UPDATED', id, {
        fields: Object.keys(input),
      });
      return this.shopRow(transaction, id);
    });
  }

  async setShopActive(actor: AuthenticatedUser, branchId: bigint, isActive: boolean) {
    const id = branchId.toString();
    if (!isActive && id === actor.branchId) {
      throw new ConflictException('You cannot deactivate the shop you are signed in to');
    }
    return this.database.begin(async (transaction) => {
      await this.lockShop(transaction, id);
      await transaction`update branches set is_active = ${isActive} where id = ${id}`;
      if (!isActive) {
        await transaction`
          update sessions set revoked_at = now(), revoke_reason = 'BRANCH_DEACTIVATED'
          where branch_id = ${id} and revoked_at is null
        `;
      }
      await auditShopEvent(
        transaction,
        actor,
        isActive ? 'PLATFORM.SHOP_ACTIVATED' : 'PLATFORM.SHOP_DEACTIVATED',
        id,
        {},
      );
      return this.shopRow(transaction, id);
    });
  }

  async setFbrInvoicing(actor: AuthenticatedUser, branchId: bigint, enabled: boolean) {
    const id = branchId.toString();
    return this.database.begin(async (transaction) => {
      await this.lockShop(transaction, id);
      const shop = await this.shopRow(transaction, id);
      if (enabled && shop.fbr.registrationGaps.length > 0) {
        throw new ConflictException(
          `Complete the FBR registration first: ${shop.fbr.registrationGaps.join(', ')}`,
        );
      }
      await transaction`
        update branches set fbr_invoicing_enabled = ${enabled}, fbr_invoicing_changed_at = now(),
          fbr_invoicing_changed_by = ${actor.id}
        where id = ${id}
      `;
      await auditShopEvent(
        transaction,
        actor,
        enabled ? 'PLATFORM.FBR_INVOICING_ENABLED' : 'PLATFORM.FBR_INVOICING_DISABLED',
        id,
        { enabled },
      );
      return this.shopRow(transaction, id);
    });
  }

  /**
   * Live transmission to FBR stays off until the software owner approves it for a shop (ADR 0004):
   * until then fiscal jobs record a blocked attempt and never invent an invoice number.
   */
  async setFbrTransmission(
    actor: AuthenticatedUser,
    branchId: bigint,
    approved: boolean,
    reason: string,
  ) {
    const id = branchId.toString();
    return this.database.begin(async (transaction) => {
      await this.lockShop(transaction, id);
      const shop = await this.shopRow(transaction, id);
      if (approved && shop.fbr.registrationGaps.length > 0) {
        throw new ConflictException(
          `Complete the FBR registration first: ${shop.fbr.registrationGaps.join(', ')}`,
        );
      }
      await transaction`
        update branches set fbr_transmission_approved = ${approved},
          fbr_transmission_approved_at = case when ${approved} then now() else null end,
          fbr_transmission_approved_by = case when ${approved} then ${actor.id}::bigint else null end
        where id = ${id}
      `;
      await auditShopEvent(
        transaction,
        actor,
        approved ? 'PLATFORM.FBR_TRANSMISSION_APPROVED' : 'PLATFORM.FBR_TRANSMISSION_WITHDRAWN',
        id,
        { reason },
      );
      return this.shopRow(transaction, id);
    });
  }

  async users() {
    const data = await this.database<Array<Record<string, unknown>>>`
      select users.id::text, users.username, users.display_name as "displayName",
        users.is_active as "isActive", users.locked_until as "lockedUntil",
        users.failed_login_count as "failedLoginCount",
        users.last_login_at as "lastLoginAt",
        coalesce(json_agg(json_build_object(
          'branchId', user_branch_roles.branch_id::text, 'branchName', branches.name,
          'role', roles.code
        ) order by branches.id, roles.code) filter (where roles.code is not null), '[]') as access
      from users
      left join user_branch_roles on user_branch_roles.user_id = users.id
      left join branches on branches.id = user_branch_roles.branch_id
      left join roles on roles.id = user_branch_roles.role_id
      where users.deleted_at is null
      group by users.id order by users.display_name, users.id
    `;
    return { data };
  }

  async createUser(actor: AuthenticatedUser, input: PlatformUserInput) {
    const passwordHash = await hash(input.password, HASH_OPTIONS);
    const branchId = input.branchId.toString();
    const roleCodes = [...new Set(input.roles)];
    return this.database.begin(async (transaction) => {
      await this.lockShop(transaction, branchId);
      const roleIds = await this.resolveRoleIds(transaction, roleCodes);
      const [taken] = await transaction<Array<{ id: string }>>`
        select id::text from users
        where lower(username) = lower(${input.username}) and deleted_at is null
      `;
      if (taken) throw new ConflictException(`Username ${input.username} is already used`);
      const [created] = await transaction<Array<{ id: string }>>`
        insert into users (username, display_name, password_hash)
        values (${input.username}, ${input.displayName}, ${passwordHash}) returning id::text
      `;
      if (!created) throw new Error('User creation did not return an identifier');
      for (const roleId of roleIds) {
        await transaction`
          insert into user_branch_roles (user_id, branch_id, role_id, granted_by_user_id)
          values (${created.id}, ${branchId}, ${roleId}, ${actor.id})
        `;
      }
      await this.auditUser(transaction, actor, branchId, 'PLATFORM.USER_CREATED', created.id, {
        username: input.username,
        roles: roleCodes,
      });
      return { id: created.id, username: input.username, roles: roleCodes };
    });
  }

  async updateUser(actor: AuthenticatedUser, userId: bigint, input: PlatformUserUpdate) {
    const id = userId.toString();
    if (id === actor.id && input.isActive === false) {
      throw new ConflictException('You cannot deactivate your own account');
    }
    if ((input.roles === undefined) !== (input.branchId === undefined)) {
      throw new ConflictException('Roles are set for one shop: send branchId with roles');
    }
    const roleCodes = input.roles ? [...new Set(input.roles)] : undefined;
    return this.database.begin(async (transaction) => {
      const [target] = await transaction<Array<{ id: string; is_active: boolean }>>`
        select id::text, is_active from users
        where id = ${id} and deleted_at is null for update
      `;
      if (!target) throw new NotFoundException('User not found');
      if (id === actor.id && roleCodes && !roleCodes.includes('SUPER_ADMIN')) {
        throw new ConflictException('You cannot remove your own super admin role');
      }
      await transaction`
        update users set
          display_name = case when ${input.displayName !== undefined}
            then ${input.displayName ?? null} else display_name end,
          is_active = case when ${input.isActive !== undefined}
            then ${input.isActive ?? target.is_active} else is_active end,
          locked_until = case when ${input.isActive === true} then null else locked_until end,
          failed_login_count = case when ${input.isActive === true} then 0 else failed_login_count end
        where id = ${id}
      `;
      let branchId = actor.branchId;
      if (roleCodes && input.branchId !== undefined) {
        branchId = input.branchId.toString();
        await this.lockShop(transaction, branchId);
        const roleIds = await this.resolveRoleIds(transaction, roleCodes);
        await transaction`
          delete from user_branch_roles where user_id = ${id} and branch_id = ${branchId}
        `;
        for (const roleId of roleIds) {
          await transaction`
            insert into user_branch_roles (user_id, branch_id, role_id, granted_by_user_id)
            values (${id}, ${branchId}, ${roleId}, ${actor.id})
          `;
        }
        await transaction`
          update sessions set revoked_at = now(), revoke_reason = 'ROLES_CHANGED'
          where user_id = ${id} and branch_id = ${branchId} and revoked_at is null
            and id <> ${actor.sessionId}
        `;
      }
      if (input.isActive === false) {
        await transaction`
          update sessions set revoked_at = now(), revoke_reason = 'USER_DEACTIVATED'
          where user_id = ${id} and revoked_at is null
        `;
      }
      await this.auditUser(transaction, actor, branchId, 'PLATFORM.USER_UPDATED', id, {
        fields: Object.keys(input),
        roles: roleCodes,
      });
      return { id, updated: true };
    });
  }

  async resetPassword(actor: AuthenticatedUser, userId: bigint, password: string) {
    const id = userId.toString();
    const passwordHash = await hash(password, HASH_OPTIONS);
    return this.database.begin(async (transaction) => {
      const [updated] = await transaction<Array<{ id: string }>>`
        update users set password_hash = ${passwordHash}, failed_login_count = 0,
          locked_until = null
        where id = ${id} and deleted_at is null
        returning id::text
      `;
      if (!updated) throw new NotFoundException('User not found');
      await transaction`
        update sessions set revoked_at = now(), revoke_reason = 'PASSWORD_RESET'
        where user_id = ${id} and revoked_at is null and id <> ${actor.sessionId}
      `;
      await this.auditUser(
        transaction,
        actor,
        actor.branchId,
        'PLATFORM.USER_PASSWORD_RESET',
        id,
        {},
      );
      return { id, sessionsRevoked: true };
    });
  }

  async unlockUser(actor: AuthenticatedUser, userId: bigint) {
    const id = userId.toString();
    return this.database.begin(async (transaction) => {
      const [updated] = await transaction<Array<{ id: string }>>`
        update users set failed_login_count = 0, locked_until = null
        where id = ${id} and deleted_at is null returning id::text
      `;
      if (!updated) throw new NotFoundException('User not found');
      await this.auditUser(transaction, actor, actor.branchId, 'PLATFORM.USER_UNLOCKED', id, {});
      return { id, unlocked: true };
    });
  }

  async roles() {
    const data = await this.database<Array<Record<string, unknown>>>`
      select roles.code, roles.name, roles.description,
        coalesce(array_agg(permissions.code order by permissions.code)
          filter (where permissions.code is not null), '{}') as permissions
      from roles
      left join role_permissions on role_permissions.role_id = roles.id
      left join permissions on permissions.id = role_permissions.permission_id
      group by roles.id order by roles.code
    `;
    return { data };
  }

  async audit(branchId: string | null, limit: number) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select audit_events.id::text, audit_events.event_type as "eventType",
        audit_events.entity_type as "entityType", audit_events.entity_id::text as "entityId",
        audit_events.created_at as "createdAt", audit_events.metadata,
        branches.name as "branchName", users.display_name as "userName"
      from audit_events
      left join branches on branches.id = audit_events.branch_id
      left join users on users.id = audit_events.user_id
      where ${branchId}::bigint is null or audit_events.branch_id = ${branchId}::bigint
      order by audit_events.id desc limit ${limit}
    `;
    return { data };
  }

  private async lockShop(transaction: DatabaseTransaction, branchId: string): Promise<void> {
    const [row] = await transaction<Array<{ id: string }>>`
      select id::text from branches where id = ${branchId} for update
    `;
    if (!row) throw new NotFoundException('Shop not found');
  }

  private async shopRow(transaction: DatabaseTransaction, branchId: string) {
    const [row] = await transaction<ShopRow[]>`
      select ${transaction.unsafe(SHOP_COLUMNS)} from branches where branches.id = ${branchId}
    `;
    if (!row) throw new NotFoundException('Shop not found');
    return toShop(row, this.environment);
  }

  private async resolveRoleIds(transaction: DatabaseTransaction, codes: readonly string[]) {
    const roles = await transaction<Array<{ id: string }>>`
      select id::text from roles where code in ${transaction(codes)} order by code
    `;
    if (roles.length !== codes.length) throw new ConflictException('One or more roles are invalid');
    return roles.map((role) => role.id);
  }

  private async auditUser(
    transaction: DatabaseTransaction,
    actor: AuthenticatedUser,
    branchId: string,
    eventType: string,
    userId: string,
    metadata: Readonly<Record<string, string | readonly string[] | undefined>>,
  ): Promise<void> {
    await transaction`
      insert into audit_events (
        branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
      ) values (
        ${branchId}, ${actor.id}, ${actor.terminalId}, ${eventType}, 'user', ${userId},
        ${transaction.json(metadata)}
      )
    `;
  }
}
