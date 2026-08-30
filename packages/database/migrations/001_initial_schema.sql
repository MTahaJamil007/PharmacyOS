create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pgcrypto;

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function prevent_append_only_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create table branches (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  address text,
  phone text,
  timezone text not null default 'Asia/Karachi',
  currency_code text not null default 'PKR' check (currency_code = 'PKR'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id bigint generated always as identity primary key,
  username text not null,
  display_name text not null,
  password_hash text not null,
  pin_hash text,
  is_active boolean not null default true,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index users_active_username_uidx on users (lower(username)) where deleted_at is null;

create table roles (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table permissions (
  id bigint generated always as identity primary key,
  code text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table role_permissions (
  role_id bigint not null references roles(id) on delete cascade,
  permission_id bigint not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
create index role_permissions_permission_id_idx on role_permissions (permission_id);

create table user_branch_roles (
  user_id bigint not null references users(id) on delete cascade,
  branch_id bigint not null references branches(id) on delete cascade,
  role_id bigint not null references roles(id) on delete restrict,
  granted_by_user_id bigint references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, branch_id, role_id)
);
create index user_branch_roles_branch_id_idx on user_branch_roles (branch_id);
create index user_branch_roles_role_id_idx on user_branch_roles (role_id);
create index user_branch_roles_granted_by_idx on user_branch_roles (granted_by_user_id);

create table terminals (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  code text not null,
  name text not null,
  terminal_type text not null check (terminal_type in ('SALES_COUNTER', 'CASHIER', 'ADMIN')),
  registration_secret_hash text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code)
);
create index terminals_branch_id_idx on terminals (branch_id);

create table sessions (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  branch_id bigint not null references branches(id) on delete cascade,
  terminal_id bigint not null references terminals(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  check (expires_at > created_at)
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_branch_id_idx on sessions (branch_id);
create index sessions_terminal_id_idx on sessions (terminal_id);
create index sessions_active_expiry_idx on sessions (expires_at) where revoked_at is null;

create table audit_events (
  id bigint generated always as identity primary key,
  branch_id bigint references branches(id) on delete restrict,
  user_id bigint references users(id) on delete restrict,
  terminal_id bigint references terminals(id) on delete restrict,
  event_type text not null,
  entity_type text,
  entity_id bigint,
  request_id text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index audit_events_branch_created_idx on audit_events (branch_id, created_at desc);
create index audit_events_user_created_idx on audit_events (user_id, created_at desc);
create index audit_events_entity_idx on audit_events (entity_type, entity_id, created_at desc);
create trigger audit_events_append_only before update or delete on audit_events
for each row execute function prevent_append_only_mutation();

create table manufacturers (
  id bigint generated always as identity primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index manufacturers_active_name_uidx on manufacturers (lower(name)) where deleted_at is null;

create table generics (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index generics_active_name_uidx on generics (lower(name)) where deleted_at is null;

create table categories (
  id bigint generated always as identity primary key,
  parent_id bigint references categories(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index categories_parent_id_idx on categories (parent_id);
create unique index categories_active_name_uidx on categories (lower(name)) where deleted_at is null;

create table medicines (
  id bigint generated always as identity primary key,
  generic_id bigint references generics(id) on delete restrict,
  manufacturer_id bigint references manufacturers(id) on delete restrict,
  category_id bigint references categories(id) on delete restrict,
  sku text,
  name text not null,
  generic_name text,
  strength text,
  dosage_form text,
  pack_size numeric(12, 3) not null default 1 check (pack_size > 0),
  unit_name text not null default 'unit',
  requires_prescription boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index medicines_generic_id_idx on medicines (generic_id);
create index medicines_manufacturer_id_idx on medicines (manufacturer_id);
create index medicines_category_id_idx on medicines (category_id);
create unique index medicines_active_sku_uidx on medicines (sku) where sku is not null and deleted_at is null;
create index medicines_name_trgm_idx on medicines using gin (name gin_trgm_ops) where deleted_at is null;
create index medicines_generic_trgm_idx on medicines using gin (generic_name gin_trgm_ops) where deleted_at is null;

create table medicine_aliases (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicines(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique (medicine_id, alias)
);
create index medicine_aliases_medicine_id_idx on medicine_aliases (medicine_id);
create index medicine_aliases_alias_trgm_idx on medicine_aliases using gin (alias gin_trgm_ops);

create table medicine_barcodes (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicines(id) on delete cascade,
  barcode text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index medicine_barcodes_medicine_id_idx on medicine_barcodes (medicine_id);

create table shelves (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  code text not null,
  name text not null,
  rack text,
  bin text,
  row_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code)
);
create index shelves_branch_id_idx on shelves (branch_id);

create table medicine_shelf_locations (
  medicine_id bigint not null references medicines(id) on delete cascade,
  shelf_id bigint not null references shelves(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (medicine_id, shelf_id)
);
create index medicine_shelf_locations_shelf_id_idx on medicine_shelf_locations (shelf_id);

create table suppliers (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  code text,
  name text not null,
  phone text,
  address text,
  lead_time_days integer not null default 1 check (lead_time_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index suppliers_branch_id_idx on suppliers (branch_id);
create unique index suppliers_active_code_uidx on suppliers (branch_id, code) where code is not null and deleted_at is null;

create table purchase_orders (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  supplier_id bigint not null references suppliers(id) on delete restrict,
  created_by_user_id bigint not null references users(id) on delete restrict,
  order_number text not null,
  supplier_invoice_number text,
  status text not null check (status in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  ordered_at timestamptz,
  received_at timestamptz,
  total_cost numeric(12, 2) not null default 0 check (total_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, order_number)
);
create index purchase_orders_branch_id_idx on purchase_orders (branch_id);
create index purchase_orders_supplier_id_idx on purchase_orders (supplier_id);
create index purchase_orders_created_by_idx on purchase_orders (created_by_user_id);
create index purchase_orders_open_idx on purchase_orders (branch_id, created_at) where status in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED');

create table purchase_order_items (
  id bigint generated always as identity primary key,
  purchase_order_id bigint not null references purchase_orders(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete restrict,
  ordered_qty numeric(12, 3) not null check (ordered_qty > 0),
  received_qty numeric(12, 3) not null default 0 check (received_qty >= 0 and received_qty <= ordered_qty),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);
create index purchase_order_items_order_id_idx on purchase_order_items (purchase_order_id);
create index purchase_order_items_medicine_id_idx on purchase_order_items (medicine_id);

create table inventory_batches (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  medicine_id bigint not null references medicines(id) on delete restrict,
  purchase_order_item_id bigint references purchase_order_items(id) on delete restrict,
  batch_number text not null,
  expiry_date date not null,
  received_at timestamptz not null default now(),
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  sale_price numeric(12, 2) not null check (sale_price >= 0),
  current_qty numeric(12, 3) not null default 0 check (current_qty >= 0),
  status text not null default 'SELLABLE' check (status in ('SELLABLE', 'QUARANTINE', 'RECALLED', 'DEPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (branch_id, medicine_id, batch_number, expiry_date)
);
create index inventory_batches_branch_id_idx on inventory_batches (branch_id);
create index inventory_batches_medicine_id_idx on inventory_batches (medicine_id);
create index inventory_batches_purchase_item_idx on inventory_batches (purchase_order_item_id);
create index inventory_batches_available_idx on inventory_batches (branch_id, medicine_id, expiry_date, received_at, id)
where current_qty > 0 and status = 'SELLABLE' and deleted_at is null;
create index inventory_batches_expiry_idx on inventory_batches (branch_id, expiry_date)
where current_qty > 0 and status = 'SELLABLE' and deleted_at is null;

create table sale_drafts (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  terminal_id bigint not null references terminals(id) on delete restrict,
  salesperson_user_id bigint not null references users(id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT_TO_CASHIER', 'RESERVED', 'PAYMENT_IN_PROGRESS', 'PAID', 'CANCELLED', 'EXPIRED')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0 and total = subtotal - discount_total),
  sent_at timestamptz,
  reserved_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sale_drafts_branch_id_idx on sale_drafts (branch_id);
create index sale_drafts_terminal_id_idx on sale_drafts (terminal_id);
create index sale_drafts_salesperson_idx on sale_drafts (salesperson_user_id);
create index sale_drafts_cashier_queue_idx on sale_drafts (branch_id, sent_at, id)
where status in ('SENT_TO_CASHIER', 'RESERVED', 'PAYMENT_IN_PROGRESS');

create table sale_draft_items (
  id bigint generated always as identity primary key,
  sale_draft_id bigint not null references sale_drafts(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sale_draft_id, medicine_id)
);
create index sale_draft_items_medicine_id_idx on sale_draft_items (medicine_id);

create table stock_reservations (
  id bigint generated always as identity primary key,
  sale_draft_item_id bigint not null references sale_draft_items(id) on delete cascade,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'CONSUMED') = (consumed_at is not null)),
  check ((status in ('RELEASED', 'EXPIRED')) = (released_at is not null))
);
create index stock_reservations_draft_item_idx on stock_reservations (sale_draft_item_id);
create index stock_reservations_batch_id_idx on stock_reservations (inventory_batch_id);
create index stock_reservations_active_batch_idx on stock_reservations (inventory_batch_id, expires_at)
where status = 'ACTIVE';
create index stock_reservations_expiry_idx on stock_reservations (expires_at) where status = 'ACTIVE';

create table cash_sessions (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  terminal_id bigint not null references terminals(id) on delete restrict,
  cashier_user_id bigint not null references users(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSING', 'CLOSED', 'VARIANCE_APPROVED')),
  opening_float numeric(12, 2) not null check (opening_float >= 0),
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2),
  variance numeric(12, 2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closing_notes text,
  variance_approved_by_user_id bigint references users(id) on delete restrict,
  variance_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cash_sessions_branch_id_idx on cash_sessions (branch_id);
create index cash_sessions_terminal_id_idx on cash_sessions (terminal_id);
create index cash_sessions_cashier_idx on cash_sessions (cashier_user_id);
create index cash_sessions_variance_approver_idx on cash_sessions (variance_approved_by_user_id);
create unique index cash_sessions_one_active_uidx on cash_sessions (cashier_user_id, terminal_id) where status in ('OPEN', 'CLOSING');

create table sales (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  terminal_id bigint not null references terminals(id) on delete restrict,
  cashier_user_id bigint not null references users(id) on delete restrict,
  cash_session_id bigint not null references cash_sessions(id) on delete restrict,
  sale_draft_id bigint not null unique references sale_drafts(id) on delete restrict,
  invoice_number text not null,
  client_request_id text not null,
  status text not null default 'PAID' check (status in ('PAID', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED')),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12, 2) not null default 0 check (tax_total >= 0),
  total numeric(12, 2) not null check (total >= 0 and total = subtotal - discount_total + tax_total),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, invoice_number),
  unique (terminal_id, cash_session_id, client_request_id)
);
create index sales_branch_created_idx on sales (branch_id, created_at desc);
create index sales_terminal_id_idx on sales (terminal_id);
create index sales_cashier_id_idx on sales (cashier_user_id);
create index sales_cash_session_id_idx on sales (cash_session_id);

create table sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references sales(id) on delete restrict,
  medicine_id bigint not null references medicines(id) on delete restrict,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);
create index sale_items_sale_id_idx on sale_items (sale_id);
create index sale_items_medicine_created_idx on sale_items (medicine_id, created_at desc);
create index sale_items_batch_id_idx on sale_items (inventory_batch_id);

create table payments (
  id bigint generated always as identity primary key,
  sale_id bigint not null references sales(id) on delete restrict,
  cash_session_id bigint not null references cash_sessions(id) on delete restrict,
  method text not null check (method in ('CASH', 'CARD', 'BANK_TRANSFER')),
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  status text not null default 'CAPTURED' check (status in ('CAPTURED', 'VOIDED', 'REFUNDED')),
  created_at timestamptz not null default now()
);
create index payments_sale_id_idx on payments (sale_id);
create index payments_cash_session_id_idx on payments (cash_session_id);

create table stock_movements (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  inventory_batch_id bigint not null references inventory_batches(id) on delete restrict,
  movement_type text not null check (movement_type in ('PURCHASE_RECEIPT', 'SALE', 'RETURN_RESTOCK', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'QUARANTINE', 'SCRAP', 'TRANSFER')),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  quantity_after numeric(12, 3) not null check (quantity_after >= 0),
  sale_item_id bigint references sale_items(id) on delete restrict,
  purchase_order_item_id bigint references purchase_order_items(id) on delete restrict,
  performed_by_user_id bigint references users(id) on delete restrict,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);
create index stock_movements_branch_created_idx on stock_movements (branch_id, created_at desc);
create index stock_movements_batch_id_idx on stock_movements (inventory_batch_id, created_at desc);
create index stock_movements_sale_item_idx on stock_movements (sale_item_id);
create index stock_movements_purchase_item_idx on stock_movements (purchase_order_item_id);
create index stock_movements_performed_by_idx on stock_movements (performed_by_user_id);
create trigger stock_movements_append_only before update or delete on stock_movements
for each row execute function prevent_append_only_mutation();

create table cash_movements (
  id bigint generated always as identity primary key,
  cash_session_id bigint not null references cash_sessions(id) on delete restrict,
  performed_by_user_id bigint not null references users(id) on delete restrict,
  movement_type text not null check (movement_type in ('CASH_IN', 'CASH_OUT')),
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);
create index cash_movements_session_id_idx on cash_movements (cash_session_id);
create index cash_movements_performed_by_idx on cash_movements (performed_by_user_id);

create table returns (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete restrict,
  sale_id bigint not null references sales(id) on delete restrict,
  requested_by_user_id bigint not null references users(id) on delete restrict,
  approved_by_user_id bigint references users(id) on delete restrict,
  return_number text not null,
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED', 'CLOSED')),
  reason text not null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, return_number)
);
create index returns_branch_id_idx on returns (branch_id);
create index returns_sale_id_idx on returns (sale_id);
create index returns_requested_by_idx on returns (requested_by_user_id);
create index returns_approved_by_idx on returns (approved_by_user_id);
create index returns_pending_idx on returns (branch_id, requested_at) where status in ('REQUESTED', 'APPROVED', 'RECEIVED');

create table return_items (
  id bigint generated always as identity primary key,
  return_id bigint not null references returns(id) on delete cascade,
  sale_item_id bigint not null references sale_items(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  disposition text check (disposition in ('RESTOCK_SELLABLE', 'QUARANTINE', 'SCRAP')),
  refund_amount numeric(12, 2) not null check (refund_amount >= 0),
  created_at timestamptz not null default now(),
  unique (return_id, sale_item_id)
);
create index return_items_sale_item_id_idx on return_items (sale_item_id);

create table refunds (
  id bigint generated always as identity primary key,
  return_id bigint not null references returns(id) on delete restrict,
  cash_session_id bigint references cash_sessions(id) on delete restrict,
  processed_by_user_id bigint not null references users(id) on delete restrict,
  method text not null check (method in ('CASH', 'CARD', 'BANK_TRANSFER')),
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  created_at timestamptz not null default now()
);
create index refunds_return_id_idx on refunds (return_id);
create index refunds_cash_session_id_idx on refunds (cash_session_id);
create index refunds_processed_by_idx on refunds (processed_by_user_id);

create table fbr_invoices (
  id bigint generated always as identity primary key,
  sale_id bigint not null unique references sales(id) on delete restrict,
  mode text not null check (mode in ('DISABLED', 'SANDBOX', 'PRAL_DI_API', 'LICENSED_INTEGRATOR_API', 'WINDOWS_IMS_BRIDGE')),
  status text not null check (status in ('NOT_REQUIRED', 'PENDING', 'VALIDATING', 'VALIDATED', 'SUBMITTING', 'SUBMITTED', 'FAILED_RETRYABLE', 'FAILED_NEEDS_REVIEW', 'VOID_OR_CREDIT_NOTE_PENDING')),
  payload jsonb not null,
  fiscal_invoice_number text,
  qr_payload text,
  submitted_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);
create index fbr_invoices_status_idx on fbr_invoices (status, created_at) where status in ('PENDING', 'FAILED_RETRYABLE', 'FAILED_NEEDS_REVIEW');

create table fbr_invoice_attempts (
  id bigint generated always as identity primary key,
  fbr_invoice_id bigint not null references fbr_invoices(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  request_payload jsonb not null,
  response_payload jsonb,
  http_status integer,
  outcome text not null check (outcome in ('SUCCESS', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE')),
  error_message text,
  attempted_at timestamptz not null default now(),
  unique (fbr_invoice_id, attempt_number)
);
create index fbr_invoice_attempts_invoice_id_idx on fbr_invoice_attempts (fbr_invoice_id);

create table outbox_jobs (
  id bigint generated always as identity primary key,
  job_type text not null,
  deduplication_key text,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRYABLE', 'FAILED')),
  priority smallint not null default 100,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 10 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);
create unique index outbox_jobs_deduplication_uidx on outbox_jobs (job_type, deduplication_key) where deduplication_key is not null;
create index outbox_jobs_claim_idx on outbox_jobs (priority, available_at, id) where status in ('PENDING', 'RETRYABLE');

create table job_attempts (
  id bigint generated always as identity primary key,
  outbox_job_id bigint not null references outbox_jobs(id) on delete restrict,
  worker_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('COMPLETED', 'RETRYABLE', 'FAILED')),
  error_message text,
  unique (outbox_job_id, attempt_number)
);
create index job_attempts_job_id_idx on job_attempts (outbox_job_id);

create function claim_outbox_job(p_worker_id text) returns setof outbox_jobs language sql as $$
  update outbox_jobs
  set status = 'PROCESSING',
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = attempts + 1,
      updated_at = now()
  where id = (
    select id
    from outbox_jobs
    where status in ('PENDING', 'RETRYABLE')
      and available_at <= now()
      and attempts < max_attempts
    order by priority, available_at, id
    limit 1
    for update skip locked
  )
  returning *;
$$;

create table reorder_policies (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete cascade,
  preferred_supplier_id bigint references suppliers(id) on delete set null,
  lookback_days integer not null default 30 check (lookback_days between 1 and 365),
  lead_time_days integer not null default 1 check (lead_time_days >= 0),
  safety_days integer not null default 3 check (safety_days >= 0),
  minimum_stock numeric(12, 3) not null default 0 check (minimum_stock >= 0),
  pack_size numeric(12, 3) not null default 1 check (pack_size > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, medicine_id)
);
create index reorder_policies_medicine_id_idx on reorder_policies (medicine_id);
create index reorder_policies_supplier_id_idx on reorder_policies (preferred_supplier_id);

create table sales_velocity_daily (
  branch_id bigint not null references branches(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete cascade,
  sales_date date not null,
  quantity_sold numeric(12, 3) not null default 0 check (quantity_sold >= 0),
  net_sales numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, medicine_id, sales_date)
);
create index sales_velocity_daily_medicine_idx on sales_velocity_daily (medicine_id, sales_date desc);

create table reorder_suggestions (
  id bigint generated always as identity primary key,
  branch_id bigint not null references branches(id) on delete cascade,
  medicine_id bigint not null references medicines(id) on delete cascade,
  policy_id bigint not null references reorder_policies(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED')),
  average_daily_sales numeric(12, 3) not null check (average_daily_sales >= 0),
  current_sellable_stock numeric(12, 3) not null check (current_sellable_stock >= 0),
  reserved_stock numeric(12, 3) not null check (reserved_stock >= 0),
  reorder_point numeric(12, 3) not null check (reorder_point >= 0),
  suggested_qty numeric(12, 3) not null check (suggested_qty > 0),
  reason jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (jsonb_typeof(reason) = 'object')
);
create index reorder_suggestions_branch_id_idx on reorder_suggestions (branch_id);
create index reorder_suggestions_medicine_id_idx on reorder_suggestions (medicine_id);
create index reorder_suggestions_policy_id_idx on reorder_suggestions (policy_id);
create index reorder_suggestions_open_idx on reorder_suggestions (branch_id, generated_at desc) where status = 'OPEN';

create table dashboard_daily_metrics (
  branch_id bigint not null references branches(id) on delete cascade,
  metric_date date not null,
  net_sales numeric(12, 2) not null default 0,
  gross_profit_estimate numeric(12, 2) not null default 0,
  cash_collected numeric(12, 2) not null default 0,
  non_cash_collected numeric(12, 2) not null default 0,
  refunds numeric(12, 2) not null default 0,
  invoice_count bigint not null default 0 check (invoice_count >= 0),
  metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (branch_id, metric_date),
  check (jsonb_typeof(metrics) = 'object')
);

create table backup_runs (
  id bigint generated always as identity primary key,
  branch_id bigint references branches(id) on delete restrict,
  backup_type text not null check (backup_type in ('LOGICAL', 'PHYSICAL', 'RESTORE_DRILL')),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  destination text not null,
  encrypted boolean not null,
  size_bytes bigint check (size_bytes >= 0),
  checksum text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);
create index backup_runs_branch_started_idx on backup_runs (branch_id, started_at desc);

create trigger branches_updated_at before update on branches for each row execute function set_updated_at();
create trigger users_updated_at before update on users for each row execute function set_updated_at();
create trigger terminals_updated_at before update on terminals for each row execute function set_updated_at();
create trigger medicines_updated_at before update on medicines for each row execute function set_updated_at();
create trigger inventory_batches_updated_at before update on inventory_batches for each row execute function set_updated_at();
create trigger sale_drafts_updated_at before update on sale_drafts for each row execute function set_updated_at();
create trigger sales_updated_at before update on sales for each row execute function set_updated_at();
create trigger cash_sessions_updated_at before update on cash_sessions for each row execute function set_updated_at();
create trigger returns_updated_at before update on returns for each row execute function set_updated_at();
create trigger fbr_invoices_updated_at before update on fbr_invoices for each row execute function set_updated_at();
create trigger outbox_jobs_updated_at before update on outbox_jobs for each row execute function set_updated_at();
create trigger reorder_policies_updated_at before update on reorder_policies for each row execute function set_updated_at();

revoke all on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
