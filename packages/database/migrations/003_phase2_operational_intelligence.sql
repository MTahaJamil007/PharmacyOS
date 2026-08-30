-- Phase 2: deterministic operational intelligence and controlled owner assistance.
-- Forward-fix policy: this migration only adds compatible columns/tables and deliberately
-- retains regulated transaction history. Applied migrations must never be edited.

alter table medicines
  add column storage_class text not null default 'AMBIENT'
    check (storage_class in ('AMBIENT', 'COLD', 'FROZEN', 'OTHER')),
  add column requires_secured_storage boolean not null default false;

alter table shelves
  add column pick_priority integer not null default 100 check (pick_priority between 1 and 10000),
  add column storage_class text not null default 'AMBIENT'
    check (storage_class in ('AMBIENT', 'COLD', 'FROZEN', 'OTHER')),
  add column is_secured boolean not null default false,
  add column is_pick_location boolean not null default true;

alter table medicine_shelf_locations
  add column location_type text not null default 'PRIMARY_PICK'
    check (location_type in ('PRIMARY_PICK', 'SECONDARY_PICK', 'RESERVE'));

create index shelves_eligible_pick_idx
  on shelves (branch_id, storage_class, is_secured, pick_priority, id)
  where is_active = true and is_pick_location = true;
create index medicine_shelf_locations_primary_idx
  on medicine_shelf_locations (medicine_id, is_primary, shelf_id)
  where location_type = 'PRIMARY_PICK';

create table operational_intelligence_policies (
  branch_id bigint primary key references branches(id) on delete cascade,
  shelf_lookback_days integer not null default 30 check (shelf_lookback_days between 7 and 365),
  shelf_minimum_picks integer not null default 10 check (shelf_minimum_picks >= 0),
  shelf_minimum_rank_improvement integer not null default 3 check (shelf_minimum_rank_improvement >= 1),
  expiry_critical_days integer not null default 30 check (expiry_critical_days between 1 and 365),
  expiry_high_days integer not null default 60 check (expiry_high_days > expiry_critical_days),
  expiry_moderate_days integer not null default 90 check (expiry_moderate_days > expiry_high_days),
  target_coverage_days integer not null default 30 check (target_coverage_days between 1 and 365),
  regulated_retention_years integer not null default 3 check (regulated_retention_years >= 3),
  require_regimen_verification boolean not null default true,
  updated_by_user_id bigint references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index operational_policies_updated_by_idx
  on operational_intelligence_policies (updated_by_user_id);

create table shelf_recommendations (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete restrict,
  current_shelf_id bigint references shelves(id) on delete restrict,
  suggested_shelf_id bigint not null references shelves(id) on delete restrict,
  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'APPLIED', 'DISMISSED', 'SUPERSEDED')),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  demand_class text not null check (demand_class in ('A', 'B', 'C', 'LOW_CONFIDENCE')),
  demand_score numeric(18, 6) not null check (demand_score >= 0),
  pick_count bigint not null check (pick_count >= 0),
  units_sold numeric(18, 3) not null check (units_sold >= 0),
  current_pick_priority integer,
  suggested_pick_priority integer not null,
  reason_snapshot jsonb not null check (jsonb_typeof(reason_snapshot) = 'object'),
  generated_for_date date not null,
  reviewed_by_user_id bigint references users(id) on delete restrict,
  review_notes text,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'PENDING_REVIEW') = (reviewed_at is null)),
  check ((status = 'APPLIED') = (applied_at is not null))
);
create index shelf_recommendations_branch_queue_idx
  on shelf_recommendations (branch_id, status, generated_for_date desc, id);
create index shelf_recommendations_medicine_idx
  on shelf_recommendations (medicine_id, generated_for_date desc);
create index shelf_recommendations_current_shelf_idx on shelf_recommendations (current_shelf_id);
create index shelf_recommendations_suggested_shelf_idx on shelf_recommendations (suggested_shelf_id);
create index shelf_recommendations_reviewer_idx on shelf_recommendations (reviewed_by_user_id);
create unique index shelf_recommendations_one_pending_uidx
  on shelf_recommendations (branch_id, medicine_id)
  where status = 'PENDING_REVIEW';

