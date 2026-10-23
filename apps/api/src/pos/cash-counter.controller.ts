import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  clearCounterPaymentSchema,
  completeInvoiceSchema,
  idSchema,
  PERMISSIONS,
  sendToCashierSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequireFeature } from '../features/features.decorator.js';
import { CashCounterService } from './cash-counter.service.js';

function parseId(value: string): bigint {
  const id = idSchema.safeParse(value);
  if (!id.success) throw new BadRequestException('Invalid order id');
  return id.data;
}

@Controller('pos')
export class CashCounterController {
  constructor(@Inject(CashCounterService) private readonly counter: CashCounterService) {}

  @Get('counter-settings')
  @RequirePermissions(PERMISSIONS.POS_SEARCH)
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.counter.settings(user);
  }

  @Post('drafts/:draftId/send-to-cashier')
  @RequirePermissions(PERMISSIONS.POS_SEND_TO_CASHIER)
  sendToCashier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    const input = sendToCashierSchema.safeParse(body ?? {});
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.counter.sendToCashier(
      user,
      parseId(draftId),
      input.data.customerId ?? null,
      input.data.cashCounterTerminalId ?? null,
    );
  }

  @Post('drafts/:draftId/complete-invoice')
  @RequirePermissions(PERMISSIONS.POS_SEND_TO_CASHIER)
  completeInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    const input = completeInvoiceSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.counter.completeInvoice(user, parseId(draftId), input.data);
  }

  @Get('cash-counters')
  @RequireAnyPermission(PERMISSIONS.POS_SEND_TO_CASHIER, PERMISSIONS.SALE_FINALIZE_PAYMENT)
  @RequireFeature('MULTI_COUNTER')
  cashCounters(@CurrentUser() user: AuthenticatedUser) {
    return this.counter.cashCounters(user);
  }

  @Post('cash-counter/:draftId/claim')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  claim(@CurrentUser() user: AuthenticatedUser, @Param('draftId') draftId: string) {
    return this.counter.claim(user, parseId(draftId));
  }

  @Get('cash-counter/queue')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.counter.queue(user);
  }

  @Post('cash-counter/:draftId/clear')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    const input = clearCounterPaymentSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.counter.clearPayment(user, parseId(draftId), input.data);
  }

  @Post('cash-counter/:draftId/cancel')
  @RequirePermissions(PERMISSIONS.SALE_FINALIZE_PAYMENT)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('draftId') draftId: string) {
    return this.counter.cancel(user, parseId(draftId));
  }
}
