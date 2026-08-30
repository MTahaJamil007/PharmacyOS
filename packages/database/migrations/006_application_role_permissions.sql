do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pharmacy_app') then
    grant usage on schema public to pharmacy_app;
    grant select, insert, update, delete on all tables in schema public to pharmacy_app;
    grant usage, select, update on all sequences in schema public to pharmacy_app;
    grant execute on function claim_outbox_job(text) to pharmacy_app;
    grant execute on function next_invoice_number(bigint) to pharmacy_app;
  end if;
end
$$;
