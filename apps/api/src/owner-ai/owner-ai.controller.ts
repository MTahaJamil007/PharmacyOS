import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { ownerAiChatSchema, PERMISSIONS } from '@pharmacy/shared';

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
}
