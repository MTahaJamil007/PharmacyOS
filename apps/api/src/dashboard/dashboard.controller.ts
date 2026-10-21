import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { dashboardQuerySchema, ownerDashboardQuerySchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('owner')
  @RequireAnyPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL, PERMISSIONS.ANALYTICS_OWNER_READ)
  owner(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = dashboardQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.dashboard.owner(user, parsed.data.date);
  }

  @Get('overview')
  @RequireAnyPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL, PERMISSIONS.ANALYTICS_OWNER_READ)
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = ownerDashboardQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.dashboard.overview(user.branchId, parsed.data.date, parsed.data.trendDays);
  }
}
