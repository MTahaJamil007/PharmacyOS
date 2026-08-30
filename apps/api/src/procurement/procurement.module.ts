import { Module } from '@nestjs/common';

import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
