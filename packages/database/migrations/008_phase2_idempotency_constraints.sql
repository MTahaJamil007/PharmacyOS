drop index cash_sessions_close_request_uidx;
create unique index cash_sessions_close_request_uidx
  on cash_sessions (branch_id, terminal_id, close_client_request_id)
  where close_client_request_id is not null;

drop index cash_sessions_variance_approval_request_uidx;
create unique index cash_sessions_variance_approval_request_uidx
  on cash_sessions (branch_id, variance_approval_client_request_id)
  where variance_approval_client_request_id is not null;

drop index purchase_orders_order_request_uidx;
create unique index purchase_orders_order_request_uidx
  on purchase_orders (branch_id, ordered_client_request_id)
  where ordered_client_request_id is not null;
