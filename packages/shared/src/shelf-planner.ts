/**
 * Shelf planner: shop geometry, walking cost, and medicine slotting.
 *
 * Shared by the API, which stores and applies plans, and the web planner, which previews the same
 * numbers live while the owner drags racks around. Everything here is deterministic: the same
 * layout, medicines, and sales always produce the same plan.
 *
 * Coordinates are centimetres on the shop floor seen from above. x grows to the right (east) and
 * y grows toward the street (south). A box's x/y is its centre. Rotation 0 means the open front of
 * a fixture faces south; rotations turn clockwise. Level 1 is the top shelf, the way staff read a
 * rack from top to bottom.
 */

export const FIXTURE_KINDS = [
  'WALL_RACK',
  'ISLAND_RACK',
  'FRIDGE',
  'SECURED_CABINET',
  'DISPLAY',
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export const SHELF_STORAGE_CLASSES = ['AMBIENT', 'COLD', 'FROZEN', 'OTHER'] as const;
export type ShelfStorageClass = (typeof SHELF_STORAGE_CLASSES)[number];

export const FIXTURE_ROTATIONS = [0, 90, 180, 270] as const;
export type FixtureRotation = (typeof FIXTURE_ROTATIONS)[number];

export const ENTRANCE_WALLS = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
export type EntranceWall = (typeof ENTRANCE_WALLS)[number];

export const PLAN_MODES = ['IMPROVE', 'FRESH'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export const PLACEMENT_GROUPINGS = ['COMPANY', 'FORM', 'NAME'] as const;
export type PlacementGrouping = (typeof PLACEMENT_GROUPINGS)[number];

export interface PlacedBox {
  readonly xCm: number;
  readonly yCm: number;
  readonly widthCm: number;
  readonly depthCm: number;
  readonly rotation: FixtureRotation;
}

export interface Entrance {
  readonly wall: EntranceWall;
  /** Distance along the wall from its west (north/south walls) or north (east/west walls) end. */
  readonly offsetCm: number;
  readonly widthCm: number;
}

export interface FloorPlan {
  readonly widthCm: number;
  readonly depthCm: number;
  /** The counter's front faces the customers; staff stand behind it. */
  readonly counter: PlacedBox;
  readonly entrance: Entrance;
}

export interface FixtureLayout extends PlacedBox {
  /** `f<id>` for a saved fixture, anything else for one that only exists on screen or in a plan. */
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly kind: FixtureKind;
  readonly heightCm: number;
  readonly levelCount: number;
  /** How many different medicines fit side by side on one level. */
  readonly facingsPerLevel: number;
  readonly storageClass: ShelfStorageClass;
  readonly isSecured: boolean;
}

export interface FixtureDefaults {
  readonly label: string;
  readonly widthCm: number;
  readonly depthCm: number;
  readonly heightCm: number;
  readonly levelCount: number;
  readonly facingsPerLevel: number;
  readonly storageClass: ShelfStorageClass;
  readonly isSecured: boolean;
}

export const FIXTURE_DEFAULTS: Readonly<Record<FixtureKind, FixtureDefaults>> = {
  WALL_RACK: {
    label: 'Wall rack',
    widthCm: 120,
    depthCm: 40,
    heightCm: 210,
    levelCount: 7,
    facingsPerLevel: 24,
    storageClass: 'AMBIENT',
    isSecured: false,
  },
  ISLAND_RACK: {
    label: 'Island stand',
    widthCm: 120,
    depthCm: 60,
    heightCm: 150,
    levelCount: 5,
    facingsPerLevel: 20,
    storageClass: 'AMBIENT',
    isSecured: false,
  },
  FRIDGE: {
    label: 'Fridge',
    widthCm: 60,
    depthCm: 65,
    heightCm: 185,
    levelCount: 5,
    facingsPerLevel: 10,
    storageClass: 'COLD',
    isSecured: false,
  },
  SECURED_CABINET: {
    label: 'Locked cabinet',
    widthCm: 80,
    depthCm: 40,
    heightCm: 120,
    levelCount: 4,
    facingsPerLevel: 16,
    storageClass: 'AMBIENT',
    isSecured: true,
  },
  DISPLAY: {
    label: 'Glass display',
    widthCm: 100,
    depthCm: 50,
    heightCm: 100,
    levelCount: 2,
    facingsPerLevel: 14,
    storageClass: 'AMBIENT',
    isSecured: false,
  },
};

/** Staff walk about one metre a second inside a busy shop. */
export const WALK_CM_PER_SECOND = 100;
/** Where staff stand to pick from a fixture, in front of its open face. */
export const PICK_STANDOFF_CM = 35;
/** Where the order taker stands behind the counter. */
export const STAFF_STANDOFF_CM = 45;
/** Comfortable space in front of a rack; below the minimum nobody can pick from it. */
export const COMFORTABLE_AISLE_CM = 75;
export const MINIMUM_AISLE_CM = 50;
/** Medicines picked at least this often a month are pulled to the quickest shelves first. */
export const FAST_MOVER_PICKS_PER_MONTH = 8;

const KIND_PENALTY_SECONDS: Readonly<Record<FixtureKind, number>> = {
  WALL_RACK: 0,
  ISLAND_RACK: 0,
  DISPLAY: 1,
  FRIDGE: 3,
  SECURED_CABINET: 8,
};
const UNREACHABLE_SECONDS = 600;
const EPSILON = 0.5;
const BODY_CLEARANCE_CM = 15;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function fixtureKey(id: string): string {
  return `f${id}`;
}

export function shelfCode(fixtureCode: string, level: number): string {
  return `${fixtureCode}-${level}`;
}

export function isTurned(rotation: FixtureRotation): boolean {
  return rotation === 90 || rotation === 270;
}

export function boxBounds(box: PlacedBox): Bounds {
  const halfWidth = (isTurned(box.rotation) ? box.depthCm : box.widthCm) / 2;
  const halfDepth = (isTurned(box.rotation) ? box.widthCm : box.depthCm) / 2;
  return {
    minX: box.xCm - halfWidth,
    maxX: box.xCm + halfWidth,
    minY: box.yCm - halfDepth,
    maxY: box.yCm + halfDepth,
  };
}

export function frontVector(rotation: FixtureRotation): Point {
  switch (rotation) {
    case 0:
      return { x: 0, y: 1 };
    case 90:
      return { x: -1, y: 0 };
    case 180:
      return { x: 0, y: -1 };
    case 270:
      return { x: 1, y: 0 };
  }
}

export function rotateClockwise(rotation: FixtureRotation): FixtureRotation {
  return ((rotation + 90) % 360) as FixtureRotation;
}

export function pickPoint(box: PlacedBox): Point {
  const front = frontVector(box.rotation);
  const reach = box.depthCm / 2 + PICK_STANDOFF_CM;
  return { x: box.xCm + front.x * reach, y: box.yCm + front.y * reach };
}

export function staffPoint(floor: FloorPlan): Point {
  const front = frontVector(floor.counter.rotation);
  const reach = floor.counter.depthCm / 2 + STAFF_STANDOFF_CM;
  return { x: floor.counter.xCm - front.x * reach, y: floor.counter.yCm - front.y * reach };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.minX < b.maxX - EPSILON &&
    b.minX < a.maxX - EPSILON &&
    a.minY < b.maxY - EPSILON &&
    b.minY < a.maxY - EPSILON
  );
}

function outsideBy(bounds: Bounds, floor: FloorPlan): number {
  return Math.max(
    0,
    -bounds.minX,
    -bounds.minY,
    bounds.maxX - floor.widthCm,
    bounds.maxY - floor.depthCm,
  );
}

/** The doorway, extended 90 cm into the shop, which must stay clear. */
export function entranceZone(floor: FloorPlan): Bounds {
  const { wall, offsetCm, widthCm } = floor.entrance;
  const inward = 90;
  switch (wall) {
    case 'NORTH':
      return { minX: offsetCm, maxX: offsetCm + widthCm, minY: 0, maxY: inward };
    case 'SOUTH':
      return {
        minX: offsetCm,
        maxX: offsetCm + widthCm,
        minY: floor.depthCm - inward,
        maxY: floor.depthCm,
      };
    case 'WEST':
      return { minX: 0, maxX: inward, minY: offsetCm, maxY: offsetCm + widthCm };
    case 'EAST':
      return {
        minX: floor.widthCm - inward,
        maxX: floor.widthCm,
        minY: offsetCm,
        maxY: offsetCm + widthCm,
      };
  }
}

/**
 * Free space in front of a fixture's open face, up to the wall or the nearest obstacle.
 *
 * Measured at five points across the face and the median taken, so a rack in a corner whose end
 * is covered by the neighbouring rack still counts as reachable, while one facing a wall does not.
 */
export function frontClearanceCm(
  box: PlacedBox,
  obstacles: readonly Bounds[],
  floor: FloorPlan,
): number {
  const own = boxBounds(box);
  const front = frontVector(box.rotation);
  // Express everything as "distance ahead" and "sideways span" in the fixture's own frame.
  const ahead = (bounds: Bounds): { near: number; from: number; to: number } => {
    if (front.y === 1) return { near: bounds.minY, from: bounds.minX, to: bounds.maxX };
    if (front.y === -1) return { near: -bounds.maxY, from: bounds.minX, to: bounds.maxX };
    if (front.x === 1) return { near: bounds.minX, from: bounds.minY, to: bounds.maxY };
    return { near: -bounds.maxX, from: bounds.minY, to: bounds.maxY };
  };
  const span = ahead(own);
  const face =
    front.y === 1 ? own.maxY : front.y === -1 ? -own.minY : front.x === 1 ? own.maxX : -own.minX;
  const wall =
    front.y === 1 ? floor.depthCm : front.y === -1 ? 0 : front.x === 1 ? floor.widthCm : 0;
  const toWall = (front.y === -1 || front.x === -1 ? -wall : wall) - face;
  const others = obstacles.map(ahead).filter((other) => other.near >= face - EPSILON);
  const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map((share) => {
    const at = span.from + (span.to - span.from) * share;
    let clearance = toWall;
    for (const other of others) {
      if (at > other.from && at < other.to) clearance = Math.min(clearance, other.near - face);
    }
    return clearance;
  });
  samples.sort((a, b) => a - b);
  return Math.max(0, Math.round(samples[2]!));
}

export type LayoutIssueSeverity = 'error' | 'warning';

export interface LayoutIssue {
  readonly severity: LayoutIssueSeverity;
  readonly code:
    | 'COUNTER_OUTSIDE'
    | 'OUTSIDE_ROOM'
    | 'OVERLAP'
    | 'DUPLICATE_CODE'
    | 'BLOCKS_ENTRANCE'
    | 'FRONT_BLOCKED'
    | 'NARROW_AISLE'
    | 'UNREACHABLE';
  readonly message: string;
  readonly fixtureKeys: readonly string[];
}

function fixtureLabel(fixture: FixtureLayout): string {
  return `${fixture.name} (${fixture.code})`;
}

/**
 * Errors make a layout impossible to build (pieces outside the shop or inside each other) and are
 * refused on save. Warnings describe a layout that works but slows staff down.
 */
export function validateLayout(
  floor: FloorPlan,
  fixtures: readonly FixtureLayout[],
  options: { readonly walkMap?: WalkMap; readonly reachability?: boolean } = {},
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const counter = boxBounds(floor.counter);
  if (outsideBy(counter, floor) > EPSILON) {
    issues.push({
      severity: 'error',
      code: 'COUNTER_OUTSIDE',
      message: 'The counter sticks out of the shop. Move it inside the walls.',
      fixtureKeys: [],
    });
  }
  const bounds = fixtures.map((fixture) => boxBounds(fixture));
  const codes = new Map<string, string>();
  const entrance = entranceZone(floor);
  if (overlaps(counter, entrance)) {
    issues.push({
      severity: 'warning',
      code: 'BLOCKS_ENTRANCE',
      message: 'The counter is inside the doorway. Customers need about 90 cm to walk in.',
      fixtureKeys: [],
    });
  }
  fixtures.forEach((fixture, index) => {
    const own = bounds[index]!;
    const outside = outsideBy(own, floor);
    if (outside > EPSILON) {
      issues.push({
        severity: 'error',
        code: 'OUTSIDE_ROOM',
        message: `${fixtureLabel(fixture)} sticks out of the shop by ${Math.ceil(outside)} cm.`,
        fixtureKeys: [fixture.key],
      });
    }
    if (overlaps(own, counter)) {
      issues.push({
        severity: 'error',
        code: 'OVERLAP',
        message: `${fixtureLabel(fixture)} is inside the counter.`,
        fixtureKeys: [fixture.key],
      });
    }
    for (let other = index + 1; other < fixtures.length; other += 1) {
      if (overlaps(own, bounds[other]!)) {
        issues.push({
          severity: 'error',
          code: 'OVERLAP',
          message: `${fixtureLabel(fixture)} and ${fixtureLabel(fixtures[other]!)} overlap.`,
          fixtureKeys: [fixture.key, fixtures[other]!.key],
        });
      }
    }
    const code = fixture.code.trim().toUpperCase();
    const duplicate = codes.get(code);
    if (duplicate) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_CODE',
        message: `Two fixtures use the label ${code}. Each rack needs its own label.`,
        fixtureKeys: [duplicate, fixture.key],
      });
    } else {
      codes.set(code, fixture.key);
    }
    if (overlaps(own, entrance)) {
      issues.push({
        severity: 'warning',
        code: 'BLOCKS_ENTRANCE',
        message: `${fixtureLabel(fixture)} blocks the doorway.`,
        fixtureKeys: [fixture.key],
      });
    }
    const obstacles = [counter, ...bounds.filter((_, other) => other !== index)];
    const clearance = frontClearanceCm(fixture, obstacles, floor);
    if (clearance < MINIMUM_AISLE_CM) {
      issues.push({
        severity: 'warning',
        code: 'FRONT_BLOCKED',
        message: `${fixtureLabel(fixture)} faces a wall or another fixture (${clearance} cm free). Turn it around so staff can reach it.`,
        fixtureKeys: [fixture.key],
      });
    } else if (clearance < COMFORTABLE_AISLE_CM) {
      issues.push({
        severity: 'warning',
        code: 'NARROW_AISLE',
        message: `Only ${clearance} cm to stand in front of ${fixtureLabel(fixture)}. About ${COMFORTABLE_AISLE_CM} cm is comfortable.`,
        fixtureKeys: [fixture.key],
      });
    }
  });
  if (options.reachability !== false && !issues.some((issue) => issue.severity === 'error')) {
    const map = options.walkMap ?? buildWalkMap(floor, fixtures);
    for (const fixture of fixtures) {
      const blocked = issues.some(
        (issue) => issue.code === 'FRONT_BLOCKED' && issue.fixtureKeys.includes(fixture.key),
      );
      if (!blocked && walkDistanceCm(map, pickPoint(fixture)) === null) {
        issues.push({
          severity: 'warning',
          code: 'UNREACHABLE',
          message: `Staff cannot walk from the counter to ${fixtureLabel(fixture)}. Open a path to it.`,
          fixtureKeys: [fixture.key],
        });
      }
    }
  }
  return issues;
}

