import { BadRequestException, Body, Controller, Get, Inject, Patch, Put } from '@nestjs/common';
import { fbrInvoicingToggleSchema, invoiceLayoutSchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ShopSettingsService } from './shop-settings.service.js';

@Controller('admin/shop')
export class ShopSettingsController {
  constructor(@Inject(ShopSettingsService) private readonly settings: ShopSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  shop(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.shop(user);
  }

  @Patch('fbr-invoicing')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  setFbrInvoicing(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = fbrInvoicingToggleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.setFbrInvoicing(user, parsed.data.enabled);
  }

  @Get('invoice-layout')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  invoiceLayout(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.invoiceLayout(user);
  }

  @Put('invoice-layout')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updateInvoiceLayout(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = invoiceLayoutSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.updateInvoiceLayout(user, parsed.data);
  }
}
