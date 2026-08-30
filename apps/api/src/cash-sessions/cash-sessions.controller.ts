import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  approveCashVarianceSchema,
  cashMovementSchema,
  closeCashSessionSchema,
  idSchema,
  openCashSessionSchema,
  PERMISSIONS,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CashSessionsService } from './cash-sessions.service.js';

@Controller('cash-sessions')
export class CashSessionsController {
  constructor(
    @Inject(CashSessionsService) private readonly cashSessionsService: CashSessionsService,
  ) {}

  @Post('open')
  @RequirePermissions(PERMISSIONS.CASH_OPEN_SESSION)
  open(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = openCashSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.cashSessionsService.open(user, parsed.data);
  }

  @Get('current')
  @RequirePermissions(PERMISSIONS.CASH_OPEN_SESSION)
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.cashSessionsService.current(user);
  }

  @Get('pending-variance')
  @RequirePermissions(PERMISSIONS.CASH_APPROVE_VARIANCE)
  pendingVariance(@CurrentUser() user: AuthenticatedUser) {
    return this.cashSessionsService.pendingVariance(user);
  }

  @Get(':id/summary')
  @RequirePermissions(PERMISSIONS.CASH_CLOSE_SESSION)
  summary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid cash session id');
    return this.cashSessionsService.summary(user, parsed.data);
  }

  @Post(':id/movements')
  @RequirePermissions(PERMISSIONS.CASH_OPEN_SESSION)
  movement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = cashMovementSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid cash movement');
    return this.cashSessionsService.addMovement(user, parsedId.data, parsedBody.data);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.CASH_CLOSE_SESSION)
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = closeCashSessionSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid close-session request');
    return this.cashSessionsService.close(user, parsedId.data, parsedBody.data);
  }

  @Post(':id/approve-variance')
  @RequirePermissions(PERMISSIONS.CASH_APPROVE_VARIANCE)
  approveVariance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = approveCashVarianceSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid variance approval');
    return this.cashSessionsService.approveVariance(user, parsedId.data, parsedBody.data);
  }
}
