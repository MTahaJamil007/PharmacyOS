import { describe, expect, it } from 'vitest';

import {
  applyFixtureChanges,
  boxBounds,
  buildWalkMap,
  FIXTURE_DEFAULTS,
  frontClearanceCm,
  levelReachHeightCm,
  pickPoint,
  placeNewFixture,
  planPlacements,
  plannerSlots,
  slotId,
  slotTimings,
  starterLayout,
  suggestFixtureChanges,
  suggestNewFixtures,
  validateLayout,
  walkDistanceCm,
  walkPath,
  type FixtureLayout,
  type FloorPlan,
  type PlannerMedicine,
  type PlannerSlot,
} from './shelf-planner.js';

const floor: FloorPlan = {
  widthCm: 400,
  depthCm: 600,
  counter: { xCm: 200, yCm: 480, widthCm: 240, depthCm: 60, rotation: 0 },
  entrance: { wall: 'SOUTH', offsetCm: 140, widthCm: 120 },
};

function rack(key: string, overrides: Partial<FixtureLayout> = {}): FixtureLayout {
  const defaults = FIXTURE_DEFAULTS.WALL_RACK;
  return {
    key,
    code: key.toUpperCase(),
    name: 'Rack',
    kind: 'WALL_RACK',
    xCm: 200,
    yCm: 20,
    widthCm: defaults.widthCm,
    depthCm: defaults.depthCm,
    heightCm: defaults.heightCm,
    levelCount: defaults.levelCount,
    facingsPerLevel: defaults.facingsPerLevel,
    storageClass: 'AMBIENT',
    isSecured: false,
    rotation: 0,
    ...overrides,
  };
}

function medicine(id: string, overrides: Partial<PlannerMedicine> = {}): PlannerMedicine {
  return {
    id,
    name: `Medicine ${id.padStart(3, '0')}`,
    groupKey: 'g',
    groupLabel: 'Group',
    picksPerMonth: 0,
    storageClass: 'AMBIENT',
    requiresSecured: false,
    current: null,
    ...overrides,
  };
}

function slot(key: string, level: number, seconds: number, overrides: Partial<PlannerSlot> = {}) {
  return {
    fixtureKey: key,
    level,
    fixtureCode: key.toUpperCase(),
    secondsPerPick: seconds,
    capacity: 2,
    storageClass: 'AMBIENT',
    isSecured: false,
    fixtureRank: 0,
    ...overrides,
  } satisfies PlannerSlot;
}

