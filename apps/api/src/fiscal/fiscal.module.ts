import { Module } from '@nestjs/common';

import { FiscalController } from './fiscal.controller.js';
import { FiscalService } from './fiscal.service.js';

@Module({
  controllers: [FiscalController],
  providers: [FiscalService],
})
export class FiscalModule {}
