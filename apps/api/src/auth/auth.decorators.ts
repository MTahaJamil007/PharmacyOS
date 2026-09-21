import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const PERMISSION_METADATA_KEY = 'required-permissions';
export const ANY_PERMISSION_METADATA_KEY = 'required-any-permission';

/** Every listed permission must be present on the session. */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);

/**
 * At least one listed permission must be present. Used where two roles legitimately
 * reach the same read-only surface, such as an owner holding `analytics.owner.read`
 * and a manager holding `reports.view_financial`.
 */
export const RequireAnyPermission = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ANY_PERMISSION_METADATA_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authenticatedUser,
);
