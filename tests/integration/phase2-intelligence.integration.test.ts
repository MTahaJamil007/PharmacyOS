import type { Environment } from '@pharmacy/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BudgetRegimenService } from '../../apps/api/src/budget-regimen/budget-regimen.service.js';
import { CatalogService } from '../../apps/api/src/catalog/catalog.service.js';
import { IntelligenceService } from '../../apps/api/src/intelligence/intelligence.service.js';
import { PosService } from '../../apps/api/src/pos/pos.service.js';
import type { AuthenticatedUser } from '../../apps/api/src/auth/auth.types.js';
import { DurableWorker } from '../../apps/worker/src/worker.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

interface WorkerSubject {
  refreshExpiryRisk(branchId: string): Promise<Record<string, unknown>>;
  refreshReorderSuggestions(branchId: string): Promise<Record<string, unknown>>;
  refreshShelfRecommendations(branchId: string): Promise<Record<string, unknown>>;
}

interface Fixture {
  readonly branchId: string;
  readonly terminalId: string;
  readonly user: AuthenticatedUser;
}

const workerEnvironment = {
  FBR_MODE: 'DISABLED',
  WORKER_HEALTH_FILE: '',
  WORKER_ID: 'phase2-p0-worker',
} as Environment;

async function seedIdentity(database: IsolatedDatabase): Promise<Fixture> {
  const [branch] = await database.admin<{ id: string }[]>`
    insert into branches (code, name) values ('P0-INTEL', 'P0 Intelligence') returning id::text
  `;
  const [user] = await database.admin<{ id: string }[]>`
    insert into users (username, display_name, password_hash)
    values ('p0-intelligence-user', 'P0 Intelligence User', 'not-used') returning id::text
  `;
  if (!branch || !user) throw new Error('Failed to create P0 identity fixture');
  const [terminal] = await database.admin<{ id: string }[]>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branch.id}, 'P0-ADMIN', 'P0 Admin', 'ADMIN') returning id::text
  `;
  if (!terminal) throw new Error('Failed to create P0 terminal fixture');
  await database.admin`
    insert into operational_intelligence_policies (
      branch_id, shelf_minimum_picks, shelf_minimum_rank_improvement
    ) values (${branch.id}, 1, 1)
  `;
  return {
    branchId: branch.id,
    terminalId: terminal.id,
    user: {
      branchId: branch.id,
      displayName: 'P0 Intelligence User',
      id: user.id,
      permissions: [],
      sessionId: 'phase2-p0-session',
      terminalId: terminal.id,
      username: 'p0-intelligence-user',
    },
  };
}

async function createMedicine(
  database: IsolatedDatabase,
  name: string,
  storageClass = 'AMBIENT',
  requiresSecuredStorage = false,
): Promise<string> {
  const [medicine] = await database.admin<{ id: string }[]>`
    insert into medicines (
      name, pack_size, unit_name, storage_class, requires_secured_storage
    ) values (${name}, 1, 'unit', ${storageClass}, ${requiresSecuredStorage})
    returning id::text
  `;
  if (!medicine) throw new Error(`Failed to create medicine ${name}`);
  return medicine.id;
}

async function createBatch(
  database: IsolatedDatabase,
  branchId: string,
  medicineId: string,
  batchNumber: string,
  expiryOffset: number,
  quantity = '5',
  cost = '2.34567800',
  price = '10.00',
): Promise<string> {
  return database.admin.begin(async (transaction) => {
    const [batch] = await transaction<{ id: string }[]>`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status
      ) values (
        ${branchId}, ${medicineId}, ${batchNumber},
        (now() at time zone (select timezone from branches where id = ${branchId}))::date
          + ${expiryOffset}::integer,
        ${cost}, ${price}, ${quantity}, 'SELLABLE'
      ) returning id::text
    `;
    if (!batch) throw new Error(`Failed to create batch ${batchNumber}`);
    await transaction`
      insert into stock_movements (
        branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
      ) values (
        ${branchId}, ${batch.id}, 'ADJUSTMENT_IN', ${quantity}, ${quantity}, 'P0 fixture'
      )
    `;
    return batch.id;
  });
}

describe('Phase 2 P0 operational-intelligence boundaries', () => {
  let database: IsolatedDatabase;
  let fixture: Fixture;
  let worker: WorkerSubject;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase2_p0_intelligence');
    fixture = await seedIdentity(database);
    worker = new DurableWorker(database.application, workerEnvironment) as unknown as WorkerSubject;
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('never generates or applies an unsafe shelf recommendation', async () => {
    const coldMedicineId = await createMedicine(database, 'P0 Cold Medicine', 'COLD');
    const securedMedicineId = await createMedicine(
      database,
      'P0 Secured Medicine',
      'AMBIENT',
      true,
    );
    const coldBatchId = await createBatch(
      database,
      fixture.branchId,
      coldMedicineId,
      'P0-COLD',
      365,
    );
    const securedBatchId = await createBatch(
      database,
      fixture.branchId,
      securedMedicineId,
      'P0-SECURED',
      365,
    );
    const shelves = await database.admin<Array<{ code: string; id: string }>>`
      insert into shelves (
        branch_id, code, name, pick_priority, storage_class, is_secured, is_active
      ) values
        (${fixture.branchId}, 'COLD-CURRENT', 'Cold current', 100, 'COLD', false, true),
        (${fixture.branchId}, 'COLD-ELIGIBLE', 'Cold eligible', 2, 'COLD', false, true),
        (${fixture.branchId}, 'COLD-INACTIVE', 'Cold inactive', 1, 'COLD', false, false),
        (${fixture.branchId}, 'AMBIENT-UNSAFE', 'Ambient unsafe', 1, 'AMBIENT', false, true),
        (${fixture.branchId}, 'SECURE-CURRENT', 'Secure current', 100, 'AMBIENT', true, true),
        (${fixture.branchId}, 'SECURE-ELIGIBLE', 'Secure eligible', 2, 'AMBIENT', true, true)
      returning id::text, code
    `;
    const shelfId = (code: string): string => {
      const shelf = shelves.find((candidate) => candidate.code === code);
      if (!shelf) throw new Error(`Missing shelf fixture ${code}`);
      return shelf.id;
    };
    await database.admin`
      insert into medicine_shelf_locations (medicine_id, shelf_id, is_primary)
      values
        (${coldMedicineId}, ${shelfId('COLD-CURRENT')}, true),
        (${securedMedicineId}, ${shelfId('SECURE-CURRENT')}, true)
    `;
    await database.admin.begin(async (transaction) => {
      const [cashSession] = await transaction<{ id: string }[]>`
        insert into cash_sessions (branch_id, terminal_id, cashier_user_id, opening_float)
        values (${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, 0)
        returning id::text
      `;
      const [draft] = await transaction<{ id: string }[]>`
        insert into sale_drafts (
          branch_id, terminal_id, salesperson_user_id, status, subtotal, total
        ) values (${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, 'PAID', 20, 20)
        returning id::text
      `;
      if (!cashSession || !draft) throw new Error('Failed to create shelf sale fixture');
      const [sale] = await transaction<{ id: string }[]>`
        insert into sales (
          branch_id, terminal_id, cashier_user_id, cash_session_id, sale_draft_id,
          invoice_number, client_request_id, subtotal, total
        ) values (
          ${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, ${cashSession.id},
          ${draft.id}, 'P0-SHELF-000001', 'p0-shelf-sale', 20, 20
        ) returning id::text
      `;
      if (!sale) throw new Error('Failed to create shelf sale');
      await transaction`
        insert into sale_items (
          sale_id, medicine_id, inventory_batch_id, quantity, unit_price, unit_cost, line_total
        ) values
          (${sale.id}, ${coldMedicineId}, ${coldBatchId}, 1, 10, 2.345678, 10),
          (${sale.id}, ${securedMedicineId}, ${securedBatchId}, 1, 10, 2.345678, 10)
      `;
    });

    await worker.refreshShelfRecommendations(fixture.branchId);
    const recommendations = await database.admin<
      Array<{ id: string; medicine_id: string; suggested_shelf_id: string }>
    >`
      select id::text, medicine_id::text, suggested_shelf_id::text
      from shelf_recommendations where branch_id = ${fixture.branchId}
      order by medicine_id
    `;
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          medicine_id: coldMedicineId,
          suggested_shelf_id: shelfId('COLD-ELIGIBLE'),
        }),
        expect.objectContaining({
          medicine_id: securedMedicineId,
          suggested_shelf_id: shelfId('SECURE-ELIGIBLE'),
        }),
      ]),
    );
    expect(
      recommendations.some((row) =>
        [shelfId('COLD-INACTIVE'), shelfId('AMBIENT-UNSAFE')].includes(row.suggested_shelf_id),
      ),
    ).toBe(false);

    const coldRecommendation = recommendations.find((row) => row.medicine_id === coldMedicineId);
    if (!coldRecommendation) throw new Error('Missing cold recommendation');
    await database.admin`
      update shelves set is_active = false where id = ${coldRecommendation.suggested_shelf_id}
    `;
    const service = new IntelligenceService(database.application);
    await expect(
      service.reviewShelfRecommendation(fixture.user, BigInt(coldRecommendation.id), {
        decision: 'APPLY',
      }),
    ).rejects.toMatchObject({ message: 'Suggested shelf is no longer eligible for this medicine' });
    const [atomicEvidence] = await database.admin<
      Array<{ primary_shelf_id: string; status: string }>
    >`
      select recommendations.status, locations.shelf_id::text as primary_shelf_id
      from shelf_recommendations recommendations
      join medicine_shelf_locations locations
        on locations.medicine_id = recommendations.medicine_id and locations.is_primary
      where recommendations.id = ${coldRecommendation.id}
    `;
    expect(atomicEvidence).toEqual({
      primary_shelf_id: shelfId('COLD-CURRENT'),
      status: 'PENDING_REVIEW',
    });
  });

  it('uses branch-local expiry boundaries, acquisition cost, and excludes expired stock from sale', async () => {
    const [clock] = await database.admin<Array<{ branch_timezone: string }>>`
      select case
        when (now() at time zone 'Pacific/Kiritimati')::date <> current_date
          then 'Pacific/Kiritimati'
        else 'America/Adak'
      end as branch_timezone
    `;
    if (!clock) throw new Error('Failed to select boundary timezone');
    await database.admin`
      update branches set timezone = ${clock.branch_timezone} where id = ${fixture.branchId}
    `;
    const offsets = [-1, 0, 30, 31, 60, 61, 90] as const;
    const expectedBuckets = [
      'EXPIRED',
      'DAYS_0_30',
      'DAYS_0_30',
      'DAYS_31_60',
      'DAYS_31_60',
      'DAYS_61_90',
      'DAYS_61_90',
    ];
    const medicineIds: string[] = [];
    for (const offset of offsets) {
      const medicineId = await createMedicine(database, `P0 Expiry ${offset}`);
      medicineIds.push(medicineId);
      await createBatch(database, fixture.branchId, medicineId, `P0-EXPIRY-${offset}`, offset, '2');
    }

    const service = new IntelligenceService(database.application);
    const result = await service.listExpiryRisk(fixture.branchId, undefined, 100, 0);
    const rows = result.data.filter((row) => medicineIds.includes(String(row.medicine_id)));
    expect(rows.map((row) => row.risk_bucket)).toEqual(expectedBuckets);
    expect(rows.every((row) => row.value_at_risk === '4.69')).toBe(true);
    expect(result.costBasis).toBe('Batch acquisition cost');

    await worker.refreshExpiryRisk(fixture.branchId);
    const workItems = await database.admin<Array<{ risk_bucket: string; value_at_risk: string }>>`
      select risk_bucket, value_at_risk::text from expiry_work_items
      where branch_id = ${fixture.branchId}
        and inventory_batch_id in (
          select id from inventory_batches where medicine_id in ${database.admin(medicineIds)}
        )
      order by inventory_batch_id
    `;
    expect(workItems.map((row) => row.risk_bucket)).toEqual(expectedBuckets);
    expect(workItems.every((row) => row.value_at_risk === '4.69')).toBe(true);

    const catalog = new CatalogService(database.application);
    const expired = await catalog.search(fixture.branchId, 'P0 Expiry -1', 10);
    expect(expired[0]).toMatchObject({ availableQuantity: '0', salePrice: null });
    const pos = new PosService(database.application, {
      RESERVATION_TTL_MINUTES: 8,
    } as Environment);
    await expect(
      pos.createDraft(fixture.user, {
        items: [{ medicineId: BigInt(medicineIds[0] ?? '0'), quantity: '1' }],
        terminalId: BigInt(fixture.terminalId),
      }),
    ).rejects.toMatchObject({ message: 'One or more medicines are unavailable for sale' });
  });

  it('generates explainable, rounded reorder quantities once without ordering', async () => {
    const noHistoryId = await createMedicine(database, 'P0 Reorder No History');
    const stockoutId = await createMedicine(database, 'P0 Reorder Stockouts');
    await createBatch(
      database,
      fixture.branchId,
      stockoutId,
      'P0-REORDER-NEAR',
      30,
      '50',
      '1',
      '2',
    );
    await database.admin`
      insert into reorder_policies (
        branch_id, medicine_id, lookback_days, lead_time_days, safety_days,
        minimum_stock, target_coverage_days, minimum_order_qty, order_multiple
      ) values
        (${fixture.branchId}, ${noHistoryId}, 30, 3, 2, 10, 10, 7, 4),
        (${fixture.branchId}, ${stockoutId}, 30, 5, 2, 0, 10, 7, 4)
    `;
    await database.admin`
      insert into sales_velocity_daily (
        branch_id, medicine_id, sales_date, quantity_sold, net_sales
      ) values (
        ${fixture.branchId}, ${stockoutId},
        (now() at time zone (select timezone from branches where id = ${fixture.branchId}))::date - 1,
        60, 120
      )
    `;
    await database.admin`
      insert into inventory_availability_daily (
        branch_id, medicine_id, availability_date, had_sellable_stock, closing_sellable_qty
      )
      select ${fixture.branchId}, ${stockoutId},
        (now() at time zone (select timezone from branches where id = ${fixture.branchId}))::date - day,
        day > 20, case when day > 20 then 50 else 0 end
      from generate_series(1, 30) day
    `;

    await worker.refreshReorderSuggestions(fixture.branchId);
    await worker.refreshReorderSuggestions(fixture.branchId);
    const suggestions = await database.admin<
      Array<{
        average_daily_sales: string;
        confidence: string;
        effective_lead_time_days: number;
        expiry_risk_flag: boolean;
        medicine_id: string;
        reason: Record<string, unknown>;
        status: string;
        suggested_qty: string;
      }>
    >`
      select medicine_id::text, average_daily_sales::text, suggested_qty::text,
        effective_lead_time_days, confidence, expiry_risk_flag, reason, status
      from reorder_suggestions
      where branch_id = ${fixture.branchId} and status = 'GENERATED'
      order by medicine_id
    `;
    expect(suggestions).toHaveLength(2);
    expect(suggestions.find((row) => row.medicine_id === noHistoryId)).toMatchObject({
      average_daily_sales: '0.000',
      confidence: 'LOW',
      effective_lead_time_days: 3,
      suggested_qty: '12.000',
    });
    expect(suggestions.find((row) => row.medicine_id === stockoutId)).toMatchObject({
      average_daily_sales: '6.000',
      confidence: 'LOW',
      effective_lead_time_days: 5,
      expiry_risk_flag: true,
      suggested_qty: '24.000',
    });
    expect(suggestions.find((row) => row.medicine_id === stockoutId)?.reason).toMatchObject({
      eligibleDemandDays: 10,
      leadTimeSource: 'POLICY_FALLBACK',
      stockoutDays: 20,
    });
    const [counts] = await database.admin<
      Array<{
        active_count: string;
        ordered_count: string;
        po_count: string;
        superseded_count: string;
      }>
    >`
      select
        count(*) filter (where status = 'GENERATED')::text as active_count,
        count(*) filter (where status = 'SUPERSEDED')::text as superseded_count,
        count(*) filter (where status = 'ORDERED')::text as ordered_count,
        (select count(*) from purchase_orders)::text as po_count
      from reorder_suggestions where branch_id = ${fixture.branchId}
    `;
    expect(counts).toEqual({
      active_count: '2',
      ordered_count: '0',
      po_count: '0',
      superseded_count: '2',
    });
  });

  it('recalculates a stale regimen price before authoritative checkout', async () => {
    const medicineId = await createMedicine(database, 'P0 Budget Freshness');
    const batchId = await createBatch(
      database,
      fixture.branchId,
      medicineId,
      'P0-BUDGET',
      365,
      '20',
      '5',
      '10',
    );
    const service = new BudgetRegimenService(database.application);
    const request = {
      budget: '20.00',
      items: [
        {
          medicineId: BigInt(medicineId),
          minimumSaleIncrement: '1',
          prescribedBaseUnitsPerDay: '1',
        },
      ],
      persistAudit: false,
    };
    const initial = await service.calculate(fixture.user, request);
    expect(initial).toMatchObject({ completeDays: 2, totalCost: '20.00' });
    const initialVersion = String(
      (initial.lines as Array<{ priceVersion: string }>)[0]?.priceVersion,
    );

    await database.admin.begin(async (transaction) => {
      await transaction`update inventory_batches set sale_price = 15 where id = ${batchId}`;
      await transaction`
        insert into inventory_batch_price_history (
          branch_id, inventory_batch_id, old_sale_price, new_sale_price,
          change_type, reason, client_request_id
        ) values (
          ${fixture.branchId}, ${batchId}, 10, 15, 'MANUAL',
          'Phase 2 stale-price fixture', 'phase2-budget-price-change'
        )
      `;
    });
    const recalculated = await service.calculate(fixture.user, request);
    expect(recalculated).toMatchObject({ completeDays: 1, totalCost: '15.00' });
    expect((recalculated.lines as Array<{ priceVersion: string }>)[0]?.priceVersion).not.toBe(
      initialVersion,
    );

    const pos = new PosService(database.application, {
      RESERVATION_TTL_MINUTES: 8,
    } as Environment);
    await expect(
      pos.createDraft(fixture.user, {
        items: [{ medicineId: BigInt(medicineId), quantity: '1' }],
        terminalId: BigInt(fixture.terminalId),
      }),
    ).resolves.toMatchObject({ subtotal: '15.00', total: '15.00' });
  });
});
