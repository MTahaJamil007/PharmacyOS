import { Controller, Get, Header, Inject, SetMetadata } from '@nestjs/common';
import type { Database } from '@pharmacy/database';

import { DATABASE } from '../database.module.js';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  @Get()
  @SetMetadata('public', true)
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async read(): Promise<string> {
    const rows = await this.database<Array<{ alert_type: string; count: number }>>`
      select alert_type, count(*)::int as count from operational_alerts
      where status in ('OPEN', 'ACKNOWLEDGED') group by alert_type order by alert_type
    `;
    const counts: Record<string, number> = {
      BACKUP_RESTORE_FAILURE: 0,
      CASH_VARIANCE: 0,
      FAILED_FISCAL_SUBMISSION: 0,
      FAILED_JOB: 0,
    };
    for (const row of rows) counts[row.alert_type] = row.count;
    return this.metrics.render(counts);
  }
}
