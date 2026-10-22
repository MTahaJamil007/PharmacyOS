-- Software owner (super admin), shop profile printed on invoices, per-shop FBR switches, and the
-- shop owner's invoice layout.

insert into permissions (code, description)
values (
  'platform.super_admin',
  'Software owner: shop profiles and FBR registration, live FBR approval, every account'
)
on conflict (code) do nothing;

insert into roles (code, name, description)
values (
  'SUPER_ADMIN', 'Super admin (software owner)',
  'Owns the software installation. Can control every shop, account, and setting.'
)
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select roles.id, permissions.id
from roles cross join permissions
where roles.code = 'SUPER_ADMIN'
on conflict do nothing;

-- The shop owner keeps every operational permission but never the platform one.
delete from role_permissions
where permission_id = (select id from permissions where code = 'platform.super_admin')
  and role_id in (select id from roles where code <> 'SUPER_ADMIN');

alter table branches
  add column email text,
  add column drug_license_number text,
  add column fbr_invoicing_enabled boolean not null default false,
  add column fbr_invoicing_changed_at timestamptz,
  add column fbr_invoicing_changed_by bigint references users(id) on delete restrict,
  add column fbr_transmission_approved boolean not null default false,
  add column fbr_transmission_approved_at timestamptz,
  add column fbr_transmission_approved_by bigint references users(id) on delete restrict,
  add column invoice_layout jsonb not null default '{}'::jsonb,
  add column invoice_layout_updated_at timestamptz,
  add column invoice_layout_updated_by bigint references users(id) on delete restrict;

alter table branches
  add constraint branches_email_format
    check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint branches_drug_license_not_blank
    check (drug_license_number is null or btrim(drug_license_number) <> ''),
  add constraint branches_invoice_layout_object
    check (jsonb_typeof(invoice_layout) = 'object'),
  add constraint branches_fbr_approval_recorded
    check (not fbr_transmission_approved or fbr_transmission_approved_at is not null);

create index branches_fbr_invoicing_changed_by_idx on branches (fbr_invoicing_changed_by);
create index branches_fbr_transmission_approved_by_idx on branches (fbr_transmission_approved_by);
create index branches_invoice_layout_updated_by_idx on branches (invoice_layout_updated_by);
