import { ProcurementService } from '../../apps/api/src/procurement/procurement.service.js';
import type { AuthenticatedUser } from '../../apps/api/src/auth/auth.types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

describe('acquisition cost exactness', () => {
  let database: IsolatedDatabase;
  let user: AuthenticatedUser;
  let purchaseOrderId: string;
  let purchaseOrderItemId: string;

  beforeAll(async () => {
    database = await createIsolatedDatabase('money_exactness');
    const [branch] = await database.admin<{ id: string }[]>`
      insert into branches (code, name) values ('MONEY', 'Money Exactness Branch')
      returning id::text
    `;
    const [actor] = await database.admin<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values ('money-actor', 'Money Actor', 'not-used-by-direct-service-tests')
      returning id::text
    `;
    if (!branch || !actor) throw new Error('Failed to create money identity fixtures');
    const [terminal] = await database.admin<{ id: string }[]>`
      insert into terminals (branch_id, code, name, terminal_type)
      values (${branch.id}, 'ADMIN-01', 'Money Admin', 'ADMIN') returning id::text
    `;
    const [supplier] = await database.admin<{ id: string }[]>`
      insert into suppliers (branch_id, code, name)
      values (${branch.id}, 'SUP-001', 'Exact Cost Supplier') returning id::text
    `;
    const [medicine] = await database.admin<{ id: string }[]>`
      insert into medicines (name, pack_size, unit_name)
      values ('Thousand Unit Pack', 1000, 'tablet') returning id::text
    `;
    if (!terminal || !supplier || !medicine) throw new Error('Failed to create money fixtures');
    const [order] = await database.admin<{ id: string }[]>`
      insert into purchase_orders (
        branch_id, supplier_id, created_by_user_id, order_number,
        status, ordered_at, total_cost
      ) values (
        ${branch.id}, ${supplier.id}, ${actor.id}, 'PO-MONEY-001', 'ORDERED', now(), 1
      ) returning id::text
    `;
    if (!order) throw new Error('Failed to create purchase-order fixture');
    const [item] = await database.admin<{ id: string }[]>`
      insert into purchase_order_items (
        purchase_order_id, medicine_id, ordered_qty, unit_cost,
        bonus_qty, base_units_per_order_unit
      ) values (${order.id}, ${medicine.id}, 1, 1, 0, 1000)
      returning id::text
    `;
    if (!item) throw new Error('Failed to create purchase-order item fixture');

    purchaseOrderId = order.id;
    purchaseOrderItemId = item.id;
    user = {
      branchId: branch.id,
      displayName: 'Money Actor',
      id: actor.id,
      permissions: [],
      sessionId: 'direct-money-integration-test',
      terminalId: terminal.id,
      username: 'money-actor',
    };
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('persists a non-zero sub-paisa cost for a high-count pack receipt', async () => {
    const service = new ProcurementService(database.application);
    const result = await service.receivePurchaseOrder(user, BigInt(purchaseOrderId), {
      clientRequestId: 'money-exactness-receipt',
      lines: [
        {
          batchNumber: 'MONEY-LOT-001',
          expiryDate: '2099-12-31',
          purchaseOrderItemId: BigInt(purchaseOrderItemId),
          receivedBonusQuantity: '0',
          receivedQuantity: '1',
          salePricePerBaseUnit: '0.02',
        },
      ],
    });
    expect(result).toMatchObject({ idempotentReplay: false, status: 'RECEIVED' });

    const [evidence] = await database.admin<
      Array<{
        batch_cost: string;
        current_qty: string;
        movement_delta: string;
        receipt_cost: string;
        sale_item_cost_type: string;
      }>
    >`
      select inventory_batches.cost_price::text as batch_cost,
        inventory_batches.current_qty::text,
        goods_receipt_items.effective_cost_per_base_unit::text as receipt_cost,
        stock_movements.quantity_delta::text as movement_delta,
        format_type(attributes.atttypid, attributes.atttypmod) as sale_item_cost_type
      from inventory_batches
      join goods_receipt_items
        on goods_receipt_items.inventory_batch_id = inventory_batches.id
      join stock_movements
        on stock_movements.inventory_batch_id = inventory_batches.id
          and stock_movements.movement_type = 'PURCHASE_RECEIPT'
      cross join pg_attribute attributes
      where inventory_batches.purchase_order_item_id = ${purchaseOrderItemId}
        and attributes.attrelid = 'sale_items'::regclass
        and attributes.attname = 'unit_cost'
    `;
    expect(evidence).toEqual({
      batch_cost: '0.00100000',
      current_qty: '1000.000',
      movement_delta: '1000.000',
      receipt_cost: '0.00100000',
      sale_item_cost_type: 'numeric(20,8)',
    });
  });
});
