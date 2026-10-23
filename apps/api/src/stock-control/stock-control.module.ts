import { Module } from '@nestjs/common';

import { StockControlController } from './stock-control.controller.js';
import { StockControlService } from './stock-control.service.js';

@Module({ controllers: [StockControlController], providers: [StockControlService] })
export class StockControlModule {}
