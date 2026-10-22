import { Module } from '@nestjs/common';

import { CashCounterController } from './cash-counter.controller.js';
import { CashCounterService } from './cash-counter.service.js';
import { PosController } from './pos.controller.js';
import { PosService } from './pos.service.js';

@Module({
  controllers: [PosController, CashCounterController],
  providers: [PosService, CashCounterService],
})
export class PosModule {}
