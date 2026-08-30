import { Module } from '@nestjs/common';

import { BudgetRegimenController } from './budget-regimen.controller.js';
import { BudgetRegimenService } from './budget-regimen.service.js';

@Module({ controllers: [BudgetRegimenController], providers: [BudgetRegimenService] })
export class BudgetRegimenModule {}
