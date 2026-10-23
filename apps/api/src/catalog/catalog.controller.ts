import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { idSchema, medicineSearchSchema, PERMISSIONS } from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequireFeature } from '../features/features.decorator.js';
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

  /** Same generic, strength and form from other companies, in stock. */
  @Get('medicines/:id/substitutes')
  @RequirePermissions(PERMISSIONS.POS_SEARCH)
  @RequireFeature('COUNTER_SUBSTITUTES')
  substitutes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid medicine id');
    return this.catalogService.substitutes(user.branchId, parsed.data.toString());
  }
}
