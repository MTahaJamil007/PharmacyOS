import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  idSchema,
  PERMISSIONS,
  reportQuerySchema,
  tabularReportQuerySchema,
  type OwnerAiChatRequest,
  type TabularReport,
  type TabularReportName,
} from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OwnerToolsService } from '../owner-ai/owner-tools.service.js';
import { ReportsService } from './reports.service.js';

/** Reports that expose cost, margin, or cash need financial authority. */
const TABULAR_REPORTS: Readonly<Record<TabularReportName, string>> = {
  'cash-sessions': PERMISSIONS.REPORTS_VIEW_FINANCIAL,
  'daily-sales': PERMISSIONS.REPORTS_VIEW_BASIC,
  expiry: PERMISSIONS.REPORTS_VIEW_BASIC,
  'item-sales': PERMISSIONS.REPORTS_VIEW_BASIC,
  profit: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
  purchases: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
  'returns-register': PERMISSIONS.REPORTS_VIEW_BASIC,
  'stock-losses': PERMISSIONS.REPORTS_VIEW_FINANCIAL,
  'stock-valuation': PERMISSIONS.REPORTS_VIEW_FINANCIAL,
};
const COST_COLUMNS = new Set(['costOfGoods', 'grossProfit']);

type ReportTool = OwnerAiChatRequest['tool'];

@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(OwnerToolsService) private readonly reports: OwnerToolsService,
    @Inject(ReportsService) private readonly tabular: ReportsService,
  ) {}

  @Get('tables/:report')
  @RequireAnyPermission(PERMISSIONS.REPORTS_VIEW_BASIC, PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async table(
    @CurrentUser() user: AuthenticatedUser,
    @Param('report') report: string,
    @Query() query: unknown,
  ): Promise<TabularReport> {
    const required = Object.hasOwn(TABULAR_REPORTS, report)
      ? TABULAR_REPORTS[report as TabularReportName]
      : undefined;
    if (!required) throw new NotFoundException('Unknown report');
    if (!user.permissions.includes(required)) {
      throw new ForbiddenException('This account lacks the required permission');
    }
    const parsed = tabularReportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.tabular.run(user.branchId, report as TabularReportName, parsed.data);
    if (user.permissions.includes(PERMISSIONS.REPORTS_VIEW_FINANCIAL)) return result;
    return {
      ...result,
      columns: result.columns.filter((column) => !COST_COLUMNS.has(column.key)),
      rows: result.rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !COST_COLUMNS.has(key))),
      ),
      totals: result.totals
        ? Object.fromEntries(
            Object.entries(result.totals).filter(([key]) => !COST_COLUMNS.has(key)),
          )
        : null,
    };
  }

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
