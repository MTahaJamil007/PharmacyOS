import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import type {
  ApproveCashVarianceRequest,
  CashMovementRequest,
  CloseCashSessionRequest,
  OpenCashSessionRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';

interface LockedCashSession {
  readonly id: string;
  readonly branch_id: string;
  readonly terminal_id: string;
  readonly cashier_user_id: string;
  readonly status: string;
  readonly close_client_request_id: string | null;
  readonly variance_approval_client_request_id: string | null;
}

export interface CashSummaryRow {
  readonly id: string;
  readonly status: string;
  readonly cashierUserId: string;
  readonly cashierName: string;
  readonly openingFloat: string;
  readonly cashSales: string;
  readonly cashRefunds: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly expectedCash: string;
  readonly countedCash: string | null;
  readonly variance: string | null;
  readonly varianceApprovalThreshold: string;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly closingNotes: string | null;
}

type QueryableDatabase = Database | DatabaseTransaction;

@Injectable()
export class CashSessionsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async open(
    user: AuthenticatedUser,
    input: OpenCashSessionRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      await transaction`select id from terminals where id = ${user.terminalId} for update`;
      const [replay] = await transaction<Array<{ id: string }>>`
        select id::text from cash_sessions
        where branch_id = ${user.branchId} and terminal_id = ${user.terminalId}
          and open_client_request_id = ${input.clientRequestId}
      `;
      if (replay)
        return { ...(await this.summaryWith(transaction, replay.id)), idempotentReplay: true };

      const [active] = await transaction<Array<{ id: string }>>`
        select id::text from cash_sessions
        where cashier_user_id = ${user.id} and terminal_id = ${user.terminalId}
          and status in ('OPEN', 'CLOSING')
      `;
      if (active) throw new ConflictException('This cashier already has an active session');

      const [session] = await transaction<Array<{ id: string }>>`
        insert into cash_sessions (
          branch_id, terminal_id, cashier_user_id, opening_float, open_client_request_id
        ) values (
          ${user.branchId}, ${user.terminalId}, ${user.id}, ${input.openingFloat},
          ${input.clientRequestId}
        ) returning id::text
      `;
      if (!session) throw new Error('Cash session creation did not return an identifier');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CASH_SESSION.OPENED',
          'cash_session', ${session.id}, ${input.clientRequestId},
          ${transaction.json({ openingFloat: input.openingFloat })}
        )
      `;
      return { ...(await this.summaryWith(transaction, session.id)), idempotentReplay: false };
    });
  }

  async current(user: AuthenticatedUser): Promise<CashSummaryRow | null> {
    const [session] = await this.database<Array<{ id: string }>>`
      select id::text from cash_sessions
      where branch_id = ${user.branchId} and terminal_id = ${user.terminalId}
        and cashier_user_id = ${user.id} and status in ('OPEN', 'CLOSING')
      order by opened_at desc limit 1
    `;
    return session ? this.summaryWith(this.database, session.id) : null;
  }

  async pendingVariance(
    user: AuthenticatedUser,
  ): Promise<{ readonly data: readonly CashSummaryRow[] }> {
    const sessions = await this.database<Array<{ id: string }>>`
      select id::text from cash_sessions
      where branch_id = ${user.branchId} and status = 'CLOSING'
      order by opened_at asc, id asc limit 50
    `;
    return {
      data: await Promise.all(
        sessions.map((session) => this.summaryWith(this.database, session.id, user.branchId)),
      ),
    };
  }

  async summary(user: AuthenticatedUser, sessionId: bigint): Promise<CashSummaryRow> {
    const summary = await this.summaryWith(this.database, sessionId.toString(), user.branchId);
    if (summary.cashierUserId !== user.id && !user.permissions.includes('cash.approve_variance')) {
      throw new NotFoundException('Cash session not found');
    }
    return summary;
  }

  async addMovement(
    user: AuthenticatedUser,
    sessionId: bigint,
    input: CashMovementRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const session = await this.lockOwnedSession(transaction, user, sessionId);
      if (session.status !== 'OPEN') throw new ConflictException('Cash session is not open');
      const [existing] = await transaction<Array<{ id: string }>>`
        select id::text from cash_movements
        where cash_session_id = ${session.id} and client_request_id = ${input.clientRequestId}
      `;
      if (existing)
        return {
          id: existing.id,
          session: await this.summaryWith(transaction, session.id),
          idempotentReplay: true,
        };
      const [movement] = await transaction<Array<{ id: string }>>`
        insert into cash_movements (
          cash_session_id, performed_by_user_id, movement_type, amount, reason, client_request_id
        ) values (
          ${session.id}, ${user.id}, ${input.movementType}, ${input.amount}, ${input.reason},
          ${input.clientRequestId}
        ) returning id::text
      `;
      if (!movement) throw new Error('Cash movement creation did not return an identifier');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CASH_MOVEMENT.CREATED',
          'cash_movement', ${movement.id}, ${input.clientRequestId},
          ${transaction.json({ sessionId: session.id, type: input.movementType, amount: input.amount, reason: input.reason })}
        )
      `;
      return {
        id: movement.id,
        session: await this.summaryWith(transaction, session.id),
        idempotentReplay: false,
      };
    });
  }

  async close(
    user: AuthenticatedUser,
    sessionId: bigint,
    input: CloseCashSessionRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const session = await this.lockOwnedSession(transaction, user, sessionId);
      if (session.close_client_request_id === input.clientRequestId) {
        return { ...(await this.summaryWith(transaction, session.id)), idempotentReplay: true };
      }
      if (session.status !== 'OPEN') throw new ConflictException('Cash session is not open');
      const before = await this.summaryWith(transaction, session.id);
      const [closed] = await transaction<Array<{ status: string }>>`
        update cash_sessions set
          expected_cash = ${before.expectedCash}, counted_cash = ${input.countedCash},
          variance = ${input.countedCash}::numeric - ${before.expectedCash}::numeric,
          closing_notes = ${input.closingNotes ?? null},
          close_client_request_id = ${input.clientRequestId},
          status = case
            when abs(${input.countedCash}::numeric - ${before.expectedCash}::numeric)
              > ${before.varianceApprovalThreshold}::numeric then 'CLOSING'
            else 'CLOSED'
          end,
          closed_at = case
            when abs(${input.countedCash}::numeric - ${before.expectedCash}::numeric)
              <= ${before.varianceApprovalThreshold}::numeric then now()
            else null
          end
        where id = ${session.id}
        returning status
      `;
      if (!closed) throw new Error('Cash session close did not return a status');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CASH_SESSION.COUNTED',
          'cash_session', ${session.id}, ${input.clientRequestId},
          ${transaction.json({ expectedCash: before.expectedCash, countedCash: input.countedCash, status: closed.status })}
        )
      `;
      return { ...(await this.summaryWith(transaction, session.id)), idempotentReplay: false };
    });
  }

  async approveVariance(
    user: AuthenticatedUser,
    sessionId: bigint,
    input: ApproveCashVarianceRequest,
  ): Promise<Record<string, unknown>> {
    return this.database.begin(async (transaction) => {
      const [session] = await transaction<LockedCashSession[]>`
        select id::text, branch_id::text, terminal_id::text, cashier_user_id::text, status,
          close_client_request_id, variance_approval_client_request_id
        from cash_sessions where id = ${sessionId.toString()} for update
      `;
      if (!session || session.branch_id !== user.branchId)
        throw new NotFoundException('Cash session not found');
      if (session.variance_approval_client_request_id === input.clientRequestId) {
        return { ...(await this.summaryWith(transaction, session.id)), idempotentReplay: true };
      }
      if (session.status !== 'CLOSING')
        throw new ConflictException('Cash session is not awaiting variance approval');
      if (session.cashier_user_id === user.id)
        throw new ConflictException('A cashier cannot approve their own variance');
      await transaction`
        update cash_sessions set status = 'VARIANCE_APPROVED', closed_at = now(),
          variance_approved_by_user_id = ${user.id}, variance_approved_at = now(),
          variance_approval_client_request_id = ${input.clientRequestId},
          closing_notes = concat_ws(E'\n', nullif(closing_notes, ''), ${`Variance approval: ${input.notes}`})
        where id = ${session.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, request_id,
          metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CASH_SESSION.VARIANCE_APPROVED',
          'cash_session', ${session.id}, ${input.clientRequestId},
          ${transaction.json({ notes: input.notes, cashierUserId: session.cashier_user_id })}
        )
      `;
      return { ...(await this.summaryWith(transaction, session.id)), idempotentReplay: false };
    });
  }

  private async lockOwnedSession(
    transaction: DatabaseTransaction,
    user: AuthenticatedUser,
    sessionId: bigint,
  ): Promise<LockedCashSession> {
    const [session] = await transaction<LockedCashSession[]>`
      select id::text, branch_id::text, terminal_id::text, cashier_user_id::text, status,
        close_client_request_id, variance_approval_client_request_id
      from cash_sessions where id = ${sessionId.toString()} for update
    `;
    if (
      !session ||
      session.branch_id !== user.branchId ||
      session.terminal_id !== user.terminalId ||
      session.cashier_user_id !== user.id
    ) {
      throw new NotFoundException('Cash session not found');
    }
    return session;
  }

  private async summaryWith(
    database: QueryableDatabase,
    sessionId: string,
    branchId?: string,
  ): Promise<CashSummaryRow> {
    const [summary] = await database<CashSummaryRow[]>`
      select cash_sessions.id::text as id, cash_sessions.status,
        cash_sessions.cashier_user_id::text as "cashierUserId",
        users.display_name as "cashierName", cash_sessions.opening_float::text as "openingFloat",
        totals.cash_sales::text as "cashSales", totals.cash_refunds::text as "cashRefunds",
        totals.cash_in::text as "cashIn", totals.cash_out::text as "cashOut",
        (cash_sessions.opening_float + totals.cash_sales - totals.cash_refunds
          + totals.cash_in - totals.cash_out)::text as "expectedCash",
        cash_sessions.counted_cash::text as "countedCash",
        cash_sessions.variance::text as variance,
        coalesce(policies.cash_variance_approval_threshold, 100)::text
          as "varianceApprovalThreshold",
        cash_sessions.opened_at as "openedAt", cash_sessions.closed_at as "closedAt",
        cash_sessions.closing_notes as "closingNotes"
      from cash_sessions
      join users on users.id = cash_sessions.cashier_user_id
      left join operational_intelligence_policies policies
        on policies.branch_id = cash_sessions.branch_id
      cross join lateral (
        select
          coalesce((select sum(amount) from payments
            where cash_session_id = cash_sessions.id and method = 'CASH' and status = 'CAPTURED'), 0)
            as cash_sales,
          coalesce((select sum(amount) from refunds
            where cash_session_id = cash_sessions.id and method = 'CASH'), 0) as cash_refunds,
          coalesce((select sum(amount) from cash_movements
            where cash_session_id = cash_sessions.id and movement_type = 'CASH_IN'), 0) as cash_in,
          coalesce((select sum(amount) from cash_movements
            where cash_session_id = cash_sessions.id and movement_type = 'CASH_OUT'), 0) as cash_out
      ) totals
      where cash_sessions.id = ${sessionId}
        and (${branchId ?? null}::bigint is null or cash_sessions.branch_id = ${branchId ?? null})
    `;
    if (!summary) throw new NotFoundException('Cash session not found');
    return summary;
  }
}
