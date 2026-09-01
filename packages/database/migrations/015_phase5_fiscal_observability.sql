alter table branches
  add column seller_ntn_cnic text,
  add column seller_strn text,
  add column fbr_pos_registration_number text,
  add column fbr_business_name text,
  add column fbr_province text,
  add column fbr_scenario_id text;

alter table branches
  add constraint branches_seller_ntn_cnic_format
    check (seller_ntn_cnic is null or seller_ntn_cnic ~ '^[0-9]{7}([0-9]{2}|[0-9]{6})?$'),
  add constraint branches_seller_strn_not_blank
    check (seller_strn is null or btrim(seller_strn) <> ''),
  add constraint branches_fbr_pos_registration_not_blank
    check (fbr_pos_registration_number is null or btrim(fbr_pos_registration_number) <> ''),
  add constraint branches_fbr_business_name_not_blank
    check (fbr_business_name is null or btrim(fbr_business_name) <> ''),
  add constraint branches_fbr_province_not_blank
    check (fbr_province is null or btrim(fbr_province) <> ''),
  add constraint branches_fbr_scenario_id_format
    check (fbr_scenario_id is null or fbr_scenario_id ~ '^SN[0-9]{3}$');

alter table medicines
  add column hs_code text,
  add column tax_rate numeric(5, 2) not null default 0,
  add column fbr_uom text not null default 'Numbers, pieces, units',
  add column fbr_sale_type text not null default 'Goods at standard rate (default)';

alter table medicines
  add constraint medicines_hs_code_format
    check (hs_code is null or hs_code ~ '^[0-9]{4}\.[0-9]{4}$'),
  add constraint medicines_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  add constraint medicines_fbr_uom_not_blank check (btrim(fbr_uom) <> ''),
  add constraint medicines_fbr_sale_type_not_blank check (btrim(fbr_sale_type) <> '');

alter table sale_items
  add column tax_rate numeric(5, 2) not null default 0,
  add column hs_code text,
  add column fbr_uom text not null default 'Numbers, pieces, units',
  add column fbr_sale_type text not null default 'Goods at standard rate (default)';

alter table sale_items
  add constraint sale_items_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  add constraint sale_items_hs_code_format
    check (hs_code is null or hs_code ~ '^[0-9]{4}\.[0-9]{4}$'),
  add constraint sale_items_fbr_uom_not_blank check (btrim(fbr_uom) <> ''),
  add constraint sale_items_fbr_sale_type_not_blank check (btrim(fbr_sale_type) <> '');

-- Counter prices are tax-inclusive. Tax is an audited component of the amount paid,
-- not an amount added again to the retail price.
do $$
declare
  legacy_total_constraint text;
begin
  select constraints.conname into legacy_total_constraint
  from pg_constraint constraints
  join pg_class relations on relations.oid = constraints.conrelid
  where relations.oid = 'sales'::regclass and constraints.contype = 'c'
    and pg_get_constraintdef(constraints.oid) like '%subtotal%'
    and pg_get_constraintdef(constraints.oid) like '%discount_total%'
    and pg_get_constraintdef(constraints.oid) like '%tax_total%';
  if legacy_total_constraint is null then
    raise exception 'legacy sales tax-exclusive total constraint was not found';
  end if;
  execute format('alter table sales drop constraint %I', legacy_total_constraint);
end;
$$;
alter table sales
  add constraint sales_tax_inclusive_total_check
    check (total >= 0 and total = subtotal - discount_total),
  add constraint sales_tax_within_total_check check (tax_total <= total);

alter table sale_items drop constraint sale_items_exact_line_total_check;
alter table sale_items
  add constraint sale_items_tax_inclusive_line_total_check
    check (line_total = round(quantity * unit_price - discount_amount, 2)),
  add constraint sale_items_tax_within_line_total_check check (tax_amount <= line_total);

create index medicines_active_lower_name_idx
  on medicines (lower(name)) where deleted_at is null and is_active;
create index medicines_active_name_search_gist_idx
  on medicines using gist (name gist_trgm_ops) where deleted_at is null and is_active;
create index medicines_active_generic_search_gist_idx
  on medicines using gist (generic_name gist_trgm_ops)
  where deleted_at is null and is_active and generic_name is not null;
create index medicine_aliases_search_gist_idx
  on medicine_aliases using gist (alias gist_trgm_ops);

alter table fbr_invoice_attempts
  add column operation text not null default 'SUBMIT',
  add column duration_ms integer,
  add column correlation_id text;

