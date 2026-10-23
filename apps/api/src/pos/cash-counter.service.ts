import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '@pharmacy/database';
import { moneyToMinorUnits } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE } from '../database.module.js';
import { PosService } from './pos.service.js';

interface QueuedDraftRow {
  readonly id: string;
  readonly branch_id: string;
  readonly terminal_id: string;
  readonly status: string;
  readonly total: string;
  readonly reserved_until: Date | null;
  readonly customer_id: string | null;
  readonly cashier_queued_at: Date | null;
}

/** A cashier holds a bill this long while taking payment; after that another counter may take it. */
const CLAIM_SECONDS = 120;

/**
 * The hand-off between the order taker and the cash counter. With cash sessions on, the order
 * taker reserves the order and sends it here; the cashier sees the bill, takes the cash, and clears
 * it. With cash sessions off, the order taker issues the invoice directly.
 */
@Injectable()
export class CashCounterService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(PosService) private readonly pos: PosService,
  ) {}

  async settings(user: AuthenticatedUser) {
    const [branch] = await this.database<
      Array<{
        cash_sessions_enabled: boolean;
        order_taker_discount_enabled: boolean;
        cashier_discount_enabled: boolean;
      }>
    >`
      select branches.cash_sessions_enabled, policies.order_taker_discount_enabled,
        policies.cashier_discount_enabled
      from branches left join operational_intelligence_policies policies
        on policies.branch_id = branches.id where branches.id = ${user.branchId}
    `;
    return {
      cashSessionsEnabled: branch?.cash_sessions_enabled ?? true,
      orderTakerDiscountEnabled: branch?.order_taker_discount_enabled ?? false,
      cashierDiscountEnabled: branch?.cashier_discount_enabled ?? false,
    };
  }

  /** Cash counters the order taker can send a bill to, with who is taking money there now. */
  async cashCounters(user: AuthenticatedUser) {
    const data = await this.database<
      Array<{ id: string; code: string; name: string; cashier: string | null; waiting: number }>
    >`
      select terminals.id::text, terminals.code, terminals.name,
        (select users.display_name from cash_sessions
          join users on users.id = cash_sessions.cashier_user_id
          where cash_sessions.terminal_id = terminals.id and cash_sessions.status = 'OPEN'
          order by cash_sessions.opened_at desc limit 1) as cashier,
        (select count(*)::int from sale_drafts
          where sale_drafts.cash_counter_terminal_id = terminals.id
            and sale_drafts.cashier_queued_at is not null
            and sale_drafts.status in ('SENT_TO_CASHIER', 'RESERVED', 'EXPIRED')) as waiting
      from terminals
      where terminals.branch_id = ${user.branchId} and terminals.is_active
        and terminals.terminal_type = 'CASHIER'
      order by terminals.name, terminals.id
    `;
    return { data };
  }

  async sendToCashier(
    user: AuthenticatedUser,
    draftId: bigint,
    customerId: bigint | null,
    cashCounterTerminalId: bigint | null = null,
  ) {
    return this.database.begin(async (transaction) => {
      const [branch] = await transaction<Array<{ enabled: boolean }>>`
        select cash_sessions_enabled as enabled from branches where id = ${user.branchId}
      `;
      if (!branch?.enabled) {
        throw new ConflictException(
          'This shop has no cash counter queue. Print the invoice instead.',
        );
      }
      const [draft] = await transaction<QueuedDraftRow[]>`
        select id::text, branch_id::text, terminal_id::text, status, total::text, reserved_until,
          customer_id::text, cashier_queued_at
        from sale_drafts where id = ${draftId.toString()} for update
      `;
      if (!draft || draft.branch_id !== user.branchId)
        throw new NotFoundException('Order not found');
      if (draft.terminal_id !== user.terminalId) {
        throw new ConflictException('Only the counter that took this order can send it');
      }
      if (draft.cashier_queued_at !== null) {
        return {
          id: draft.id,
          total: draft.total,
          queuedAt: draft.cashier_queued_at,
          idempotentReplay: true,
        };
      }
      if (draft.status !== 'RESERVED') {
        throw new ConflictException('Reserve the order before sending it to the cash counter');
      }
      if (customerId !== null) {
        const [customer] = await transaction<Array<{ id: string }>>`
          select id::text from customers
          where id = ${customerId.toString()} and branch_id = ${user.branchId}
            and deleted_at is null and is_active
        `;
        if (!customer) throw new NotFoundException('Customer not found');
      }
      if (cashCounterTerminalId !== null) {
        const [counter] = await transaction<Array<{ id: string }>>`
          select id::text from terminals
          where id = ${cashCounterTerminalId.toString()} and branch_id = ${user.branchId}
            and is_active and terminal_type = 'CASHIER'
        `;
        if (!counter) throw new NotFoundException('Cash counter not found');
      }
      const [queued] = await transaction<Array<{ cashier_queued_at: Date }>>`
        update sale_drafts set cashier_queued_at = now(), cashier_queued_by = ${user.id},
          customer_id = ${customerId?.toString() ?? null},
          cash_counter_terminal_id = ${cashCounterTerminalId?.toString() ?? null}
        where id = ${draft.id}
        returning cashier_queued_at
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'POS.SENT_TO_CASH_COUNTER',
          'sale_draft', ${draft.id},
          ${transaction.json({
            total: draft.total,
            cashCounterTerminalId: cashCounterTerminalId?.toString() ?? null,
          })}
        )
      `;
      return {
        id: draft.id,
        total: draft.total,
        queuedAt: queued?.cashier_queued_at ?? null,
        idempotentReplay: false,
      };
    });
  }

  async queue(user: AuthenticatedUser) {
    const data = await this.database<Array<Record<string, unknown>>>`
      select sale_drafts.id::text as id, sale_drafts.total::text as total,
        sale_drafts.discount_total::text as "invoiceDiscount",
        sale_drafts.cashier_queued_at as "queuedAt", sale_drafts.reserved_until as "reservedUntil",
        sale_drafts.status, takers.display_name as "orderTaker",
        terminals.name as "counterName", customers.name as "customerName",
        sale_drafts.cash_counter_terminal_id::text as "cashCounterId",
        cash_counters.name as "cashCounterName",
        (sale_drafts.cash_counter_terminal_id = ${user.terminalId}) as "forThisCounter",
        case when sale_drafts.payment_claimed_at > now() - make_interval(secs => ${CLAIM_SECONDS})
          then claimers.name end as "claimedBy",
        (sale_drafts.payment_claimed_by_terminal_id = ${user.terminalId}
          and sale_drafts.payment_claimed_at > now() - make_interval(secs => ${CLAIM_SECONDS}))
          as "claimedHere",
        coalesce((
          select json_agg(json_build_object(
            'medicineId', sale_draft_items.medicine_id::text,
            'discountAmount', sale_draft_items.discount_amount::text,
            'name', medicines.name, 'strength', medicines.strength,
            'quantity', sale_draft_items.quantity::text,
            'lineTotal', sale_draft_items.line_total::text,
            'dosage', sale_draft_items.dosage_instruction
          ) order by sale_draft_items.id)
          from sale_draft_items join medicines on medicines.id = sale_draft_items.medicine_id
          where sale_draft_items.sale_draft_id = sale_drafts.id
        ), '[]'::json) as items
      from sale_drafts
      join users takers on takers.id = sale_drafts.cashier_queued_by
      join terminals on terminals.id = sale_drafts.terminal_id
      left join customers on customers.id = sale_drafts.customer_id
      left join terminals cash_counters on cash_counters.id = sale_drafts.cash_counter_terminal_id
      left join terminals claimers on claimers.id = sale_drafts.payment_claimed_by_terminal_id
      where sale_drafts.branch_id = ${user.branchId}
        and sale_drafts.cashier_queued_at is not null
        and sale_drafts.status in ('SENT_TO_CASHIER', 'RESERVED', 'EXPIRED')
      order by
        case when sale_drafts.cash_counter_terminal_id = ${user.terminalId} then 0
          when sale_drafts.cash_counter_terminal_id is null then 1 else 2 end,
        sale_drafts.cashier_queued_at, sale_drafts.id
      limit 100
    `;
    const recent = await this.database<Array<Record<string, unknown>>>`
      select sales.id::text as id, sales.invoice_number as "invoiceNumber",
        sales.total::text as total, sales.created_at as "createdAt"
      from sales
      join cash_sessions on cash_sessions.id = sales.cash_session_id
      where cash_sessions.terminal_id = ${user.terminalId}
        and cash_sessions.cashier_user_id = ${user.id}
        and cash_sessions.status in ('OPEN', 'CLOSING')
      order by sales.id desc limit 12
    `;
    return { data, recent };
  }

  /**
   * The cashier opens a bill to take payment. Other counters see "being paid at" for a short time,
   * so two cashiers never take money for the same customer. A stale claim may be taken over.
   */
  async claim(user: AuthenticatedUser, draftId: bigint) {
    const [claimed] = await this.database<Array<{ id: string }>>`
      update sale_drafts set payment_claimed_by_terminal_id = ${user.terminalId},
        payment_claimed_at = now()
      where id = ${draftId.toString()} and branch_id = ${user.branchId}
        and cashier_queued_at is not null
        and status in ('SENT_TO_CASHIER', 'RESERVED', 'EXPIRED')
        and (payment_claimed_by_terminal_id is null
          or payment_claimed_by_terminal_id = ${user.terminalId}
          or payment_claimed_at <= now() - make_interval(secs => ${CLAIM_SECONDS}))
      returning id::text
    `;
    if (claimed) return { id: claimed.id, claimed: true };
    await this.assertNotClaimedElsewhere(user, draftId);
    throw new NotFoundException('Order not found at the cash counter');
  }

  private async assertNotClaimedElsewhere(user: AuthenticatedUser, draftId: bigint) {
    const [elsewhere] = await this.database<Array<{ name: string }>>`
      select terminals.name from sale_drafts
      join terminals on terminals.id = sale_drafts.payment_claimed_by_terminal_id
      where sale_drafts.id = ${draftId.toString()} and sale_drafts.branch_id = ${user.branchId}
        and sale_drafts.payment_claimed_by_terminal_id <> ${user.terminalId}
        and sale_drafts.payment_claimed_at > now() - make_interval(secs => ${CLAIM_SECONDS})
        and sale_drafts.status in ('SENT_TO_CASHIER', 'RESERVED', 'EXPIRED')
    `;
    if (elsewhere) {
      throw new ConflictException(`This bill is being paid at ${elsewhere.name}.`);
    }
  }

  /** The cashier took the cash for this bill. Re-reserves stock first if the hold expired. */
  async clearPayment(
    user: AuthenticatedUser,
    draftId: bigint,
    input: {
      readonly cashSessionId?: bigint | undefined;
      readonly clientRequestId: string;
      readonly tenderedAmount?: string | undefined;
    },
  ) {
    const [draft] = await this.database<QueuedDraftRow[]>`
      select id::text, branch_id::text, terminal_id::text, status, total::text, reserved_until,
        customer_id::text, cashier_queued_at
      from sale_drafts where id = ${draftId.toString()}
    `;
    if (!draft || draft.branch_id !== user.branchId || draft.cashier_queued_at === null) {
      throw new NotFoundException('Order not found at the cash counter');
    }
    if (draft.status === 'CANCELLED') throw new ConflictException('This order was cancelled');
    if (draft.status === 'PAID') {
      // A retry of this cashier's own clear replays its sale; anyone else is told it is paid.
      return this.replayOrPaid(user, draftId, input.clientRequestId);
    }
    await this.assertNotClaimedElsewhere(user, draftId);
    let total = draft.total;
    if (
      draft.status !== 'RESERVED' ||
      !draft.reserved_until ||
      draft.reserved_until <= new Date()
    ) {
      const reservation = (await this.pos.reserveDraft(user, draftId)) as { total: string };
      total = reservation.total;
    }
    if (
      input.tenderedAmount &&
      moneyToMinorUnits(input.tenderedAmount) < moneyToMinorUnits(total)
    ) {
      throw new ConflictException('Cash received is less than the bill');
    }
    return this.pos.finalizeSale(user, {
      draftId,
      clientRequestId: input.clientRequestId,
      ...(input.cashSessionId === undefined ? {} : { cashSessionId: input.cashSessionId }),
      ...(draft.customer_id ? { customerId: BigInt(draft.customer_id) } : {}),
      payments: [
        {
          method: 'CASH',
          amount: total,
          tenderedAmount: input.tenderedAmount ?? total,
        },
      ],
    });
  }

  private async replayOrPaid(
    user: AuthenticatedUser,
    draftId: bigint,
    clientRequestId: string,
  ): Promise<Record<string, unknown>> {
    const [sale] = await this.database<Array<Record<string, unknown>>>`
      select sales.id::text as id, sales.invoice_number as "invoiceNumber",
        sales.total::text as total, return_lookup_tokens.token::text as "returnLookupToken",
        fbr_invoices.status as "fiscalStatus"
      from sales
      left join return_lookup_tokens on return_lookup_tokens.sale_id = sales.id
      left join fbr_invoices on fbr_invoices.sale_id = sales.id
      where sales.sale_draft_id = ${draftId.toString()} and sales.terminal_id = ${user.terminalId}
        and sales.client_request_id = ${clientRequestId}
    `;
    if (!sale) throw new ConflictException('This order has already been paid');
    return { ...sale, idempotentReplay: true };
  }

  cancel(user: AuthenticatedUser, draftId: bigint) {
    return this.pos.cancelDraft(user, draftId, { fromCashCounter: true });
  }

  /**
   * Cash sessions off: the order taker's invoice is the sale. Cash is collected at the counter
   * against the printed invoice, and the sale is recorded in the server's automatic day session.
   */
  async completeInvoice(
    user: AuthenticatedUser,
    draftId: bigint,
    input: { readonly clientRequestId: string; readonly customerId?: bigint | undefined },
  ) {
    const settings = await this.settings(user);
    if (settings.cashSessionsEnabled) {
      throw new ConflictException('This shop uses the cash counter. Send the order there instead.');
    }
    const [draft] = await this.database<QueuedDraftRow[]>`
      select id::text, branch_id::text, terminal_id::text, status, total::text, reserved_until,
        customer_id::text, cashier_queued_at
      from sale_drafts where id = ${draftId.toString()}
    `;
    if (!draft || draft.branch_id !== user.branchId) throw new NotFoundException('Order not found');
    if (draft.terminal_id !== user.terminalId) {
      throw new ConflictException('Only the counter that took this order can invoice it');
    }
    if (draft.status === 'PAID') {
      return this.replayOrPaid(user, draftId, input.clientRequestId);
    }
    let total = draft.total;
    if (
      draft.status !== 'RESERVED' ||
      !draft.reserved_until ||
      draft.reserved_until <= new Date()
    ) {
      const reservation = (await this.pos.reserveDraft(user, draftId)) as { total: string };
      total = reservation.total;
    }
    return this.pos.finalizeSale(user, {
      draftId,
      clientRequestId: input.clientRequestId,
      ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
      payments: [{ method: 'CASH', amount: total, tenderedAmount: total }],
    });
  }
}