export interface WalkMap {
  readonly cellCm: number;
  readonly columns: number;
  readonly rows: number;
  /** Walking distance in cm from the staff position to each cell's centre; Infinity when walled off. */
  readonly distance: Float64Array;
  /** The previous cell on the shortest path, or -1. */
  readonly previous: Int32Array;
  readonly blocked: Uint8Array;
  readonly origin: Point;
}

/** Shortest walking distances from behind the counter, around every fixture, on a fine grid. */
export function buildWalkMap(
  floor: FloorPlan,
  fixtures: readonly PlacedBox[],
  cellCm = 20,
): WalkMap {
  const columns = Math.max(1, Math.ceil(floor.widthCm / cellCm));
  const rows = Math.max(1, Math.ceil(floor.depthCm / cellCm));
  const total = columns * rows;
  const blocked = new Uint8Array(total);
  const obstacles = [floor.counter, ...fixtures].map((box) => {
    const bounds = boxBounds(box);
    return {
      minX: bounds.minX - BODY_CLEARANCE_CM,
      minY: bounds.minY - BODY_CLEARANCE_CM,
      maxX: bounds.maxX + BODY_CLEARANCE_CM,
      maxY: bounds.maxY + BODY_CLEARANCE_CM,
    };
  });
  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) * cellCm;
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * cellCm;
      if (
        x > floor.widthCm ||
        y > floor.depthCm ||
        obstacles.some((o) => x > o.minX && x < o.maxX && y > o.minY && y < o.maxY)
      ) {
        blocked[row * columns + column] = 1;
      }
    }
  }
  const distance = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(total).fill(-1);
  const origin = staffPoint(floor);
  const map: WalkMap = { cellCm, columns, rows, distance, previous, blocked, origin };
  const start = nearestOpenCell(map, origin, 10, false);
  if (start < 0) return map;
  distance[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);
  const diagonal = cellCm * Math.SQRT2;
  while (heap.size > 0) {
    const [cell, cost] = heap.pop();
    if (cost > distance[cell]!) continue;
    const row = Math.floor(cell / columns);
    const column = cell % columns;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextRow = row + dy;
        const nextColumn = column + dx;
        if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
        const next = nextRow * columns + nextColumn;
        if (blocked[next]) continue;
        // No squeezing diagonally between two obstacles that touch at a corner.
        if (dx !== 0 && dy !== 0) {
          if (blocked[row * columns + nextColumn] || blocked[nextRow * columns + column]) continue;
        }
        const nextCost = cost + (dx !== 0 && dy !== 0 ? diagonal : cellCm);
        if (nextCost < distance[next]!) {
          distance[next] = nextCost;
          previous[next] = cell;
          heap.push(next, nextCost);
        }
      }
    }
  }
  return map;
}

