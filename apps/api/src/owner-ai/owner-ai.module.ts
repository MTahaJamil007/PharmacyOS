import { Module } from '@nestjs/common';
import type { Environment } from '@pharmacy/config';

import { ENVIRONMENT } from '../database.module.js';
import { GeminiProvider } from './gemini.provider.js';
import { OwnerAiController } from './owner-ai.controller.js';
import { OwnerAiService } from './owner-ai.service.js';
import { ReportsModule } from '../reports/reports.module.js';

@Module({
  imports: [ReportsModule],
  controllers: [OwnerAiController],
  providers: [
    OwnerAiService,
    {
      provide: GeminiProvider,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => new GeminiProvider(environment),
    },
  ],
})
export class OwnerAiModule {}
