-- Cash counter modes. The software owner chooses per shop whether staff run cash sessions. With
-- them on, order takers send reserved orders to the cash counter queue and the cashier clears each
-- payment against a day opened with the drawer's starting cash. With them off, the order taker
-- issues the invoice directly and the server keeps one automatic session per counter user per day,
-- so every sale still belongs to a cash session and every day still has a total.

alter table branches
  add column cash_sessions_enabled boolean not null default true,
  add column cash_sessions_changed_at timestamptz,
  add column cash_sessions_changed_by bigint references users(id) on delete restrict;

create index branches_cash_sessions_changed_by_idx on branches (cash_sessions_changed_by);

alter table cash_sessions
  add column auto_managed boolean not null default false;

alter table cash_sessions
  add constraint cash_sessions_auto_managed_no_float
    check (not auto_managed or opening_float = 0);

alter table sale_drafts
  add column cashier_queued_at timestamptz,
  add column cashier_queued_by bigint references users(id) on delete restrict,
  add column customer_id bigint references customers(id) on delete restrict;

alter table sale_drafts
  add constraint sale_drafts_cashier_queue_consistent
    check ((cashier_queued_at is null) = (cashier_queued_by is null));

create index sale_drafts_cashier_queued_by_idx on sale_drafts (cashier_queued_by);
create index sale_drafts_customer_id_idx on sale_drafts (customer_id);
create index sale_drafts_cash_counter_queue_idx on sale_drafts (branch_id, cashier_queued_at, id)
  where cashier_queued_at is not null and status in ('SENT_TO_CASHIER', 'RESERVED', 'EXPIRED');