/** The closest walkable cell to a point; with `reached`, only cells the counter can walk to. */
function nearestOpenCell(map: WalkMap, point: Point, radius: number, reached = true): number {
  const column = Math.floor(point.x / map.cellCm);
  const row = Math.floor(point.y / map.cellCm);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring <= radius && best < 0; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const r = row + dy;
        const c = column + dx;
        if (r < 0 || r >= map.rows || c < 0 || c >= map.columns) continue;
        const cell = r * map.columns + c;
        if (map.blocked[cell]) continue;
        if (reached && !Number.isFinite(map.distance[cell]!)) continue;
        const cx = (c + 0.5) * map.cellCm - point.x;
        const cy = (r + 0.5) * map.cellCm - point.y;
        const away = Math.hypot(cx, cy);
        if (away < bestDistance) {
          bestDistance = away;
          best = cell;
        }
      }
    }
  }
  return best;
}

/** Walking distance in cm from behind the counter to a point, or null when it cannot be reached. */
export function walkDistanceCm(map: WalkMap, point: Point): number | null {
  const cell = nearestOpenCell(map, point, 3);
  if (cell < 0) return null;
  const column = cell % map.columns;
  const row = Math.floor(cell / map.columns);
  const last = Math.hypot(
    (column + 0.5) * map.cellCm - point.x,
    (row + 0.5) * map.cellCm - point.y,
  );
  return Math.round(map.distance[cell]! + last);
}

/** The walking route from behind the counter to a point, for drawing on the plan. */
export function walkPath(map: WalkMap, point: Point): Point[] {
  let cell = nearestOpenCell(map, point, 3);
  if (cell < 0) return [];
  const path: Point[] = [point];
  let guard = map.columns * map.rows;
  while (cell >= 0 && guard > 0) {
    const column = cell % map.columns;
    const row = Math.floor(cell / map.columns);
    path.push({ x: (column + 0.5) * map.cellCm, y: (row + 0.5) * map.cellCm });
    cell = map.previous[cell]!;
    guard -= 1;
  }
  path.push(map.origin);
  return path.reverse();
}

