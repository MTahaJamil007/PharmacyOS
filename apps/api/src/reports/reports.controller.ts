import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  idSchema,
  PERMISSIONS,
  reportQuerySchema,
  type OwnerAiChatRequest,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OwnerToolsService } from '../owner-ai/owner-tools.service.js';

type ReportTool = OwnerAiChatRequest['tool'];

@Controller('reports')
export class ReportsController {
  constructor(@Inject(OwnerToolsService) private readonly reports: OwnerToolsService) {}

  @Get('sales')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  sales(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_sales_summary', query);
  }

  @Get('profit')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  profit(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_profit_summary', query);
  }

  @Get('low-stock')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  lowStock(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_low_stock', query);
  }

  @Get('expiry-risk')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  expiryRisk(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_expiry_risk', query);
  }

  @Get('purchase-suggestions')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  purchaseSuggestions(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_purchase_suggestions', query);
  }

  @Get('supplier-prices/:medicineId')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ)
  supplierPrices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('medicineId') medicineId: string,
    @Query() query: unknown,
  ) {
    const parsedId = idSchema.safeParse(medicineId);
    if (!parsedId.success) throw new BadRequestException('Invalid medicine id');
    return this.run(user, 'get_supplier_price_comparison', {
      ...this.objectQuery(query),
      medicineId,
    });
  }

  @Get('shelf-recommendations')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  shelfRecommendations(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_shelf_recommendations', query);
  }

  @Get('returns')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_BASIC)
  returns(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_returns_summary', query);
  }

  @Get('cash-reconciliation')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  cash(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.run(user, 'get_cash_reconciliation_summary', query);
  }

  private run(user: AuthenticatedUser, tool: ReportTool, query: unknown) {
    const parsed = reportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.reports.execute(user, {
      question: 'Show deterministic report',
      tool,
      arguments: parsed.data,
    });
  }

  private objectQuery(query: unknown): Record<string, unknown> {
    return typeof query === 'object' && query !== null ? { ...query } : {};
  }
}
