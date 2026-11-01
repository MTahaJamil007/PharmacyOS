alter table operational_intelligence_policies
  add column discount_reason_required boolean not null default true;

alter table discount_approvals
  drop constraint discount_approvals_reason_check,
  add constraint discount_approvals_reason_check
    check (length(btrim(reason)) between 0 and 500);
