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
  assignShelfSchema,
  createMedicineSchema,
  createShelfSchema,
  createSupplierSchema,
  createTerminalSchema,
  customerSearchSchema,
  idSchema,
  PERMISSIONS,
  updateMedicineSchema,
  updateOperationalPoliciesSchema,
  updateFiscalSettingsSchema,
  updateShelfSchema,
  updateSupplierSchema,
  updateTerminalSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AdministrationService } from './administration.service.js';

@Controller('admin')
export class AdministrationController {
  constructor(@Inject(AdministrationService) private readonly admin: AdministrationService) {}

  @Get('medicines')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  medicines(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = customerSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.medicines(user, parsed.data.query, parsed.data.limit);
  }

  @Post('medicines')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  createMedicine(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createMedicineSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createMedicine(user, parsed.data);
  }

  @Patch('medicines/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updateMedicine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.withId(id, updateMedicineSchema, body, (value, input) =>
      this.admin.updateMedicine(user, value, input),
    );
  }

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  suppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.suppliers(user);
  }

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  createSupplier(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createSupplierSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createSupplier(user, parsed.data);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updateSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.withId(id, updateSupplierSchema, body, (value, input) =>
      this.admin.updateSupplier(user, value, input),
    );
  }

  @Get('shelves')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  shelves(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.shelves(user);
  }

  @Post('shelves')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  createShelf(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createShelfSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createShelf(user, parsed.data);
  }

  @Patch('shelves/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  updateShelf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.withId(id, updateShelfSchema, body, (value, input) =>
      this.admin.updateShelf(user, value, input),
    );
  }

  @Post('shelves/:id/assign')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  assignShelf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.withId(id, assignShelfSchema, body, (value, input) =>
      this.admin.assignShelf(user, value, input),
    );
  }

  @Get('terminals')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  terminals(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.terminals(user);
  }

  @Post('terminals')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  createTerminal(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createTerminalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createTerminal(user, parsed.data);
  }

  @Patch('terminals/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updateTerminal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.withId(id, updateTerminalSchema, body, (value, input) =>
      this.admin.updateTerminal(user, value, input),
    );
  }

  @Get('policies')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  policies(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.policies(user);
  }

  @Patch('policies')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updatePolicies(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = updateOperationalPoliciesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updatePolicies(user, parsed.data);
  }

  @Get('fiscal-settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  fiscalSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.fiscalSettings(user);
  }

  @Patch('fiscal-settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  updateFiscalSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = updateFiscalSettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateFiscalSettings(user, parsed.data);
  }

  private withId<T>(
    id: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    body: unknown,
    operation: (id: bigint, input: T) => unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = schema.safeParse(body);
    if (!parsedId.success || !parsedBody.success) throw new BadRequestException('Invalid request');
    return operation(parsedId.data, parsedBody.data);
  }
}
