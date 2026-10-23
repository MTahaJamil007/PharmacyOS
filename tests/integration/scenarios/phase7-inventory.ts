import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import {
  createDraftSchema,
  openCashSessionSchema,
  quickReceiptSchema,
  starterLayout,
  saveShelfLayoutSchema,
  type CashSessionSummary,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../../../apps/api/src/auth/auth.types.js';
import { CashSessionsService } from '../../../apps/api/src/cash-sessions/cash-sessions.service.js';
import { CatalogService } from '../../../apps/api/src/catalog/catalog.service.js';
import { FeaturesService } from '../../../apps/api/src/features/features.service.js';
import { CashCounterService } from '../../../apps/api/src/pos/cash-counter.service.js';
import { PosService } from '../../../apps/api/src/pos/pos.service.js';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service.js';
import { ShelfPlannerService } from '../../../apps/api/src/shelf-planner/shelf-planner.service.js';
import { StockControlService } from '../../../apps/api/src/stock-control/stock-control.service.js';

export type Check = (name: string, ok: boolean, detail?: string) => void;

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await promise;
    return 'did not reject';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return pattern.test(message) ? 'ok' : message;
  }
}

const GS = '\u001d';
// Valid GTIN-14s (check digits computed) for the test packs.
const PANADOL_GTIN = '08964000121238';
const UNKNOWN_GTIN = '08964000999998';

/**
 * Phase 7 stock work against real migrations: scan-and-receive, barcode linking, exact
 * same-medicine alternatives, customer requests, low/stuck/expiring stock, several cash counters,
 * and A to Z shelf places.
 */
