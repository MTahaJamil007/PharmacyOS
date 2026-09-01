import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { verify } from 'argon2';
import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  multiplyMoneyByQuantity,
  PERMISSIONS,
  scaledIntegerToDecimal,
  sumMoney,
  type ApplySaleDiscountRequest,
  type CreateDraftRequest,
  type FinalizeSaleRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { lockIdempotencyKey } from '../common/idempotency.js';
import { DATABASE, ENVIRONMENT } from '../database.module.js';

interface DraftRow {
  readonly id: string;
  readonly branch_id: string;
  readonly terminal_id: string;
  readonly status: string;
  readonly subtotal: string;
  readonly discount_total: string;
  readonly total: string;
  readonly reserved_until: Date | null;
  readonly discount_approval_id: string | null;
}

interface DraftItemRow {
  readonly id: string;
  readonly medicine_id: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly discount_amount: string;
  readonly line_total: string;
}

interface BatchRow {
  readonly batch_id: string;
  readonly medicine_id: string;
  readonly expiry_date: string;
  readonly received_at: Date;
  readonly cost_price: string;
  readonly sale_price: string;
  readonly current_qty: string;
}

interface ReservedLineRow {
  readonly reservation_id: string;
  readonly draft_item_id: string;
  readonly inventory_batch_id: string;
  readonly medicine_id: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly discount_amount: string;
  readonly cost_price: string;
  readonly reservation_status: string;
  readonly expires_at: Date;
}

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=1,t=3$Qmtqvlr9uuf0LHmWB9gtWQ$bqjEBg5g/m9jpoCKjF9k6ylMJbHj2GZxzLiSk8jQy3Q';

function allocateDiscountedLines(lines: readonly ReservedLineRow[]) {
  const groups = new Map<string, ReservedLineRow[]>();
  for (const line of lines) {
    const group = groups.get(line.draft_item_id) ?? [];
    group.push(line);
    groups.set(line.draft_item_id, group);
  }

  return [...groups.values()].flatMap((group) => {
    const totalDiscount = moneyToMinorUnits(group[0]?.discount_amount ?? '0');
    const rawAmounts = group.map((line) =>
      moneyToMinorUnits(multiplyMoneyByQuantity(line.unit_price, line.quantity)),
    );
    const totalRaw = rawAmounts.reduce((total, amount) => total + amount, 0n);
    if (totalDiscount > totalRaw) throw new ConflictException('Line discount exceeds line value');

    let allocated = 0n;
    return group.map((line, index) => {
      const rawAmount = rawAmounts[index] ?? 0n;
      const isLast = index === group.length - 1;
      const discount = isLast
        ? totalDiscount - allocated
        : totalRaw === 0n
          ? 0n
          : (totalDiscount * rawAmount) / totalRaw;
      allocated += discount;
      return {
        ...line,
        discountAmount: minorUnitsToMoney(discount),
        lineTotal: minorUnitsToMoney(rawAmount - discount),
      };
    });
  });
}

