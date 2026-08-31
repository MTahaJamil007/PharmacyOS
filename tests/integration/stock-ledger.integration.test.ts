import { IntelligenceService } from '../../apps/api/src/intelligence/intelligence.service.js';
import { ReturnsService } from '../../apps/api/src/returns/returns.service.js';
import type { AuthenticatedUser } from '../../apps/api/src/auth/auth.types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runConcurrently } from './harness/concurrency.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

interface LedgerFixture {
  readonly branchId: string;
  readonly terminalId: string;
  readonly user: AuthenticatedUser;
}

async function seedIdentity(database: IsolatedDatabase): Promise<LedgerFixture> {
  const [branch] = await database.admin<{ id: string }[]>`
    insert into branches (code, name) values ('LEDGER', 'Ledger Integrity Branch')
    returning id::text
  `;
  const [actor] = await database.admin<{ id: string }[]>`
    insert into users (username, display_name, password_hash)
    values ('ledger-actor', 'Ledger Actor', 'not-used-by-direct-service-tests')
    returning id::text
  `;
  if (!branch || !actor) throw new Error('Failed to create ledger identity fixtures');
  const [terminal] = await database.admin<{ id: string }[]>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branch.id}, 'ADMIN-01', 'Ledger Admin', 'ADMIN') returning id::text
  `;
  if (!terminal) throw new Error('Failed to create ledger terminal fixture');

  return {
    branchId: branch.id,
    terminalId: terminal.id,
    user: {
      branchId: branch.id,
      displayName: 'Ledger Actor',
      id: actor.id,
      permissions: [],
      sessionId: 'direct-ledger-integration-test',
      terminalId: terminal.id,
      username: 'ledger-actor',
    },
  };
}

async function createMedicine(database: IsolatedDatabase, name: string): Promise<string> {
  const [medicine] = await database.admin<{ id: string }[]>`
    insert into medicines (name, pack_size, unit_name)
    values (${name}, 1, 'unit') returning id::text
  `;
  if (!medicine) throw new Error('Failed to create medicine fixture');
  return medicine.id;
}

async function createBatchWithOpening(
  database: IsolatedDatabase,
  branchId: string,
  medicineId: string,
  input: { batchNumber: string; quantity: string; status?: string },
): Promise<string> {
  return database.admin.begin(async (transaction) => {
    const [batch] = await transaction<{ id: string }[]>`
      insert into inventory_batches (
        branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status
      ) values (
        ${branchId}, ${medicineId}, ${input.batchNumber}, current_date + 365,
        10, 20, ${input.quantity}, ${input.status ?? 'SELLABLE'}
      ) returning id::text
    `;
    if (!batch) throw new Error('Failed to create inventory fixture');
    await transaction`
      insert into stock_movements (
        branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after, reason
      ) values (
        ${branchId}, ${batch.id}, 'ADJUSTMENT_IN', ${input.quantity}, ${input.quantity},
        'Integration fixture opening balance'
      )
    `;
    return batch.id;
  });
}

describe('stock ledger integrity', () => {
  let database: IsolatedDatabase;
  let fixture: LedgerFixture;

  beforeAll(async () => {
    database = await createIsolatedDatabase('stock_ledger');
    fixture = await seedIdentity(database);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('rejects arithmetic, sign, and direct batch-balance violations in the database', async () => {
    const medicineId = await createMedicine(database, 'Ledger Constraint Medicine');
    const batchId = await createBatchWithOpening(database, fixture.branchId, medicineId, {
      batchNumber: 'LEDGER-CHECK',
      quantity: '3',
    });

    await expect(
      database.admin.begin(async (transaction) => {
        await transaction`update inventory_batches set current_qty = 2 where id = ${batchId}`;
        await transaction`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after
          ) values (${fixture.branchId}, ${batchId}, 'SALE', -1, 1)
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      database.admin.begin(async (transaction) => {
        await transaction`update inventory_batches set current_qty = 2 where id = ${batchId}`;
        await transaction`
          insert into stock_movements (
            branch_id, inventory_batch_id, movement_type, quantity_delta, quantity_after
          ) values (${fixture.branchId}, ${batchId}, 'ADJUSTMENT_IN', -1, 2)
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      database.admin`update inventory_batches set current_qty = 2 where id = ${batchId}`,
    ).rejects.toMatchObject({ code: '23514' });

    const [unchanged] = await database.admin<{ current_qty: string }[]>`
      select current_qty::text from inventory_batches where id = ${batchId}
    `;
    expect(unchanged?.current_qty).toBe('3.000');
  });

  it('moves expiry stock into a separate quarantine segment and records its final scrap', async () => {
    const medicineId = await createMedicine(database, 'Expiry Boundary Medicine');
    const sourceBatchId = await createBatchWithOpening(database, fixture.branchId, medicineId, {
      batchNumber: 'EXPIRY-LOT',
      quantity: '3',
    });
    const [workItem] = await database.admin<{ id: string }[]>`
      insert into expiry_work_items (
        branch_id, inventory_batch_id, risk_bucket, quantity_snapshot,
        value_at_risk, snapshot_date
      ) values (${fixture.branchId}, ${sourceBatchId}, 'DAYS_0_30', 3, 30, current_date)
      returning id::text
    `;
    if (!workItem) throw new Error('Failed to create expiry work item fixture');
    const service = new IntelligenceService(database.application);

    const quarantine = await service.actionExpiryWorkItem(fixture.user, BigInt(workItem.id), {
      action: 'QUARANTINED',
      notes: 'Damaged packaging requires restricted storage',
    });
    expect(quarantine).toMatchObject({
      action: 'QUARANTINED',
      idempotentReplay: false,
      status: 'REVIEWED',
    });

    const batchesAfterQuarantine = await database.admin<
      Array<{
        current_qty: string;
        id: string;
        segment_key: string;
        source_batch_id: string | null;
        status: string;
      }>
    >`
      select id::text, current_qty::text, segment_key, source_batch_id::text, status
      from inventory_batches where medicine_id = ${medicineId} order by segment_key
    `;
    const quarantineBatch = batchesAfterQuarantine[0];
    const sourceBatch = batchesAfterQuarantine[1];
    if (!quarantineBatch || !sourceBatch) throw new Error('Missing quarantine batch evidence');
    expect(quarantineBatch).toEqual({
      current_qty: '3.000',
      id: quarantineBatch.id,
      segment_key: 'EXPIRY_QUARANTINE',
      source_batch_id: sourceBatchId,
      status: 'QUARANTINE',
    });
    expect(quarantineBatch.id).not.toBe(sourceBatchId);
    expect(sourceBatch).toEqual({
      current_qty: '0.000',
      id: sourceBatchId,
      segment_key: 'PRIMARY',
      source_batch_id: null,
      status: 'DEPLETED',
    });

    const scrap = await service.actionExpiryWorkItem(fixture.user, BigInt(workItem.id), {
      action: 'SCRAPPED',
      notes: 'Supervisor approved physical destruction',
    });
    expect(scrap).toMatchObject({
      action: 'SCRAPPED',
      idempotentReplay: false,
      inventoryBatchId: quarantineBatch.id,
      status: 'RESOLVED',
    });

    const movements = await database.admin<
      Array<{
        inventory_batch_id: string;
        movement_type: string;
        quantity_after: string;
        quantity_delta: string;
      }>
    >`
      select inventory_batch_id::text, movement_type, quantity_delta::text, quantity_after::text
      from stock_movements where inventory_batch_id in (${sourceBatchId}, ${quarantineBatch.id})
      order by id
    `;
    expect(movements).toEqual([
      {
        inventory_batch_id: sourceBatchId,
        movement_type: 'ADJUSTMENT_IN',
        quantity_after: '3.000',
        quantity_delta: '3.000',
      },
      {
        inventory_batch_id: sourceBatchId,
        movement_type: 'QUARANTINE',
        quantity_after: '0.000',
        quantity_delta: '-3.000',
      },
      {
        inventory_batch_id: quarantineBatch.id,
        movement_type: 'TRANSFER',
        quantity_after: '3.000',
        quantity_delta: '3.000',
      },
      {
        inventory_batch_id: quarantineBatch.id,
        movement_type: 'SCRAP',
        quantity_after: '0.000',
        quantity_delta: '-3.000',
      },
    ]);
  });

  it('processes one concurrent refund without reviving recalled stock or quarantining its lot', async () => {
    const recalledMedicineId = await createMedicine(database, 'Recalled Return Medicine');
    const damagedMedicineId = await createMedicine(database, 'Damaged Return Medicine');
    const recalledBatchId = await createBatchWithOpening(
      database,
      fixture.branchId,
      recalledMedicineId,
      { batchNumber: 'RECALLED-LOT', quantity: '4', status: 'RECALLED' },
    );
    const damagedSourceBatchId = await createBatchWithOpening(
      database,
      fixture.branchId,
      damagedMedicineId,
      { batchNumber: 'DAMAGED-LOT', quantity: '10' },
    );

    const returnId = await database.admin.begin(async (transaction) => {
      const [cashSession] = await transaction<{ id: string }[]>`
        insert into cash_sessions (
          branch_id, terminal_id, cashier_user_id, opening_float
        ) values (${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, 0)
        returning id::text
      `;
      const [draft] = await transaction<{ id: string }[]>`
        insert into sale_drafts (
          branch_id, terminal_id, salesperson_user_id, status, subtotal, total
        ) values (${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, 'PAID', 30, 30)
        returning id::text
      `;
      if (!cashSession || !draft) throw new Error('Failed to create return transaction fixtures');
      const [sale] = await transaction<{ id: string }[]>`
        insert into sales (
          branch_id, terminal_id, cashier_user_id, cash_session_id, sale_draft_id,
          invoice_number, client_request_id, subtotal, total
        ) values (
          ${fixture.branchId}, ${fixture.terminalId}, ${fixture.user.id}, ${cashSession.id},
          ${draft.id}, 'LEDGER-RETURN-000001', 'ledger-return-sale', 30, 30
        ) returning id::text
      `;
      if (!sale) throw new Error('Failed to create sale fixture');
      const saleItems = await transaction<{ id: string; inventory_batch_id: string }[]>`
        insert into sale_items (
          sale_id, medicine_id, inventory_batch_id, quantity, unit_price, unit_cost, line_total
        ) values
          (${sale.id}, ${recalledMedicineId}, ${recalledBatchId}, 1, 10, 5, 10),
          (${sale.id}, ${damagedMedicineId}, ${damagedSourceBatchId}, 1, 20, 10, 20)
        returning id::text, inventory_batch_id::text
      `;
      const recalledSaleItem = saleItems.find(
        (item) => item.inventory_batch_id === recalledBatchId,
      );
      const damagedSaleItem = saleItems.find(
        (item) => item.inventory_batch_id === damagedSourceBatchId,
      );
      if (!recalledSaleItem || !damagedSaleItem) throw new Error('Missing sale-item fixture');
      const [createdReturn] = await transaction<{ id: string }[]>`
        insert into returns (
          branch_id, sale_id, requested_by_user_id, approved_by_user_id,
          return_number, status, reason, approved_at
        ) values (
          ${fixture.branchId}, ${sale.id}, ${fixture.user.id}, ${fixture.user.id},
          'LEDGER-RETURN-001', 'APPROVED', 'Integration return', now()
        ) returning id::text
      `;
      if (!createdReturn) throw new Error('Failed to create return fixture');
      await transaction`
        insert into return_items (
          return_id, sale_item_id, quantity, disposition, refund_amount
        ) values
          (${createdReturn.id}, ${recalledSaleItem.id}, 1, 'RESTOCK_SELLABLE', 10),
          (${createdReturn.id}, ${damagedSaleItem.id}, 1, 'QUARANTINE', 20)
      `;
      return createdReturn.id;
    });

    const service = new ReturnsService(database.application);
    const results = await runConcurrently(8, () =>
      service.refund(fixture.user, BigInt(returnId), { method: 'CARD', reference: 'TEST-REFUND' }),
    );
    const responses = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(responses.filter((response) => response.idempotentReplay === false)).toHaveLength(1);
    expect(responses.filter((response) => response.idempotentReplay === true)).toHaveLength(7);

    const batches = await database.admin<
      Array<{
        current_qty: string;
        medicine_id: string;
        segment_key: string;
        source_batch_id: string | null;
        status: string;
      }>
    >`
      select medicine_id::text, current_qty::text, status, segment_key, source_batch_id::text
      from inventory_batches
      where medicine_id in (${recalledMedicineId}, ${damagedMedicineId})
      order by medicine_id, segment_key
    `;
    expect(batches).toEqual(
      expect.arrayContaining([
        {
          current_qty: '5.000',
          medicine_id: recalledMedicineId,
          segment_key: 'PRIMARY',
          source_batch_id: null,
          status: 'RECALLED',
        },
        {
          current_qty: '10.000',
          medicine_id: damagedMedicineId,
          segment_key: 'PRIMARY',
          source_batch_id: null,
          status: 'SELLABLE',
        },
        {
          current_qty: '1.000',
          medicine_id: damagedMedicineId,
          segment_key: 'RETURN_QUARANTINE',
          source_batch_id: damagedSourceBatchId,
          status: 'QUARANTINE',
        },
      ]),
    );
    const [counts] = await database.admin<
      {
        refund_count: string;
        restock_movement_count: string;
      }[]
    >`
      select
        (select count(*) from refunds where return_id = ${returnId})::text as refund_count,
        (select count(*) from stock_movements
          where movement_type = 'RETURN_RESTOCK'
            and metadata ->> 'returnId' = ${returnId})::text as restock_movement_count
    `;
    expect(counts).toEqual({ refund_count: '1', restock_movement_count: '2' });
  });
});