export async function phase7InventoryScenario(
  db: Database,
  environment: Environment,
  check: Check,
): Promise<void> {
  const [branch] = await db<Array<{ id: string }>>`
    insert into branches (code, name) values ('P7', 'Phase 7 Pharmacy') returning id::text`;
  const branchId = branch!.id;
  await db`insert into operational_intelligence_policies (branch_id) values (${branchId})`;
  const terminal = async (code: string, type: string) =>
    (
      await db<Array<{ id: string }>>`
        insert into terminals (branch_id, code, name, terminal_type)
        values (${branchId}, ${code}, ${code}, ${type}) returning id::text`
    )[0]!.id;
  const orderDesk = await terminal('ORDER-1', 'SALES_COUNTER');
  const counterOne = await terminal('CASH-1', 'CASHIER');
  const counterTwo = await terminal('CASH-2', 'CASHIER');
  const user = async (username: string) =>
    (
      await db<Array<{ id: string }>>`
        insert into users (username, display_name, password_hash)
        values (${username}, ${username}, 'unused') returning id::text`
    )[0]!.id;
  const actor = (id: string, terminalId: string): AuthenticatedUser => ({
    id,
    branchId,
    terminalId,
    username: id,
    displayName: id,
    permissions: [
      'inventory.shelf.read',
      'inventory.shelf.manage',
      'inventory.shelf.recommendation.review',
    ],
    sessionId: '0',
  });
  const owner = actor(await user('p7-owner'), orderDesk);
  const otherTaker = actor(await user('p7-taker'), orderDesk);
  const cashierOne = actor(await user('p7-cash-1'), counterOne);
  const cashierTwo = actor(await user('p7-cash-2'), counterTwo);
  const [supplier] = await db<Array<{ id: string }>>`
    insert into suppliers (branch_id, name) values (${branchId}, 'Muller Distributors')
    returning id::text`;
  const company = async (name: string) =>
    (
      await db<
        Array<{ id: string }>
      >`insert into manufacturers (name) values (${name}) returning id::text`
    )[0]!.id;
  const gsk = await company('GSK P7');
  const getz = await company('Getz P7');
  const medicine = async (
    name: string,
    generic: string,
    strength: string,
    form: string,
    manufacturer: string,
    options: { cold?: boolean } = {},
  ) =>
    (
      await db<Array<{ id: string }>>`
        insert into medicines (name, generic_name, strength, dosage_form, manufacturer_id,
          pack_size, unit_name, storage_class)
        values (${name}, ${generic}, ${strength}, ${form}, ${manufacturer}, 10, 'tablet',
          ${options.cold ? 'COLD' : 'AMBIENT'})
        returning id::text`
    )[0]!.id;
  const panadol = await medicine('Panadol P7', 'Paracetamol', '500mg', 'tablets', gsk);
  const calpara = await medicine('Calpara P7', 'Paracetamol', '500 mg', 'Tablet', getz);
  const glucophage = await medicine('Glucophage P7', 'Metformin', '500mg', 'tablets', gsk);
  const glucophageXr = await medicine('Glucophage XR P7', 'Metformin XR', '500mg', 'tablets', gsk);
  const brufen = await medicine('Brufen P7', 'Ibuprofen', '400mg', 'tablets', gsk);
  await db`insert into medicine_barcodes (medicine_id, barcode, is_primary)
    values (${panadol}, '8964000121238', true)`;

  const procurement = new ProcurementService(db);
  const features = new FeaturesService(db);
  const stock = new StockControlService(db, features);
  const catalog = new CatalogService(db);
  const pos = new PosService(db, environment);
  const counter = new CashCounterService(db, pos);
  const sessions = new CashSessionsService(db);
  const planner = new ShelfPlannerService(db);

  // 1. Scanning a pack fills batch and expiry; the product is matched only by an exact barcode.
  const scanned = await stock.scan(owner, `01${PANADOL_GTIN}17300630` + `10PN2201${GS}21S1`);
  check(
    'a 2D pack code finds the exact medicine with its batch and expiry',
    scanned.medicine?.id === panadol &&
      scanned.scan.batch === 'PN2201' &&
      scanned.scan.expiryDate === '2030-06-30' &&
      scanned.defaults?.unitsPerPack === '10.000',
    JSON.stringify(scanned),
  );
  const unknown = await stock.scan(owner, `01${UNKNOWN_GTIN}17300630` + `10X1`);
  check('an unknown pack is not guessed', unknown.medicine === null, JSON.stringify(unknown));

  // 2. Scan-and-receive: an order and its receipt in one step, stock and ledger as usual.
  const receipt = quickReceiptSchema.parse({
    clientRequestId: 'p7-direct-receipt-1',
    supplierId: supplier!.id,
    supplierInvoiceNumber: 'MD-4410',
    lines: [
      {
        medicineId: panadol,
        quantity: '2',
        unitsPerPack: '10',
        costPerPack: '100',
        batchNumber: 'PN2201',
        expiryDate: '2030-06-30',
        salePricePerUnit: '12.50',
        scannedCode: `01${PANADOL_GTIN}`,
      },
      {
        medicineId: calpara,
        quantity: '5',
        bonusQuantity: '1',
        unitsPerPack: '10',
        costPerPack: '80',
        batchNumber: 'CP-9',
        expiryDate: '2030-01-31',
        salePricePerUnit: '10',
      },
      {
        medicineId: glucophageXr,
        quantity: '3',
        unitsPerPack: '10',
        costPerPack: '150',
        batchNumber: 'GX-1',
        expiryDate: '2030-01-31',
        salePricePerUnit: '18',
      },
      {
        medicineId: brufen,
        quantity: '4',
        unitsPerPack: '10',
        costPerPack: '60',
        batchNumber: 'BR-1',
        expiryDate: '2030-01-31',
        salePricePerUnit: '8',
      },
    ],
  });
  const received = await procurement.quickReceipt(owner, receipt);
  const [order] = await db<Array<{ status: string; direct_receipt: boolean; total: string }>>`
    select status, direct_receipt, total_cost::text as total from purchase_orders
    where id = ${received.purchaseOrderId}`;
  const onHand = async (id: string) =>
    (
      await db<Array<{ qty: string | null }>>`
        select sum(current_qty)::text as qty from inventory_batches
        where branch_id = ${branchId} and medicine_id = ${id}`
    )[0]!.qty;
  check(
    'scan-and-receive records a received direct order',
    order?.status === 'RECEIVED' && order.direct_receipt && order.total === '1290.00',
    JSON.stringify(order),
  );
  check(
    'received stock counts packs, bonus and units',
    (await onHand(panadol)) === '20.000' && (await onHand(calpara)) === '60.000',
  );
  const [movements] = await db<Array<{ count: number }>>`
    select count(*)::int as count from stock_movements
    where branch_id = ${branchId} and movement_type = 'PURCHASE_RECEIPT'`;
  check('every received line is in the stock ledger', movements?.count === 4);
  const replay = await procurement.quickReceipt(owner, receipt);
  check(
    'a retried receipt returns the same receipt',
    replay.idempotentReplay && replay.receiptId === received.receiptId,
  );
  check(
    'expired stock is refused at receiving',
    (await rejects(
      procurement.quickReceipt(
        owner,
        quickReceiptSchema.parse({
          ...receipt,
          clientRequestId: 'p7-direct-receipt-expired',
          lines: [{ ...receipt.lines[0]!, expiryDate: '2020-01-31' }],
        }),
      ),
      /Expired stock/,
    )) === 'ok',
  );
  const again = await stock.scan(owner, `01${PANADOL_GTIN}17300630` + `10PN2201`);
  check(
    'the next scan remembers the last price and supplier, and the existing batch',
    again.defaults?.costPerPack === '100.00' &&
      again.defaults.supplierName === 'Muller Distributors' &&
      again.existingBatch?.quantity === '20.000',
    JSON.stringify(again),
  );

  // 3. Linking an unknown barcode is explicit; a barcode is never moved between medicines.
  await stock.linkBarcode(owner, glucophage, `01${UNKNOWN_GTIN}17300630`);
  check(
    'a linked barcode finds its medicine next time',
    (await stock.scan(owner, `01${UNKNOWN_GTIN}`)).medicine?.id === glucophage,
  );
  check(
    'a barcode already used by another medicine is refused',
    (await rejects(
      stock.linkBarcode(owner, calpara, '8964000121238'),
      /already belongs to Panadol/,
    )) === 'ok',
  );

  // 4. Counter search reads pack codes and shows the form; alternatives are exact only.
  const found = await catalog.search(branchId, `01${PANADOL_GTIN}17300630` + `10PN2201`, 10);
  check(
    'counter search finds a scanned 2D code by barcode',
    found[0]?.id === panadol &&
      found[0].matchedBy === 'BARCODE' &&
      found[0].dosageForm === 'tablets',
    JSON.stringify(found[0]),
  );
  const alternatives = await catalog.substitutes(branchId, panadol);
  check(
    'alternatives are the same generic, strength and form from another company',
    alternatives.data.map((row) => row.id).join() === calpara &&
      alternatives.formulation === 'Paracetamol 500mg tablet',
    JSON.stringify(alternatives),
  );
  check(
    'an extended-release medicine is never offered for the plain one',
    (await catalog.substitutes(branchId, glucophage)).data.length === 0,
  );

  // 5. Customer requests: a double tap counts once; the report counts people, not taps.
  await stock.recordRequest(owner, { requestedName: 'Glucophage', medicineId: BigInt(glucophage) });
  const tap = await stock.recordRequest(owner, {
    requestedName: 'Glucophage',
    medicineId: BigInt(glucophage),
  });
  await stock.recordRequest(otherTaker, {
    requestedName: 'Glucophage',
    medicineId: BigInt(glucophage),
  });
  await stock.recordRequest(owner, { requestedName: 'Zinc syrup Kids' });
  await stock.recordRequest(otherTaker, { requestedName: '  zinc   syrup kids ' });
  const report = await stock.requestReport(owner);
  check('a double tap counts once', !tap.counted);
  check(
    'requests are counted per medicine and per typed name',
    report.data.find((row) => row.medicineId === glucophage)?.times === 2 &&
      report.data.find((row) => row.medicineId === null)?.times === 2,
    JSON.stringify(report.data),
  );

  // 6. Low, stuck and expiring stock use the shop's settings.
  await db`
    insert into reorder_policies (branch_id, medicine_id, minimum_stock)
    values (${branchId}, ${brufen}, 100)`;
  const low = await stock.lowStock(owner);
  check(
    'a medicine under its minimum is low, with packs to order',
    low.data.find((row) => row.id === brufen)?.suggestedPacks === 6,
    JSON.stringify(low.data),
  );
  await db.begin(async (transaction) => {
    const [old] = await transaction<Array<{ id: string }>>`
      insert into inventory_batches (branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status, received_at)
      values (${branchId}, ${glucophage}, 'OLD-1', current_date + 20, 5, 9, 30, 'SELLABLE',
        now() - interval '200 days')
      returning id::text`;
    await transaction`
      insert into stock_movements (branch_id, inventory_batch_id, movement_type, quantity_delta,
        quantity_after, reason)
      values (${branchId}, ${old!.id}, 'ADJUSTMENT_IN', 30, 30, 'fixture')`;
  });
  const stuck = await stock.stuckStock(owner);
  check(
    'stock unsold since long before the window is stuck, new stock is not',
    stuck.data.some((row) => row.id === glucophage && row.value === '150.00') &&
      !stuck.data.some((row) => row.id === panadol),
    JSON.stringify(stuck.data),
  );
  const expiring = await stock.expiring(owner);
  check(
    'stock expiring inside the window is listed with days left',
    expiring.data.some((row) => row.batchNumber === 'OLD-1' && row.daysLeft === 20) &&
      !expiring.data.some((row) => row.batchNumber === 'PN2201'),
  );
  check(
    'the expiry window follows the shop setting',
    (await stock.expiring(owner, 10)).data.length === 0,
  );
  const orderList = await stock.orderList(owner);
  check(
    'the order list joins low stock and requests with the last supplier',
    orderList.lines.some(
      (line) => line.medicineId === brufen && line.supplierName === 'Muller Distributors',
    ) &&
      orderList.lines.some((line) => line.medicineId === glucophage && line.requestCount === 2) &&
      orderList.notInCatalog.length === 1,
    JSON.stringify(orderList),
  );

  // 7. Several cash counters: a bill can be sent to one; a claimed bill is not paid twice.
  const counters = await counter.cashCounters(owner);
  check('order takers see the cash counters', counters.data.length === 2);
  const draft = (await pos.createDraft(
    owner,
    createDraftSchema.parse({
      terminalId: orderDesk,
      items: [{ medicineId: calpara, quantity: '10' }],
    }),
  )) as { id: string };
  await pos.reserveDraft(owner, BigInt(draft.id));
  await counter.sendToCashier(owner, BigInt(draft.id), null, BigInt(counterTwo));
  const queueTwo = (await counter.queue(cashierTwo)).data as Array<Record<string, unknown>>;
  check(
    'the chosen counter sees the bill as its own',
    queueTwo[0]?.id === draft.id && queueTwo[0]?.forThisCounter === true,
    JSON.stringify(queueTwo),
  );
  await counter.claim(cashierTwo, BigInt(draft.id));
  check(
    'another counter cannot claim a bill being paid',
    (await rejects(counter.claim(cashierOne, BigInt(draft.id)), /being paid at CASH-2/)) === 'ok',
  );
  const dayOne = (await sessions.open(
    cashierOne,
    openCashSessionSchema.parse({ openingFloat: '0', clientRequestId: 'p7-open-cash-1' }),
  )) as unknown as CashSessionSummary;
  check(
    'another counter cannot take the money either',
    (await rejects(
      counter.clearPayment(cashierOne, BigInt(draft.id), {
        cashSessionId: BigInt(dayOne.id),
        clientRequestId: 'p7-clear-wrong-counter',
      }),
      /being paid at CASH-2/,
    )) === 'ok',
  );
  const dayTwo = (await sessions.open(
    cashierTwo,
    openCashSessionSchema.parse({ openingFloat: '0', clientRequestId: 'p7-open-cash-2' }),
  )) as unknown as CashSessionSummary;
  const paid = (await counter.clearPayment(cashierTwo, BigInt(draft.id), {
    cashSessionId: BigInt(dayTwo.id),
    clientRequestId: 'p7-clear-right-counter',
  })) as { invoiceNumber?: string };
  check('the claiming counter takes the payment', Boolean(paid.invoiceNumber));

  // 8. A to Z shelves: a new medicine gets its place from its name; shelf names stick.
  const starter = starterLayout(305, 610);
  await planner.saveLayout(
    owner,
    saveShelfLayoutSchema.parse({
      expectedVersion: 0,
      floor: starter.floor,
      fixtures: starter.fixtures.map((fixture) => ({
        id: null,
        key: fixture.key,
        code: fixture.code,
        name: fixture.name,
        kind: fixture.kind,
        xCm: Math.round(fixture.xCm),
        yCm: Math.round(fixture.yCm),
        widthCm: fixture.widthCm,
        depthCm: fixture.depthCm,
        rotation: fixture.rotation,
        heightCm: fixture.heightCm,
        levelCount: fixture.levelCount,
        facingsPerLevel: 2,
        storageClass: fixture.storageClass,
        isSecured: fixture.isSecured,
      })),
    }),
  );
  const state = await planner.state(owner);
  const rackA = state.fixtures.find((fixture) => fixture.code === 'A')!;
  await planner.place(owner, {
    medicineId: BigInt(brufen),
    shelfId: BigInt(rackA.levels[0]!.shelfId),
  });
  await planner.place(owner, {
    medicineId: BigInt(glucophage),
    shelfId: BigInt(rackA.levels[0]!.shelfId),
  });
  await planner.setShelfLabel(owner, BigInt(rackA.levels[0]!.shelfId), 'Pain and sugar');
  const preview = await planner.alphabetPlace(owner, BigInt(calpara), false);
  check(
    'a new medicine is placed between its A to Z neighbours, shifting the overflow',
    preview.targetLabel === 'A-1' &&
      preview.after === 'Brufen P7' &&
      preview.before === 'Glucophage P7' &&
      preview.moves.length === 1 &&
      preview.moves[0]?.name === 'Glucophage P7',
    JSON.stringify(preview),
  );
  await planner.alphabetPlace(owner, BigInt(calpara), true);
  const ranges = (await planner.alphabet(owner)).data;
  check(
    'applying keeps every level in A to Z order and keeps its name',
    ranges[0]?.first === 'Brufen P7' &&
      ranges[0].last === 'Calpara P7' &&
      ranges[0].shelfLabel === 'Pain and sugar' &&
      ranges[1]?.first === 'Glucophage P7',
    JSON.stringify(ranges.slice(0, 2)),
  );
  const shelfSearch = await catalog.search(branchId, 'Brufen P7', 5);
  check(
    'counter search shows the shelf with its name',
    shelfSearch[0]?.shelf === 'A-1 · Pain and sugar',
    JSON.stringify(shelfSearch[0]),
  );
}
