create table customers (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 160),
  phone text,
  phone_normalized text,
  address text,
  credit_limit numeric(12, 2) not null default 0 check (credit_limit >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (phone is null or length(btrim(phone)) between 5 and 32),
  check (phone_normalized is null or length(phone_normalized) between 5 and 24)
);
create index customers_branch_name_idx on customers (branch_id, lower(name), id)
  where deleted_at is null;
create index customers_branch_phone_idx on customers (branch_id, phone_normalized)
  where phone_normalized is not null and deleted_at is null;
create index customers_name_trgm_idx on customers using gin (name gin_trgm_ops)
  where deleted_at is null;
create trigger customers_updated_at before update on customers
for each row execute function set_updated_at();

alter table sales add column customer_id bigint references customers(id) on delete restrict;
create index sales_customer_created_idx on sales (customer_id, created_at desc)
  where customer_id is not null;

alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT'));

create table customer_ledger_entries (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  customer_id bigint not null references customers(id) on delete restrict,
  entry_type text not null
    check (entry_type in ('OPENING_BALANCE', 'CREDIT_SALE', 'PAYMENT', 'ADJUSTMENT')),
  amount_delta numeric(12, 2) not null check (amount_delta <> 0),
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  sale_id bigint references sales(id) on delete restrict,
  cash_session_id bigint references cash_sessions(id) on delete restrict,
  payment_method text check (payment_method in ('CASH', 'CARD', 'BANK_TRANSFER')),
  reference text,
  client_request_id text,
  performed_by_user_id bigint not null references users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'CREDIT_SALE' and amount_delta > 0 and sale_id is not null
      and payment_method is null)
    or (entry_type = 'OPENING_BALANCE' and amount_delta > 0 and sale_id is null
      and payment_method is null)
    or (entry_type = 'PAYMENT' and amount_delta < 0 and sale_id is null
      and payment_method is not null)
    or (entry_type = 'ADJUSTMENT' and sale_id is null and payment_method is null)
  ),
  check ((payment_method = 'CASH') = (cash_session_id is not null))
);
create index customer_ledger_customer_created_idx
  on customer_ledger_entries (customer_id, created_at desc, id desc);
create index customer_ledger_branch_created_idx
  on customer_ledger_entries (branch_id, created_at desc, id desc);
create index customer_ledger_cash_session_idx
  on customer_ledger_entries (cash_session_id) where cash_session_id is not null;
create index customer_ledger_performed_by_idx
  on customer_ledger_entries (performed_by_user_id);
create unique index customer_ledger_credit_sale_uidx
  on customer_ledger_entries (sale_id) where entry_type = 'CREDIT_SALE';
create unique index customer_ledger_request_uidx
  on customer_ledger_entries (branch_id, customer_id, client_request_id)
  where client_request_id is not null;

create function enforce_customer_ledger_integrity() returns trigger language plpgsql as $$
declare
  v_customer_branch_id bigint;
  v_credit_limit numeric(12, 2);
  v_customer_is_active boolean;
  v_prior_balance numeric(12, 2);
begin
  select branch_id, credit_limit, is_active
    into strict v_customer_branch_id, v_credit_limit, v_customer_is_active
  from customers where id = new.customer_id and deleted_at is null for update;

  if new.branch_id <> v_customer_branch_id then
    raise exception 'customer ledger branch must match its customer branch'
      using errcode = '23514';
  end if;

  select balance_after into v_prior_balance
  from customer_ledger_entries where customer_id = new.customer_id
  order by id desc limit 1;
  v_prior_balance := coalesce(v_prior_balance, 0);

  if new.balance_after <> v_prior_balance + new.amount_delta then
    raise exception 'customer ledger balance_after must equal prior balance plus delta'
      using errcode = '23514';
  end if;
  if new.balance_after > v_credit_limit then
    raise exception 'customer credit limit exceeded' using errcode = '23514';
  end if;
  if new.entry_type = 'CREDIT_SALE' and not v_customer_is_active then
    raise exception 'inactive customer cannot receive credit' using errcode = '23514';
  end if;
  if new.sale_id is not null and not exists (
    select 1 from sales
    where sales.id = new.sale_id and sales.branch_id = new.branch_id
      and sales.customer_id = new.customer_id
  ) then
    raise exception 'credit sale must belong to the same branch and customer'
      using errcode = '23514';
  end if;
  if new.cash_session_id is not null and not exists (
    select 1 from cash_sessions
    where cash_sessions.id = new.cash_session_id and cash_sessions.branch_id = new.branch_id
  ) then
    raise exception 'customer payment cash session must belong to the same branch'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function enforce_customer_credit_limit_update() returns trigger language plpgsql as $$
declare
  v_balance numeric(12, 2);
begin
  if new.credit_limit = old.credit_limit then
    return new;
  end if;
  select balance_after into v_balance from customer_ledger_entries
  where customer_id = new.id order by id desc limit 1;
  if coalesce(v_balance, 0) > new.credit_limit then
    raise exception 'credit limit cannot be lower than the current balance'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function prevent_customer_delete() returns trigger language plpgsql as $$
begin
  raise exception 'customers must be archived, not deleted' using errcode = '23514';
end;
$$;

create trigger customer_ledger_integrity before insert on customer_ledger_entries
for each row execute function enforce_customer_ledger_integrity();
create trigger customer_ledger_append_only before update or delete on customer_ledger_entries
for each row execute function prevent_append_only_mutation();
create trigger customers_credit_limit before update of credit_limit on customers
for each row execute function enforce_customer_credit_limit_update();
create trigger customers_no_delete before delete on customers
for each row execute function prevent_customer_delete();

insert into permissions (code, description) values
  ('customer.read', 'Search customers and view account statements'),
  ('customer.manage', 'Create and update customer accounts and credit limits'),
  ('customer.credit', 'Use customer credit within the configured limit'),
  ('customer.payment', 'Record payments against customer accounts')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_id, permission_id)
select roles.id, permissions.id
from roles cross join permissions
where roles.code in ('OWNER', 'MANAGER')
  and permissions.code in ('customer.read', 'customer.manage', 'customer.credit', 'customer.payment')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select roles.id, permissions.id
from roles cross join permissions
where roles.code in ('CASHIER', 'SUPERVISOR')
  and permissions.code in ('customer.read', 'customer.credit', 'customer.payment')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select roles.id, permissions.id
from roles cross join permissions
where roles.code = 'SALESPERSON' and permissions.code = 'customer.read'
on conflict do nothing;
