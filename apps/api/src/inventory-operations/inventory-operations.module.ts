import { Module } from '@nestjs/common';

import { InventoryOperationsController } from './inventory-operations.controller.js';
import { InventoryOperationsService } from './inventory-operations.service.js';

@Module({ controllers: [InventoryOperationsController], providers: [InventoryOperationsService] })
export class InventoryOperationsModule {}