class MinHeap {
  private readonly cells: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, cost: number): void {
    this.cells.push(cell);
    this.costs.push(cost);
    let index = this.cells.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.costs[parent]! <= cost) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.cells[0]!, this.costs[0]!];
    const lastCell = this.cells.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.costs[0] = lastCost;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.costs.length && this.costs[left]! < this.costs[smallest]!) smallest = left;
        if (right < this.costs.length && this.costs[right]! < this.costs[smallest]!) {
          smallest = right;
        }
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
  }
}

/** Height of the middle of a level above the floor, where a hand reaches for a box. */
export function levelReachHeightCm(fixture: FixtureLayout, level: number): number {
  const base = 10;
  const pitch = (fixture.heightCm - base) / fixture.levelCount;
  const surface = base + (fixture.levelCount - level) * pitch;
  return Math.round(surface + Math.min(15, pitch / 2));
}

/** Seconds lost bending to the floor or stretching (or fetching a stool) for high shelves. */
export function reachPenaltySeconds(heightCm: number): number {
  if (heightCm < 40) return 4;
  if (heightCm < 75) return 2;
  if (heightCm <= 160) return 0;
  if (heightCm <= 185) return 1.5;
  return 5;
}

export interface SlotTiming {
  readonly fixtureKey: string;
  readonly level: number;
  readonly walkCm: number | null;
  readonly reachHeightCm: number;
  /** Round trip from the counter, reaching the level, and opening a door or lock. */
  readonly secondsPerPick: number;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function slotTimings(
  floor: FloorPlan,
  fixtures: readonly FixtureLayout[],
  walkMap?: WalkMap,
): SlotTiming[] {
  const map = walkMap ?? buildWalkMap(floor, fixtures);
  const timings: SlotTiming[] = [];
  for (const fixture of fixtures) {
    const walkCm = walkDistanceCm(map, pickPoint(fixture));
    for (let level = 1; level <= fixture.levelCount; level += 1) {
      const reachHeightCm = levelReachHeightCm(fixture, level);
      timings.push({
        fixtureKey: fixture.key,
        level,
        walkCm,
        reachHeightCm,
        secondsPerPick:
          walkCm === null
            ? UNREACHABLE_SECONDS
            : roundTenth(
                (2 * walkCm) / WALK_CM_PER_SECOND +
                  reachPenaltySeconds(reachHeightCm) +
                  KIND_PENALTY_SECONDS[fixture.kind],
              ),
      });
    }
  }
  return timings;
}

/** Stored on each shelf so older ranking code and reports agree with the planner. */
export function pickPriorityFromSeconds(seconds: number): number {
  return Math.min(10_000, Math.max(1, Math.round(seconds * 10)));
}

export interface SlotRef {
  readonly fixtureKey: string;
  readonly level: number;
}

export function slotId(slot: SlotRef): string {
  return `${slot.fixtureKey}#${slot.level}`;
}

export interface PlannerSlot extends SlotRef {
  readonly fixtureCode: string;
  readonly secondsPerPick: number;
  readonly capacity: number;
  readonly storageClass: ShelfStorageClass;
  readonly isSecured: boolean;
  /** Position of the fixture when racks are ordered quickest first. */
  readonly fixtureRank: number;
}

export function plannerSlots(
  floor: FloorPlan,
  fixtures: readonly FixtureLayout[],
  walkMap?: WalkMap,
): PlannerSlot[] {
  const timings = slotTimings(floor, fixtures, walkMap);
  const average = new Map<string, number>();
  for (const fixture of fixtures) {
    const own = timings.filter((timing) => timing.fixtureKey === fixture.key);
    average.set(
      fixture.key,
      own.reduce((sum, timing) => sum + timing.secondsPerPick, 0) / Math.max(1, own.length),
    );
  }
  const ranked = [...fixtures].sort(
    (a, b) => average.get(a.key)! - average.get(b.key)! || a.code.localeCompare(b.code),
  );
  const rank = new Map(ranked.map((fixture, index) => [fixture.key, index]));
  const byKey = new Map(fixtures.map((fixture) => [fixture.key, fixture]));
  return timings.map((timing) => {
    const fixture = byKey.get(timing.fixtureKey)!;
    return {
      fixtureKey: timing.fixtureKey,
      level: timing.level,
      fixtureCode: fixture.code,
      secondsPerPick: timing.secondsPerPick,
      capacity: fixture.facingsPerLevel,
      storageClass: fixture.storageClass,
      isSecured: fixture.isSecured,
      fixtureRank: rank.get(fixture.key)!,
    };
  });
}

export interface PlannerMedicine {
  readonly id: string;
  readonly name: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly picksPerMonth: number;
  readonly storageClass: ShelfStorageClass;
  readonly requiresSecured: boolean;
  /** The medicine's current shelf when that shelf belongs to a planned fixture. */
  readonly current: SlotRef | null;
}

export type MoveReason =
  | 'FAST_MOVER'
  | 'MAKE_ROOM'
  | 'NEEDS_COLD'
  | 'NEEDS_LOCK'
  | 'LEAVE_COLD'
  | 'NOT_ON_SHELF'
  | 'REGROUP';

export const MOVE_REASON_LABELS: Readonly<Record<MoveReason, string>> = {
  FAST_MOVER: 'Sells often: closer to the counter',
  MAKE_ROOM: 'Sells rarely: frees a quick shelf',
  NEEDS_COLD: 'Must be kept in the fridge',
  NEEDS_LOCK: 'Must be kept locked',
  LEAVE_COLD: 'Does not need fridge space',
  NOT_ON_SHELF: 'Has no shelf yet',
  REGROUP: 'Kept with its group',
};

export interface PlannedMove {
  readonly medicineId: string;
  readonly from: SlotRef | null;
  readonly to: SlotRef;
  readonly reason: MoveReason;
  readonly secondsSavedPerMonth: number;
}

export type UnplacedReason = 'NO_COLD_SPACE' | 'NO_LOCKED_SPACE' | 'NO_SPACE';

export interface PlacementPlan {
  readonly moves: readonly PlannedMove[];
  readonly unplaced: ReadonlyArray<{
    readonly medicineId: string;
    readonly reason: UnplacedReason;
  }>;
  /** Final location of every placed medicine, including the ones that stay where they are. */
  readonly placements: ReadonlyMap<string, SlotRef>;
  readonly secondsSavedPerMonth: number;
}

function fits(slot: PlannerSlot, medicine: PlannerMedicine): boolean {
  if (slot.storageClass !== medicine.storageClass) return false;
  return !medicine.requiresSecured || slot.isSecured;
}

function unplacedReason(medicine: PlannerMedicine): UnplacedReason {
  if (medicine.requiresSecured) return 'NO_LOCKED_SPACE';
  if (medicine.storageClass !== 'AMBIENT') return 'NO_COLD_SPACE';
  return 'NO_SPACE';
}

/**
 * Decides where every medicine should sit.
 *
 * FRESH lays the shop out from scratch: fast movers take the quickest shelves, then everything
 * else fills racks from the quickest rack outward, in group order (company, form, or A-Z) so staff
 * find related stock together.
 *
 * IMPROVE keeps the shop's current arrangement and only proposes moves that pay for themselves:
 * medicines on the wrong kind of shelf, medicines with no shelf, and fast movers stuck far from
 * the counter (swapped with a slow mover on a quick shelf).
 */
export function planPlacements(input: {
  readonly slots: readonly PlannerSlot[];
  readonly medicines: readonly PlannerMedicine[];
  readonly mode: PlanMode;
}): PlacementPlan {
  const slots = input.slots;
  const slotById = new Map(slots.map((slot) => [slotId(slot), slot]));
  const used = new Map<string, number>(slots.map((slot) => [slotId(slot), 0]));
  const occupants = new Map<string, Set<string>>(slots.map((slot) => [slotId(slot), new Set()]));
  const groupSlots = new Map<string, Set<string>>();
  const placements = new Map<string, SlotRef>();
  const medicinesById = new Map(input.medicines.map((medicine) => [medicine.id, medicine]));
  const moves: PlannedMove[] = [];
  const unplaced: Array<{ medicineId: string; reason: UnplacedReason }> = [];
  const settled = new Set<string>();

  const groupDemand = new Map<string, number>();
  for (const medicine of input.medicines) {
    groupDemand.set(
      medicine.groupKey,
      (groupDemand.get(medicine.groupKey) ?? 0) + medicine.picksPerMonth,
    );
  }
  const groupOrder = (a: PlannerMedicine, b: PlannerMedicine): number =>
    groupDemand.get(b.groupKey)! - groupDemand.get(a.groupKey)! ||
    a.groupLabel.localeCompare(b.groupLabel, 'en') ||
    a.name.localeCompare(b.name, 'en') ||
    compareIds(a.id, b.id);
  const fastest = [...slots].sort(
    (a, b) =>
      a.secondsPerPick - b.secondsPerPick || a.fixtureRank - b.fixtureRank || a.level - b.level,
  );
  const readingOrder = [...slots].sort(
    (a, b) => a.fixtureRank - b.fixtureRank || a.level - b.level,
  );
  const secondsAt = (slot: SlotRef | null): number | null =>
    slot ? (slotById.get(slotId(slot))?.secondsPerPick ?? null) : null;
  const currentSlot = (medicine: PlannerMedicine): PlannerSlot | undefined =>
    medicine.current ? slotById.get(slotId(medicine.current)) : undefined;

  const occupy = (medicine: PlannerMedicine, slot: PlannerSlot): void => {
    const id = slotId(slot);
    used.set(id, used.get(id)! + 1);
    occupants.get(id)!.add(medicine.id);
    if (!groupSlots.has(medicine.groupKey)) groupSlots.set(medicine.groupKey, new Set());
    groupSlots.get(medicine.groupKey)!.add(id);
    placements.set(medicine.id, { fixtureKey: slot.fixtureKey, level: slot.level });
  };
  const vacate = (medicine: PlannerMedicine, slot: SlotRef): void => {
    const id = slotId(slot);
    used.set(id, Math.max(0, used.get(id)! - 1));
    occupants.get(id)!.delete(medicine.id);
    placements.delete(medicine.id);
  };
  const hasRoom = (slot: PlannerSlot): boolean => used.get(slotId(slot))! < slot.capacity;
  // A medicine that needs neither a lock nor the fridge only uses locked space as a last resort.
  const choose = (
    order: readonly PlannerSlot[],
    medicine: PlannerMedicine,
    accept: (slot: PlannerSlot) => boolean = hasRoom,
  ): PlannerSlot | undefined =>
    order.find(
      (slot) =>
        fits(slot, medicine) && (medicine.requiresSecured || !slot.isSecured) && accept(slot),
    ) ?? order.find((slot) => fits(slot, medicine) && accept(slot));
  const record = (medicine: PlannerMedicine, to: PlannerSlot, reason: MoveReason): void => {
    const before = secondsAt(medicine.current);
    occupy(medicine, to);
    settled.add(medicine.id);
    if (medicine.current && slotId(medicine.current) === slotId(to)) return;
    moves.push({
      medicineId: medicine.id,
      from: medicine.current,
      to: { fixtureKey: to.fixtureKey, level: to.level },
      reason,
      secondsSavedPerMonth:
        before === null ? 0 : Math.round((before - to.secondsPerPick) * medicine.picksPerMonth),
    });
  };
  const isFast = (medicine: PlannerMedicine): boolean =>
    medicine.picksPerMonth >= FAST_MOVER_PICKS_PER_MONTH;
  const constraintsFirst = (a: PlannerMedicine, b: PlannerMedicine): number =>
    Number(b.requiresSecured) - Number(a.requiresSecured) ||
    Number(b.storageClass !== 'AMBIENT') - Number(a.storageClass !== 'AMBIENT');

  if (input.mode === 'FRESH') {
    const fast = input.medicines
      .filter(isFast)
      .sort((a, b) => b.picksPerMonth - a.picksPerMonth || a.name.localeCompare(b.name, 'en'));
    for (const medicine of fast) {
      const slot = choose(fastest, medicine);
      if (slot) record(medicine, slot, reasonFor(medicine, currentSlot(medicine), 'FAST_MOVER'));
      else unplaced.push({ medicineId: medicine.id, reason: unplacedReason(medicine) });
      settled.add(medicine.id);
    }
    const rest = input.medicines
      .filter((medicine) => !settled.has(medicine.id))
      .sort((a, b) => constraintsFirst(a, b) || groupOrder(a, b));
    for (const medicine of rest) {
      const slot = choose(readingOrder, medicine);
      if (slot) record(medicine, slot, reasonFor(medicine, currentSlot(medicine), 'REGROUP'));
      else unplaced.push({ medicineId: medicine.id, reason: unplacedReason(medicine) });
    }
  } else {
    const homeless: Array<{ medicine: PlannerMedicine; reason: MoveReason }> = [];
    for (const medicine of [...input.medicines].sort(groupOrder)) {
      const slot = medicine.current ? slotById.get(slotId(medicine.current)) : undefined;
      if (!slot) homeless.push({ medicine, reason: 'NOT_ON_SHELF' });
      else if (medicine.requiresSecured && !slot.isSecured) {
        homeless.push({ medicine, reason: 'NEEDS_LOCK' });
      } else if (medicine.storageClass !== slot.storageClass) {
        homeless.push({
          medicine,
          reason: medicine.storageClass === 'AMBIENT' ? 'LEAVE_COLD' : 'NEEDS_COLD',
        });
      } else occupy(medicine, slot);
    }
    // Fast movers far from the counter trade places with slow movers on quicker shelves.
    const fast = input.medicines
      .filter((medicine) => isFast(medicine) && placements.has(medicine.id))
      .sort((a, b) => b.picksPerMonth - a.picksPerMonth || a.name.localeCompare(b.name, 'en'));
    for (const medicine of fast) {
      if (settled.has(medicine.id)) continue;
      const here = slotById.get(slotId(placements.get(medicine.id)!))!;
      for (const target of fastest) {
        if (target.secondsPerPick >= here.secondsPerPick - 1) break;
        if (!fits(target, medicine)) continue;
        if (!medicine.requiresSecured && target.isSecured) continue;
        const gain = here.secondsPerPick - target.secondsPerPick;
        if (hasRoom(target)) {
          if (gain * medicine.picksPerMonth < 60) break;
          vacate(medicine, here);
          record(medicine, target, 'FAST_MOVER');
          break;
        }
        const slow = [...occupants.get(slotId(target))!]
          .map((id) => medicinesById.get(id)!)
          .filter((other) => !settled.has(other.id) && fits(here, other))
          .sort((a, b) => a.picksPerMonth - b.picksPerMonth || compareIds(a.id, b.id))[0];
        if (!slow || gain * (medicine.picksPerMonth - slow.picksPerMonth) < 60) continue;
        vacate(slow, target);
        vacate(medicine, here);
        record(medicine, target, 'FAST_MOVER');
        record(slow, here, 'MAKE_ROOM');
        break;
      }
    }
    homeless.sort(
      (a, b) => constraintsFirst(a.medicine, b.medicine) || groupOrder(a.medicine, b.medicine),
    );
    for (const { medicine, reason } of homeless) {
      let slot: PlannerSlot | undefined;
      if (isFast(medicine)) slot = choose(fastest, medicine);
      if (!slot) {
        const neighbours = groupSlots.get(medicine.groupKey);
        if (neighbours) {
          slot = choose(
            fastest,
            medicine,
            (candidate) => neighbours.has(slotId(candidate)) && hasRoom(candidate),
          );
        }
      }
      slot ??= choose(readingOrder, medicine);
      if (slot) record(medicine, slot, reason);
      else unplaced.push({ medicineId: medicine.id, reason: unplacedReason(medicine) });
    }
  }
  return {
    moves,
    unplaced,
    placements,
    secondsSavedPerMonth: moves.reduce((sum, move) => sum + move.secondsSavedPerMonth, 0),
  };
}

function reasonFor(
  medicine: PlannerMedicine,
  current: PlannerSlot | undefined,
  fallback: MoveReason,
): MoveReason {
  if (!current) return 'NOT_ON_SHELF';
  if (medicine.requiresSecured && !current.isSecured) return 'NEEDS_LOCK';
  if (medicine.storageClass !== current.storageClass) {
    return medicine.storageClass === 'AMBIENT' ? 'LEAVE_COLD' : 'NEEDS_COLD';
  }
  return fallback;
}

function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export type FixtureChange =
  | {
      readonly id: string;
      readonly type: 'ROTATE';
      readonly fixtureKey: string;
      readonly rotation: FixtureRotation;
      readonly reason: string;
    }
  | {
      readonly id: string;
      readonly type: 'SWAP';
      readonly fixtureKey: string;
      readonly otherKey: string;
      readonly reason: string;
      readonly secondsSavedPerMonth: number;
    }
  | {
      readonly id: string;
      readonly type: 'ADD';
      readonly fixture: FixtureLayout;
      readonly reason: string;
    };

export function applyFixtureChanges(
  fixtures: readonly FixtureLayout[],
  changes: readonly FixtureChange[],
): FixtureLayout[] {
  let result = [...fixtures];
  for (const change of changes) {
    if (change.type === 'ROTATE') {
      result = result.map((fixture) =>
        fixture.key === change.fixtureKey ? { ...fixture, rotation: change.rotation } : fixture,
      );
    } else if (change.type === 'SWAP') {
      const a = result.find((fixture) => fixture.key === change.fixtureKey);
      const b = result.find((fixture) => fixture.key === change.otherKey);
      if (!a || !b) continue;
      result = result.map((fixture) =>
        fixture.key === a.key
          ? { ...fixture, xCm: b.xCm, yCm: b.yCm, rotation: b.rotation }
          : fixture.key === b.key
            ? { ...fixture, xCm: a.xCm, yCm: a.yCm, rotation: a.rotation }
            : fixture,
      );
    } else {
      result.push(change.fixture);
    }
  }
  return result;
}

function hasErrors(floor: FloorPlan, fixtures: readonly FixtureLayout[]): boolean {
  return validateLayout(floor, fixtures, { reachability: false }).some(
    (issue) => issue.severity === 'error',
  );
}

function averageSeconds(floor: FloorPlan, fixtures: readonly FixtureLayout[]): Map<string, number> {
  const timings = slotTimings(floor, fixtures);
  const totals = new Map<string, { sum: number; count: number }>();
  for (const timing of timings) {
    const total = totals.get(timing.fixtureKey) ?? { sum: 0, count: 0 };
    total.sum += timing.secondsPerPick;
    total.count += 1;
    totals.set(timing.fixtureKey, total);
  }
  return new Map([...totals].map(([key, total]) => [key, total.sum / total.count]));
}

/**
 * Physical changes worth making: turn fixtures that face a wall, and swap a busy far rack with a
 * quiet near one of about the same size. `picksByFixture` is monthly picks from each fixture.
 */
export function suggestFixtureChanges(input: {
  readonly floor: FloorPlan;
  readonly fixtures: readonly FixtureLayout[];
  readonly picksByFixture: ReadonlyMap<string, number>;
}): FixtureChange[] {
  const { floor } = input;
  let fixtures = [...input.fixtures];
  const changes: FixtureChange[] = [];
  const counter = boxBounds(floor.counter);
  for (const fixture of input.fixtures) {
    const obstacles = [
      counter,
      ...fixtures.filter((other) => other.key !== fixture.key).map((other) => boxBounds(other)),
    ];
    if (frontClearanceCm(fixture, obstacles, floor) >= MINIMUM_AISLE_CM) continue;
    const turned = { ...fixture, rotation: rotateClockwise(rotateClockwise(fixture.rotation)) };
    if (frontClearanceCm(turned, obstacles, floor) < COMFORTABLE_AISLE_CM) continue;
    const change: FixtureChange = {
      id: `rotate-${fixture.key}`,
      type: 'ROTATE',
      fixtureKey: fixture.key,
      rotation: turned.rotation,
      reason: `${fixtureLabel(fixture)} faces a wall. Turn it around so staff can pick from it.`,
    };
    changes.push(change);
    fixtures = applyFixtureChanges(fixtures, [change]);
  }

  const seconds = averageSeconds(floor, fixtures);
  const candidates: Array<{ a: FixtureLayout; b: FixtureLayout; saved: number }> = [];
  for (const a of fixtures) {
    for (const b of fixtures) {
      if (a.key === b.key) continue;
      const farther = seconds.get(a.key)! - seconds.get(b.key)!;
      const busier =
        (input.picksByFixture.get(a.key) ?? 0) - (input.picksByFixture.get(b.key) ?? 0);
      if (farther <= 1 || busier <= 0) continue;
      if (Math.abs(a.widthCm - b.widthCm) > 20 || Math.abs(a.depthCm - b.depthCm) > 20) continue;
      const saved = Math.round(farther * busier);
      if (saved >= 600) candidates.push({ a, b, saved });
    }
  }
  candidates.sort((x, y) => y.saved - x.saved || x.a.code.localeCompare(y.a.code));
  const moved = new Set<string>();
  for (const { a, b, saved } of candidates) {
    if (moved.has(a.key) || moved.has(b.key) || moved.size >= 6) continue;
    const change: FixtureChange = {
      id: `swap-${a.key}-${b.key}`,
      type: 'SWAP',
      fixtureKey: a.key,
      otherKey: b.key,
      secondsSavedPerMonth: saved,
      reason: `${fixtureLabel(a)} is busy but far from the counter; ${fixtureLabel(b)} is quiet but close. Swap their places.`,
    };
    const next = applyFixtureChanges(fixtures, [change]);
    if (hasErrors(floor, next)) continue;
    fixtures = next;
    changes.push(change);
    moved.add(a.key);
    moved.add(b.key);
  }
  return changes;
}

/** The first free rack label: A to Z, then AA, AB, and so on. */
export function nextFixtureCode(used: ReadonlySet<string>): string {
  for (let index = 0; index < 702; index += 1) {
    const code =
      index < 26
        ? String.fromCharCode(65 + index)
        : String.fromCharCode(64 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26));
    if (!used.has(code)) return code;
  }
  return `R${used.size + 1}`;
}

