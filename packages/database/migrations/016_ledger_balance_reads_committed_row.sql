-- The deferred ledger-balance check introduced in 009 compared the stock ledger with the
-- NEW row captured when each insert/update event fired. Because the trigger is deferred to
-- commit, a transaction that changes the same batch twice (insert then update, or two
-- updates) was checked against an intermediate quantity and rejected even though the final
-- state reconciled. The check must compare the ledger with the batch row as it stands at
-- commit time.
create or replace function enforce_inventory_batch_ledger_balance() returns trigger
language plpgsql as $$
declare
  v_current_quantity numeric(12, 3);
  v_latest_quantity numeric(12, 3);
begin
  select current_qty into v_current_quantity from inventory_batches where id = new.id;
  if not found then
    return null;
  end if;

  select quantity_after into v_latest_quantity
  from stock_movements
  where inventory_batch_id = new.id
  order by id desc limit 1;

  if coalesce(v_latest_quantity, 0) <> v_current_quantity then
    raise exception 'inventory batch quantity must reconcile to its stock movement ledger'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

-- The deferred price-history check has the same stale-row defect: two price changes to one
-- batch inside a transaction were compared against the first change, not the final price.
create or replace function enforce_inventory_batch_price_history() returns trigger
language plpgsql as $$
declare
  v_current_sale_price numeric(12, 2);
  v_current_mrp numeric(12, 2);
  v_sale_price numeric(12, 2);
  v_mrp numeric(12, 2);
begin
  select sale_price, maximum_retail_price into v_current_sale_price, v_current_mrp
  from inventory_batches where id = new.id;
  if not found then
    return null;
  end if;
  if (old.sale_price, old.maximum_retail_price) is not distinct from
      (v_current_sale_price, v_current_mrp) then
    return null;
  end if;
  select new_sale_price, new_maximum_retail_price into v_sale_price, v_mrp
  from inventory_batch_price_history where inventory_batch_id = new.id
  order by id desc limit 1;
  if v_sale_price is distinct from v_current_sale_price
      or v_mrp is distinct from v_current_mrp then
    raise exception 'inventory price change requires a matching history row'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
