import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import {
  createDraftSchema,
  openCashSessionSchema,
  type CashSessionSummary,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../../../apps/api/src/auth/auth.types.js';
import { CashSessionsService } from '../../../apps/api/src/cash-sessions/cash-sessions.service.js';
import { PlatformService } from '../../../apps/api/src/platform/platform.service.js';
import { CashCounterService } from '../../../apps/api/src/pos/cash-counter.service.js';
import { PosService } from '../../../apps/api/src/pos/pos.service.js';

export type Check = (name: string, ok: boolean, detail?: string) => void;

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await promise;
    return 'did not reject';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return pattern.test(message) ? 'ok' : message;
  }
}

/**
 * The cash counter end to end against real migrations: the order taker sends, the cashier clears,
 * the day's drawer adds up, and a shop without cash sessions invoices straight from the counter.
 */
export async function cashCounterScenario(
  db: Database,
  environment: Environment,
  check: Check,
): Promise<void> {
  const [branch] = await db<Array<{ id: string }>>`
    insert into branches (code, name) values ('CC', 'Cash Counter Pharmacy') returning id::text`;
  const branchId = branch!.id;
  await db`insert into operational_intelligence_policies (branch_id) values (${branchId})`;
  const terminal = async (code: string) =>
    (
      await db<Array<{ id: string }>>`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${branchId}, ${code}, ${code}, 'SALES_COUNTER') returning id::text`
    )[0]!.id;
  const orderDesk = await terminal('ORDER-1');
  const cashDesk = await terminal('CASH-1');
  const user = async (username: string) =>
    (
      await db<Array<{ id: string }>>`
        insert into users (username, display_name, password_hash)
        values (${username}, ${username}, 'unused') returning id::text`
    )[0]!.id;
  const takerId = await user('taker');
  const cashierId = await user('cashier');
  const superId = await user('owner-of-software');
  const actor = (id: string, terminalId: string): AuthenticatedUser => ({
    id,
    branchId,
    terminalId,
    username: id,
    displayName: id,
    permissions: ['platform.super_admin'],
    sessionId: '0',
  });
  const taker = actor(takerId, orderDesk);
  const cashier = actor(cashierId, cashDesk);
  const softwareOwner = actor(superId, cashDesk);
  const [medicine] = await db<Array<{ id: string }>>`
    insert into medicines (name, strength, pack_size, unit_name)
    values ('Brufen', '400mg', 10, 'tablet') returning id::text`;
  await db.begin(async (transaction) => {
    const [batch] = await transaction<Array<{ id: string }>>`
      insert into inventory_batches (branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status)
      values (${branchId}, ${medicine!.id}, 'BR1', current_date + 300, 10, 16.50, 100, 'SELLABLE')
      returning id::text`;
    await transaction`
      insert into stock_movements (branch_id, inventory_batch_id, movement_type, quantity_delta,
        quantity_after, reason)
      values (${branchId}, ${batch!.id}, 'ADJUSTMENT_IN', 100, 100, 'fixture')`;
  });

  const pos = new PosService(db, environment);
  const counter = new CashCounterService(db, pos);
  const sessions = new CashSessionsService(db);
  const platform = new PlatformService(db, environment);
  const reservedOrder = async (quantity: string) => {
    const draft = (await pos.createDraft(
      taker,
      createDraftSchema.parse({
        terminalId: orderDesk,
        items: [{ medicineId: medicine!.id, quantity, dosageInstruction: '101' }],
      }),
    )) as { id: string };
    await pos.reserveDraft(taker, BigInt(draft.id));
    return draft.id;
  };
  const available = async () =>
    (
      await db<Array<{ qty: string }>>`
        select (sum(current_qty) - coalesce((select sum(quantity) from stock_reservations
          where status = 'ACTIVE' and expires_at > now()), 0))::text as qty
        from inventory_batches where medicine_id = ${medicine!.id}`
    )[0]!.qty;

  // 1. Cash sessions on (the default): order taker sends, the cashier's queue shows it.
  check('shops run cash sessions by default', (await counter.settings(taker)).cashSessionsEnabled);
  const first = await reservedOrder('10');
  check(
    'sending needs no till at the order desk',
    !(await counter.sendToCashier(taker, BigInt(first), null)).idempotentReplay,
  );
  check(
    'sending twice is harmless',
    (await counter.sendToCashier(taker, BigInt(first), null)).idempotentReplay === true,
  );
  const queue = (await counter.queue(cashier)).data;
  check(
    'the cash counter sees the bill with its lines',
    queue.length === 1 &&
      queue[0]?.total === '165.00' &&
      JSON.stringify(queue[0]?.items).includes('Brufen') &&
      queue[0]?.orderTaker === 'taker',
    JSON.stringify(queue),
  );

  // 2. The cashier starts the day with the drawer's cash and clears the payment.
  check(
    'clearing needs a started day',
    (await rejects(
      counter.clearPayment(cashier, BigInt(first), { clientRequestId: 'clear-first-attempt' }),
      /open cash session/,
    )) === 'ok',
  );
  const day = (await sessions.open(
    cashier,
    openCashSessionSchema.parse({ openingFloat: '2000', clientRequestId: 'open-cash-day' }),
  )) as unknown as CashSessionSummary;
  const cleared = (await counter.clearPayment(cashier, BigInt(first), {
    cashSessionId: BigInt(day.id),
    clientRequestId: 'clear-first-order',
    tenderedAmount: '500',
  })) as { id: string; invoiceNumber: string; idempotentReplay: boolean };
  check('payment clears into a sale', Boolean(cleared.invoiceNumber) && !cleared.idempotentReplay);
  const [payment] = await db<Array<{ amount: string; tendered: string; change: string }>>`
    select amount::text, tendered_amount::text as tendered, change_amount::text as change
    from payments where sale_id = ${cleared.id}`;
  check(
    'cash taken and change recorded',
    payment?.amount === '165.00' && payment.tendered === '500.00' && payment.change === '335.00',
    JSON.stringify(payment),
  );
  const replay = (await counter.clearPayment(cashier, BigInt(first), {
    cashSessionId: BigInt(day.id),
    clientRequestId: 'clear-first-order',
  })) as { id: string; idempotentReplay: boolean };
  check(
    'a retried clear returns the same sale',
    replay.idempotentReplay && replay.id === cleared.id,
  );
  check(
    'a different clear of a paid bill is refused',
    (await rejects(
      counter.clearPayment(cashier, BigInt(first), {
        cashSessionId: BigInt(day.id),
        clientRequestId: 'clear-first-again',
      }),
      /already been paid/,
    )) === 'ok',
  );
  const after = (await counter.queue(cashier)) as unknown as {
    data: unknown[];
    recent: Array<{ id: string }>;
  };
  check(
    'the queue empties and the sale shows as recent',
    after.data.length === 0 && after.recent[0]?.id === cleared.id,
  );
  const summary = (await sessions.current(cashier))!;
  check(
    'the drawer should hold opening cash plus the sale',
    summary.cashSales === '165.00' && summary.expectedCash === '2165.00',
    JSON.stringify(summary),
  );

  // 3. A customer who leaves: the cashier cancels and the stock is released.
  const before = await available();
  const second = await reservedOrder('5');
  await counter.sendToCashier(taker, BigInt(second), null);
  await counter.cancel(cashier, BigInt(second));
  check('cancelling at the cash counter releases stock', (await available()) === before);

  // 4. A bill that waited past its stock hold is re-reserved when cleared.
  const third = await reservedOrder('2');
  await counter.sendToCashier(taker, BigInt(third), null);
  await db`update stock_reservations set status = 'EXPIRED', released_at = now()
    where sale_draft_item_id in (select id from sale_draft_items where sale_draft_id = ${third})`;
  await db`update sale_drafts set status = 'EXPIRED', reserved_until = now() - interval '1 minute'
    where id = ${third}`;
  const late = (await counter.clearPayment(cashier, BigInt(third), {
    cashSessionId: BigInt(day.id),
    clientRequestId: 'clear-late-order',
  })) as { total: string };
  check('an expired hold is re-reserved and paid', late.total === '33.00', JSON.stringify(late));

  // 5. Super admin switches cash sessions off: the order taker invoices directly.
  await platform.setCashSessions(softwareOwner, BigInt(branchId), false);
  const fourth = await reservedOrder('4');
  check(
    'no cash counter queue while sessions are off',
    (await rejects(counter.sendToCashier(taker, BigInt(fourth), null), /Print the invoice/)) ===
      'ok',
  );
  const invoiced = (await counter.completeInvoice(taker, BigInt(fourth), {
    clientRequestId: 'invoice-direct-1',
  })) as { id: string; total: string };
  const [auto] = await db<Array<{ id: string; auto: boolean; opening: string; user_id: string }>>`
    select cash_sessions.id::text, cash_sessions.auto_managed as auto,
      cash_sessions.opening_float::text as opening, cash_sessions.cashier_user_id::text as user_id
    from sales join cash_sessions on cash_sessions.id = sales.cash_session_id
    where sales.id = ${invoiced.id}`;
  check(
    'the invoice lands in an automatic day session',
    invoiced.total === '66.00' &&
      auto?.auto === true &&
      auto.opening === '0.00' &&
      auto.user_id === takerId,
    JSON.stringify(auto),
  );
  const fifth = await reservedOrder('1');
  const sameDay = (await counter.completeInvoice(taker, BigInt(fifth), {
    clientRequestId: 'invoice-direct-2',
  })) as { id: string };
  const [sameSession] = await db<Array<{ id: string }>>`
    select cash_session_id::text as id from sales where id = ${sameDay.id}`;
  check('the same day reuses the session', sameSession?.id === auto?.id);
  await db`update cash_sessions set opened_at = now() - interval '2 days' where id = ${auto!.id}`;
  const sixth = await reservedOrder('1');
  const nextDay = (await counter.completeInvoice(taker, BigInt(sixth), {
    clientRequestId: 'invoice-direct-3',
  })) as { id: string };
  const [old] = await db<Array<{ status: string; variance: string; counted: string }>>`
    select status, variance::text, counted_cash::text as counted from cash_sessions
    where id = ${auto!.id}`;
  const [fresh] = await db<Array<{ id: string }>>`
    select cash_session_id::text as id from sales where id = ${nextDay.id}`;
  check(
    'yesterday closes by itself and a new day opens',
    old?.status === 'CLOSED' &&
      old.variance === '0.00' &&
      old.counted === '82.50' &&
      fresh?.id !== auto?.id,
    JSON.stringify(old),
  );
  check(
    'nobody can start a manual day while sessions are off',
    (await rejects(
      sessions.open(
        taker,
        openCashSessionSchema.parse({ openingFloat: '0', clientRequestId: 'manual-open-off' }),
      ),
      /does not run cash sessions/,
    )) === 'ok',
  );

  // 6. Back on: automatic sessions close and invoicing goes through the cash counter again.
  await platform.setCashSessions(softwareOwner, BigInt(branchId), true);
  const [stillOpen] = await db<Array<{ count: number }>>`
    select count(*)::int as count from cash_sessions where auto_managed and status = 'OPEN'`;
  check('switching back on closes automatic sessions', stillOpen?.count === 0);
  const seventh = await reservedOrder('1');
  check(
    'direct invoicing is refused once the cash counter is back',
    (await rejects(
      counter.completeInvoice(taker, BigInt(seventh), { clientRequestId: 'invoice-direct-4' }),
      /uses the cash counter/,
    )) === 'ok',
  );
  const audit = (
    await db<Array<{ event_type: string }>>`
      select distinct event_type from audit_events where branch_id = ${branchId}`
  ).map((row) => row.event_type);
  check(
    'every step is audited',
    [
      'POS.SENT_TO_CASH_COUNTER',
      'CASH_SESSION.OPENED',
      'POS.DRAFT_CANCELLED',
      'PLATFORM.CASH_SESSIONS_DISABLED',
      'CASH_SESSION.AUTO_OPENED',
      'PLATFORM.CASH_SESSIONS_ENABLED',
    ].every((event) => audit.includes(event)),
    audit.join(','),
  );
}