alter table fbr_invoice_attempts
  add constraint fbr_invoice_attempts_operation_check
    check (operation in ('VALIDATE', 'SUBMIT', 'REFERENCE_DATA')),
  add constraint fbr_invoice_attempts_duration_check
    check (duration_ms is null or duration_ms >= 0),
  add constraint fbr_invoice_attempts_http_status_check
    check (http_status is null or http_status between 100 and 599);

alter table sessions add column permission_snapshot text[] not null default '{}';

update sessions
set permission_snapshot = permissions.codes
from (
  select sessions.id,
    coalesce(array_agg(distinct permissions.code order by permissions.code)
      filter (where permissions.code is not null), '{}') as codes
  from sessions
  left join user_branch_roles on user_branch_roles.user_id = sessions.user_id
    and user_branch_roles.branch_id = sessions.branch_id
  left join role_permissions on role_permissions.role_id = user_branch_roles.role_id
  left join permissions on permissions.id = role_permissions.permission_id
  group by sessions.id
) permissions
where sessions.id = permissions.id;

create function set_session_permission_snapshot() returns trigger language plpgsql as $$
begin
  if cardinality(new.permission_snapshot) = 0 then
    select coalesce(array_agg(distinct permissions.code order by permissions.code)
      filter (where permissions.code is not null), '{}')
    into new.permission_snapshot
    from user_branch_roles
    left join role_permissions on role_permissions.role_id = user_branch_roles.role_id
    left join permissions on permissions.id = role_permissions.permission_id
    where user_branch_roles.user_id = new.user_id
      and user_branch_roles.branch_id = new.branch_id;
  end if;
  return new;
end;
$$;
create trigger sessions_permission_snapshot before insert on sessions
for each row execute function set_session_permission_snapshot();

create function revoke_sessions_for_user_branch_role_change() returns trigger
language plpgsql as $$
begin
  update sessions
  set revoked_at = now(), revoke_reason = 'ROLE_ASSIGNMENT_CHANGED'
  where user_id = coalesce(new.user_id, old.user_id)
    and branch_id = coalesce(new.branch_id, old.branch_id)
    and revoked_at is null;
  return coalesce(new, old);
end;
$$;

create trigger user_branch_roles_revoke_sessions
after insert or update or delete on user_branch_roles
for each row execute function revoke_sessions_for_user_branch_role_change();

create function revoke_sessions_for_role_permission_change() returns trigger
language plpgsql as $$
begin
  update sessions
  set revoked_at = now(), revoke_reason = 'ROLE_PERMISSION_CHANGED'
  where revoked_at is null
    and exists (
      select 1 from user_branch_roles
      where user_branch_roles.user_id = sessions.user_id
        and user_branch_roles.branch_id = sessions.branch_id
        and user_branch_roles.role_id = coalesce(new.role_id, old.role_id)
    );
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_revoke_sessions
after insert or update or delete on role_permissions
for each row execute function revoke_sessions_for_role_permission_change();

create table operational_alerts (
  id bigint generated always as identity primary key,
  branch_id bigint references branches(id) on delete restrict,
  alert_type text not null check (alert_type in (
    'FAILED_JOB', 'FAILED_FISCAL_SUBMISSION', 'CASH_VARIANCE', 'BACKUP_RESTORE_FAILURE'
  )),
  severity text not null check (severity in ('WARNING', 'CRITICAL')),
  deduplication_key text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id bigint references users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (alert_type, deduplication_key),
  check (jsonb_typeof(details) = 'object'),
  check (status <> 'ACKNOWLEDGED' or acknowledged_at is not null),
  check (status <> 'RESOLVED' or resolved_at is not null)
);
create index operational_alerts_open_idx
  on operational_alerts (branch_id, severity, last_observed_at desc)
  where status in ('OPEN', 'ACKNOWLEDGED');
create index operational_alerts_acknowledged_by_idx
  on operational_alerts (acknowledged_by_user_id)
  where acknowledged_by_user_id is not null;
create trigger operational_alerts_updated_at before update on operational_alerts
for each row execute function set_updated_at();

create function open_operational_alert(
  target_branch_id bigint,
  target_type text,
  target_severity text,
  target_key text,
  target_title text,
  target_details jsonb
) returns void language sql as $$
  insert into operational_alerts (
    branch_id, alert_type, severity, deduplication_key, title, details
  ) values (
    target_branch_id, target_type, target_severity, target_key, target_title, target_details
  )
  on conflict (alert_type, deduplication_key) do update
  set branch_id = excluded.branch_id,
      severity = excluded.severity,
      title = excluded.title,
      details = excluded.details,
      last_observed_at = now(),
      status = case
        when operational_alerts.status = 'RESOLVED' then 'OPEN'
        else operational_alerts.status
      end,
      acknowledged_at = case
        when operational_alerts.status = 'RESOLVED' then null
        else operational_alerts.acknowledged_at
      end,
      acknowledged_by_user_id = case
        when operational_alerts.status = 'RESOLVED' then null
        else operational_alerts.acknowledged_by_user_id
      end,
      resolved_at = null;
