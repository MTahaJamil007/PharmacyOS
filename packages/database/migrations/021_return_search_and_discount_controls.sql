alter table operational_intelligence_policies
  add column order_taker_discount_enabled boolean not null default false,
  add column cashier_discount_enabled boolean not null default false,
  add column allow_invoice_less_returns boolean not null default false;

insert into role_permissions (role_id, permission_id)
select roles.id, permissions.id
from roles cross join permissions
where roles.code = 'SALESPERSON' and permissions.code = 'returns.lookup'
on conflict do nothing;

delete from role_permissions
using roles, permissions
where role_permissions.role_id = roles.id
  and role_permissions.permission_id = permissions.id
  and roles.code = 'CASHIER' and permissions.code = 'sale.discount.basic';

-- A salesperson may make a basic discount only when the owner has enabled the branch control.
-- The existing percentage limit still applies, and larger discounts need override authority.
create or replace function enforce_discount_approval_authority() returns trigger language plpgsql as $$
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
  ) and not (
    new.approval_level = 'BASIC'
    and new.approved_by_user_id = new.requested_by_user_id
    and exists (
      select 1 from operational_intelligence_policies
      where branch_id = new.branch_id
        and (order_taker_discount_enabled or cashier_discount_enabled)
    )
  ) then
    raise exception 'discount approver lacks the required branch permission'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
