import { BadRequestException, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { idSchema, operationalAlertsQuerySchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AlertsService } from './alerts.service.js';

@Controller('operations/alerts')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = operationalAlertsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.alerts.list(user, parsed.data.status, parsed.data.limit);
  }

  @Post(':id/acknowledge')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid alert identifier');
    return this.alerts.acknowledge(user, parsed.data);
  }
}
