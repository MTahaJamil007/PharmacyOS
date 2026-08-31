-- Acquisition cost can be smaller than one paisa per base unit. Retail money remains two decimals.
alter table purchase_order_items alter column unit_cost type numeric(20, 8);
alter table inventory_batches alter column cost_price type numeric(20, 8);
alter table goods_receipt_items
  alter column effective_cost_per_base_unit type numeric(20, 8);
alter table sale_items alter column unit_cost type numeric(20, 8);

alter table sale_draft_items
  add constraint sale_draft_items_exact_line_total_check check (
    line_total = round(quantity * unit_price - discount_amount, 2)
  );
alter table sale_items
  add constraint sale_items_exact_line_total_check check (
    line_total = round(quantity * unit_price - discount_amount + tax_amount, 2)
  );

do $$
begin
  if exists (
    select 1
    from sales
    left join lateral (
      select count(*) as line_count, coalesce(sum(line_total), 0) as line_subtotal
      from sale_items where sale_items.sale_id = sales.id
    ) lines on true
    where lines.line_count = 0 or sales.subtotal <> lines.line_subtotal
  ) then
    raise exception 'existing sale subtotal does not equal the sum of its line totals'
      using errcode = '23514';
  end if;
end
$$;

create function enforce_sale_subtotal_from_lines() returns trigger language plpgsql as $$
declare
  v_line_count bigint;
  v_line_subtotal numeric(12, 2);
begin
  select count(*), coalesce(sum(line_total), 0)
    into v_line_count, v_line_subtotal
  from sale_items where sale_id = new.id;

  if v_line_count = 0 or new.subtotal <> v_line_subtotal then
    raise exception 'sale subtotal must equal the sum of its line totals'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger sales_line_subtotal
after insert or update of subtotal on sales
deferrable initially deferred
for each row execute function enforce_sale_subtotal_from_lines();

create function enforce_sale_item_parent_subtotal() returns trigger language plpgsql as $$
declare
  v_line_subtotal numeric(12, 2);
  v_sale_subtotal numeric(12, 2);
begin
  select subtotal into strict v_sale_subtotal from sales where id = new.sale_id;
  select coalesce(sum(line_total), 0) into v_line_subtotal
  from sale_items where sale_id = new.sale_id;

  if v_sale_subtotal <> v_line_subtotal then
    raise exception 'sale line totals must reconcile to the sale subtotal'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger sale_items_parent_subtotal
after insert on sale_items
deferrable initially deferred
for each row execute function enforce_sale_item_parent_subtotal();

create trigger sale_items_append_only before update or delete on sale_items
for each row execute function prevent_append_only_mutation();
