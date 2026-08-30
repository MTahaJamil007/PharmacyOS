import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  expiryRiskQuerySchema,
  expiryWorkItemActionSchema,
  idSchema,
  PERMISSIONS,
  shelfRecommendationQuerySchema,
  shelfRecommendationReviewSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { IntelligenceService } from './intelligence.service.js';

@Controller()
export class IntelligenceController {
  constructor(@Inject(IntelligenceService) private readonly intelligenceService: IntelligenceService) {}

  @Get('inventory-intelligence/attention')
  @RequirePermissions(PERMISSIONS.INVENTORY_EXPIRY_READ)
  getAttention(@CurrentUser() user: AuthenticatedUser): Promise<Record<string, unknown>> {
    return this.intelligenceService.getAttentionSummary(user.branchId);
  }

  @Get('shelf-recommendations')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_READ)
  listShelf(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = shelfRecommendationQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.intelligenceService.listShelfRecommendations(
      user.branchId,
      parsed.data.status,
      parsed.data.limit,
      parsed.data.offset,
    );
  }

  @Post('shelf-recommendations/:id/review')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_REVIEW)
  reviewShelf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = shelfRecommendationReviewSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid review request');
    return this.intelligenceService.reviewShelfRecommendation(user, parsedId.data, parsedBody.data);
  }

  @Get('expiry-risk')
  @RequirePermissions(PERMISSIONS.INVENTORY_EXPIRY_READ)
  listExpiry(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = expiryRiskQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.intelligenceService.listExpiryRisk(
      user.branchId,
      parsed.data.bucket,
      parsed.data.limit,
      parsed.data.offset,
    );
  }

  @Post('expiry-work-items/:id/action')
  @RequirePermissions(PERMISSIONS.INVENTORY_EXPIRY_MANAGE)
  actionExpiry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = expiryWorkItemActionSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid expiry action');
    return this.intelligenceService.actionExpiryWorkItem(user, parsedId.data, parsedBody.data);
  }
}
