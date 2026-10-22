import { Module } from '@nestjs/common';

import { PrintingController } from './printing.controller.js';
import { PrintingService } from './printing.service.js';

@Module({
  controllers: [PrintingController],
  providers: [PrintingService],
})
export class PrintingModule {}
