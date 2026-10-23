import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import {
  featureOverrideSchema,
  featureSettingsSchema,
  idSchema,
  PERMISSIONS,
  shopPlanSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FeaturesService } from './features.service.js';

interface Parser<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { flatten(): unknown } };
}

function parse<T>(schema: Parser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}

@Controller()
export class FeaturesController {
  constructor(@Inject(FeaturesService) private readonly features: FeaturesService) {}

  /** Every signed-in screen reads this to show only what the shop has. */
  @Get('features')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.features.forShop(user.branchId);
  }

  @Get('features/catalog')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.features.describe(user.branchId);
  }

  @Patch('features/:key/settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  settings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.features.setSettings(user, key, parse(featureSettingsSchema, body).settings);
  }

  @Get('platform/shops/:id/features')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  shopFeatures(@Param('id') id: string) {
    return this.features.describe(parse(idSchema, id).toString());
  }

  @Put('platform/shops/:id/plan')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  plan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.features.setPlan(
      user,
      parse(idSchema, id).toString(),
      parse(shopPlanSchema, body).plan,
    );
  }

  @Patch('platform/shops/:id/features/:key')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPER_ADMIN)
  feature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const change = parse(featureOverrideSchema, body);
    return this.features.setFeature(user, parse(idSchema, id).toString(), key, {
      ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
      ...(change.settings ? { settings: change.settings } : {}),
    });
  }
}
