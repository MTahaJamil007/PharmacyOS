import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const PERMISSION_METADATA_KEY = 'required-permissions';

export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authenticatedUser,
);
