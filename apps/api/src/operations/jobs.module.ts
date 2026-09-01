import { Module } from '@nestjs/common';

import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

@Module({
  controllers: [JobsController, AlertsController],
  providers: [JobsService, AlertsService],
})
export class JobsModule {}
