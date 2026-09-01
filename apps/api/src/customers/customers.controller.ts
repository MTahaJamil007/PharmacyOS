import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createCustomerSchema,
  customerPaymentSchema,
  customerSearchSchema,
  idSchema,
  PERMISSIONS,
  updateCustomerSchema,
} from '@pharmacy/shared';

import { CurrentUser, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customersService: CustomersService) {}

  @Get('receivables/aging')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  aging(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.agedReceivables(user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const parsed = customerSearchSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.customersService.search(user, parsed.data.query, parsed.data.limit);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.customersService.create(user, parsed.data);
  }

  @Get(':id/statement')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  statement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid customer id');
    return this.customersService.statement(user, parsed.data);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = updateCustomerSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid customer update');
    return this.customersService.update(user, parsedId.data, parsedBody.data);
  }

  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PAYMENT)
  payment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const parsedId = idSchema.safeParse(id);
    const parsedBody = customerPaymentSchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success)
      throw new BadRequestException('Invalid customer payment');
    return this.customersService.recordPayment(user, parsedId.data, parsedBody.data);
  }
}
