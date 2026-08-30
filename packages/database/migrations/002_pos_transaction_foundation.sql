create table invoice_counters (
  branch_id bigint not null references branches(id) on delete restrict,
  business_date date not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, business_date)
);

create index invoice_counters_business_date_idx on invoice_counters (business_date);

create function next_invoice_number(p_branch_id bigint) returns text language plpgsql as $$
declare
  v_branch_code text;
  v_business_date date := (now() at time zone 'Asia/Karachi')::date;
  v_next bigint;
begin
  select code into strict v_branch_code from branches where id = p_branch_id and is_active = true;

  insert into invoice_counters (branch_id, business_date, last_value)
  values (p_branch_id, v_business_date, 1)
  on conflict (branch_id, business_date)
  do update set last_value = invoice_counters.last_value + 1, updated_at = now()
  returning last_value into v_next;

  return concat(v_branch_code, '-', to_char(v_business_date, 'YYYYMMDD'), '-', lpad(v_next::text, 6, '0'));
end;
$$;

revoke all on function next_invoice_number(bigint) from public;
revoke all on function claim_outbox_job(text) from public;
