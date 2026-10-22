import { ConflictException } from '@nestjs/common';
import type { DatabaseTransaction } from '@pharmacy/database';

import type { AuthenticatedUser } from '../auth/auth.types.js';

/** Cash a closed session should have held, from the same ledgers the cash counter shows. */
export const EXPECTED_CASH_SQL = `
  cash_sessions.opening_float
  + coalesce((select sum(amount) from payments where payments.cash_session_id = cash_sessions.id
      and payments.method = 'CASH' and payments.status = 'CAPTURED'), 0)
  + coalesce((select -sum(amount_delta) from customer_ledger_entries
      where customer_ledger_entries.cash_session_id = cash_sessions.id
        and entry_type = 'PAYMENT' and payment_method = 'CASH'), 0)
  - coalesce((select sum(amount) from refunds where refunds.cash_session_id = cash_sessions.id
      and refunds.method = 'CASH'), 0)
  + coalesce((select sum(amount) from cash_movements
      where cash_movements.cash_session_id = cash_sessions.id
        and movement_type = 'CASH_IN'), 0)
  - coalesce((select sum(amount) from cash_movements
      where cash_movements.cash_session_id = cash_sessions.id
        and movement_type = 'CASH_OUT'), 0)
`;

export async function cashSessionsEnabled(
  transaction: DatabaseTransaction,
  branchId: string,
): Promise<boolean> {
  const [branch] = await transaction<Array<{ enabled: boolean }>>`
    select cash_sessions_enabled as enabled from branches where id = ${branchId}
  `;
  return branch?.enabled ?? true;
}

/**
 * Closes automatic sessions without a count: nobody counted a drawer, so counted equals expected
 * and there is no variance to approve.
 */
export async function closeAutomaticSessions(
  transaction: DatabaseTransaction,
  where: { readonly branchId: string; readonly sessionId?: string },
): Promise<number> {
  const closed = await transaction`
    update cash_sessions set
      expected_cash = greatest(${transaction.unsafe(EXPECTED_CASH_SQL)}, 0),
      counted_cash = greatest(${transaction.unsafe(EXPECTED_CASH_SQL)}, 0),
      variance = 0, status = 'CLOSED', closed_at = now(),
      closing_notes = 'Closed automatically: this shop does not run cash sessions'
    where cash_sessions.branch_id = ${where.branchId}
      and cash_sessions.auto_managed and cash_sessions.status = 'OPEN'
      and (${where.sessionId ?? null}::bigint is null or cash_sessions.id = ${where.sessionId ?? null}::bigint)
  `;
  return closed.count;
}

/**
 * The cash session a cash movement of money belongs to.
 *
 * With cash sessions on, it must be the caller's own open session on this terminal. With them off,
 * the server keeps one automatic session per counter user per business day, opening it on first use
 * and closing yesterday's, so the order taker never sees a till yet every sale has a day.
 * Lock order: terminal row, then cash session (the same order opening a session uses).
 */
export async function resolveCashSession(
  transaction: DatabaseTransaction,
  user: AuthenticatedUser,
  requestedSessionId: string | null,
  missingMessage = 'An open cash session is required',
): Promise<string> {
  if (await cashSessionsEnabled(transaction, user.branchId)) {
    const [session] = await transaction<Array<{ id: string }>>`
      select id::text from cash_sessions
      where id = ${requestedSessionId}::bigint and branch_id = ${user.branchId}
        and terminal_id = ${user.terminalId} and cashier_user_id = ${user.id}
        and status = 'OPEN'
      for update
    `;
    if (!session) throw new ConflictException(missingMessage);
    return session.id;
  }

  await transaction`select id from terminals where id = ${user.terminalId} for update`;
  const [open] = await transaction<
    Array<{ id: string; auto_managed: boolean; opened_today: boolean }>
  >`
    select cash_sessions.id::text, cash_sessions.auto_managed,
      (cash_sessions.opened_at at time zone branches.timezone)::date
        = (now() at time zone branches.timezone)::date as opened_today
    from cash_sessions
    join branches on branches.id = cash_sessions.branch_id
    where cash_sessions.branch_id = ${user.branchId}
      and cash_sessions.terminal_id = ${user.terminalId}
      and cash_sessions.cashier_user_id = ${user.id}
      and cash_sessions.status = 'OPEN'
    order by cash_sessions.opened_at desc limit 1
    for update of cash_sessions
  `;
  // A till someone opened by hand before sessions were switched off stays in use until closed.
  if (open && (!open.auto_managed || open.opened_today)) return open.id;
  if (open)
    await closeAutomaticSessions(transaction, { branchId: user.branchId, sessionId: open.id });

  const [created] = await transaction<Array<{ id: string }>>`
    insert into cash_sessions (branch_id, terminal_id, cashier_user_id, opening_float, auto_managed)
    values (${user.branchId}, ${user.terminalId}, ${user.id}, 0, true)
    returning id::text
  `;
  if (!created) throw new Error('Automatic cash session creation did not return an identifier');
  await transaction`
    insert into audit_events (
      branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
    ) values (
      ${user.branchId}, ${user.id}, ${user.terminalId}, 'CASH_SESSION.AUTO_OPENED',
      'cash_session', ${created.id}, ${transaction.json({ reason: 'cash sessions are off' })}
    )
  `;
  return created.id;
}
