-- Phase 7: features per shop, faster stock work, customer requests, several cash counters, and
-- shelf names.
--
-- * Each shop has a plan; a feature follows the plan unless the software owner switches it for
--   that shop. Settings (durations, thresholds) are stored per shop and validated by the API.
-- * Customer requests record medicines a customer asked for that the shop could not supply. They
--   are an append-only demand signal for buying.
-- * A direct receipt is a purchase order created and received in one step from scanned stock.
-- * Orders sent to the cash counter may name the counter that should take the payment, and a
--   cashier claims a bill while taking payment so a second counter does not take it too.
-- * A shelf level may carry a short name staff use ("Antibiotic syrups").

alter table branches
  add column plan_code text not null default 'PRO'
    check (plan_code in ('BASIC', 'STANDARD', 'PRO')),
  add column plan_changed_at timestamptz,
  add column plan_changed_by bigint references users(id) on delete restrict;
create index branches_plan_changed_by_idx on branches (plan_changed_by);

create table shop_features (
  branch_id bigint not null references branches(id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[A-Z][A-Z0-9_]{2,47}$'),
  -- Null follows the plan; true or false is the software owner's decision for this shop.
  enabled boolean,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by_user_id bigint references users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (branch_id, feature_key)
);
create index shop_features_updated_by_idx on shop_features (updated_by_user_id);

create table customer_requests (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  medicine_id bigint references medicines(id) on delete restrict,
  requested_name text not null check (length(trim(requested_name)) between 2 and 120),
  normalized_name text not null check (length(normalized_name) between 2 and 120),
  reason text not null check (reason in ('OUT_OF_STOCK', 'NOT_IN_CATALOG')),
  quantity numeric(12, 3) check (quantity is null or quantity > 0),
  requested_by_user_id bigint not null references users(id) on delete restrict,
  terminal_id bigint references terminals(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((reason = 'NOT_IN_CATALOG') = (medicine_id is null))
);
create index customer_requests_branch_created_idx on customer_requests (branch_id, created_at desc);
create index customer_requests_medicine_idx
  on customer_requests (branch_id, medicine_id, created_at desc) where medicine_id is not null;
create index customer_requests_name_idx
  on customer_requests (branch_id, normalized_name, created_at desc) where medicine_id is null;
create index customer_requests_user_idx on customer_requests (requested_by_user_id);
create index customer_requests_terminal_idx on customer_requests (terminal_id);
create index customer_requests_medicine_fk_idx on customer_requests (medicine_id);
create trigger customer_requests_append_only before update or delete on customer_requests
for each row execute function prevent_append_only_mutation();

alter table purchase_orders
  add column direct_receipt boolean not null default false;

alter table medicine_barcodes
  add column added_by_user_id bigint references users(id) on delete restrict;
create index medicine_barcodes_added_by_idx on medicine_barcodes (added_by_user_id);

alter table sale_drafts
  add column cash_counter_terminal_id bigint references terminals(id) on delete restrict,
  add column payment_claimed_by_terminal_id bigint references terminals(id) on delete restrict,
  add column payment_claimed_at timestamptz;
alter table sale_drafts
  add constraint sale_drafts_payment_claim_consistent
    check ((payment_claimed_by_terminal_id is null) = (payment_claimed_at is null));
create index sale_drafts_cash_counter_terminal_idx on sale_drafts (cash_counter_terminal_id);
create index sale_drafts_payment_claimed_by_idx on sale_drafts (payment_claimed_by_terminal_id);

alter table shelves
  add column label text check (label is null or length(trim(label)) between 1 and 60);
