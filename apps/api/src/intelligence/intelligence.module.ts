import { Module } from '@nestjs/common';

import { IntelligenceController } from './intelligence.controller.js';
import { IntelligenceService } from './intelligence.service.js';

@Module({
  controllers: [IntelligenceController],
  providers: [IntelligenceService],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}
