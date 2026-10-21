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
  createReturnSchema,
  idSchema,
  invoiceNumberSchema,
  PERMISSIONS,
  refundReturnSchema,
  rejectReturnSchema,
  returnLookupTokenSchema,
  returnQueueQuerySchema,
} from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ReturnsService } from './returns.service.js';

@Controller('returns')
export class ReturnsController {
  constructor(@Inject(ReturnsService) private readonly returnsService: ReturnsService) {}

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.RETURNS_LOOKUP,
    PERMISSIONS.RETURNS_APPROVE,
    PERMISSIONS.RETURNS_REFUND,
  )
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = returnQueueQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.returnsService.list(user.branchId, parsed.data.status, parsed.data.limit);
  }

  @Get('lookup/:token')
  @RequirePermissions(PERMISSIONS.RETURNS_LOOKUP)
  lookup(@CurrentUser() user: AuthenticatedUser, @Param('token') token: string) {
    const parsed = returnLookupTokenSchema.safeParse(token);
    if (!parsed.success) throw new BadRequestException('Invalid receipt lookup token');
    return this.returnsService.lookup(user.branchId, parsed.data);
  }

  /** Customers lose receipts; staff can find the sale by the invoice number instead. */
  @Get('invoices/:invoiceNumber')
  @RequirePermissions(PERMISSIONS.RETURNS_LOOKUP)
  lookupByInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceNumber') invoiceNumber: string,
  ) {
    const parsed = invoiceNumberSchema.safeParse(invoiceNumber);
    if (!parsed.success) throw new BadRequestException('Invalid invoice number');
    return this.returnsService.lookupByInvoice(user.branchId, parsed.data);
  }

  @Post('lookup/:token/request')
  @RequirePermissions(PERMISSIONS.RETURNS_REQUEST)
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
    @Body() body: unknown,
  ) {
    const parsedToken = returnLookupTokenSchema.safeParse(token);
    const parsedBody = createReturnSchema.safeParse(body);
    if (!parsedToken.success || !parsedBody.success)
      throw new BadRequestException('Invalid return request');
    return this.returnsService.requestReturn(user, parsedToken.data, parsedBody.data);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.RETURNS_APPROVE)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid return id');
    return this.returnsService.approve(user, parsed.data);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.RETURNS_APPROVE)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = rejectReturnSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Give a reason for rejecting this return');
    return this.returnsService.reject(user, parsedId.data, parsedBody.data);
  }

  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.RETURNS_REFUND)
  refund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = refundReturnSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException(
        parsedBody.success ? 'Invalid refund request' : parsedBody.error.issues[0]?.message,
      );
    return this.returnsService.refund(user, parsedId.data, parsedBody.data);
  }
}