/** Every spot along the walls where a fixture fits with its back to the wall. */
function wallSpots(floor: FloorPlan, widthCm: number, depthCm: number): PlacedBox[] {
  const spots: PlacedBox[] = [];
  const step = 10;
  for (let x = widthCm / 2; x <= floor.widthCm - widthCm / 2; x += step) {
    spots.push({ xCm: x, yCm: depthCm / 2, widthCm, depthCm, rotation: 0 });
    spots.push({ xCm: x, yCm: floor.depthCm - depthCm / 2, widthCm, depthCm, rotation: 180 });
  }
  for (let y = widthCm / 2; y <= floor.depthCm - widthCm / 2; y += step) {
    spots.push({ xCm: depthCm / 2, yCm: y, widthCm, depthCm, rotation: 270 });
    spots.push({ xCm: floor.widthCm - depthCm / 2, yCm: y, widthCm, depthCm, rotation: 90 });
  }
  return spots;
}

/**
 * Where to put new fixtures for medicines that did not fit: the free wall spots quickest to reach
 * from the counter, never in the doorway and never blocking another fixture's front.
 */
export function suggestNewFixtures(input: {
  readonly floor: FloorPlan;
  readonly fixtures: readonly FixtureLayout[];
  readonly shortfall: { readonly ambient: number; readonly cold: number; readonly locked: number };
  readonly maximum?: number;
}): FixtureChange[] {
  const { floor } = input;
  const maximum = input.maximum ?? 6;
  let fixtures = [...input.fixtures];
  const changes: FixtureChange[] = [];
  const codes = new Set(fixtures.map((fixture) => fixture.code.toUpperCase()));
  const wanted: FixtureKind[] = [];
  const perFixture = (kind: FixtureKind): number =>
    FIXTURE_DEFAULTS[kind].levelCount * FIXTURE_DEFAULTS[kind].facingsPerLevel;
  for (
    let count = 0;
    count < Math.ceil(input.shortfall.locked / perFixture('SECURED_CABINET'));
    count += 1
  )
    wanted.push('SECURED_CABINET');
  for (let count = 0; count < Math.ceil(input.shortfall.cold / perFixture('FRIDGE')); count += 1)
    wanted.push('FRIDGE');
  for (
    let count = 0;
    count < Math.ceil(input.shortfall.ambient / perFixture('WALL_RACK'));
    count += 1
  )
    wanted.push('WALL_RACK');
  const entrance = entranceZone(floor);
  const counter = boxBounds(floor.counter);
  for (const kind of wanted.slice(0, maximum)) {
    const defaults = FIXTURE_DEFAULTS[kind];
    const map = buildWalkMap(floor, fixtures);
    const others = fixtures.map((fixture) => boxBounds(fixture));
    const clearances = fixtures.map((fixture, index) =>
      frontClearanceCm(fixture, [counter, ...others.filter((_, other) => other !== index)], floor),
    );
    let best: { spot: PlacedBox; walk: number } | null = null;
    for (const spot of wallSpots(floor, defaults.widthCm, defaults.depthCm)) {
      const bounds = boxBounds(spot);
      const padded = {
        minX: bounds.minX - 5,
        minY: bounds.minY - 5,
        maxX: bounds.maxX + 5,
        maxY: bounds.maxY + 5,
      };
      if (overlaps(padded, counter) || overlaps(bounds, entrance)) continue;
      if (others.some((other) => overlaps(padded, other))) continue;
      if (frontClearanceCm(spot, [counter, ...others], floor) < COMFORTABLE_AISLE_CM) continue;
      // The new fixture must not stand in front of an existing one.
      const blocksOthers = fixtures.some((fixture, index) => {
        const without = others.filter((_, other) => other !== index);
        const after = frontClearanceCm(fixture, [counter, bounds, ...without], floor);
        return after < Math.min(COMFORTABLE_AISLE_CM, clearances[index]!);
      });
      if (blocksOthers) continue;
      const walk = walkDistanceCm(map, pickPoint(spot));
      if (walk === null) continue;
      if (!best || walk < best.walk) best = { spot, walk };
    }
    if (!best) break;
    const code = nextFixtureCode(codes);
    codes.add(code);
    const fixture: FixtureLayout = {
      ...best.spot,
      key: `new-${changes.length + 1}`,
      code,
      name: defaults.label,
      kind,
      heightCm: defaults.heightCm,
      levelCount: defaults.levelCount,
      facingsPerLevel: defaults.facingsPerLevel,
      storageClass: defaults.storageClass,
      isSecured: defaults.isSecured,
    };
    const reason =
      kind === 'FRIDGE'
        ? 'Medicines that need cold storage have no room in a fridge.'
        : kind === 'SECURED_CABINET'
          ? 'Controlled medicines have no room in a locked cabinet.'
          : 'More medicines are in stock than the racks can hold. This wall space is free.';
    changes.push({ id: `add-${fixture.key}`, type: 'ADD', fixture, reason });
    fixtures = [...fixtures, fixture];
  }
  return changes;
}

