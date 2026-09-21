import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { aiAuditQuerySchema, ownerAiChatSchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OwnerAiService } from './owner-ai.service.js';

@Controller('owner-ai')
export class OwnerAiController {
  constructor(@Inject(OwnerAiService) private readonly ownerAiService: OwnerAiService) {}

  @Post('chat')
  @RequirePermissions(PERMISSIONS.AI_OWNER_USE)
  chat(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = ownerAiChatSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ownerAiService.chat(user, parsed.data);
  }

  @Get('audits')
  @RequirePermissions(PERMISSIONS.AI_AUDIT_READ)
  audits(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = aiAuditQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ownerAiService.audits(user, parsed.data.limit);
  }
}
