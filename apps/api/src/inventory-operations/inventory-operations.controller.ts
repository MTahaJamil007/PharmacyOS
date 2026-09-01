import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  idSchema,
  inventoryBatchSearchSchema,
  PERMISSIONS,
  stockAdjustmentSchema,
  updateBatchPriceSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { InventoryOperationsService } from './inventory-operations.service.js';

@Controller('inventory')
export class InventoryOperationsController {
  constructor(
    @Inject(InventoryOperationsService) private readonly inventory: InventoryOperationsService,
  ) {}

  @Get('batches')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  batches(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = inventoryBatchSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.inventory.searchBatches(user, parsed.data.query, parsed.data.limit);
  }

  @Post('batches/:id/price')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  price(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = updateBatchPriceSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid batch price update');
    return this.inventory.updatePrice(user, parsedId.data, parsedBody.data);
  }

  @Post('batches/:id/adjustments')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = stockAdjustmentSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid stock adjustment');
    return this.inventory.adjustStock(user, parsedId.data, parsedBody.data);
  }
}
