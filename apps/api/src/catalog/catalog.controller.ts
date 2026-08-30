import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { medicineSearchSchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CatalogService, type MedicineSearchResult } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Get('medicines/search')
  @RequirePermissions(PERMISSIONS.POS_SEARCH)
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<{ data: MedicineSearchResult[] }> {
    const result = medicineSearchSchema.safeParse(query);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return {
      data: await this.catalogService.search(user.branchId, result.data.query, result.data.limit),
    };
  }
}
