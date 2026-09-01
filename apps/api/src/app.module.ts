import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';

import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './database.module.js';
import { HealthModule } from './health/health.module.js';
import { PosModule } from './pos/pos.module.js';
import { BudgetRegimenModule } from './budget-regimen/budget-regimen.module.js';
import { IntelligenceModule } from './intelligence/intelligence.module.js';
import { OwnerAiModule } from './owner-ai/owner-ai.module.js';
import { JobsModule } from './operations/jobs.module.js';
import { ProcurementModule } from './procurement/procurement.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { CashSessionsModule } from './cash-sessions/cash-sessions.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InventoryOperationsModule } from './inventory-operations/inventory-operations.module.js';
import { AdministrationModule } from './administration/administration.module.js';
import { DatabaseExceptionFilter } from './common/database-exception.filter.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CatalogModule,
    HealthModule,
    PosModule,
    IntelligenceModule,
    ProcurementModule,
    BudgetRegimenModule,
    ReturnsModule,
    OwnerAiModule,
    JobsModule,
    CashSessionsModule,
    CustomersModule,
    ReportsModule,
    DashboardModule,
    InventoryOperationsModule,
    AdministrationModule,
  ],
  providers: [
    AuthGuard,
    DatabaseExceptionFilter,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useExisting: DatabaseExceptionFilter },
  ],
})
export class AppModule {}