$$;

create function observe_outbox_alert() returns trigger language plpgsql as $$
declare
  alert_branch_id bigint;
begin
  if new.status = 'FAILED' then
    alert_branch_id := case
      when new.payload ? 'branchId' and (new.payload->>'branchId') ~ '^[0-9]+$'
      then (new.payload->>'branchId')::bigint
      else null
    end;
    perform open_operational_alert(
      alert_branch_id, 'FAILED_JOB', 'CRITICAL', 'outbox-job:' || new.id,
      'Background job failed',
      jsonb_build_object('jobId', new.id::text, 'jobType', new.job_type,
        'attempts', new.attempts, 'lastError', new.last_error)
    );
  elsif old.status = 'FAILED' and new.status <> 'FAILED' then
    update operational_alerts
    set status = 'RESOLVED', resolved_at = now()
    where alert_type = 'FAILED_JOB' and deduplication_key = 'outbox-job:' || new.id
      and status <> 'RESOLVED';
  end if;
  return new;
end;
$$;
create trigger outbox_jobs_operational_alert
after update of status on outbox_jobs
for each row when (old.status is distinct from new.status)
execute function observe_outbox_alert();

create function observe_fiscal_alert() returns trigger language plpgsql as $$
declare
  alert_branch_id bigint;
begin
  select sales.branch_id into alert_branch_id
  from sales where sales.id = new.sale_id;
  if new.status in ('FAILED_RETRYABLE', 'FAILED_NEEDS_REVIEW') then
    perform open_operational_alert(
      alert_branch_id, 'FAILED_FISCAL_SUBMISSION',
      case when new.status = 'FAILED_NEEDS_REVIEW' then 'CRITICAL' else 'WARNING' end,
      'fbr-invoice:' || new.id, 'Fiscal invoice requires attention',
      jsonb_build_object('fbrInvoiceId', new.id::text, 'saleId', new.sale_id::text,
        'status', new.status, 'errorCode', new.last_error_code,
        'errorMessage', new.last_error_message)
    );
  elsif new.status = 'SUBMITTED' then
    update operational_alerts
    set status = 'RESOLVED', resolved_at = now()
    where alert_type = 'FAILED_FISCAL_SUBMISSION'
      and deduplication_key = 'fbr-invoice:' || new.id and status <> 'RESOLVED';
  end if;
  return new;
end;
$$;
create trigger fbr_invoices_operational_alert
after update of status on fbr_invoices
for each row when (old.status is distinct from new.status)
execute function observe_fiscal_alert();

create function observe_cash_variance_alert() returns trigger language plpgsql as $$
begin
  if new.status = 'CLOSING' and new.variance is not null then
    perform open_operational_alert(
      new.branch_id, 'CASH_VARIANCE', 'WARNING', 'cash-session:' || new.id,
      'Cash variance requires approval',
      jsonb_build_object('cashSessionId', new.id::text, 'variance', new.variance::text,
        'cashierUserId', new.cashier_user_id::text)
    );
  elsif new.status in ('CLOSED', 'VARIANCE_APPROVED') then
    update operational_alerts
    set status = 'RESOLVED', resolved_at = now()
    where alert_type = 'CASH_VARIANCE'
      and deduplication_key = 'cash-session:' || new.id and status <> 'RESOLVED';
  end if;
  return new;
end;
$$;
create trigger cash_sessions_operational_alert
after update of status on cash_sessions
for each row when (old.status is distinct from new.status)
execute function observe_cash_variance_alert();

create function observe_backup_failure_alert() returns trigger language plpgsql as $$
begin
  if new.status = 'FAILED' then
    perform open_operational_alert(
      new.branch_id, 'BACKUP_RESTORE_FAILURE', 'CRITICAL', 'backup-run:' || new.id,
      case when new.backup_type = 'RESTORE_DRILL'
        then 'Restore drill failed' else 'Backup failed' end,
      jsonb_build_object('backupRunId', new.id::text, 'backupType', new.backup_type,
        'destination', new.destination, 'errorMessage', new.error_message)
    );
  end if;
  return new;
end;
$$;
create trigger backup_runs_operational_alert
after update of status on backup_runs
for each row when (old.status is distinct from new.status)
execute function observe_backup_failure_alert();
