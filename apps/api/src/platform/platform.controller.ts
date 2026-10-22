import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  activeToggleSchema,
  cashSessionsToggleSchema,
  createShopSchema,
  fbrInvoicingToggleSchema,
  fbrTransmissionApprovalSchema,
  idSchema,
  PERMISSIONS,
  platformAuditQuerySchema,
  platformCreateUserSchema,
  platformUpdateUserSchema,
  resetPasswordSchema,
  shopProfileSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlatformService } from './platform.service.js';

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

function parse<T>(schema: Parser<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = result.error as { flatten?: () => unknown };
    throw new BadRequestException(error.flatten?.() ?? 'Invalid request');
  }
  return result.data;
}

function parseId(value: string): bigint {
  const id = idSchema.safeParse(value);
  if (!id.success) throw new BadRequestException('Invalid id');
  return id.data;
}

/** Software-owner (super admin) controls. Every route requires the platform permission. */
@Controller('platform')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get('system')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  system() {
    return this.platform.system();
  }

  @Get('shops')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  shops() {
    return this.platform.shops();
  }

  @Post('shops')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  createShop(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.platform.createShop(user, parse(createShopSchema, body));
  }

  @Patch('shops/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  updateShop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.updateShop(user, parseId(id), parse(shopProfileSchema, body));
  }

  @Patch('shops/:id/active')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  setShopActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.setShopActive(user, parseId(id), parse(activeToggleSchema, body).isActive);
  }

  @Patch('shops/:id/cash-sessions')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  setCashSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.setCashSessions(
      user,
      parseId(id),
      parse(cashSessionsToggleSchema, body).enabled,
    );
  }

  @Patch('shops/:id/fbr-invoicing')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  setFbrInvoicing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.setFbrInvoicing(
      user,
      parseId(id),
      parse(fbrInvoicingToggleSchema, body).enabled,
    );
  }

  @Patch('shops/:id/fbr-transmission')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  setFbrTransmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(fbrTransmissionApprovalSchema, body);
    return this.platform.setFbrTransmission(user, parseId(id), input.approved, input.reason);
  }

  @Get('users')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  users() {
    return this.platform.users();
  }

  @Post('users')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  createUser(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.platform.createUser(user, parse(platformCreateUserSchema, body));
  }

  @Patch('users/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  updateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.updateUser(user, parseId(id), parse(platformUpdateUserSchema, body));
  }

  @Post('users/:id/password')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.resetPassword(
      user,
      parseId(id),
      parse(resetPasswordSchema, body).password,
    );
  }

  @Post('users/:id/unlock')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  unlockUser(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.platform.unlockUser(user, parseId(id));
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  roles() {
    return this.platform.roles();
  }

  @Get('audit')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  audit(@Query() query: unknown) {
    const input = parse(platformAuditQuerySchema, query);
    return this.platform.audit(input.branchId?.toString() ?? null, input.limit);
  }
}
