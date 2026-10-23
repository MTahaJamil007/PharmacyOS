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
  customerRequestSchema,
  idSchema,
  linkBarcodeSchema,
  PERMISSIONS,
  scanLookupSchema,
  stockAlertQuerySchema,
} from '@pharmacy/shared';

import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequireFeature } from '../features/features.decorator.js';
import { StockControlService } from './stock-control.service.js';

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

const STOCK_READERS = [
  PERMISSIONS.INVENTORY_PURCHASE,
  PERMISSIONS.INVENTORY_EXPIRY_READ,
  PERMISSIONS.REPORTS_VIEW_BASIC,
] as const;

@Controller('stock')
export class StockControlController {
  constructor(@Inject(StockControlService) private readonly stock: StockControlService) {}

  @Get('scan')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  @RequireFeature('SCAN_RECEIVING')
  scan(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.stock.scan(user, parse(scanLookupSchema, query).code);
  }

  @Get('receiving/medicines/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  medicine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stock.medicineForReceiving(user, parse(idSchema, id).toString());
  }

  @Post('barcodes')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  @RequireFeature('SCAN_RECEIVING')
  link(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = parse(linkBarcodeSchema, body);
    return this.stock.linkBarcode(user, input.medicineId.toString(), input.code);
  }

  @Get('low')
  @RequireAnyPermission(...STOCK_READERS)
  @RequireFeature('LOW_STOCK')
  low(@CurrentUser() user: AuthenticatedUser) {
    return this.stock.lowStock(user);
  }

  @Get('stuck')
  @RequireAnyPermission(...STOCK_READERS)
  @RequireFeature('STUCK_STOCK')
  stuck(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.stock.stuckStock(user, parse(stockAlertQuerySchema, query).days);
  }

  @Get('expiring')
  @RequireAnyPermission(...STOCK_READERS)
  @RequireFeature('EXPIRY_ALERTS')
  expiring(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.stock.expiring(user, parse(stockAlertQuerySchema, query).days);
  }

  /** Any counter user may record that a customer asked for something the shop lacks. */
  @Post('customer-requests')
  @RequirePermissions(PERMISSIONS.POS_SEARCH)
  @RequireFeature('CUSTOMER_REQUESTS')
  request(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.stock.recordRequest(user, parse(customerRequestSchema, body));
  }

  @Get('customer-requests')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_PURCHASE, PERMISSIONS.REPORTS_VIEW_BASIC)
  @RequireFeature('CUSTOMER_REQUESTS')
  requests(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.stock.requestReport(user, parse(stockAlertQuerySchema, query).days);
  }

  @Get('order-list')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  @RequireFeature('PURCHASE_ORDERS')
  orderList(@CurrentUser() user: AuthenticatedUser) {
    return this.stock.orderList(user);
  }
}
