alter table payments
  add column tendered_amount numeric(12, 2),
  add column change_amount numeric(12, 2);

alter table payments
  add constraint payments_tendered_change_check check (
    (
      method = 'CASH'
      and (
        (tendered_amount is null and change_amount is null)
        or (
          tendered_amount >= amount
          and change_amount = tendered_amount - amount
        )
      )
    )
    or (
      method <> 'CASH'
      and tendered_amount is null
      and change_amount is null
    )
  );
