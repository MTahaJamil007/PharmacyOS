import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  applyShelfProposalSchema,
  generateShelfProposalSchema,
  idSchema,
  PERMISSIONS,
  saveShelfLayoutSchema,
  shelfMedicineSearchSchema,
  shelfPlacementRemoveSchema,
  shelfPlacementSchema,
} from '@pharmacy/shared';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ShelfPlannerService } from './shelf-planner.service.js';

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

@Controller('shelf-planner')
export class ShelfPlannerController {
  constructor(@Inject(ShelfPlannerService) private readonly planner: ShelfPlannerService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_READ, PERMISSIONS.INVENTORY_SHELF_MANAGE)
  state(@CurrentUser() user: AuthenticatedUser) {
    return this.planner.state(user);
  }

  @Put('layout')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  saveLayout(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.planner.saveLayout(user, parse(saveShelfLayoutSchema, body));
  }

  @Get('shelves/:id/medicines')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_READ, PERMISSIONS.INVENTORY_SHELF_MANAGE)
  shelfMedicines(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.planner.shelfMedicines(user, parse(idSchema, id));
  }

  @Get('medicines')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_READ, PERMISSIONS.INVENTORY_SHELF_MANAGE)
  searchMedicines(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.planner.searchMedicines(user, parse(shelfMedicineSearchSchema, query).query);
  }

  @Post('placements')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  place(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.planner.place(user, parse(shelfPlacementSchema, body));
  }

  @Post('placements/remove')
  @RequirePermissions(PERMISSIONS.INVENTORY_SHELF_MANAGE)
  remove(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.planner.remove(user, parse(shelfPlacementRemoveSchema, body).medicineId);
  }

  @Get('proposals/current')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_READ, PERMISSIONS.INVENTORY_SHELF_MANAGE)
  currentProposal(@CurrentUser() user: AuthenticatedUser) {
    return this.planner.currentProposal(user);
  }

  @Post('proposals')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_MANAGE, PERMISSIONS.INVENTORY_SHELF_REVIEW)
  generate(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.planner.generateProposal(user, parse(generateShelfProposalSchema, body));
  }

  @Post('proposals/:id/apply')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_MANAGE, PERMISSIONS.INVENTORY_SHELF_REVIEW)
  apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.planner.applyProposal(
      user,
      parse(idSchema, id),
      parse(applyShelfProposalSchema, body),
    );
  }

  @Post('proposals/:id/reject')
  @RequireAnyPermission(PERMISSIONS.INVENTORY_SHELF_MANAGE, PERMISSIONS.INVENTORY_SHELF_REVIEW)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.planner.rejectProposal(user, parse(idSchema, id));
  }
}
