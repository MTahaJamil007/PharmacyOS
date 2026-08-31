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
  createDraftSchema,
  finalizeSaleSchema,
  idSchema,
  PERMISSIONS,
  saleReceiptSearchSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PosService } from './pos.service.js';

@Controller('pos')
export class PosController {
  constructor(@Inject(PosService) private readonly posService: PosService) {}

  @Get('sales')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  async sales(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<Record<string, unknown>> {
    const input = saleReceiptSearchSchema.safeParse(query);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.posService.findSales(user, input.data.query);
  }

  @Get('sales/:saleId/receipt')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  async receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleId') saleId: string,
  ): Promise<Record<string, unknown>> {
    const id = idSchema.safeParse(saleId);
    if (!id.success) throw new BadRequestException('Invalid sale id');
    return this.posService.getReceipt(user, id.data);
  }

  @Post('sales/:saleId/reprint')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  async reprintReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleId') saleId: string,
  ): Promise<Record<string, unknown>> {
    const id = idSchema.safeParse(saleId);
    if (!id.success) throw new BadRequestException('Invalid sale id');
    return this.posService.reprintReceipt(user, id.data);
  }

  @Post('drafts')
  @RequirePermissions(PERMISSIONS.POS_CREATE_DRAFT)
  async createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = createDraftSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.posService.createDraft(user, input.data);
  }

  @Post('drafts/:draftId/reserve')
  @RequirePermissions(PERMISSIONS.POS_SEND_TO_CASHIER)
  async reserveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId') draftId: string,
  ): Promise<Record<string, unknown>> {
    const id = idSchema.safeParse(draftId);
    if (!id.success) throw new BadRequestException('Invalid draft id');
    return this.posService.reserveDraft(user, id.data);
  }

  @Post('sales/finalize')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  async finalizeSale(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = finalizeSaleSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.posService.finalizeSale(user, input.data);
  }
}