/**
 * A sensible first layout for a typical Pakistani pharmacy: counter across the front, staff
 * behind it, racks on the back and side walls, a fridge and a locked cabinet near the counter.
 */
export function starterLayout(
  widthCm: number,
  depthCm: number,
): { floor: FloorPlan; fixtures: FixtureLayout[] } {
  const counterDepth = 60;
  const counterWidth = Math.max(100, Math.min(widthCm - 160, 360));
  const counterY = depthCm - 90 - counterDepth / 2;
  const floor: FloorPlan = {
    widthCm,
    depthCm,
    counter: {
      xCm: Math.round(widthCm / 2),
      yCm: Math.round(counterY),
      widthCm: counterWidth,
      depthCm: counterDepth,
      rotation: 0,
    },
    entrance: {
      wall: 'SOUTH',
      offsetCm: Math.max(0, Math.round(widthCm / 2 - 60)),
      widthCm: Math.min(120, widthCm),
    },
  };
  const fixtures: FixtureLayout[] = [];
  const codes = new Set<string>();
  const add = (kind: FixtureKind, box: PlacedBox): void => {
    const defaults = FIXTURE_DEFAULTS[kind];
    const code = nextFixtureCode(codes);
    codes.add(code);
    fixtures.push({
      ...box,
      key: `new-${fixtures.length + 1}`,
      code,
      name: defaults.label,
      kind,
      heightCm: defaults.heightCm,
      levelCount: defaults.levelCount,
      facingsPerLevel: defaults.facingsPerLevel,
      storageClass: defaults.storageClass,
      isSecured: defaults.isSecured,
    });
  };
  const rackDepth = FIXTURE_DEFAULTS.WALL_RACK.depthCm;
  const split = (length: number): number[] => {
    const count = Math.max(1, Math.round(length / 120));
    const width = Math.floor(length / count);
    return width < 60 ? [] : Array.from({ length: count }, () => width);
  };
  let x = 0;
  for (const width of split(widthCm)) {
    add('WALL_RACK', {
      xCm: x + width / 2,
      yCm: rackDepth / 2,
      widthCm: width,
      depthCm: rackDepth,
      rotation: 0,
    });
    x += width;
  }
  const sideStart = rackDepth;
  const sideEnd = counterY - counterDepth / 2 - 70;
  const sides: Array<{ kind: FixtureKind; west: boolean }> = [
    { kind: 'FRIDGE', west: true },
    { kind: 'SECURED_CABINET', west: false },
  ];
  for (const { kind, west } of sides) {
    let end = sideEnd;
    const special = FIXTURE_DEFAULTS[kind];
    if (end - sideStart >= special.widthCm) {
      add(kind, {
        xCm: west ? special.depthCm / 2 : widthCm - special.depthCm / 2,
        yCm: end - special.widthCm / 2,
        widthCm: special.widthCm,
        depthCm: special.depthCm,
        rotation: west ? 270 : 90,
      });
      end -= special.widthCm;
    }
    let y = sideStart;
    for (const width of split(end - sideStart)) {
      add('WALL_RACK', {
        xCm: west ? rackDepth / 2 : widthCm - rackDepth / 2,
        yCm: y + width / 2,
        widthCm: width,
        depthCm: rackDepth,
        rotation: west ? 270 : 90,
      });
      y += width;
    }
  }
  return { floor, fixtures: fixtures.filter((fixture) => fixture.widthCm >= 60) };
}

