import type { Database } from '@pharmacy/database';
import {
  saveShelfLayoutSchema,
  starterLayout,
  type FixtureLayout,
  type FloorPlan,
  type SaveShelfLayoutRequest,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../../../apps/api/src/auth/auth.types.js';
import { ShelfPlannerService } from '../../../apps/api/src/shelf-planner/shelf-planner.service.js';

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

interface SavedFixture extends FixtureLayout {
  readonly id: string | null;
  readonly levels: ReadonlyArray<{ level: number; shelfId: string; code: string; used: number }>;
}

function request(
  version: number,
  floor: FloorPlan,
  fixtures: ReadonlyArray<FixtureLayout & { id?: string | null }>,
): SaveShelfLayoutRequest {
  return saveShelfLayoutSchema.parse({
    expectedVersion: version,
    floor,
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id ?? null,
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
      facingsPerLevel: fixture.facingsPerLevel,
      storageClass: fixture.storageClass,
      isSecured: fixture.isSecured,
    })),
  });
}

/**
 * The shelf planner against real migrations: draw a shop, place medicines by hand, ask for a
 * suggestion, accept it, and prove that stale suggestions, overlaps, wrong storage, and removing
 * a rack that still holds stock are all refused.
 */
export async function shelfPlannerScenario(db: Database, check: Check): Promise<void> {
  const [branch] = await db<Array<{ id: string }>>`
    insert into branches (code, name) values ('SP', 'Shelf Planner Pharmacy') returning id::text`;
  const branchId = branch!.id;
  await db`insert into operational_intelligence_policies (branch_id) values (${branchId})`;
  const [terminal] = await db<Array<{ id: string }>>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branchId}, 'BACK-1', 'Back office', 'ADMIN') returning id::text`;
  const [owner] = await db<Array<{ id: string }>>`
    insert into users (username, display_name, password_hash)
    values ('planner-owner', 'Owner', 'unused') returning id::text`;
  const actor: AuthenticatedUser = {
    id: owner!.id,
    branchId,
    terminalId: terminal!.id,
    username: 'planner-owner',
    displayName: 'Owner',
    permissions: [
      'inventory.shelf.read',
      'inventory.shelf.manage',
      'inventory.shelf.recommendation.review',
    ],
    sessionId: '0',
  };
  const reviewer: AuthenticatedUser = {
    ...actor,
    permissions: ['inventory.shelf.recommendation.review'],
  };
  const companies = await db<Array<{ id: string }>>`
    insert into manufacturers (name) values ('Getz'), ('GSK'), ('Searle') returning id::text`;
  const medicine = async (
    name: string,
    company: number,
    options: { cold?: boolean; locked?: boolean } = {},
  ): Promise<string> => {
    const [row] = await db<Array<{ id: string }>>`
      insert into medicines (name, strength, dosage_form, manufacturer_id, storage_class,
        requires_secured_storage)
      values (${name}, '10mg', 'tablets', ${companies[company]!.id},
        ${options.cold ? 'COLD' : 'AMBIENT'}, ${options.locked ?? false})
      returning id::text`;
    await db.begin(async (transaction) => {
      const [batch] = await transaction<Array<{ id: string }>>`
        insert into inventory_batches (branch_id, medicine_id, batch_number, expiry_date,
          cost_price, sale_price, current_qty, status)
        values (${branchId}, ${row!.id}, ${`B-${name}`}, current_date + 300, 10, 15, 50, 'SELLABLE')
        returning id::text`;
      await transaction`
        insert into stock_movements (branch_id, inventory_batch_id, movement_type, quantity_delta,
          quantity_after, reason)
        values (${branchId}, ${batch!.id}, 'ADJUSTMENT_IN', 50, 50, 'fixture')`;
    });
    return row!.id;
  };
  const ordinary: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    ordinary.push(await medicine(`Tab ${String(index).padStart(2, '0')}`, index % 3));
  }
  const insulin = await medicine('Insulin', 1, { cold: true });
  const morphine = await medicine('Morphine', 2, { locked: true });

  const planner = new ShelfPlannerService(db);
  const empty = await planner.state(actor);
  check('an unplanned shop has no floor yet', empty.floor === null && empty.version === 0);
  check(
    'stock counts reach the planner',
    empty.stats.stocked === 32 && empty.stats.unplaced === 32,
  );

  const starter = starterLayout(305, 610);
  const saved = await planner.saveLayout(actor, request(0, starter.floor, starter.fixtures));
  check('the starter shop saves as version 1', saved.version === 1, JSON.stringify(saved));
  let state = await planner.state(actor);
  const fixtures = state.fixtures as unknown as SavedFixture[];
  const rackA = fixtures.find((fixture) => fixture.code === 'A')!;
  const fridge = fixtures.find((fixture) => fixture.kind === 'FRIDGE')!;
  check(
    'every level becomes a coded shelf',
    rackA.levels.length === rackA.levelCount && rackA.levels[0]?.code === 'A-1',
    JSON.stringify(rackA.levels),
  );
  const priorities = await db<Array<{ code: string; pick_priority: number }>>`
    select code, pick_priority from shelves where branch_id = ${branchId} and is_active
    order by pick_priority`;
  check(
    'shelves are priced by seconds per pick',
    priorities.every((row) => row.pick_priority >= 1 && row.pick_priority < 6000) &&
      priorities[0]!.pick_priority < priorities.at(-1)!.pick_priority,
  );

  check(
    'a stale save is refused',
    (await rejects(
      planner.saveLayout(actor, request(0, starter.floor, starter.fixtures)),
      /changed the shop layout/,
    )) === 'ok',
  );
  const overlapping = fixtures.map((fixture, index) =>
    index === 1 ? { ...fixture, xCm: fixtures[0]!.xCm } : fixture,
  );
  check(
    'overlapping racks are refused',
    (await rejects(
      planner.saveLayout(actor, request(1, starter.floor, overlapping)),
      /overlap/,
    )) === 'ok',
  );

  const shelfA1 = rackA.levels[0]!.shelfId;
  check(
    'insulin cannot go on an ordinary shelf',
    (await rejects(
      planner.place(actor, { medicineId: BigInt(insulin), shelfId: BigInt(shelfA1) }),
      /fridge/,
    )) === 'ok',
  );
  await planner.place(actor, { medicineId: BigInt(ordinary[0]!), shelfId: BigInt(shelfA1) });
  const found = (await planner.searchMedicines(actor, 'Tab 00')).data;
  check('search shows where a medicine sits', found[0]?.shelfCode === 'A-1', JSON.stringify(found));
  const onShelf = await planner.shelfMedicines(actor, BigInt(shelfA1));
  check('a shelf lists its medicines', onShelf.data.length === 1);
  check(
    'a rack holding stock cannot be removed',
    (await rejects(
      planner.saveLayout(
        actor,
        request(
          1,
          starter.floor,
          fixtures.filter((fixture) => fixture.code !== 'A'),
        ),
      ),
      /still holds/,
    )) === 'ok',
  );

  // Swapping two labels keeps each shelf (and its medicines) with the physical rack.
  const rackB = fixtures.find((fixture) => fixture.code === 'B')!;
  const relabelled = fixtures.map((fixture) =>
    fixture.code === 'A'
      ? { ...fixture, code: 'B' }
      : fixture.code === 'B'
        ? { ...fixture, code: 'A' }
        : fixture,
  );
  const swapped = await planner.saveLayout(actor, request(1, starter.floor, relabelled));
  const relabelledShelf = await db<Array<{ code: string }>>`
    select code from shelves where id = ${shelfA1}`;
  check(
    'swapping rack labels keeps shelves with their racks',
    swapped.version === 2 && relabelledShelf[0]?.code === 'B-1' && rackB.id !== null,
    JSON.stringify(relabelledShelf),
  );

  const fresh = await planner.generateProposal(actor, { mode: 'FRESH', grouping: 'COMPANY' });
  const proposal = fresh.data as unknown as {
    id: string;
    moves: Array<{
      medicineId: string;
      to: { fixtureKey: string; level: number };
      toLabel: string;
    }>;
    unplaced: unknown[];
    fixtureChanges: Array<{ id: string }>;
    summary: { moveCount: number };
  };
  const insulinMove = proposal.moves.find((move) => move.medicineId === insulin);
  const morphineMove = proposal.moves.find((move) => move.medicineId === morphine);
  check(
    'the suggestion puts insulin in the fridge',
    insulinMove?.to.fixtureKey === `f${fridge.id}`,
    JSON.stringify(insulinMove),
  );
  check(
    'the suggestion locks up morphine',
    fixtures.find((fixture) => `f${fixture.id}` === morphineMove?.to.fixtureKey)?.isSecured ===
      true,
  );
  check('everything fits in the starter shop', proposal.unplaced.length === 0);
  check(
    'a reviewer without manage rights cannot move racks',
    proposal.fixtureChanges.length === 0 ||
      (await rejects(
        planner.applyProposal(reviewer, BigInt(proposal.id), {
          fixtureChangeIds: proposal.fixtureChanges.map((change) => change.id),
          moves: [],
        }),
        /manage permission/,
      )) === 'ok',
  );
  const applied = await planner.applyProposal(actor, BigInt(proposal.id), {
    fixtureChangeIds: [],
    moves: proposal.moves.map((move) => ({
      medicineId: BigInt(move.medicineId),
      fixtureKey: move.to.fixtureKey,
      level: move.to.level,
    })),
  });
  state = await planner.state(actor);
  check(
    'accepting the suggestion shelves every medicine',
    applied.moves === proposal.moves.length &&
      state.stats.unplaced === 0 &&
      state.stats.placed === 32,
    JSON.stringify({ applied, stats: state.stats }),
  );
  check(
    'a suggestion cannot be applied twice',
    (await rejects(
      planner.applyProposal(actor, BigInt(proposal.id), { fixtureChangeIds: [], moves: [] }),
      /already applied/,
    )) === 'ok',
  );

  const improve = (await planner.generateProposal(actor, { mode: 'IMPROVE', grouping: 'COMPANY' }))
    .data as unknown as { id: string; moves: unknown[] };
  check(
    'a tidy shop needs no improving',
    improve.moves.length === 0,
    JSON.stringify(improve.moves),
  );
  await planner.rejectProposal(actor, BigInt(improve.id));
  const [rejected] = await db<Array<{ status: string }>>`
    select status from shelf_layout_proposals where id = ${improve.id}`;
  check('a suggestion can be rejected', rejected?.status === 'REJECTED');

  // A layout change makes an open suggestion stale.
  const stale = (await planner.generateProposal(actor, { mode: 'FRESH', grouping: 'NAME' }))
    .data as unknown as { id: string };
  state = await planner.state(actor);
  await planner.saveLayout(actor, request(state.version, starter.floor, state.fixtures));
  check(
    'saving the layout retires the open suggestion',
    (await rejects(
      planner.applyProposal(actor, BigInt(stale.id), { fixtureChangeIds: [], moves: [] }),
      /already applied, rejected, or replaced/,
    )) === 'ok',
  );

  // Squeeze capacity until stock overflows in a wider room: the planner asks for a new rack on
  // the free east wall.
  for (let index = 0; index < 80; index += 1) {
    await medicine(`Syrup ${String(index).padStart(2, '0')}`, index % 3);
  }
  state = await planner.state(actor);
  const squeezed = (state.fixtures as unknown as SavedFixture[]).map((fixture) =>
    fixture.kind === 'FRIDGE' ? fixture : { ...fixture, facingsPerLevel: 1 },
  );
  await planner.saveLayout(
    actor,
    request(state.version, { ...starter.floor, widthCm: 600, depthCm: 900 }, squeezed),
  );
  state = await planner.state(actor);
  const overflow = (await planner.generateProposal(actor, { mode: 'FRESH', grouping: 'FORM' }))
    .data as unknown as {
    id: string;
    fixtureChanges: Array<{ id: string; type: string; fixture?: { key: string } }>;
    moves: Array<{ medicineId: string; to: { fixtureKey: string; level: number } }>;
  };
  const additions = overflow.fixtureChanges.filter((change) => change.type === 'ADD');
  const toNew = overflow.moves.filter((move) => move.to.fixtureKey.startsWith('new-'));
  check(
    'overflowing stock asks for a new rack',
    additions.length > 0 && toNew.length > 0,
    JSON.stringify(overflow.fixtureChanges),
  );
  const asMoves = overflow.moves.map((move) => ({
    medicineId: BigInt(move.medicineId),
    fixtureKey: move.to.fixtureKey,
    level: move.to.level,
  }));
  check(
    'moves onto a rack you did not accept are refused',
    (await rejects(
      planner.applyProposal(actor, BigInt(overflow.id), { fixtureChangeIds: [], moves: asMoves }),
      /did not accept/,
    )) === 'ok',
  );
  const accepted = await planner.applyProposal(actor, BigInt(overflow.id), {
    fixtureChangeIds: overflow.fixtureChanges.map((change) => change.id),
    moves: asMoves,
  });
  const after = await planner.state(actor);
  check(
    'accepting a new rack builds it with its shelves',
    accepted.fixtureChanges === overflow.fixtureChanges.length &&
      after.fixtures.length > state.fixtures.length &&
      after.version === accepted.version,
    JSON.stringify({ accepted, before: state.fixtures.length, after: after.fixtures.length }),
  );
  const [audits] = await db<Array<{ count: number }>>`
    select count(*)::int as count from audit_events
    where branch_id = ${branchId} and event_type like 'SHELF%'`;
  check('every planner change is audited', (audits?.count ?? 0) >= 8);
}
