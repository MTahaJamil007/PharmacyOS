import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  changePasswordSchema,
  createUserSchema,
  idSchema,
  PERMISSIONS,
  resetPasswordSchema,
  updateUserSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UsersService } from './users.service.js';

@Controller('admin/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_USERS)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.users.list(user);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_USERS)
  roles() {
    return this.users.roles();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_USERS)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.users.create(user, parsed.data);
  }

  @Post('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.users.changeOwnPassword(user, parsed.data.currentPassword, parsed.data.newPassword);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_USERS)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = updateUserSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid user update');
    return this.users.update(user, parsedId.data, parsedBody.data);
  }

  @Post(':id/password')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_USERS)
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = resetPasswordSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid password reset');
    return this.users.resetPassword(user, parsedId.data, parsedBody.data.password);
  }
}
