import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  minorUnitsToMoney,
  moneyToMinorUnits,
  type CreateCustomerRequest,
  type CustomerPaymentRequest,
  type CustomerSummary,
  type UpdateCustomerRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE } from '../database.module.js';

type QueryableDatabase = Database | DatabaseTransaction;

interface LockedCustomer {
  readonly id: string;
  readonly credit_limit: string;
  readonly is_active: boolean;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

@Injectable()
export class CustomersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async search(user: AuthenticatedUser, query: string, limit: number) {
    const normalized = query.trim();
    const phone = normalizePhone(normalized);
    const data = await this.database<CustomerSummary[]>`
      select customers.id::text, customers.name, customers.phone, customers.address,
        customers.credit_limit::text as "creditLimit",
        balances.balance::text as balance,
        (customers.credit_limit - balances.balance)::text as "availableCredit",
        customers.is_active as "isActive", customers.created_at as "createdAt"
      from customers
      cross join lateral (
        select coalesce((select balance_after from customer_ledger_entries
          where customer_id = customers.id order by id desc limit 1), 0) as balance
      ) balances
      where customers.branch_id = ${user.branchId} and customers.deleted_at is null
        and (
          ${normalized} = ''
          or customers.name ilike ${`%${normalized}%`}
          or (${phone}::text is not null and customers.phone_normalized like ${phone ? `%${phone}%` : ''})
        )
      order by
        case when customers.phone_normalized = ${phone} then 0 else 1 end,
        case when lower(customers.name) = lower(${normalized}) then 0 else 1 end,
        customers.is_active desc, customers.name, customers.id
      limit ${limit}
    `;
    return { data };
  }