/**
 * The quickest free spot for one new fixture. Racks, fridges and cabinets go against a wall;
 * island stands and displays may stand anywhere on the floor with room to pick from their front.
 */
export function placeNewFixture(
  floor: FloorPlan,
  fixtures: readonly FixtureLayout[],
  kind: FixtureKind,
): PlacedBox | null {
  const defaults = FIXTURE_DEFAULTS[kind];
  const counter = boxBounds(floor.counter);
  const entrance = entranceZone(floor);
  const others = fixtures.map((fixture) => boxBounds(fixture));
  const map = buildWalkMap(floor, fixtures);
  const candidates: PlacedBox[] = wallSpots(floor, defaults.widthCm, defaults.depthCm);
  if (kind === 'ISLAND_RACK' || kind === 'DISPLAY') {
    for (let y = 0; y <= floor.depthCm; y += 20) {
      for (let x = 0; x <= floor.widthCm; x += 20) {
        for (const rotation of FIXTURE_ROTATIONS) {
          candidates.push({
            xCm: x,
            yCm: y,
            widthCm: defaults.widthCm,
            depthCm: defaults.depthCm,
            rotation,
          });
        }
      }
    }
  }
  let best: { spot: PlacedBox; walk: number } | null = null;
  for (const spot of candidates) {
    const bounds = boxBounds(spot);
    if (outsideBy(bounds, floor) > EPSILON) continue;
    const padded = {
      minX: bounds.minX - 5,
      minY: bounds.minY - 5,
      maxX: bounds.maxX + 5,
      maxY: bounds.maxY + 5,
    };
    if (overlaps(padded, counter) || overlaps(bounds, entrance)) continue;
    if (others.some((other) => overlaps(padded, other))) continue;
    if (frontClearanceCm(spot, [counter, ...others], floor) < COMFORTABLE_AISLE_CM) continue;
    const walk = walkDistanceCm(map, pickPoint(spot));
    if (walk === null) continue;
    if (!best || walk < best.walk) best = { spot, walk };
  }
  return best?.spot ?? null;
}