create table expiry_work_items (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  risk_bucket text not null check (risk_bucket in ('EXPIRED', 'DAYS_0_30', 'DAYS_31_60', 'DAYS_61_90')),
  quantity_snapshot numeric(18, 3) not null check (quantity_snapshot >= 0),
  value_at_risk numeric(14, 2) not null check (value_at_risk >= 0),
  cost_basis text not null default 'BATCH_ACQUISITION_COST'
    check (cost_basis = 'BATCH_ACQUISITION_COST'),
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWED', 'RESOLVED')),
  action text check (action in ('REVIEWED', 'SUPPLIER_RETURN_CANDIDATE', 'QUARANTINED', 'RESOLVED')),
  assigned_to_user_id bigint references users(id) on delete restrict,
  acted_by_user_id bigint references users(id) on delete restrict,
  action_notes text,
  snapshot_date date not null,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expiry_work_items_branch_queue_idx
  on expiry_work_items (branch_id, status, risk_bucket, snapshot_date desc);
create index expiry_work_items_batch_idx on expiry_work_items (inventory_batch_id, snapshot_date desc);
create index expiry_work_items_assignee_idx on expiry_work_items (assigned_to_user_id);
create index expiry_work_items_actor_idx on expiry_work_items (acted_by_user_id);
create unique index expiry_work_items_one_open_uidx
  on expiry_work_items (branch_id, inventory_batch_id)
  where status in ('OPEN', 'REVIEWED');

alter table purchase_order_items
  add column line_discount numeric(12, 2) not null default 0 check (line_discount >= 0),
  add column bonus_qty numeric(12, 3) not null default 0 check (bonus_qty >= 0),
  add column base_units_per_order_unit numeric(12, 3) not null default 1
    check (base_units_per_order_unit > 0);

alter table purchase_orders add column client_request_id text;
create unique index purchase_orders_client_request_uidx
  on purchase_orders (branch_id, client_request_id) where client_request_id is not null;

create table supplier_quotes (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  supplier_id bigint not null references suppliers(id) on delete restrict,
  medicine_id bigint not null references medicines(id) on delete restrict,
  quoted_unit_cost numeric(12, 2) not null check (quoted_unit_cost >= 0),
  quote_unit text not null,
  base_units_per_quote_unit numeric(12, 3) not null check (base_units_per_quote_unit > 0),
  minimum_order_qty numeric(12, 3) not null default 0 check (minimum_order_qty >= 0),
  valid_from date not null default current_date,
  valid_until date,
  source text not null,
  entered_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);
create index supplier_quotes_product_current_idx
  on supplier_quotes (branch_id, medicine_id, valid_from desc, id desc);
create index supplier_quotes_supplier_idx on supplier_quotes (supplier_id, medicine_id, valid_from desc);
create index supplier_quotes_entered_by_idx on supplier_quotes (entered_by_user_id);

alter table reorder_policies
  add column target_coverage_days integer not null default 30 check (target_coverage_days between 1 and 365),
  add column minimum_order_qty numeric(12, 3) not null default 0 check (minimum_order_qty >= 0),
  add column order_multiple numeric(12, 3) not null default 1 check (order_multiple > 0);

alter table reorder_suggestions drop constraint reorder_suggestions_status_check;
update reorder_suggestions set status = 'GENERATED' where status = 'OPEN';
alter table reorder_suggestions
  add constraint reorder_suggestions_status_check
    check (status in ('GENERATED', 'REVIEWED', 'DRAFT_PO', 'APPROVED', 'ORDERED', 'DISMISSED', 'EXPIRED', 'SUPERSEDED')),
  add column eligible_demand_days integer not null default 0 check (eligible_demand_days >= 0),
  add column stockout_days integer not null default 0 check (stockout_days >= 0),
  add column observed_lead_time_days integer check (observed_lead_time_days >= 0),
  add column effective_lead_time_days integer not null default 1 check (effective_lead_time_days >= 0),
  add column safety_stock numeric(12, 3) not null default 0 check (safety_stock >= 0),
  add column target_stock numeric(12, 3) not null default 0 check (target_stock >= 0),
  add column minimum_order_qty numeric(12, 3) not null default 0 check (minimum_order_qty >= 0),
  add column order_multiple numeric(12, 3) not null default 1 check (order_multiple > 0),
  add column confidence text not null default 'LOW' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  add column expiry_risk_flag boolean not null default false,
  add column draft_purchase_order_id bigint references purchase_orders(id) on delete restrict,
  add column reviewed_by_user_id bigint references users(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column version integer not null default 1 check (version > 0);
drop index reorder_suggestions_open_idx;
create index reorder_suggestions_queue_idx
  on reorder_suggestions (branch_id, status, generated_at desc, id)
  where status in ('GENERATED', 'REVIEWED', 'DRAFT_PO', 'APPROVED');
create index reorder_suggestions_draft_po_idx on reorder_suggestions (draft_purchase_order_id);
create index reorder_suggestions_reviewer_idx on reorder_suggestions (reviewed_by_user_id);
create unique index reorder_suggestions_one_active_uidx
  on reorder_suggestions (branch_id, medicine_id)
  where status in ('GENERATED', 'REVIEWED');

create table inventory_availability_daily (
  branch_id bigint not null references branches(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete cascade,
  availability_date date not null,
  had_sellable_stock boolean not null,
  closing_sellable_qty numeric(12, 3) not null check (closing_sellable_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, medicine_id, availability_date)
);
create index inventory_availability_daily_medicine_idx
  on inventory_availability_daily (medicine_id, availability_date desc);

create table return_lookup_tokens (
  id bigint generated always as identity primary key,
  sale_id bigint not null unique references sales(id) on delete restrict,
  token uuid not null unique default gen_random_uuid(),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index return_lookup_tokens_active_idx on return_lookup_tokens (token) where revoked_at is null;

alter table returns add column client_request_id text;
create unique index returns_client_request_uidx
  on returns (branch_id, client_request_id) where client_request_id is not null;
create unique index refunds_one_per_return_uidx on refunds (return_id);

create function enforce_return_item_limit() returns trigger language plpgsql as $$
declare
  v_sold numeric(12, 3);
  v_already_requested numeric(12, 3);
begin
  select quantity into strict v_sold from sale_items where id = new.sale_item_id for update;
  select coalesce(sum(return_items.quantity), 0)
    into v_already_requested
    from return_items
    join returns on returns.id = return_items.return_id
   where return_items.sale_item_id = new.sale_item_id
     and returns.status <> 'REJECTED'
     and (tg_op = 'INSERT' or return_items.id <> new.id);
  if v_already_requested + new.quantity > v_sold then
    raise exception 'return quantity exceeds remaining sold quantity' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger return_items_limit before insert or update on return_items
for each row execute function enforce_return_item_limit();

create table budget_regimen_audits (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  calculated_by_user_id bigint not null references users(id) on delete restrict,
  verified_by_user_id bigint references users(id) on delete restrict,
  budget numeric(12, 2) not null check (budget >= 0),
  complete_days integer not null check (complete_days >= 0),
  total_cost numeric(12, 2) not null check (total_cost >= 0 and total_cost <= budget),
  price_snapshot jsonb not null check (jsonb_typeof(price_snapshot) = 'array'),
  regimen_hash bytea not null,
  created_at timestamptz not null default now()
);
create index budget_regimen_audits_branch_created_idx
  on budget_regimen_audits (branch_id, created_at desc);
create index budget_regimen_audits_calculator_idx on budget_regimen_audits (calculated_by_user_id);
create index budget_regimen_audits_verifier_idx on budget_regimen_audits (verified_by_user_id);

create table ai_assistant_audits (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  user_id bigint not null references users(id) on delete restrict,
  question_hash bytea not null,
  tool_name text not null,
  tool_arguments jsonb not null default '{}'::jsonb check (jsonb_typeof(tool_arguments) = 'object'),
  provider text not null,
  model text,
  status text not null check (status in ('SUCCEEDED', 'DISABLED', 'RATE_LIMITED', 'FAILED', 'TIMED_OUT')),
  latency_ms integer not null check (latency_ms >= 0),
  usage_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_metadata) = 'object'),
  error_code text,
  created_at timestamptz not null default now()
);
create index ai_assistant_audits_user_rate_idx on ai_assistant_audits (user_id, created_at desc);
create index ai_assistant_audits_branch_status_idx on ai_assistant_audits (branch_id, status, created_at desc);
create trigger ai_assistant_audits_append_only before update or delete on ai_assistant_audits
for each row execute function prevent_append_only_mutation();

create table scheduled_job_runs (
  id bigint generated always as identity primary key,
  branch_id bigint references branches(id) on delete cascade,
  job_name text not null,
  run_key text not null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms >= 0),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  last_error text,
  unique (job_name, run_key)
);
create index scheduled_job_runs_branch_started_idx
  on scheduled_job_runs (branch_id, started_at desc);

create trigger operational_intelligence_policies_updated_at before update
on operational_intelligence_policies for each row execute function set_updated_at();
create trigger expiry_work_items_updated_at before update
on expiry_work_items for each row execute function set_updated_at();

insert into operational_intelligence_policies (branch_id)
select id from branches on conflict (branch_id) do nothing;