describe('shelf planner geometry', () => {
  it('turns a fixture footprint and points its front the right way', () => {
    const turned = rack('a', { xCm: 20, yCm: 300, rotation: 270 });
    expect(boxBounds(turned)).toEqual({ minX: 0, maxX: 40, minY: 240, maxY: 360 });
    expect(pickPoint(turned)).toEqual({ x: 75, y: 300 });
    expect(pickPoint(rack('b', { rotation: 90, xCm: 380, yCm: 300 }))).toEqual({ x: 325, y: 300 });
  });

  it('builds a starter shop that is valid, reachable, and faces every rack into the room', () => {
    const starter = starterLayout(305, 610);
    expect(starter.fixtures.length).toBeGreaterThanOrEqual(6);
    expect(starter.fixtures.some((fixture) => fixture.kind === 'FRIDGE')).toBe(true);
    expect(starter.fixtures.some((fixture) => fixture.kind === 'SECURED_CABINET')).toBe(true);
    expect(validateLayout(starter.floor, starter.fixtures)).toEqual([]);
    const codes = starter.fixtures.map((fixture) => fixture.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('walks around obstacles rather than through them', () => {
    const wall = rack('a', { xCm: 200, yCm: 300, widthCm: 280, depthCm: 40 });
    const behind = { x: 200, y: 150 };
    const open = buildWalkMap(floor, []);
    const blocked = buildWalkMap(floor, [wall]);
    const straight = walkDistanceCm(open, behind)!;
    const around = walkDistanceCm(blocked, behind)!;
    expect(straight).toBeGreaterThan(200);
    expect(straight).toBeLessThan(290);
    expect(around).toBeGreaterThan(straight + 100);
    const path = walkPath(blocked, behind);
    expect(path[0]).toEqual(blocked.origin);
    expect(path.at(-1)).toEqual(behind);
  });

  it('reports a fixture that is shut off from the counter', () => {
    const fence = rack('a', { xCm: 200, yCm: 300, widthCm: 400, depthCm: 40 });
    const cutOff = rack('b', { xCm: 200, yCm: 20 });
    const issues = validateLayout(floor, [fence, cutOff]);
    expect(issues.map((issue) => issue.code)).toContain('UNREACHABLE');
  });

  it('refuses overlapping, escaping, and duplicate fixtures and warns about blocked fronts', () => {
    const issues = validateLayout(floor, [
      rack('a'),
      rack('b', { xCm: 250, code: 'A' }),
      rack('c', { xCm: 390 }),
      rack('d', { xCm: 60, yCm: 300, rotation: 90, code: 'D' }),
    ]);
    const codes = issues.map((issue) => `${issue.severity}:${issue.code}`);
    expect(codes).toContain('error:OVERLAP');
    expect(codes).toContain('error:OUTSIDE_ROOM');
    expect(codes).toContain('error:DUPLICATE_CODE');
    expect(codes).toContain('warning:FRONT_BLOCKED');
  });

  it('measures the aisle in front of a corner rack past its neighbour', () => {
    const back = rack('a', { xCm: 60, yCm: 20 });
    const side = rack('b', { xCm: 20, yCm: 100, rotation: 270 });
    expect(frontClearanceCm(back, [boxBounds(side)], floor)).toBe(560);
    const facingWall = rack('c', { xCm: 300, yCm: 20, rotation: 180 });
    expect(frontClearanceCm(facingWall, [], floor)).toBe(0);
  });

  it('prices eye level quicker than the floor and the fridge slower than a rack', () => {
    const near = rack('a', { xCm: 200, yCm: 300, rotation: 0, levelCount: 7 });
    const timings = slotTimings(floor, [near]);
    const eye = timings.find((timing) => timing.level === 3)!;
    const bottom = timings.find((timing) => timing.level === 7)!;
    const top = timings.find((timing) => timing.level === 1)!;
    expect(levelReachHeightCm(near, 3)).toBeGreaterThan(75);
    expect(levelReachHeightCm(near, 3)).toBeLessThanOrEqual(160);
    expect(eye.secondsPerPick).toBeLessThan(bottom.secondsPerPick);
    expect(eye.secondsPerPick).toBeLessThan(top.secondsPerPick);
    const fridge = { ...near, key: 'f', kind: 'FRIDGE' as const, storageClass: 'COLD' as const };
    const fridgeEye = slotTimings(floor, [fridge]).find((timing) => timing.level === 3)!;
    expect(fridgeEye.secondsPerPick).toBe(eye.secondsPerPick + 3);
  });
});

describe('medicine slotting', () => {
  it('fresh plans put fast movers on the quickest shelves and keep groups together', () => {
    const slots = [
      slot('a', 1, 5, { fixtureRank: 1 }),
      slot('a', 2, 4, { fixtureRank: 1 }),
      slot('b', 1, 2, { fixtureRank: 0 }),
      slot('b', 2, 3, { fixtureRank: 0 }),
    ];
    const medicines = [
      medicine('1', { picksPerMonth: 40, groupKey: 'fast', groupLabel: 'Fast' }),
      medicine('2', { groupKey: 'a', groupLabel: 'Alpha', name: 'Beta tabs' }),
      medicine('3', { groupKey: 'a', groupLabel: 'Alpha', name: 'Alpha tabs' }),
      medicine('4', { groupKey: 'z', groupLabel: 'Zeta' }),
      medicine('5', { groupKey: 'z', groupLabel: 'Zeta' }),
    ];
    const plan = planPlacements({ slots, medicines, mode: 'FRESH' });
    expect(plan.unplaced).toEqual([]);
    expect(plan.placements.get('1')).toEqual({ fixtureKey: 'b', level: 1 });
    // Alpha comes first alphabetically and follows reading order on the quickest rack.
    expect(plan.placements.get('3')).toEqual({ fixtureKey: 'b', level: 1 });
    expect(plan.placements.get('2')).toEqual({ fixtureKey: 'b', level: 2 });
    expect(plan.moves.every((move) => move.reason === 'NOT_ON_SHELF')).toBe(true);
    const counts = new Map<string, number>();
    for (const placed of plan.placements.values()) {
      counts.set(slotId(placed), (counts.get(slotId(placed)) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('keeps cold and controlled medicines in the fridge and the locked cabinet', () => {
    const slots = [
      slot('rack', 1, 2),
      slot('fridge', 1, 6, { storageClass: 'COLD' }),
      slot('lock', 1, 9, { isSecured: true }),
    ];
    const plan = planPlacements({
      slots,
      medicines: [
        medicine('1', { storageClass: 'COLD' }),
        medicine('2', { requiresSecured: true }),
        medicine('3', { storageClass: 'COLD' }),
        medicine('4', { storageClass: 'COLD' }),
        medicine('5'),
        medicine('6'),
        medicine('7'),
      ],
      mode: 'FRESH',
    });
    expect(plan.placements.get('1')?.fixtureKey).toBe('fridge');
    expect(plan.placements.get('2')?.fixtureKey).toBe('lock');
    expect(plan.unplaced).toEqual([{ medicineId: '4', reason: 'NO_COLD_SPACE' }]);
    // Ordinary medicines only use the spare locked space when the open racks are full.
    expect(plan.placements.get('7')?.fixtureKey).toBe('lock');
  });

  it('improve mode leaves a working shop alone and only moves what pays off', () => {
    const slots = [slot('near', 1, 2), slot('far', 1, 12)];
    const medicines = [
      medicine('fast', { picksPerMonth: 90, current: { fixtureKey: 'far', level: 1 } }),
      medicine('slow', { picksPerMonth: 1, current: { fixtureKey: 'near', level: 1 } }),
      medicine('other', { picksPerMonth: 0, current: { fixtureKey: 'near', level: 1 } }),
      medicine('cold', { storageClass: 'COLD', current: { fixtureKey: 'far', level: 1 } }),
    ];
    const plan = planPlacements({ slots, medicines, mode: 'IMPROVE' });
    const moves = new Map(plan.moves.map((move) => [move.medicineId, move]));
    expect(moves.get('fast')).toMatchObject({
      to: { fixtureKey: 'near', level: 1 },
      reason: 'FAST_MOVER',
      secondsSavedPerMonth: 900,
    });
    expect(moves.get('other')).toMatchObject({ to: { fixtureKey: 'far', level: 1 } });
    expect(moves.get('other')?.reason).toBe('MAKE_ROOM');
    expect(moves.has('slow')).toBe(false);
    expect(plan.unplaced).toEqual([{ medicineId: 'cold', reason: 'NO_COLD_SPACE' }]);
    expect(plan.secondsSavedPerMonth).toBe(900);
  });

  it('improve mode puts a medicine with no shelf next to its own group', () => {
    const slots = [slot('a', 1, 2, { capacity: 5 }), slot('b', 1, 8, { capacity: 5 })];
    const plan = planPlacements({
      slots,
      medicines: [
        medicine('1', {
          groupKey: 'gsk',
          groupLabel: 'GSK',
          current: { fixtureKey: 'b', level: 1 },
        }),
        medicine('2', { groupKey: 'gsk', groupLabel: 'GSK' }),
      ],
      mode: 'IMPROVE',
    });
    expect(plan.moves).toEqual([
      {
        medicineId: '2',
        from: null,
        to: { fixtureKey: 'b', level: 1 },
        reason: 'NOT_ON_SHELF',
        secondsSavedPerMonth: 0,
      },
    ]);
  });

  it('plans thousands of medicines quickly', () => {
    const starter = starterLayout(400, 900);
    const slots = plannerSlots(starter.floor, starter.fixtures);
    const medicines = Array.from({ length: 4000 }, (_, index) =>
      medicine(String(index + 1), {
        groupKey: `g${index % 40}`,
        groupLabel: `Company ${index % 40}`,
        picksPerMonth: index % 17 === 0 ? 30 : index % 5,
      }),
    );
    const started = performance.now();
    const plan = planPlacements({ slots, medicines, mode: 'FRESH' });
    expect(performance.now() - started).toBeLessThan(1500);
    const capacity = slots
      .filter((item) => item.storageClass === 'AMBIENT')
      .reduce((sum, item) => sum + item.capacity, 0);
    expect(plan.placements.size).toBe(Math.min(capacity, 4000));
    expect(plan.unplaced.length).toBe(4000 - plan.placements.size);
  });
});

describe('fixture suggestions', () => {
  it('turns a rack that faces the wall', () => {
    const backwards = rack('a', { xCm: 200, yCm: 20, rotation: 180 });
    const changes = suggestFixtureChanges({
      floor,
      fixtures: [backwards],
      picksByFixture: new Map(),
    });
    expect(changes).toEqual([
      expect.objectContaining({ type: 'ROTATE', fixtureKey: 'a', rotation: 0 }),
    ]);
  });

  it('swaps a busy far rack with a quiet rack of the same size near the counter', () => {
    const near = rack('near', { xCm: 20, yCm: 330, rotation: 270 });
    const far = rack('far', { xCm: 200, yCm: 20, rotation: 0 });
    const changes = suggestFixtureChanges({
      floor,
      fixtures: [near, far],
      picksByFixture: new Map([
        ['far', 900],
        ['near', 10],
      ]),
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'SWAP', fixtureKey: 'far', otherKey: 'near' });
    const swapped = applyFixtureChanges([near, far], changes);
    expect(swapped.find((fixture) => fixture.key === 'far')).toMatchObject({
      xCm: 20,
      yCm: 330,
      rotation: 270,
    });
  });

  it('adds racks and a fridge on free walls when stock does not fit', () => {
    const starter = starterLayout(400, 900);
    const changes = suggestNewFixtures({
      floor: starter.floor,
      fixtures: starter.fixtures.slice(0, 3),
      shortfall: { ambient: 300, cold: 5, locked: 0 },
    });
    expect(
      changes.some((change) => change.type === 'ADD' && change.fixture.kind === 'FRIDGE'),
    ).toBe(true);
    expect(changes.filter((change) => change.type === 'ADD').length).toBeGreaterThanOrEqual(2);
    const after = applyFixtureChanges(starter.fixtures.slice(0, 3), changes);
    expect(
      validateLayout(starter.floor, after).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
    expect(
      validateLayout(starter.floor, after).filter((issue) => issue.code === 'FRONT_BLOCKED'),
    ).toEqual([]);
  });
});

describe('adding a fixture', () => {
  it('finds the quickest free wall spot and an open floor spot for a stand', () => {
    const starter = starterLayout(400, 900);
    const partial = starter.fixtures.slice(0, 2);
    const wall = placeNewFixture(starter.floor, partial, 'WALL_RACK');
    expect(wall).not.toBeNull();
    const added = [...partial, rack('n', { ...wall! })];
    expect(
      validateLayout(starter.floor, added).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
    const stand = placeNewFixture(starter.floor, starter.fixtures, 'ISLAND_RACK');
    expect(stand).not.toBeNull();
    const withStand = [...starter.fixtures, rack('s', { ...stand!, widthCm: 120, depthCm: 60 })];
    expect(
      validateLayout(starter.floor, withStand).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
  });

  it('reports no spot when the shop is full', () => {
    const tiny: FloorPlan = {
      widthCm: 160,
      depthCm: 200,
      counter: { xCm: 80, yCm: 140, widthCm: 150, depthCm: 60, rotation: 0 },
      entrance: { wall: 'SOUTH', offsetCm: 20, widthCm: 120 },
    };
    expect(placeNewFixture(tiny, [], 'ISLAND_RACK')).toBeNull();
  });
});
