import { Module } from '@nestjs/common';

import { OwnerToolsService } from '../owner-ai/owner-tools.service.js';
import { ReportsController } from './reports.controller.js';

@Module({
  controllers: [ReportsController],
  providers: [OwnerToolsService],
  exports: [OwnerToolsService],
})
export class ReportsModule {}
