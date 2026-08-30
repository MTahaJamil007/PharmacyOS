-- Cash-session controls: idempotent commands and branch-level variance approval policy.
-- Financial aggregates remain NUMERIC in PostgreSQL; application code never uses floats.

alter table operational_intelligence_policies
  add column cash_variance_approval_threshold numeric(12, 2) not null default 100
    check (cash_variance_approval_threshold >= 0);

alter table cash_sessions
  add column open_client_request_id text,
  add column close_client_request_id text,
  add column variance_approval_client_request_id text,
  add constraint cash_sessions_expected_cash_nonnegative check (expected_cash is null or expected_cash >= 0),
  add constraint cash_sessions_counted_cash_nonnegative check (counted_cash is null or counted_cash >= 0);

create unique index cash_sessions_open_request_uidx
  on cash_sessions (branch_id, terminal_id, open_client_request_id)
  where open_client_request_id is not null;
create unique index cash_sessions_close_request_uidx
  on cash_sessions (id, close_client_request_id)
  where close_client_request_id is not null;
create unique index cash_sessions_variance_approval_request_uidx
  on cash_sessions (id, variance_approval_client_request_id)
  where variance_approval_client_request_id is not null;

alter table cash_movements add column client_request_id text;
create unique index cash_movements_request_uidx
  on cash_movements (cash_session_id, client_request_id)
  where client_request_id is not null;

