import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { budgetRegimenSchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BudgetRegimenService } from './budget-regimen.service.js';

@Controller('budget-regimen')
export class BudgetRegimenController {
  constructor(@Inject(BudgetRegimenService) private readonly budgetRegimenService: BudgetRegimenService) {}

  @Post('calculate')
  @RequirePermissions(PERMISSIONS.SALES_BUDGET_REGIMEN_CALCULATE)
  calculate(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = budgetRegimenSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.budgetRegimenService.calculate(user, parsed.data);
  }
}
