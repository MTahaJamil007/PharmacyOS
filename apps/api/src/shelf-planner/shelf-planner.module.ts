import { Module } from '@nestjs/common';

import { ShelfPlannerController } from './shelf-planner.controller.js';
import { ShelfPlannerService } from './shelf-planner.service.js';

@Module({
  controllers: [ShelfPlannerController],
  providers: [ShelfPlannerService],
})
export class ShelfPlannerModule {}
