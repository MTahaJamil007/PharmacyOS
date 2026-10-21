-- A purchase order that will not be fulfilled can be cancelled while nothing has been
-- received against it. Cancellation is recorded, not deleted.
alter table purchase_orders
  add column cancelled_at timestamptz,
  add column cancelled_by_user_id bigint references users(id) on delete restrict,
  add column cancel_reason text,
  add column cancel_client_request_id text,
  add constraint purchase_orders_cancellation_check check (
    (status = 'CANCELLED') = (cancelled_at is not null and cancelled_by_user_id is not null)
  );
create unique index purchase_orders_cancel_request_uidx
  on purchase_orders (branch_id, cancel_client_request_id)
  where cancel_client_request_id is not null;
create index purchase_orders_cancelled_by_idx on purchase_orders (cancelled_by_user_id)
  where cancelled_by_user_id is not null;
