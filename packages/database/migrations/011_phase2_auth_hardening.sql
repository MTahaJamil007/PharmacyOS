alter table users
  add column failed_login_window_started_at timestamptz;

alter table sessions
  add column absolute_expires_at timestamptz;
update sessions set absolute_expires_at = expires_at where absolute_expires_at is null;
alter table sessions
  alter column absolute_expires_at set not null,
  add constraint sessions_absolute_expiry_check check (absolute_expires_at >= expires_at);
create index sessions_absolute_expiry_idx on sessions (absolute_expires_at)
  where revoked_at is null;

create table auth_login_throttles (
  scope_type text not null check (scope_type in ('IP', 'USERNAME')),
  scope_hash bytea not null,
  attempt_count integer not null check (attempt_count > 0),
  window_started_at timestamptz not null,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_hash),
  check (blocked_until is null or blocked_until > window_started_at)
);
create index auth_login_throttles_cleanup_idx
  on auth_login_throttles (updated_at);
