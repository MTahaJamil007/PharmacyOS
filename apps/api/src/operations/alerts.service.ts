import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import type { OperationalAlertsResponse } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

@Injectable()
export class AlertsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async list(
    user: AuthenticatedUser,
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED',
    limit: number,
  ): Promise<OperationalAlertsResponse> {
    const rows = await this.database<
      Array<{
        id: string;
        alert_type: OperationalAlertsResponse['alerts'][number]['alertType'];
        severity: OperationalAlertsResponse['alerts'][number]['severity'];
        status: OperationalAlertsResponse['alerts'][number]['status'];
        title: string;
        details: Record<string, unknown>;
        first_observed_at: string;
        last_observed_at: string;
      }>
    >`
      select id::text, alert_type, severity, status, title, details,
        first_observed_at::text, last_observed_at::text
      from operational_alerts
      where status = ${status} and (branch_id = ${user.branchId} or branch_id is null)
      order by case severity when 'CRITICAL' then 0 else 1 end,
        last_observed_at desc, id desc limit ${limit}
    `;
    return {
      summary: {
        total: rows.length,
        critical: rows.filter((row) => row.severity === 'CRITICAL').length,
      },
      alerts: rows.map((row) => ({
        id: row.id,
        alertType: row.alert_type,
        severity: row.severity,
        status: row.status,
        title: row.title,
        details: row.details,
        firstObservedAt: row.first_observed_at,
        lastObservedAt: row.last_observed_at,
      })),
    };
  }

  async acknowledge(
    user: AuthenticatedUser,
    alertId: bigint,
  ): Promise<{ id: string; status: string }> {
    return this.database.begin(async (transaction) => {
      const id = alertId.toString();
      const [alert] = await transaction<Array<{ status: string }>>`
        select status from operational_alerts
        where id = ${id} and (branch_id = ${user.branchId} or branch_id is null)
        for update
      `;
      if (!alert) throw new NotFoundException('Operational alert not found');
      if (alert.status === 'RESOLVED')
        throw new ConflictException('Resolved alerts cannot be acknowledged');
      if (alert.status === 'OPEN') {
        await transaction`
          update operational_alerts set status = 'ACKNOWLEDGED', acknowledged_at = now(),
            acknowledged_by_user_id = ${user.id} where id = ${id}
        `;
        await transaction`
          insert into audit_events (
            branch_id, user_id, terminal_id, event_type, entity_type, entity_id
          ) values (
            ${user.branchId}, ${user.id}, ${user.terminalId}, 'OPERATIONAL_ALERT.ACKNOWLEDGED',
            'operational_alert', ${id}
          )
        `;
      }
      return { id, status: 'ACKNOWLEDGED' };
    });
  }
}
