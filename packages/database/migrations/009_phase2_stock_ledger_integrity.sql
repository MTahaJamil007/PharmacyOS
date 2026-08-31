alter table inventory_batches
  add column source_batch_id bigint references inventory_batches(id) on delete restrict,
  add column segment_key text not null default 'PRIMARY' check (length(segment_key) between 1 and 64);

alter table inventory_batches drop constraint inventory_batches_acquisition_lot_key;
alter table inventory_batches
  add constraint inventory_batches_acquisition_lot_key unique nulls not distinct (
    branch_id, medicine_id, batch_number, expiry_date, purchase_order_item_id, segment_key
  );
create index inventory_batches_source_batch_idx on inventory_batches (source_batch_id)
  where source_batch_id is not null;

alter table expiry_work_items drop constraint expiry_work_items_action_check;
alter table expiry_work_items add constraint expiry_work_items_action_check
  check (action in ('REVIEWED', 'SUPPLIER_RETURN_CANDIDATE', 'QUARANTINED', 'SCRAPPED', 'RESOLVED'));

with first_movements as (
  select distinct on (inventory_batch_id)
    inventory_batch_id, quantity_delta, quantity_after, created_at
  from stock_movements
  order by inventory_batch_id, id
), legacy_openings as (
  select batches.id, batches.branch_id,
    coalesce(first_movements.quantity_after - first_movements.quantity_delta,
      batches.current_qty) as opening_quantity,
    coalesce(first_movements.created_at, batches.created_at) as opening_at
  from inventory_batches batches
  left join first_movements on first_movements.inventory_batch_id = batches.id
)
insert into stock_movements (
  id, branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason,
  metadata, created_at
)
overriding system value
select -legacy_openings.id, legacy_openings.branch_id, legacy_openings.id, 'ADJUSTMENT_IN',
  legacy_openings.opening_quantity, legacy_openings.opening_quantity,
  'Phase 2 legacy ledger opening',
  jsonb_build_object('migration', '009_phase2_stock_ledger_integrity.sql'),
  legacy_openings.opening_at
from legacy_openings
where legacy_openings.opening_quantity > 0;

do $$
begin
  if exists (
    select 1
    from (
      select inventory_batch_id, quantity_delta, quantity_after,
        coalesce(lag(quantity_after) over (
          partition by inventory_batch_id order by id
        ), 0) as quantity_before
      from stock_movements
    ) history
    where history.quantity_after <> history.quantity_before + history.quantity_delta
  ) then
    raise exception 'existing stock movement arithmetic is inconsistent' using errcode = '23514';
  end if;

  if exists (
    select 1 from inventory_batches batches
    join lateral (
      select quantity_after from stock_movements
      where inventory_batch_id = batches.id order by id desc limit 1
    ) latest on true
    where latest.quantity_after <> batches.current_qty
  ) then
    raise exception 'stock movement ledger does not match current batch quantity' using errcode = '23514';
  end if;
end
$$;

create function enforce_stock_movement_integrity() returns trigger language plpgsql as $$
declare
  v_batch_branch_id bigint;
  v_current_quantity numeric(12, 3);
  v_prior_quantity numeric(12, 3);
begin
  select branch_id, current_qty into strict v_batch_branch_id, v_current_quantity
  from inventory_batches where id = new.inventory_batch_id for update;

  select quantity_after into v_prior_quantity
  from stock_movements
  where inventory_batch_id = new.inventory_batch_id
  order by id desc limit 1;
  v_prior_quantity := coalesce(v_prior_quantity, 0);

  if new.quantity_after <> v_prior_quantity + new.quantity_delta then
    raise exception 'stock movement quantity_after must equal prior quantity plus delta'
      using errcode = '23514';
  end if;
  if new.quantity_after <> v_current_quantity then
    raise exception 'stock movement quantity_after must match the locked batch quantity'
      using errcode = '23514';
  end if;
  if new.branch_id <> v_batch_branch_id then
    raise exception 'stock movement branch must match its inventory batch branch'
      using errcode = '23514';
  end if;
  if new.movement_type in ('PURCHASE_RECEIPT', 'RETURN_RESTOCK', 'ADJUSTMENT_IN')
      and new.quantity_delta <= 0 then
    raise exception '% requires a positive quantity_delta', new.movement_type
      using errcode = '23514';
  end if;
  if new.movement_type in ('SALE', 'ADJUSTMENT_OUT', 'QUARANTINE', 'SCRAP')
      and new.quantity_delta >= 0 then
    raise exception '% requires a negative quantity_delta', new.movement_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger stock_movements_integrity before insert on stock_movements
for each row execute function enforce_stock_movement_integrity();

create function enforce_inventory_batch_ledger_balance() returns trigger language plpgsql as $$
declare
  v_latest_quantity numeric(12, 3);
begin
  select quantity_after into v_latest_quantity
  from stock_movements
  where inventory_batch_id = new.id
  order by id desc limit 1;

  if coalesce(v_latest_quantity, 0) <> new.current_qty then
    raise exception 'inventory batch quantity must reconcile to its stock movement ledger'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger inventory_batches_ledger_balance
after insert or update of current_qty on inventory_batches
deferrable initially deferred
for each row execute function enforce_inventory_batch_ledger_balance();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pharmacy_app') then
    execute 'alter default privileges in schema public
      grant select, insert, update, delete on tables to pharmacy_app';
    execute 'alter default privileges in schema public
      grant usage, select, update on sequences to pharmacy_app';
    execute 'alter default privileges in schema public
      grant execute on functions to pharmacy_app';
    grant execute on all functions in schema public to pharmacy_app;
  end if;
end
$$;
