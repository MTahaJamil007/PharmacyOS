import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { dashboardQuerySchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequireFeature } from '../features/features.decorator.js';
import { DashboardService } from './dashboard.service.js';

@RequireFeature('OWNER_DASHBOARD')
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
}
