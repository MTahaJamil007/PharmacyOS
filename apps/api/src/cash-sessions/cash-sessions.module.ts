import { Module } from '@nestjs/common';

import { CashSessionsController } from './cash-sessions.controller.js';
import { CashSessionsService } from './cash-sessions.service.js';

@Module({
  controllers: [CashSessionsController],
  providers: [CashSessionsService],
})
export class CashSessionsModule {}
