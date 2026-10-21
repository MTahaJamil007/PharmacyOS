import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  idSchema,
  openingStockImportSchema,
  PERMISSIONS,
  reorderPolicySchema,
  stockOverviewQuerySchema,
} from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { StockService } from './stock.service.js';

@Controller('stock')
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_PURCHASE,
    PERMISSIONS.REPORTS_VIEW_BASIC,
  )
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = stockOverviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.stock.overview(user.branchId, parsed.data);
  }

  @Get('medicines/:medicineId')
  @RequireAnyPermission(
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_PURCHASE,
    PERMISSIONS.REPORTS_VIEW_BASIC,
  )
  medicine(@CurrentUser() user: AuthenticatedUser, @Param('medicineId') medicineId: string) {
    const parsed = idSchema.safeParse(medicineId);
    if (!parsed.success) throw new BadRequestException('Invalid medicine id');
    return this.stock.medicineDetail(user.branchId, parsed.data);
  }

  @Put('medicines/:medicineId/reorder-policy')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  reorderPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('medicineId') medicineId: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(medicineId);
    const parsedBody = reorderPolicySchema.safeParse(body);
    if (!parsedId.success) throw new BadRequestException('Invalid medicine id');
    if (!parsedBody.success) throw new BadRequestException(parsedBody.error.flatten());
    return this.stock.upsertReorderPolicy(user, parsedId.data, parsedBody.data);
  }

  /** Onboarding only: creates stock from nothing, so it needs system authority. */
  @Post('opening-stock/import')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  openingStock(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = openingStockImportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.stock.importOpeningStock(user, parsed.data);
  }
}
