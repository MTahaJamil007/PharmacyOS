import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  backupRunQuerySchema,
  fiscalInvoiceQuerySchema,
  idSchema,
  PERMISSIONS,
  retryFiscalInvoiceSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FiscalService } from './fiscal.service.js';

@Controller()
export class FiscalController {
  constructor(@Inject(FiscalService) private readonly fiscal: FiscalService) {}

  @Get('fiscal/invoices')
  @RequirePermissions(PERMISSIONS.FBR_VIEW_STATUS)
  invoices(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = fiscalInvoiceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.fiscal.overview(user, parsed.data.status, parsed.data.limit, parsed.data.offset);
  }

  @Get('fiscal/invoices/:id/attempts')
  @RequirePermissions(PERMISSIONS.FBR_VIEW_STATUS)
  attempts(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid fiscal invoice id');
    return this.fiscal.attempts(user, parsed.data);
  }

  @Post('fiscal/invoices/:id/retry')
  @RequirePermissions(PERMISSIONS.FBR_RETRY)
  retry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = retryFiscalInvoiceSchema.safeParse(body);
    if (!parsedId.success) throw new BadRequestException('Invalid fiscal invoice id');
    if (!parsedBody.success) throw new BadRequestException(parsedBody.error.flatten());
    return this.fiscal.retry(user, parsedId.data, parsedBody.data);
  }

  @Get('operations/backups')
  @RequirePermissions(PERMISSIONS.BACKUP_RESTORE)
  backups(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = backupRunQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.fiscal.backups(user, parsed.data.limit);
  }
}
