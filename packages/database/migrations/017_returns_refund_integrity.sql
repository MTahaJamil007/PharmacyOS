-- Returns and refunds: refunds that go back onto the customer's account (khata), explicit
-- rejection of a return request, and the sale/refund linkage needed to stop outstanding
-- customer credit being converted into cash.

alter table refunds drop constraint refunds_method_check;
alter table refunds
  add constraint refunds_method_check
    check (method in ('CASH', 'CARD', 'BANK_TRANSFER', 'CUSTOMER_ACCOUNT')),
  add column customer_ledger_entry_id bigint
    references customer_ledger_entries(id) on delete restrict,
  add constraint refunds_account_entry_check
    check ((method = 'CUSTOMER_ACCOUNT') = (customer_ledger_entry_id is not null)),
  add constraint refunds_cash_session_check
    check (method <> 'CASH' or cash_session_id is not null);
create unique index refunds_customer_ledger_entry_uidx
  on refunds (customer_ledger_entry_id) where customer_ledger_entry_id is not null;

-- A refund credited to the customer's account reduces what they owe and names the sale.
alter table customer_ledger_entries drop constraint customer_ledger_entries_entry_type_check;
alter table customer_ledger_entries
  add constraint customer_ledger_entries_entry_type_check
    check (entry_type in (
      'OPENING_BALANCE', 'CREDIT_SALE', 'PAYMENT', 'ADJUSTMENT', 'RETURN_CREDIT'
    ));
alter table customer_ledger_entries drop constraint customer_ledger_entries_check;
alter table customer_ledger_entries
  add constraint customer_ledger_entries_shape_check check (
    (entry_type = 'CREDIT_SALE' and amount_delta > 0 and sale_id is not null
      and payment_method is null)
    or (entry_type = 'OPENING_BALANCE' and amount_delta > 0 and sale_id is null
      and payment_method is null)
    or (entry_type = 'PAYMENT' and amount_delta < 0 and sale_id is null
      and payment_method is not null)
    or (entry_type = 'ADJUSTMENT' and sale_id is null and payment_method is null)
    or (entry_type = 'RETURN_CREDIT' and amount_delta < 0 and sale_id is not null
      and payment_method is null)
  );
create index customer_ledger_sale_idx on customer_ledger_entries (sale_id)
  where sale_id is not null;

alter table returns
  add column rejected_by_user_id bigint references users(id) on delete restrict,
  add column rejected_at timestamptz,
  add column rejection_reason text,
  add constraint returns_rejection_check check (
    (status = 'REJECTED') = (rejected_at is not null and rejected_by_user_id is not null)
  );
create index returns_rejected_by_idx on returns (rejected_by_user_id)
  where rejected_by_user_id is not null;

-- Refunds are financial evidence; once written they are corrected by a new record only.
create trigger refunds_append_only before update or delete on refunds
for each row execute function prevent_append_only_mutation();
create trigger return_items_append_only before update or delete on return_items
for each row execute function prevent_append_only_mutation();
create trigger payments_append_only before update or delete on payments
for each row execute function prevent_append_only_mutation();
