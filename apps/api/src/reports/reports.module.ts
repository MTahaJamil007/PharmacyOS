import { Module } from '@nestjs/common';

import { OwnerToolsService } from '../owner-ai/owner-tools.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [OwnerToolsService, ReportsService],
  exports: [OwnerToolsService],
})
export class ReportsModule {}
