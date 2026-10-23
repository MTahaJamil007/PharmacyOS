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
  createPurchaseOrderSchema,
  createDraftPurchaseOrderSchema,
  idSchema,
  orderPurchaseOrderSchema,
  quickReceiptSchema,
  PERMISSIONS,
  purchaseOrderQuerySchema,
  receivePurchaseOrderSchema,
  reorderSuggestionQuerySchema,
  reviewReorderSuggestionSchema,
  supplierQuoteSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequireFeature } from '../features/features.decorator.js';
import { ProcurementService } from './procurement.service.js';

@Controller()
export class ProcurementController {
  constructor(
    @Inject(ProcurementService) private readonly procurementService: ProcurementService,
  ) {}

  @Post('supplier-quotes')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  addQuote(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = supplierQuoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.procurementService.addSupplierQuote(user, parsed.data);
  }

  @Get('purchase-orders')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  listPurchaseOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = purchaseOrderQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.procurementService.listPurchaseOrders(
      user.branchId,
      parsed.data.status,
      parsed.data.limit,
      parsed.data.offset,
    );
  }

  @Get('purchase-orders/:id')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  getPurchaseOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid purchase order id');
    return this.procurementService.getPurchaseOrder(user.branchId, parsed.data);
  }

  @Post('purchase-orders')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  createPurchaseOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createPurchaseOrderSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.procurementService.createPurchaseOrder(user, parsed.data);
  }

  @Post('purchase-orders/:id/order')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PURCHASE_DRAFT_APPROVE)
  orderPurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = orderPurchaseOrderSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid order request');
    return this.procurementService.orderPurchaseOrder(user, parsedId.data, parsedBody.data);
  }

  @Post('purchase-orders/:id/receive')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  receivePurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = receivePurchaseOrderSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid goods receipt');
    return this.procurementService.receivePurchaseOrder(user, parsedId.data, parsedBody.data);
  }

  @Get('products/:medicineId/supplier-comparison')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ)
  comparison(@CurrentUser() user: AuthenticatedUser, @Param('medicineId') medicineId: string) {
    const parsed = idSchema.safeParse(medicineId);
    if (!parsed.success) throw new BadRequestException('Invalid medicine id');
    return this.procurementService.getSupplierComparison(user.branchId, parsed.data);
  }

  @Get('reorder-suggestions')
  @RequireFeature('LOW_STOCK')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_REORDER_REVIEW)
  listReorders(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = reorderSuggestionQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.procurementService.listReorderSuggestions(
      user.branchId,
      parsed.data.status,
      parsed.data.limit,
      parsed.data.offset,
    );
  }

  @Post('reorder-suggestions/:id/review')
  @RequireFeature('LOW_STOCK')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_REORDER_REVIEW)
  reviewReorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = reviewReorderSuggestionSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid reorder review');
    return this.procurementService.reviewReorderSuggestion(user, parsedId.data, parsedBody.data);
  }

  @Post('reorder-suggestions/:id/create-draft-po')
  @RequireFeature('PURCHASE_ORDERS')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PURCHASE_DRAFT_APPROVE)
  createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = createDraftPurchaseOrderSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid purchase draft request');
    return this.procurementService.createDraftPurchaseOrder(user, parsedId.data, parsedBody.data);
  }

  /** Scan-and-receive: a delivery without a purchase order, received in one step. */
  @Post('quick-receipts')
  @RequirePermissions(PERMISSIONS.INVENTORY_PURCHASE)
  @RequireFeature('SCAN_RECEIVING')
  quickReceipt(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = quickReceiptSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.procurementService.quickReceipt(user, parsed.data);
  }
}
