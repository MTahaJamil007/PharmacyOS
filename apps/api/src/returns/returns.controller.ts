import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  createReturnSchema,
  idSchema,
  PERMISSIONS,
  refundReturnSchema,
  returnLookupTokenSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ReturnsService } from './returns.service.js';

@Controller('returns')
export class ReturnsController {
  constructor(@Inject(ReturnsService) private readonly returnsService: ReturnsService) {}

  @Get('lookup/:token')
  @RequirePermissions(PERMISSIONS.RETURNS_LOOKUP)
  lookup(@CurrentUser() user: AuthenticatedUser, @Param('token') token: string) {
    const parsed = returnLookupTokenSchema.safeParse(token);
    if (!parsed.success) throw new BadRequestException('Invalid receipt lookup token');
    return this.returnsService.lookup(user.branchId, parsed.data);
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

  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.RETURNS_REFUND)
  refund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = refundReturnSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid refund request');
    return this.returnsService.refund(user, parsedId.data, parsedBody.data);
  }
}