@Injectable()
export class PosService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async findSales(user: AuthenticatedUser, query: string): Promise<Record<string, unknown>> {
    const match = `%${query}%`;
    const data = await this.database<Array<Record<string, unknown>>>`
      select sales.id::text, sales.invoice_number, sales.total::text, sales.created_at,
        users.display_name as cashier_name
      from sales
      join users on users.id = sales.cashier_user_id
      where sales.branch_id = ${user.branchId}
        and (${query} = '' or sales.invoice_number ilike ${match})
      order by sales.created_at desc, sales.id desc
      limit 20
    `;
    return { data };
  }

  async reprintReceipt(user: AuthenticatedUser, saleId: bigint): Promise<Record<string, unknown>> {
    const saleIdText = saleId.toString();
    await this.database.begin(async (transaction) => {
      const [sale] = await transaction<Array<{ id: string }>>`
        select id::text from sales
        where id = ${saleIdText} and branch_id = ${user.branchId}
      `;
      if (!sale) throw new NotFoundException('Sale receipt not found');
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId},
          'RECEIPT.REPRINTED', 'sale', ${sale.id},
          ${transaction.json({ source: 'POS_RECEIPT_SEARCH' })}
        )
      `;
    });
    return this.getReceipt(user, saleId);
  }

  async getReceipt(user: AuthenticatedUser, saleId: bigint): Promise<Record<string, unknown>> {
    const [sale] = await this.database<Array<Record<string, unknown>>>`
      select sales.id::text, sales.invoice_number, sales.subtotal::text,
        sales.discount_total::text, sales.tax_total::text, sales.total::text,
        sales.created_at, branches.name as branch_name, branches.address as branch_address,
        branches.phone as branch_phone, users.display_name as cashier_name,
        customers.id::text as customer_id, customers.name as customer_name,
        customers.phone as customer_phone,
        return_lookup_tokens.token::text as return_lookup_token,
        fbr_invoices.status as fiscal_status,
        fbr_invoices.fiscal_invoice_number,
        fbr_invoices.qr_payload as fiscal_qr_payload
      from sales
      join branches on branches.id = sales.branch_id
      join users on users.id = sales.cashier_user_id
      left join customers on customers.id = sales.customer_id
      join return_lookup_tokens on return_lookup_tokens.sale_id = sales.id
        and return_lookup_tokens.revoked_at is null
      join fbr_invoices on fbr_invoices.sale_id = sales.id
      where sales.id = ${saleId.toString()} and sales.branch_id = ${user.branchId}
    `;
    if (!sale) throw new NotFoundException('Sale receipt not found');
    const items = await this.database<Array<Record<string, unknown>>>`
      select sale_items.id::text, medicines.name, medicines.strength,
        inventory_batches.batch_number, inventory_batches.expiry_date,
        sale_items.quantity::text, sale_items.unit_price::text,
        sale_items.discount_amount::text, sale_items.line_total::text
      from sale_items
      join medicines on medicines.id = sale_items.medicine_id
      join inventory_batches on inventory_batches.id = sale_items.inventory_batch_id
      where sale_items.sale_id = ${saleId.toString()} order by sale_items.id
    `;
    const payments = await this.database<Array<Record<string, unknown>>>`
      select method, amount::text, tendered_amount::text, change_amount::text, reference from payments
      where sale_id = ${saleId.toString()} and status = 'CAPTURED' order by id
    `;
    return {
      sale,
      items,
      payments,
      returnQrPayload: String(sale.return_lookup_token),
      qrDataClassification: 'OPAQUE_RETURN_TOKEN_ONLY',
    };
  }

  async createDraft(
    user: AuthenticatedUser,
    input: CreateDraftRequest,
  ): Promise<Record<string, unknown>> {
    if (input.terminalId.toString() !== user.terminalId) {
      throw new ConflictException('Draft terminal must match the authenticated terminal');
    }

    const normalizedItems = new Map<string, bigint>();
    for (const item of input.items) {
      const medicineId = item.medicineId.toString();
      const quantity = decimalToScaledInteger(item.quantity, 3);
      normalizedItems.set(medicineId, (normalizedItems.get(medicineId) ?? 0n) + quantity);
    }

    return this.database.begin(async (transaction) => {
      const medicineIds = [...normalizedItems.keys()];
      const pricedMedicines = await transaction<
        Array<{ medicine_id: string; sale_price: string | null }>
      >`
        select medicines.id::text as medicine_id, prices.sale_price::text
        from medicines
        left join lateral (
          select inventory_batches.sale_price
          from inventory_batches
          where inventory_batches.branch_id = ${user.branchId}
            and inventory_batches.medicine_id = medicines.id
            and inventory_batches.status = 'SELLABLE'
            and inventory_batches.deleted_at is null
            and inventory_batches.current_qty > 0
            and inventory_batches.expiry_date >= (now() at time zone (
              select timezone from branches where id = ${user.branchId}
            ))::date
          order by inventory_batches.expiry_date, inventory_batches.received_at, inventory_batches.id
          limit 1
        ) prices on true
        where medicines.id in ${transaction(medicineIds)}
          and medicines.is_active = true and medicines.deleted_at is null
        order by medicines.id
      `;
      if (
        pricedMedicines.length !== medicineIds.length ||
        pricedMedicines.some((row) => row.sale_price === null)
      ) {
        throw new ConflictException('One or more medicines are unavailable for sale');
      }

      const lines = pricedMedicines.map((row) => {
        const quantity = scaledIntegerToDecimal(normalizedItems.get(row.medicine_id) ?? 0n, 3);
        const unitPrice = row.sale_price;
        if (unitPrice === null) throw new ConflictException('Medicine has no active sale price');
        return {
          medicineId: row.medicine_id,
          quantity,
          unitPrice,
          lineTotal: multiplyMoneyByQuantity(unitPrice, quantity),
        };
      });
      const subtotal = sumMoney(lines.map((line) => line.lineTotal));
      const [draft] = await transaction<Array<{ id: string }>>`
        insert into sale_drafts (
          branch_id, terminal_id, salesperson_user_id, status,
          subtotal, discount_total, total
        ) values (
          ${user.branchId}, ${user.terminalId}, ${user.id}, 'DRAFT',
          ${subtotal}, 0, ${subtotal}
        )
        returning id::text
      `;
      if (!draft) throw new Error('Draft creation did not return an identifier');

      for (const line of lines) {
        await transaction`
          insert into sale_draft_items (
            sale_draft_id, medicine_id, quantity, unit_price, discount_amount, line_total
          ) values (
            ${draft.id}, ${line.medicineId}, ${line.quantity}, ${line.unitPrice}, 0, ${line.lineTotal}
          )
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId},
          'POS.DRAFT_CREATED', 'sale_draft', ${draft.id}
        )
      `;

      return { id: draft.id, status: 'DRAFT', subtotal, total: subtotal, itemCount: lines.length };
    });
  }

  async applyDiscount(
    user: AuthenticatedUser,
    draftId: bigint,
    input: ApplySaleDiscountRequest,
  ): Promise<Record<string, unknown>> {
    const authenticatedApprover =
      input.approverUsername && input.approverPassword
        ? await this.authenticateDiscountApprover(input.approverUsername, input.approverPassword)
        : null;

    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'POS.APPLY_DISCOUNT',
        user.branchId,
        input.clientRequestId,
      );
      const [replay] = await transaction<Array<{ id: string; sale_draft_id: string }>>`
        select id::text, sale_draft_id::text from discount_approvals
        where branch_id = ${user.branchId} and client_request_id = ${input.clientRequestId}
      `;
      if (replay) {
        const [draft] = await transaction<
          Array<{ subtotal: string; discount_total: string; total: string }>
        >`
          select subtotal::text, discount_total::text, total::text
          from sale_drafts where id = ${replay.sale_draft_id}
        `;
        return { approvalId: replay.id, ...draft, idempotentReplay: true };
      }

      const [draft] = await transaction<DraftRow[]>`
        select id::text, branch_id::text, terminal_id::text, status,
          subtotal::text, discount_total::text, total::text, reserved_until,
          discount_approval_id::text
        from sale_drafts where id = ${draftId.toString()} for update
      `;
      if (!draft || draft.branch_id !== user.branchId)
        throw new NotFoundException('Draft not found');
      if (!['DRAFT', 'SENT_TO_CASHIER', 'RESERVED', 'EXPIRED'].includes(draft.status)) {
        throw new ConflictException(`Discount cannot be applied to a ${draft.status} draft`);
      }
      const items = await transaction<DraftItemRow[]>`
        select id::text, medicine_id::text, quantity::text, unit_price::text,
          discount_amount::text, line_total::text
        from sale_draft_items where sale_draft_id = ${draft.id}
        order by medicine_id, id for update
      `;
      if (items.length === 0) throw new ConflictException('Draft has no items');

      const requested = new Map(
        input.lineDiscounts.map((line) => [line.medicineId.toString(), line.amount]),
      );
      if ([...requested.keys()].some((id) => !items.some((item) => item.medicine_id === id))) {
        throw new ConflictException('Discount references a medicine outside this draft');
      }
      const grossAmounts = items.map((item) =>
        multiplyMoneyByQuantity(item.unit_price, item.quantity),
      );
      const grossAmount = sumMoney(grossAmounts);
      const lineDiscounts = items.map((item, index) => {
        const amount = requested.get(item.medicine_id) ?? '0';
        if (moneyToMinorUnits(amount) > moneyToMinorUnits(grossAmounts[index] ?? '0')) {
          throw new ConflictException('Line discount exceeds line value');
        }
        return amount;
      });
      const discountedSubtotal = minorUnitsToMoney(
        moneyToMinorUnits(grossAmount) -
          lineDiscounts.reduce((total, amount) => total + moneyToMinorUnits(amount), 0n),
      );
      if (moneyToMinorUnits(input.invoiceDiscount) > moneyToMinorUnits(discountedSubtotal)) {
        throw new ConflictException('Invoice discount exceeds discounted subtotal');
      }
      const totalDiscount = sumMoney([...lineDiscounts, input.invoiceDiscount]);
      const grossMinor = moneyToMinorUnits(grossAmount);
      const discountMinor = moneyToMinorUnits(totalDiscount);
      if (discountMinor >= grossMinor) {
        throw new ConflictException('Discount must leave a positive sale total');
      }
      const percentHundredths = (discountMinor * 10_000n + grossMinor / 2n) / grossMinor;
      const discountPercent = scaledIntegerToDecimal(percentHundredths, 2);
      const [policy] = await transaction<Array<{ limit_percent: string }>>`
        select basic_discount_limit_percent::text as limit_percent
        from operational_intelligence_policies where branch_id = ${user.branchId}
      `;
      const limit = decimalToScaledInteger(policy?.limit_percent ?? '5', 2);
      const needsOverride = percentHundredths > limit;
      let approverId = user.id;
      if (needsOverride && !user.permissions.includes(PERMISSIONS.SALE_DISCOUNT_OVERRIDE)) {
        if (!authenticatedApprover)
          throw new ForbiddenException('Supervisor approval is required for this discount');
        const [authorized] = await transaction<Array<{ id: string }>>`
          select users.id::text from users
          where users.id = ${authenticatedApprover} and users.is_active
            and users.deleted_at is null and (users.locked_until is null or users.locked_until <= now())
            and exists (
              select 1 from user_branch_roles
              join role_permissions on role_permissions.role_id = user_branch_roles.role_id
              join permissions on permissions.id = role_permissions.permission_id
              where user_branch_roles.user_id = users.id
                and user_branch_roles.branch_id = ${user.branchId}
                and permissions.code = ${PERMISSIONS.SALE_DISCOUNT_OVERRIDE}
            )
        `;
        if (!authorized) throw new ForbiddenException('Supervisor approval is not valid');
        approverId = authorized.id;
      }

      for (const [index, item] of items.entries()) {
        const discount = lineDiscounts[index] ?? '0';
        const lineTotal = minorUnitsToMoney(
          moneyToMinorUnits(grossAmounts[index] ?? '0') - moneyToMinorUnits(discount),
        );
        await transaction`
          update sale_draft_items set discount_amount = ${discount}, line_total = ${lineTotal}
          where id = ${item.id}
        `;
      }
      const [approval] = await transaction<Array<{ id: string }>>`
        insert into discount_approvals (
          branch_id, sale_draft_id, requested_by_user_id, approved_by_user_id,
          approval_level, gross_amount, discount_amount, discount_percent,
          reason, client_request_id
        ) values (
          ${user.branchId}, ${draft.id}, ${user.id}, ${approverId},
          ${needsOverride ? 'OVERRIDE' : 'BASIC'}, ${grossAmount}, ${totalDiscount},
          ${discountPercent}, ${input.reason}, ${input.clientRequestId}
        ) returning id::text
      `;
      if (!approval) throw new Error('Discount approval did not return an identifier');
      const total = minorUnitsToMoney(
        moneyToMinorUnits(discountedSubtotal) - moneyToMinorUnits(input.invoiceDiscount),
      );
      await transaction`
        update stock_reservations set status = 'RELEASED', released_at = now()
        where sale_draft_item_id in (
          select id from sale_draft_items where sale_draft_id = ${draft.id}
        ) and status = 'ACTIVE'
      `;
      await transaction`
        update sale_drafts set status = 'DRAFT', subtotal = ${discountedSubtotal},
          discount_total = ${input.invoiceDiscount}, total = ${total},
          discount_approval_id = ${approval.id}, reserved_until = null
        where id = ${draft.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId}, 'SALE.DISCOUNT_APPROVED',
          'discount_approval', ${approval.id}, ${input.clientRequestId},
          ${transaction.json({ draftId: draft.id, approverId, approvalLevel: needsOverride ? 'OVERRIDE' : 'BASIC', grossAmount, totalDiscount, discountPercent, reason: input.reason })}
        )
      `;
      return {
        approvalId: approval.id,
        approvalLevel: needsOverride ? 'OVERRIDE' : 'BASIC',
        subtotal: discountedSubtotal,
        invoiceDiscount: input.invoiceDiscount,
        total,
        idempotentReplay: false,
      };
    });
  }

  async reserveDraft(user: AuthenticatedUser, draftId: bigint): Promise<Record<string, unknown>> {
    const draftIdText = draftId.toString();
    return this.database.begin(async (transaction) => {
      const [draft] = await transaction<DraftRow[]>`
        select id::text, branch_id::text, terminal_id::text, status,
          subtotal::text, discount_total::text, total::text, reserved_until,
          discount_approval_id::text
        from sale_drafts where id = ${draftIdText} for update
      `;
      if (!draft || draft.branch_id !== user.branchId)
        throw new NotFoundException('Draft not found');
      if (!['DRAFT', 'SENT_TO_CASHIER', 'RESERVED', 'EXPIRED'].includes(draft.status)) {
        throw new ConflictException(`Draft cannot be reserved from ${draft.status}`);
      }

      await transaction`
        update stock_reservations set status = 'RELEASED', released_at = now()
        where sale_draft_item_id in (select id from sale_draft_items where sale_draft_id = ${draft.id})
          and status = 'ACTIVE'
      `;
      const items = await transaction<DraftItemRow[]>`
        select id::text, medicine_id::text, quantity::text, unit_price::text,
          discount_amount::text, line_total::text
        from sale_draft_items where sale_draft_id = ${draft.id} order by medicine_id, id
      `;
      if (items.length === 0) throw new ConflictException('Draft has no items');

      const expiresAt = new Date(Date.now() + this.environment.RESERVATION_TTL_MINUTES * 60_000);
      let reservationCount = 0;
      for (const item of items) {
        const lockedBatches = await transaction<BatchRow[]>`
          select inventory_batches.id::text as batch_id,
            inventory_batches.medicine_id::text as medicine_id,
            inventory_batches.expiry_date::text,
            inventory_batches.received_at,
            inventory_batches.cost_price::text,
            inventory_batches.sale_price::text,
            inventory_batches.current_qty::text
          from inventory_batches
          where inventory_batches.branch_id = ${user.branchId}
            and inventory_batches.medicine_id = ${item.medicine_id}
            and inventory_batches.status = 'SELLABLE'
            and inventory_batches.deleted_at is null
            and inventory_batches.current_qty > 0
            and inventory_batches.expiry_date >= (now() at time zone (
              select timezone from branches where id = ${user.branchId}
            ))::date
          order by inventory_batches.id
          for update of inventory_batches
        `;
        const batchIds = lockedBatches.map((batch) => batch.batch_id);
        const activeReservations =
          batchIds.length === 0
            ? []
            : await transaction<Array<{ inventory_batch_id: string; reserved_qty: string }>>`
                select inventory_batch_id::text,
                  coalesce(sum(quantity), 0)::text as reserved_qty
                from stock_reservations
                where inventory_batch_id in ${transaction(batchIds)}
                  and status = 'ACTIVE' and expires_at > now()
                group by inventory_batch_id
              `;
        const reservedByBatch = new Map(
          activeReservations.map((reservation) => [
            reservation.inventory_batch_id,
            decimalToScaledInteger(reservation.reserved_qty, 3),
          ]),
        );
        lockedBatches.sort((left, right) => {
          const dateOrder = left.expiry_date.localeCompare(right.expiry_date);
          if (dateOrder !== 0) return dateOrder;
          const receivedOrder = left.received_at.getTime() - right.received_at.getTime();
          if (receivedOrder !== 0) return receivedOrder;
          const leftId = BigInt(left.batch_id);
          const rightId = BigInt(right.batch_id);
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });

        let required = decimalToScaledInteger(item.quantity, 3);
        for (const batch of lockedBatches) {
          if (required === 0n) break;
          const available =
            decimalToScaledInteger(batch.current_qty, 3) -
            (reservedByBatch.get(batch.batch_id) ?? 0n);
          if (available <= 0n) continue;
          const allocated = available < required ? available : required;
          const quantity = scaledIntegerToDecimal(allocated, 3);
          await transaction`
            insert into stock_reservations (
              sale_draft_item_id, inventory_batch_id, quantity, status, expires_at
            ) values (${item.id}, ${batch.batch_id}, ${quantity}, 'ACTIVE', ${expiresAt})
          `;
          reservationCount += 1;
          required -= allocated;
        }
        if (required > 0n) {
          throw new ConflictException({
            message: 'Insufficient stock for reservation',
            medicineId: item.medicine_id,
            shortage: scaledIntegerToDecimal(required, 3),
          });
        }
      }

      const reservedLines = await transaction<ReservedLineRow[]>`
        select stock_reservations.id::text as reservation_id,
          sale_draft_items.id::text as draft_item_id,
          inventory_batches.id::text as inventory_batch_id,
          sale_draft_items.medicine_id::text as medicine_id,
          stock_reservations.quantity::text,
          sale_draft_items.unit_price::text,
          sale_draft_items.discount_amount::text,
          inventory_batches.cost_price::text,
          stock_reservations.status as reservation_status,
          stock_reservations.expires_at
        from stock_reservations
        join sale_draft_items on sale_draft_items.id = stock_reservations.sale_draft_item_id
        join inventory_batches on inventory_batches.id = stock_reservations.inventory_batch_id
        where sale_draft_items.sale_draft_id = ${draft.id}
          and stock_reservations.status = 'ACTIVE'
        order by inventory_batches.id, stock_reservations.id
      `;
      const reservedSubtotal = sumMoney(
        allocateDiscountedLines(reservedLines).map((line) => line.lineTotal),
      );
      const reservedTotalMinor =
        moneyToMinorUnits(reservedSubtotal) - moneyToMinorUnits(draft.discount_total);
      if (reservedTotalMinor < 0n) {
        throw new ConflictException('Sale discount cannot exceed the reserved subtotal');
      }
      const reservedTotal = minorUnitsToMoney(reservedTotalMinor);

      await transaction`
        update sale_drafts
        set status = 'RESERVED', sent_at = coalesce(sent_at, now()), reserved_until = ${expiresAt},
          subtotal = ${reservedSubtotal}, total = ${reservedTotal}
        where id = ${draft.id}
      `;
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId},
          'POS.DRAFT_RESERVED', 'sale_draft', ${draft.id},
          ${transaction.json({ reservationCount, expiresAt: expiresAt.toISOString() })}
        )
      `;
      return {
        id: draft.id,
        status: 'RESERVED',
        reservationCount,
        reservedUntil: expiresAt.toISOString(),
        subtotal: reservedSubtotal,
        total: reservedTotal,
      };
    });
  }

  async finalizeSale(
    user: AuthenticatedUser,
    input: FinalizeSaleRequest,
  ): Promise<Record<string, unknown>> {
    const cashSessionId = input.cashSessionId.toString();
    const draftId = input.draftId.toString();
    const creditAmount = sumMoney(
      input.payments
        .filter((payment) => payment.method === 'CREDIT')
        .map((payment) => payment.amount),
    );
    if (
      moneyToMinorUnits(creditAmount) > 0n &&
      !user.permissions.includes(PERMISSIONS.CUSTOMER_CREDIT)
    ) {
      throw new ForbiddenException('Customer credit permission is required');
    }
    return this.database.begin(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        'POS.FINALIZE_SALE',
        user.branchId,
        input.clientRequestId,
      );
      const [existingSale] = await transaction<
        Array<{
          id: string;
          invoice_number: string;
          total: string;
          return_lookup_token: string | null;
        }>
      >`
        select sales.id::text, sales.invoice_number, sales.total::text,
          return_lookup_tokens.token::text as return_lookup_token
        from sales
        left join return_lookup_tokens on return_lookup_tokens.sale_id = sales.id
        where sales.terminal_id = ${user.terminalId}
          and sales.cash_session_id = ${cashSessionId}
          and sales.client_request_id = ${input.clientRequestId}
      `;
      if (existingSale) {
        return {
          id: existingSale.id,
          invoiceNumber: existingSale.invoice_number,
          total: existingSale.total,
          returnLookupToken: existingSale.return_lookup_token,
          idempotentReplay: true,
        };
      }

      const [cashSession] = await transaction<Array<{ id: string }>>`
        select id::text from cash_sessions
        where id = ${cashSessionId}
          and branch_id = ${user.branchId}
          and terminal_id = ${user.terminalId}
          and cashier_user_id = ${user.id}
          and status = 'OPEN'
        for update
      `;
      if (!cashSession) throw new ConflictException('An open cash session is required');

      const [draft] = await transaction<DraftRow[]>`
        select id::text, branch_id::text, terminal_id::text, status,
          subtotal::text, discount_total::text, total::text, reserved_until,
          discount_approval_id::text
        from sale_drafts where id = ${draftId} for update
      `;
      if (!draft || draft.branch_id !== user.branchId)
        throw new NotFoundException('Draft not found');
      if (
        draft.status !== 'RESERVED' ||
        !draft.reserved_until ||
        draft.reserved_until <= new Date()
      ) {
        throw new ConflictException('Draft reservation is missing or expired');
      }

      let customerBalanceAfter: string | null = null;
      const customerId = input.customerId?.toString() ?? null;
      if (customerId) {
        const [customer] = await transaction<
          Array<{ id: string; credit_limit: string; is_active: boolean }>
        >`
          select id::text, credit_limit::text, is_active from customers
          where id = ${customerId} and branch_id = ${user.branchId} and deleted_at is null
          for update
        `;
        if (!customer) throw new NotFoundException('Customer not found');
        if (!customer.is_active) throw new ConflictException('Customer account is inactive');
        const [latest] = await transaction<Array<{ balance: string }>>`
          select coalesce((select balance_after from customer_ledger_entries
            where customer_id = ${customer.id} order by id desc limit 1), 0)::text as balance
        `;
        const nextBalance =
          moneyToMinorUnits(latest?.balance ?? '0') + moneyToMinorUnits(creditAmount);
        if (nextBalance > moneyToMinorUnits(customer.credit_limit)) {
          throw new ConflictException({
            message: 'Customer credit limit exceeded',
            balance: latest?.balance ?? '0.00',
            creditLimit: customer.credit_limit,
          });
        }
        customerBalanceAfter = minorUnitsToMoney(nextBalance);
      } else if (moneyToMinorUnits(creditAmount) > 0n) {
        throw new ConflictException('A customer is required for credit payment');
      }

      const reservedLines = await transaction<ReservedLineRow[]>`
        select stock_reservations.id::text as reservation_id,
          sale_draft_items.id::text as draft_item_id,
          inventory_batches.id::text as inventory_batch_id,
          sale_draft_items.medicine_id::text as medicine_id,
          stock_reservations.quantity::text,
          sale_draft_items.unit_price::text,
          sale_draft_items.discount_amount::text,
          inventory_batches.cost_price::text,
          stock_reservations.status as reservation_status,
          stock_reservations.expires_at
        from stock_reservations
        join sale_draft_items on sale_draft_items.id = stock_reservations.sale_draft_item_id
        join inventory_batches on inventory_batches.id = stock_reservations.inventory_batch_id
        where sale_draft_items.sale_draft_id = ${draft.id}
          and stock_reservations.status = 'ACTIVE'
        order by inventory_batches.id, stock_reservations.id
        for update of inventory_batches, stock_reservations
      `;
      if (
        reservedLines.length === 0 ||
        reservedLines.some((line) => line.expires_at <= new Date())
      ) {
        throw new ConflictException('Active stock reservations are required');
      }

      const expectedByItem = await transaction<Array<{ id: string; quantity: string }>>`
        select id::text, quantity::text from sale_draft_items where sale_draft_id = ${draft.id}
      `;
      for (const expected of expectedByItem) {
        const reserved = reservedLines
          .filter((line) => line.draft_item_id === expected.id)
          .reduce((total, line) => total + decimalToScaledInteger(line.quantity, 3), 0n);
        if (reserved !== decimalToScaledInteger(expected.quantity, 3)) {
          throw new ConflictException('Reserved quantity no longer matches the draft');
        }
      }

      const finalizedLines = allocateDiscountedLines(reservedLines);
      const finalizedSubtotal = sumMoney(finalizedLines.map((line) => line.lineTotal));
      const finalizedTotalMinor =
        moneyToMinorUnits(finalizedSubtotal) - moneyToMinorUnits(draft.discount_total);
      if (finalizedTotalMinor < 0n) {
        throw new ConflictException('Sale discount cannot exceed the finalized subtotal');
      }
      const finalizedTotal = minorUnitsToMoney(finalizedTotalMinor);
      const paymentTotal = sumMoney(input.payments.map((payment) => payment.amount));
      if (moneyToMinorUnits(paymentTotal) !== finalizedTotalMinor) {
        throw new ConflictException({
          message: 'Payment total must equal sale total',
          expected: finalizedTotal,
        });
      }

      const [invoice] = await transaction<Array<{ invoice_number: string }>>`
        select next_invoice_number(${user.branchId}) as invoice_number
      `;
      if (!invoice) throw new Error('Invoice number generation failed');
      const [sale] = await transaction<Array<{ id: string }>>`
        insert into sales (
          branch_id, terminal_id, cashier_user_id, cash_session_id, sale_draft_id,
          customer_id, invoice_number, client_request_id, status,
          subtotal, discount_total, tax_total, total, discount_approval_id
        ) values (
          ${user.branchId}, ${user.terminalId}, ${user.id}, ${cashSessionId}, ${draft.id},
          ${customerId}, ${invoice.invoice_number}, ${input.clientRequestId}, 'PAID',
          ${finalizedSubtotal}, ${draft.discount_total}, 0, ${finalizedTotal},
          ${draft.discount_approval_id}
        )
        returning id::text
      `;
      if (!sale) throw new Error('Sale creation did not return an identifier');
      const [returnLookup] = await transaction<Array<{ token: string }>>`
        insert into return_lookup_tokens (sale_id) values (${sale.id})
        returning token::text
      `;
      if (!returnLookup) throw new Error('Receipt return lookup token creation failed');

      for (const line of finalizedLines) {
        const [saleItem] = await transaction<Array<{ id: string }>>`
          insert into sale_items (
            sale_id, medicine_id, inventory_batch_id, quantity,
            unit_price, unit_cost, discount_amount, tax_amount, line_total
          ) values (
            ${sale.id}, ${line.medicine_id}, ${line.inventory_batch_id}, ${line.quantity},
            ${line.unit_price}, ${line.cost_price}, ${line.discountAmount}, 0, ${line.lineTotal}
          )
          returning id::text
        `;
        if (!saleItem) throw new Error('Sale item creation failed');
        const [batch] = await transaction<Array<{ quantity_after: string }>>`
          update inventory_batches
          set current_qty = current_qty - ${line.quantity}::numeric,
              status = case
                when current_qty - ${line.quantity}::numeric = 0 then 'DEPLETED'
                else status
              end
          where id = ${line.inventory_batch_id} and current_qty >= ${line.quantity}::numeric
          returning current_qty::text as quantity_after
        `;
        if (!batch) throw new ConflictException('Stock changed before sale finalization');
        await transaction`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta,
            quantity_after, sale_item_id, performed_by_user_id
          ) values (
            ${user.branchId}, ${line.inventory_batch_id}, 'SALE', -${line.quantity}::numeric,
            ${batch.quantity_after}, ${saleItem.id}, ${user.id}
          )
        `;
      }

      for (const payment of input.payments) {
        const tenderedAmount =
          payment.method === 'CASH' ? (payment.tenderedAmount ?? payment.amount) : null;
        const changeAmount =
          tenderedAmount === null
            ? null
            : minorUnitsToMoney(
                moneyToMinorUnits(tenderedAmount) - moneyToMinorUnits(payment.amount),
              );
        await transaction`
          insert into payments (
            sale_id, cash_session_id, method, amount, tendered_amount, change_amount, reference
          ) values (
            ${sale.id}, ${cashSessionId}, ${payment.method}, ${payment.amount},
            ${tenderedAmount}, ${changeAmount}, ${payment.reference ?? null}
          )
        `;
      }
      if (customerId && moneyToMinorUnits(creditAmount) > 0n && customerBalanceAfter) {
        await transaction`
          insert into customer_ledger_entries (
            branch_id, customer_id, entry_type, amount_delta, balance_after,
            sale_id, performed_by_user_id, reason
          ) values (
            ${user.branchId}, ${customerId}, 'CREDIT_SALE', ${creditAmount},
            ${customerBalanceAfter}, ${sale.id}, ${user.id}, 'Credit sale'
          )
        `;
      }
      await transaction`
        update stock_reservations set status = 'CONSUMED', consumed_at = now()
        where id in ${transaction(reservedLines.map((line) => line.reservation_id))}
      `;
      await transaction`
        update sale_drafts set status = 'PAID', subtotal = ${finalizedSubtotal},
          total = ${finalizedTotal}
        where id = ${draft.id}
      `;

      const fiscalStatus = this.environment.FBR_MODE === 'DISABLED' ? 'NOT_REQUIRED' : 'PENDING';
      const [fbrInvoice] = await transaction<Array<{ id: string }>>`
        insert into fbr_invoices (sale_id, mode, status, payload)
        values (
          ${sale.id}, ${this.environment.FBR_MODE}, ${fiscalStatus},
          ${transaction.json({ saleId: sale.id, invoiceNumber: invoice.invoice_number, total: finalizedTotal, currency: 'PKR' })}
        )
        returning id::text
      `;
      if (!fbrInvoice) throw new Error('Fiscal record creation failed');
      if (fiscalStatus === 'PENDING') {
        await transaction`
          insert into outbox_jobs (job_type, deduplication_key, payload)
          values (
            'FBR_SUBMIT', ${`sale:${sale.id}`},
            ${transaction.json({ fbrInvoiceId: fbrInvoice.id, saleId: sale.id })}
          )
          on conflict (job_type, deduplication_key) where deduplication_key is not null do nothing
        `;
      }
      await transaction`
        insert into audit_events (
          branch_id, user_id, terminal_id, event_type, entity_type, entity_id,
          request_id, metadata
        ) values (
          ${user.branchId}, ${user.id}, ${user.terminalId},
          'SALE.FINALIZED', 'sale', ${sale.id}, ${input.clientRequestId},
          ${transaction.json({ invoiceNumber: invoice.invoice_number, total: finalizedTotal, paymentTotal, customerId, creditAmount })}
        )
      `;

      return {
        id: sale.id,
        invoiceNumber: invoice.invoice_number,
        total: finalizedTotal,
        fiscalStatus,
        returnLookupToken: returnLookup.token,
        returnLookupPath: `/returns/${returnLookup.token}`,
        customerId,
        customerBalance: customerBalanceAfter,
        idempotentReplay: false,
      };
    });
  }

  private async authenticateDiscountApprover(username: string, password: string) {
    const [account] = await this.database<Array<{ id: string; password_hash: string }>>`
      select id::text, password_hash from users
      where lower(username) = lower(${username}) limit 1
    `;
    const valid = await verify(account?.password_hash ?? DUMMY_PASSWORD_HASH, password);
    if (!account || !valid) throw new ForbiddenException('Supervisor approval is not valid');
    return account.id;
  }
}
