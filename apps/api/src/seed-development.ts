import { hash } from 'argon2';
import { createDatabase } from '@pharmacy/database';

const allowSeed = process.env.ALLOW_DEVELOPMENT_SEED === 'true';
const environmentName = process.env.NODE_ENV ?? 'development';
const password = process.env.DEVELOPMENT_SEED_PASSWORD;
const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const medicineCount = Number.parseInt(process.env.DEVELOPMENT_MEDICINE_COUNT ?? '500', 10);

if (environmentName === 'production' || !allowSeed) {
  throw new Error(
    'Development seed refused. Set NODE_ENV=development and ALLOW_DEVELOPMENT_SEED=true explicitly.',
  );
}
if (!connectionString) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');
if (!password || password.length < 12) {
  throw new Error('DEVELOPMENT_SEED_PASSWORD must contain at least 12 characters');
}
if (!Number.isSafeInteger(medicineCount) || medicineCount < 100 || medicineCount > 10_000) {
  throw new Error('DEVELOPMENT_MEDICINE_COUNT must be an integer between 100 and 10000');
}

const database = createDatabase(connectionString, { max: 1 });

try {
  const passwordHash = await hash(password, {
    type: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
  await database.begin(async (transaction) => {
    const [branch] = await transaction<Array<{ id: string }>>`
      insert into branches (code, name, address, phone)
      values ('DEMO', 'PharmacyOS demonstration branch', 'Development environment only', '0000000000')
      on conflict (code) do update set name = excluded.name, is_active = true
      returning id::text
    `;
    if (!branch) throw new Error('Development branch seed failed');

    const terminals = await transaction<Array<{ id: string; code: string }>>`
      insert into terminals (branch_id, code, name, terminal_type)
      values
        (${branch.id}, 'COUNTER-01', 'Demo checkout counter', 'CASHIER'),
        (${branch.id}, 'ADMIN-01', 'Demo owner terminal', 'ADMIN'),
        (${branch.id}, 'STORE-01', 'Demo stock terminal', 'ADMIN')
      on conflict (branch_id, code) do update set name = excluded.name, is_active = true
      returning id::text, code
    `;
    const terminalByCode = new Map(terminals.map((terminal) => [terminal.code, terminal.id]));

    const userDefinitions = [
      ['demo-owner', 'Demo owner', 'OWNER'],
      ['demo-cashier', 'Demo cashier', 'CASHIER'],
      ['demo-inventory', 'Demo inventory manager', 'INVENTORY_MANAGER'],
      ['demo-supervisor', 'Demo pharmacist supervisor', 'SUPERVISOR'],
    ] as const;
    const userByUsername = new Map<string, string>();
    for (const [username, displayName, roleCode] of userDefinitions) {
      const [user] = await transaction<Array<{ id: string }>>`
        insert into users (username, display_name, password_hash)
        values (${username}, ${displayName}, ${passwordHash})
        on conflict (lower(username)) where deleted_at is null
        do update set display_name = excluded.display_name, password_hash = excluded.password_hash,
          is_active = true, failed_login_count = 0, locked_until = null
        returning id::text
      `;
      if (!user) throw new Error(`Development user seed failed for ${username}`);
      userByUsername.set(username, user.id);
      await transaction`
        insert into user_branch_roles (user_id, branch_id, role_id)
        select ${user.id}, ${branch.id}, roles.id from roles where roles.code = ${roleCode}
        on conflict do nothing
      `;
    }

    const [manufacturer] = await transaction<Array<{ id: string }>>`
      insert into manufacturers (name) values ('Demo Pharma Industries')
      on conflict (lower(name)) where deleted_at is null do update set is_active = true
      returning id::text
    `;
    const [generic] = await transaction<Array<{ id: string }>>`
      insert into generics (name) values ('Demonstration generic')
      on conflict (lower(name)) where deleted_at is null do update set name = excluded.name
      returning id::text
    `;
    const [category] = await transaction<Array<{ id: string }>>`
      insert into categories (name) values ('Development catalogue')
      on conflict (lower(name)) where deleted_at is null do update set name = excluded.name
      returning id::text
    `;
    if (!manufacturer || !generic || !category) throw new Error('Reference catalogue seed failed');

    await transaction`
      insert into shelves (
        branch_id, code, name, rack, bin, row_label, pick_priority, storage_class,
        is_secured, is_pick_location
      )
      select ${branch.id}, 'D-' || lpad(series::text, 2, '0'),
        'Demo shelf ' || lpad(series::text, 2, '0'),
        'R' || ceil(series / 5.0)::int, 'B' || (((series - 1) % 5) + 1),
        chr(64 + ceil(series / 5.0)::int), series * 10, 'AMBIENT', false, true
      from generate_series(1, 20) series
      on conflict (branch_id, code) do update set name = excluded.name, is_active = true
    `;

    await transaction`
      insert into suppliers (branch_id, code, name, phone, lead_time_days)
      select ${branch.id}, 'DEMO-S' || lpad(series::text, 2, '0'),
        'Demo supplier ' || lpad(series::text, 2, '0'), '0300000' || lpad(series::text, 3, '0'),
        1 + (series % 7)
      from generate_series(1, 10) series
      on conflict (branch_id, code) where code is not null and deleted_at is null
      do update set name = excluded.name, lead_time_days = excluded.lead_time_days, is_active = true
    `;

    await transaction`
      insert into medicines (
        generic_id, manufacturer_id, category_id, sku, name, generic_name, strength,
        dosage_form, pack_size, unit_name, requires_prescription
      )
      select ${generic.id}, ${manufacturer.id}, ${category.id},
        'DEV-' || lpad(series::text, 5, '0'),
        'Development medicine ' || lpad(series::text, 5, '0'),
        'Demonstration generic ' || (((series - 1) % 25) + 1),
        (50 + ((series - 1) % 10) * 50)::text || ' mg',
        case when series % 4 = 0 then 'capsule' else 'tablet' end,
        case when series % 3 = 0 then 20 else 10 end, 'tablet', series % 8 = 0
      from generate_series(1, ${medicineCount}) series
      on conflict (sku) where sku is not null and deleted_at is null
      do update set name = excluded.name, is_active = true
    `;

    await transaction`
      insert into medicine_barcodes (medicine_id, barcode, is_primary)
      select medicines.id, '920000' || lpad(substring(medicines.sku from 5), 7, '0'), true
      from medicines where medicines.sku like 'DEV-%' and medicines.deleted_at is null
      on conflict (barcode) do update set is_primary = true
    `;
    await transaction`
      insert into medicine_shelf_locations (medicine_id, shelf_id, is_primary, location_type)
      select medicines.id, shelves.id, true, 'PRIMARY_PICK'
      from medicines
      join shelves on shelves.branch_id = ${branch.id}
        and shelves.code = 'D-' || lpad((((substring(medicines.sku from 5)::int - 1) % 20) + 1)::text, 2, '0')
      where medicines.sku like 'DEV-%' and medicines.deleted_at is null
      on conflict (medicine_id, shelf_id) do update set is_primary = true
    `;

    await transaction`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date, received_at, cost_price,
        sale_price, current_qty, status
      )
      select ${branch.id}, medicines.id, 'DEV-B-' || substring(medicines.sku from 5),
        current_date + (((substring(medicines.sku from 5)::int - 1) % 360) - 15),
        now() - interval '60 days',
        (25 + ((substring(medicines.sku from 5)::int - 1) % 200))::numeric(12, 2),
        (35 + ((substring(medicines.sku from 5)::int - 1) % 250))::numeric(12, 2),
        case when substring(medicines.sku from 5)::int <= 90 then 49 else 50 end,
        'SELLABLE'
      from medicines where medicines.sku like 'DEV-%' and medicines.deleted_at is null
      on conflict on constraint inventory_batches_acquisition_lot_key
      do update set cost_price = excluded.cost_price, sale_price = excluded.sale_price,
        current_qty = excluded.current_qty, status = excluded.status, deleted_at = null
    `;

    await transaction`
      insert into reorder_policies (
        branch_id, medicine_id, preferred_supplier_id, lead_time_days, safety_days,
        minimum_stock, pack_size, is_active
      )
      select ${branch.id}, medicines.id, suppliers.id, suppliers.lead_time_days, 3, 10,
        medicines.pack_size, true
      from medicines
      join suppliers on suppliers.branch_id = ${branch.id}
        and suppliers.code = 'DEMO-S' || lpad((((substring(medicines.sku from 5)::int - 1) % 10) + 1)::text, 2, '0')
      where medicines.sku like 'DEV-%' and medicines.deleted_at is null
      on conflict (branch_id, medicine_id) do update set
        preferred_supplier_id = excluded.preferred_supplier_id,
        lead_time_days = excluded.lead_time_days, is_active = true
    `;
    await transaction`
      insert into operational_intelligence_policies (branch_id, cash_variance_approval_threshold)
      values (${branch.id}, 100)
      on conflict (branch_id) do update set cash_variance_approval_threshold = excluded.cash_variance_approval_threshold
    `;

    await transaction`
      insert into sales_velocity_daily (
        branch_id, medicine_id, sales_date, quantity_sold, net_sales
      )
      select ${branch.id}, medicines.id, current_date - days.day,
        (1 + ((substring(medicines.sku from 5)::int + days.day) % 8))::numeric(12, 3),
        ((1 + ((substring(medicines.sku from 5)::int + days.day) % 8)) * batches.sale_price)::numeric(12, 2)
      from medicines
      join inventory_batches batches on batches.branch_id = ${branch.id}
        and batches.medicine_id = medicines.id and batches.batch_number like 'DEV-B-%'
      cross join generate_series(0, 89) days(day)
      where medicines.sku between 'DEV-00001' and 'DEV-00100'
      on conflict (branch_id, medicine_id, sales_date) do update set
        quantity_sold = excluded.quantity_sold, net_sales = excluded.net_sales,
        updated_at = now()
    `;

    const cashierId = userByUsername.get('demo-cashier');
    const cashierTerminalId = terminalByCode.get('COUNTER-01');
    if (!cashierId || !cashierTerminalId) throw new Error('Cashier fixture references are missing');
    const [historyExists] = await transaction<Array<{ exists: boolean }>>`
      select exists(
        select 1 from sales where branch_id = ${branch.id}
          and client_request_id = 'development-history-001'
      ) as exists
    `;
    if (!historyExists?.exists) {
      const [cashSession] = await transaction<Array<{ id: string }>>`
        insert into cash_sessions (
          branch_id, terminal_id, cashier_user_id, status, opening_float, expected_cash,
          counted_cash, variance, opened_at, closed_at, open_client_request_id,
          close_client_request_id
        ) values (
          ${branch.id}, ${cashierTerminalId}, ${cashierId}, 'CLOSED', 5000, 5000, 5000, 0,
          now() - interval '91 days', now() - interval '1 day',
          'development-history-open', 'development-history-close'
        ) returning id::text
      `;
      if (!cashSession) throw new Error('Historical cash session fixture failed');
      const saleSources = await transaction<
        Array<{ medicine_id: string; batch_id: string; sale_price: string; unit_cost: string }>
      >`
        select medicines.id::text as medicine_id, batches.id::text as batch_id,
          batches.sale_price::text, batches.cost_price::text as unit_cost
        from medicines join inventory_batches batches on batches.medicine_id = medicines.id
          and batches.branch_id = ${branch.id} and batches.batch_number like 'DEV-B-%'
        where medicines.sku between 'DEV-00001' and 'DEV-00090'
        order by medicines.sku
      `;
      for (const [index, source] of saleSources.entries()) {
        const sequence = index + 1;
        const occurredAt = new Date(Date.now() - (90 - index) * 86_400_000);
        const requestId = `development-history-${sequence.toString().padStart(3, '0')}`;
        const [draft] = await transaction<Array<{ id: string }>>`
          insert into sale_drafts (
            branch_id, terminal_id, salesperson_user_id, status, subtotal, discount_total,
            total, sent_at, created_at, updated_at
          ) values (
            ${branch.id}, ${cashierTerminalId}, ${cashierId}, 'PAID', ${source.sale_price}, 0,
            ${source.sale_price}, ${occurredAt}, ${occurredAt}, ${occurredAt}
          ) returning id::text
        `;
        if (!draft) throw new Error('Historical draft fixture failed');
        const [draftItem] = await transaction<Array<{ id: string }>>`
          insert into sale_draft_items (
            sale_draft_id, medicine_id, quantity, unit_price, discount_amount, line_total,
            created_at, updated_at
          ) values (
            ${draft.id}, ${source.medicine_id}, 1, ${source.sale_price}, 0, ${source.sale_price},
            ${occurredAt}, ${occurredAt}
          ) returning id::text
        `;
        if (!draftItem) throw new Error('Historical draft-item fixture failed');
        const [sale] = await transaction<Array<{ id: string }>>`
          insert into sales (
            branch_id, terminal_id, cashier_user_id, cash_session_id, sale_draft_id,
            invoice_number, client_request_id, status, subtotal, discount_total, tax_total,
            total, created_at, updated_at
          ) values (
            ${branch.id}, ${cashierTerminalId}, ${cashierId}, ${cashSession.id}, ${draft.id},
            ${`DEMO-${sequence.toString().padStart(6, '0')}`}, ${requestId}, 'PAID',
            ${source.sale_price}, 0, 0, ${source.sale_price}, ${occurredAt}, ${occurredAt}
          ) returning id::text
        `;
        if (!sale) throw new Error('Historical sale fixture failed');
        const [saleItem] = await transaction<Array<{ id: string }>>`
          insert into sale_items (
            sale_id, medicine_id, inventory_batch_id, quantity, unit_price, unit_cost,
            discount_amount, tax_amount, line_total, created_at
          ) values (
            ${sale.id}, ${source.medicine_id}, ${source.batch_id}, 1, ${source.sale_price},
            ${source.unit_cost}, 0, 0, ${source.sale_price}, ${occurredAt}
          ) returning id::text
        `;
        if (!saleItem) throw new Error('Historical sale-item fixture failed');
        await transaction`
          insert into payments (sale_id, cash_session_id, method, amount, created_at)
          values (${sale.id}, ${cashSession.id}, 'CASH', ${source.sale_price}, ${occurredAt})
        `;
        await transaction`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after,
            sale_item_id, performed_by_user_id, reason, created_at
          ) values (
            ${branch.id}, ${source.batch_id}, 'SALE', -1, 49, ${saleItem.id}, ${cashierId},
            'Development history fixture', ${occurredAt}
          )
        `;
        await transaction`insert into return_lookup_tokens (sale_id) values (${sale.id})`;
        await transaction`
          insert into fbr_invoices (sale_id, mode, status, payload, created_at, updated_at)
          values (
            ${sale.id}, 'DISABLED', 'NOT_REQUIRED',
            ${transaction.json({ fixture: true, invoiceNumber: `DEMO-${sequence.toString().padStart(6, '0')}` })},
            ${occurredAt}, ${occurredAt}
          )
        `;
      }
      await transaction`
        update cash_sessions set
          expected_cash = opening_float + (
            select coalesce(sum(amount), 0) from payments
            where payments.cash_session_id = cash_sessions.id and method = 'CASH'
          ),
          counted_cash = opening_float + (
            select coalesce(sum(amount), 0) from payments
            where payments.cash_session_id = cash_sessions.id and method = 'CASH'
          ),
          variance = 0
        where id = ${cashSession.id}
      `;
    }

    await transaction`
      insert into audit_events (branch_id, user_id, terminal_id, event_type, metadata)
      values (
        ${branch.id}, ${userByUsername.get('demo-owner') ?? null},
        ${terminalByCode.get('ADMIN-01') ?? null}, 'SYSTEM.DEVELOPMENT_FIXTURES_SEEDED',
        ${transaction.json({ medicineCount, historicalSales: 90 })}
      )
    `;
  });
  process.stdout.write(
    `Development fixtures ready: ${medicineCount} medicines, 4 users, 3 terminals, 90 historical sales.\n`,
  );
} finally {
  await database.end();
}