  async create(user: AuthenticatedUser, input: CreateCustomerRequest) {
    return this.database.begin(async (transaction) => {
      const [customer] = await transaction<Array<{ id: string }>>`
        insert into customers (
          branch_id, name, phone, phone_normalized, address, credit_limit
        ) values (
          ${user.branchId}, ${input.name}, ${input.phone ?? null},
          ${normalizePhone(input.phone)}, ${input.address ?? null}, ${input.creditLimit}
        ) returning id::text
      `;
      if (!customer) throw new Error('Customer creation did not return an identifier');

      if (moneyToMinorUnits(input.openingBalance) > 0n) {
        await transaction`
          insert into customer_ledger_entries (
            branch_id, customer_id, entry_type, amount_delta, balance_after,
            performed_by_user_id, reason
          ) values (
            ${user.branchId}, ${customer.id}, 'OPENING_BALANCE', ${input.openingBalance},
            ${input.openingBalance}, ${user.id}, 'Opening balance'
          )
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CUSTOMER.CREATED',
          'customer', ${customer.id},
          ${transaction.json({ creditLimit: input.creditLimit, openingBalance: input.openingBalance })}
        )
      `;
      return this.summaryWith(transaction, user.branchId, customer.id);
    });
  }

  async update(user: AuthenticatedUser, customerId: bigint, input: UpdateCustomerRequest) {
    return this.database.begin(async (transaction) => {
      const id = customerId.toString();
      const customer = await this.lockCustomer(transaction, user.branchId, id);
      const [balance] = await transaction<Array<{ balance: string }>>`
        select coalesce((select balance_after from customer_ledger_entries
          where customer_id = ${id} order by id desc limit 1), 0)::text as balance
      `;
      if (
        input.creditLimit !== undefined &&
        moneyToMinorUnits(input.creditLimit) > -1n &&
        moneyToMinorUnits(input.creditLimit) < moneyToMinorUnits(balance?.balance ?? '0')
      ) {
        throw new ConflictException('Credit limit cannot be lower than the current balance');
      }

      const hasName = input.name !== undefined;
      const hasPhone = input.phone !== undefined;
      const hasAddress = input.address !== undefined;
      const hasCreditLimit = input.creditLimit !== undefined;
      const hasActive = input.isActive !== undefined;
      await transaction`
        update customers set
          name = case when ${hasName} then ${input.name ?? null} else name end,
          phone = case when ${hasPhone} then ${input.phone ?? null} else phone end,
          phone_normalized = case when ${hasPhone} then ${normalizePhone(input.phone)} else phone_normalized end,
          address = case when ${hasAddress} then ${input.address ?? null} else address end,
          credit_limit = case when ${hasCreditLimit} then ${input.creditLimit ?? customer.credit_limit}::numeric else credit_limit end,
          is_active = case when ${hasActive} then ${input.isActive ?? customer.is_active} else is_active end
        where id = ${id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CUSTOMER.UPDATED',
          'customer', ${id}, ${transaction.json({ fields: Object.keys(input) })}
        )
      `;
      return this.summaryWith(transaction, user.branchId, id);
    });
  }

  async statement(user: AuthenticatedUser, customerId: bigint) {
    const id = customerId.toString();
    const customer = await this.summaryWith(this.database, user.branchId, id);
    const entries = await this.database<Array<Record<string, unknown>>>`
      select customer_ledger_entries.id::text,
        customer_ledger_entries.entry_type as "entryType",
        customer_ledger_entries.amount_delta::text as "amountDelta",
        customer_ledger_entries.balance_after::text as "balanceAfter",
        customer_ledger_entries.sale_id::text as "saleId", sales.invoice_number as "invoiceNumber",
        customer_ledger_entries.payment_method as "paymentMethod",
        customer_ledger_entries.reference, customer_ledger_entries.reason,
        users.display_name as "performedBy", customer_ledger_entries.created_at as "createdAt"
      from customer_ledger_entries
      join users on users.id = customer_ledger_entries.performed_by_user_id
      left join sales on sales.id = customer_ledger_entries.sale_id
      where customer_ledger_entries.customer_id = ${id}
        and customer_ledger_entries.branch_id = ${user.branchId}
      order by customer_ledger_entries.id desc limit 500
    `;
    return { customer, entries };
  }

  async recordPayment(user: AuthenticatedUser, customerId: bigint, input: CustomerPaymentRequest) {
    const id = customerId.toString();
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'CUSTOMER.ACCOUNT_PAYMENT',
        user.branchId,
        input.clientRequestId,
      );
      if (input.method === 'CASH') {
        const [session] = await transaction<Array<{ id: string }>>`
          select id::text from cash_sessions
          where id = ${input.cashSessionId?.toString() ?? null}
            and branch_id = ${user.branchId} and terminal_id = ${user.terminalId}
            and cashier_user_id = ${user.id} and status = 'OPEN'
          for update
        `;
        if (!session) throw new ConflictException('An owned open cash session is required');
      }

      await this.lockCustomer(transaction, user.branchId, id);
      const [replay] = await transaction<Array<{ id: string; balance_after: string }>>`
        select id::text, balance_after::text from customer_ledger_entries
        where branch_id = ${user.branchId} and customer_id = ${id}
          and client_request_id = ${input.clientRequestId}
      `;
      if (replay) {
        return { id: replay.id, balance: replay.balance_after, idempotentReplay: true };
      }

      const [latest] = await transaction<Array<{ balance: string }>>`
        select coalesce((select balance_after from customer_ledger_entries
          where customer_id = ${id} order by id desc limit 1), 0)::text as balance
      `;
      const balanceMinor = moneyToMinorUnits(latest?.balance ?? '0');
      const amountMinor = moneyToMinorUnits(input.amount);
      if (amountMinor > balanceMinor) {
        throw new ConflictException({
          message: 'Payment cannot exceed the customer balance',
          balance: minorUnitsToMoney(balanceMinor),
        });
      }
      const balanceAfter = minorUnitsToMoney(balanceMinor - amountMinor);
      const [entry] = await transaction<Array<{ id: string }>>`
        insert into customer_ledger_entries (
          branch_id, customer_id, entry_type, amount_delta, balance_after,
          cash_session_id, payment_method, reference, client_request_id,
          performed_by_user_id, reason
        ) values (
          ${user.branchId}, ${id}, 'PAYMENT', -${input.amount}::numeric, ${balanceAfter},
          ${input.cashSessionId?.toString() ?? null}, ${input.method}, ${input.reference ?? null},
          ${input.clientRequestId}, ${user.id}, 'Payment against customer account'
        ) returning id::text
      `;
      if (!entry) throw new Error('Customer payment did not return an identifier');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'CUSTOMER.PAYMENT_RECORDED',
          'customer_ledger_entry', ${entry.id}, ${input.clientRequestId},
          ${transaction.json({ customerId: id, amount: input.amount, method: input.method, balanceAfter })}
        )
      `;
      return { id: entry.id, balance: balanceAfter, idempotentReplay: false };
    });
  }

  async agedReceivables(user: AuthenticatedUser) {
    const [report] = await this.database<Array<Record<string, unknown>>>`
      with paid as (
        select customer_id, -coalesce(sum(amount_delta) filter (where amount_delta < 0), 0) as amount
        from customer_ledger_entries where branch_id = ${user.branchId} group by customer_id
      ), charges as (
        select entries.customer_id, entries.amount_delta, entries.created_at,
          sum(entries.amount_delta) over (
            partition by entries.customer_id order by entries.id rows unbounded preceding
          ) as cumulative_charge,
          coalesce(paid.amount, 0) as paid_amount
        from customer_ledger_entries entries
        left join paid on paid.customer_id = entries.customer_id
        where entries.branch_id = ${user.branchId} and entries.amount_delta > 0
      ), outstanding as (
        select customer_id, created_at,
          greatest(least(amount_delta, cumulative_charge - paid_amount), 0) as amount
        from charges
      ), branch_clock as (
        select (now() at time zone timezone)::date as today from branches where id = ${user.branchId}
      )
      select count(distinct customer_id) filter (where amount > 0)::int as "customerCount",
        coalesce(sum(amount), 0)::text as total,
        coalesce(sum(amount) filter (where branch_clock.today - outstanding.created_at::date <= 30), 0)::text as current,
        coalesce(sum(amount) filter (where branch_clock.today - outstanding.created_at::date between 31 and 60), 0)::text as "days31To60",
        coalesce(sum(amount) filter (where branch_clock.today - outstanding.created_at::date between 61 and 90), 0)::text as "days61To90",
        coalesce(sum(amount) filter (where branch_clock.today - outstanding.created_at::date > 90), 0)::text as "over90Days",
        branch_clock.today::text as "asOf"
      from outstanding cross join branch_clock group by branch_clock.today
    `;
    return (
      report ?? {
        customerCount: 0,
        total: '0.00',
        current: '0.00',
        days31To60: '0.00',
        days61To90: '0.00',
        over90Days: '0.00',
        asOf: new Date().toISOString().slice(0, 10),
      }
    );
  }

  private async lockCustomer(
    transaction: DatabaseTransaction,
    branchId: string,
    customerId: string,
  ): Promise<LockedCustomer> {
    const [customer] = await transaction<LockedCustomer[]>`
      select id::text, credit_limit::text, is_active from customers
      where id = ${customerId} and branch_id = ${branchId} and deleted_at is null
      for update
    `;
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  private async summaryWith(
    database: QueryableDatabase,
    branchId: string,
    customerId: string,
  ): Promise<CustomerSummary> {
    const [customer] = await database<CustomerSummary[]>`
      select customers.id::text, customers.name, customers.phone, customers.address,
        customers.credit_limit::text as "creditLimit",
        balances.balance::text as balance,
        (customers.credit_limit - balances.balance)::text as "availableCredit",
        customers.is_active as "isActive", customers.created_at as "createdAt"
      from customers
      cross join lateral (
        select coalesce((select balance_after from customer_ledger_entries
          where customer_id = customers.id order by id desc limit 1), 0) as balance
      ) balances
      where customers.id = ${customerId} and customers.branch_id = ${branchId}
        and customers.deleted_at is null
    `;
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
