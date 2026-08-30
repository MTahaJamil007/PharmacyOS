-- Append-only goods receipt ledger and idempotent purchase-order transitions.

alter table purchase_orders add column ordered_client_request_id text;
create unique index purchase_orders_order_request_uidx
  on purchase_orders (id, ordered_client_request_id)
  where ordered_client_request_id is not null;

alter table purchase_order_items
  add column received_bonus_qty numeric(12, 3) not null default 0
    check (received_bonus_qty >= 0 and received_bonus_qty <= bonus_qty);

-- One manufacturer batch may arrive through multiple purchase lots with different acquisition costs.
do $$
declare
  legacy_constraint_name text;
begin
  select pg_constraint.conname into legacy_constraint_name
  from pg_constraint
  where pg_constraint.conrelid = 'inventory_batches'::regclass
    and pg_constraint.contype = 'u'
    and pg_get_constraintdef(pg_constraint.oid) =
      'UNIQUE (branch_id, medicine_id, batch_number, expiry_date)';
  if legacy_constraint_name is null then
    raise exception 'Legacy inventory batch acquisition constraint was not found';
  end if;
  execute format('alter table inventory_batches drop constraint %I', legacy_constraint_name);
end;
$$;
alter table inventory_batches
  add constraint inventory_batches_acquisition_lot_key unique nulls not distinct (
    branch_id, medicine_id, batch_number, expiry_date, purchase_order_item_id
  );

alter table reorder_suggestions drop constraint reorder_suggestions_status_check;
alter table reorder_suggestions
  add constraint reorder_suggestions_status_check check (
    status in (
      'GENERATED', 'REVIEWED', 'DRAFT_PO', 'APPROVED', 'ORDERED', 'RECEIVED',
      'DISMISSED', 'EXPIRED', 'SUPERSEDED'
    )
  );

create table goods_receipts (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  purchase_order_id bigint not null references purchase_orders(id) on delete restrict,
  received_by_user_id bigint not null references users(id) on delete restrict,
  client_request_id text not null,
  supplier_invoice_number text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (branch_id, client_request_id)
);
create index goods_receipts_order_idx on goods_receipts (purchase_order_id, received_at desc);
create index goods_receipts_received_by_idx on goods_receipts (received_by_user_id);

create table goods_receipt_items (
  id bigint generated always as identity primary key,
  goods_receipt_id bigint not null references goods_receipts(id) on delete restrict,
  purchase_order_item_id bigint not null references purchase_order_items(id) on delete restrict,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  received_order_qty numeric(12, 3) not null check (received_order_qty > 0),
  received_bonus_qty numeric(12, 3) not null default 0 check (received_bonus_qty >= 0),
  base_units_per_order_unit numeric(12, 3) not null check (base_units_per_order_unit > 0),
  received_base_qty numeric(12, 3) generated always as (
    (received_order_qty + received_bonus_qty) * base_units_per_order_unit
  ) stored,
  effective_cost_per_base_unit numeric(12, 2) not null check (effective_cost_per_base_unit >= 0),
  batch_number text not null,
  expiry_date date not null,
  created_at timestamptz not null default now(),
  unique (goods_receipt_id, purchase_order_item_id, batch_number, expiry_date)
);
create index goods_receipt_items_receipt_idx on goods_receipt_items (goods_receipt_id);
create index goods_receipt_items_po_item_idx on goods_receipt_items (purchase_order_item_id);
create index goods_receipt_items_batch_idx on goods_receipt_items (inventory_batch_id);

create trigger goods_receipts_append_only before update or delete on goods_receipts
for each row execute function prevent_append_only_mutation();
create trigger goods_receipt_items_append_only before update or delete on goods_receipt_items
for each row execute function prevent_append_only_mutation();
