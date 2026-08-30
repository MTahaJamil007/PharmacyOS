import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';

import { DATABASE } from '../database.module.js';
import type { Database } from '@pharmacy/database';
import { PERMISSION_METADATA_KEY } from './auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A valid session is required');
    }

    const rawToken = authorization.slice('Bearer '.length);
    const tokenHash = createHash('sha256').update(rawToken).digest();
    const [row] = await this.database<
      Array<{
        session_id: string;
        user_id: string;
        branch_id: string;
        terminal_id: string;
        username: string;
        display_name: string;
        permissions: string[];
      }>
    >`
      select
        sessions.id::text as session_id,
        users.id::text as user_id,
        sessions.branch_id::text as branch_id,
        sessions.terminal_id::text as terminal_id,
        users.username,
        users.display_name,
        coalesce(array_agg(distinct permissions.code) filter (where permissions.code is not null), '{}') as permissions
      from sessions
      join users on users.id = sessions.user_id
      join user_branch_roles on user_branch_roles.user_id = users.id
        and user_branch_roles.branch_id = sessions.branch_id
      join role_permissions on role_permissions.role_id = user_branch_roles.role_id
      join permissions on permissions.id = role_permissions.permission_id
      where sessions.token_hash = ${tokenHash}
        and sessions.revoked_at is null
        and sessions.expires_at > now()
        and users.is_active = true
        and users.deleted_at is null
      group by sessions.id, users.id
    `;

    if (!row) throw new UnauthorizedException('Session expired or revoked');
    const user: AuthenticatedUser = {
      id: row.user_id,
      branchId: row.branch_id,
      terminalId: row.terminal_id,
      username: row.username,
      displayName: row.display_name,
      permissions: row.permissions,
      sessionId: row.session_id,
    };
    request.authenticatedUser = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.some((permission) => !user.permissions.includes(permission))) {
      throw new ForbiddenException('This account lacks the required permission');
    }
    return true;
  }
}
