import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { dashboardQuerySchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('owner')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  owner(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = dashboardQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.dashboard.owner(user, parsed.data.date);
  }
}
