import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { networkPrintSchema, PERMISSIONS } from '@pharmacy/shared';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { PrintingService } from './printing.service.js';

@Controller('printing')
export class PrintingController {
  constructor(@Inject(PrintingService) private readonly printing: PrintingService) {}

  @Post('network')
  @RequirePermissions(PERMISSIONS.POS_SEARCH)
  printToNetwork(@Body() body: unknown) {
    const parsed = networkPrintSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.printing.printToNetwork(parsed.data);
  }
}
