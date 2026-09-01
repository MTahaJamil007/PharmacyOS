import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { RequestMetricsInterceptor } from './request-metrics.interceptor.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: RequestMetricsInterceptor }],
  exports: [MetricsService],
})
export class ObservabilityModule {}
