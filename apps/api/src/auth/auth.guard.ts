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

import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import { DATABASE, ENVIRONMENT } from '../database.module.js';
import { PERMISSION_METADATA_KEY } from './auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
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
        sessions.permission_snapshot as permissions
      from sessions
      join users on users.id = sessions.user_id
      where sessions.token_hash = ${tokenHash}
        and sessions.revoked_at is null
        and sessions.expires_at > now()
        and sessions.absolute_expires_at > now()
        and users.is_active = true
        and users.deleted_at is null
    `;

    if (!row) throw new UnauthorizedException('Session expired or revoked');
    const slidingExpiresAt = new Date(Date.now() + this.environment.SESSION_TTL_MINUTES * 60_000);
    const refreshThresholdMinutes = Math.max(
      1,
      Math.floor(this.environment.SESSION_TTL_MINUTES / 2),
    );
    await this.database`
      update sessions set last_seen_at = now(),
        expires_at = least(${slidingExpiresAt}, absolute_expires_at)
      where id = ${row.session_id} and revoked_at is null
        and expires_at < now() + (${refreshThresholdMinutes} * interval '1 minute')
    `;
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
