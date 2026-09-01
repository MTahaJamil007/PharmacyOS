alter table operational_intelligence_policies
  add column basic_discount_limit_percent numeric(5, 2) not null default 5
    check (basic_discount_limit_percent between 0 and 100);

create table discount_approvals (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  sale_draft_id bigint not null references sale_drafts(id) on delete restrict,
  requested_by_user_id bigint not null references users(id) on delete restrict,
  approved_by_user_id bigint not null references users(id) on delete restrict,
  approval_level text not null check (approval_level in ('BASIC', 'OVERRIDE')),
  gross_amount numeric(12, 2) not null check (gross_amount > 0),
  discount_amount numeric(12, 2) not null check (discount_amount > 0),
  discount_percent numeric(5, 2) not null check (discount_percent > 0 and discount_percent <= 100),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  client_request_id text not null,
  created_at timestamptz not null default now()
);
create index discount_approvals_draft_idx on discount_approvals (sale_draft_id, id desc);
create index discount_approvals_approver_idx on discount_approvals (approved_by_user_id, created_at desc);
create unique index discount_approvals_request_uidx
  on discount_approvals (branch_id, client_request_id);
create function enforce_discount_approval_authority() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from sale_drafts
    where id = new.sale_draft_id and branch_id = new.branch_id
  ) then
    raise exception 'discount approval branch must match its draft branch'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from user_branch_roles
    join role_permissions on role_permissions.role_id = user_branch_roles.role_id
    join permissions on permissions.id = role_permissions.permission_id
    where user_branch_roles.user_id = new.approved_by_user_id
      and user_branch_roles.branch_id = new.branch_id
      and permissions.code = case when new.approval_level = 'OVERRIDE'
        then 'sale.discount.override' else 'sale.discount.basic' end
  ) then
    raise exception 'discount approver lacks the required branch permission'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger discount_approvals_authority before insert on discount_approvals
for each row execute function enforce_discount_approval_authority();
create trigger discount_approvals_append_only before update or delete on discount_approvals
for each row execute function prevent_append_only_mutation();

alter table sale_drafts
  add column discount_approval_id bigint references discount_approvals(id) on delete restrict;
alter table sales
  add column discount_approval_id bigint references discount_approvals(id) on delete restrict;

create function enforce_sale_discount_approval() returns trigger language plpgsql as $$
declare
  v_line_discounts numeric(12, 2);
begin
  select coalesce(sum(discount_amount), 0) into v_line_discounts
  from sale_items where sale_id = new.id;
  if v_line_discounts + new.discount_total > 0 and not exists (
    select 1 from discount_approvals
    where id = new.discount_approval_id and branch_id = new.branch_id
      and sale_draft_id = new.sale_draft_id
  ) then
    raise exception 'discounted sale requires a matching approval record'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger sales_discount_approval
after insert or update of discount_total, discount_approval_id on sales
deferrable initially deferred for each row execute function enforce_sale_discount_approval();

alter table inventory_batches
  add column maximum_retail_price numeric(12, 2)
    check (maximum_retail_price is null or maximum_retail_price >= 0),
  add constraint inventory_batch_sale_price_mrp_check
    check (maximum_retail_price is null or sale_price <= maximum_retail_price);

create table inventory_batch_price_history (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  old_sale_price numeric(12, 2),
  new_sale_price numeric(12, 2) not null check (new_sale_price >= 0),
  old_maximum_retail_price numeric(12, 2),
  new_maximum_retail_price numeric(12, 2),
  change_type text not null check (change_type in ('INITIAL', 'MANUAL')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  client_request_id text,
  performed_by_user_id bigint references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (new_maximum_retail_price is null or new_sale_price <= new_maximum_retail_price)
);
create index inventory_price_history_batch_idx
  on inventory_batch_price_history (inventory_batch_id, id desc);
create index inventory_price_history_user_idx
  on inventory_batch_price_history (performed_by_user_id, created_at desc)
  where performed_by_user_id is not null;
create unique index inventory_price_history_request_uidx
  on inventory_batch_price_history (branch_id, client_request_id)
  where client_request_id is not null;
create trigger inventory_price_history_append_only
before update or delete on inventory_batch_price_history
for each row execute function prevent_append_only_mutation();

insert into inventory_batch_price_history (
  branch_id, inventory_batch_id, new_sale_price, new_maximum_retail_price,
  change_type, reason
)
select branch_id, id, sale_price, maximum_retail_price, 'INITIAL', 'Phase 4 price history opening'
from inventory_batches;

create function enforce_inventory_batch_price_history() returns trigger language plpgsql as $$
declare
  v_sale_price numeric(12, 2);
  v_mrp numeric(12, 2);
begin
  if (old.sale_price, old.maximum_retail_price) is not distinct from
      (new.sale_price, new.maximum_retail_price) then
    return null;
  end if;
  select new_sale_price, new_maximum_retail_price into v_sale_price, v_mrp
  from inventory_batch_price_history where inventory_batch_id = new.id
  order by id desc limit 1;
  if v_sale_price is distinct from new.sale_price
      or v_mrp is distinct from new.maximum_retail_price then
    raise exception 'inventory price change requires a matching history row'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger inventory_batches_price_history
after update of sale_price, maximum_retail_price on inventory_batches
deferrable initially deferred for each row execute function enforce_inventory_batch_price_history();

create table stock_adjustments (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  stock_movement_id bigint unique references stock_movements(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in ('COUNT', 'SCRAP')),
  quantity_before numeric(12, 3) not null check (quantity_before >= 0),
  quantity_delta numeric(12, 3) not null,
  quantity_after numeric(12, 3) not null check (quantity_after >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  client_request_id text not null,
  performed_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (quantity_after = quantity_before + quantity_delta),
  check ((quantity_delta = 0 and adjustment_type = 'COUNT' and stock_movement_id is null)
    or (quantity_delta <> 0 and stock_movement_id is not null)),
  check (adjustment_type <> 'SCRAP' or quantity_delta < 0),
  unique (branch_id, client_request_id)
);
create index stock_adjustments_batch_idx on stock_adjustments (inventory_batch_id, created_at desc);
create index stock_adjustments_user_idx on stock_adjustments (performed_by_user_id, created_at desc);
create function enforce_stock_adjustment_movement() returns trigger language plpgsql as $$
begin
  if new.stock_movement_id is not null and not exists (
    select 1 from stock_movements movement
    where movement.id = new.stock_movement_id
      and movement.branch_id = new.branch_id
      and movement.inventory_batch_id = new.inventory_batch_id
      and movement.quantity_delta = new.quantity_delta
      and movement.quantity_after = new.quantity_after
      and movement.performed_by_user_id = new.performed_by_user_id
      and movement.movement_type = case when new.adjustment_type = 'SCRAP' then 'SCRAP'
        when new.quantity_delta > 0 then 'ADJUSTMENT_IN' else 'ADJUSTMENT_OUT' end
  ) then
    raise exception 'stock adjustment must match its stock movement'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger stock_adjustments_movement before insert on stock_adjustments
for each row execute function enforce_stock_adjustment_movement();
create trigger stock_adjustments_append_only before update or delete on stock_adjustments
for each row execute function prevent_append_only_mutation();
