import {
  FIXTURE_DEFAULTS,
  nextFixtureCode,
  placeNewFixture,
  rotateClockwise,
  type FixtureKind,
  type FixtureLayout,
  type FloorPlan,
  type PlacedBox,
} from '@pharmacy/shared';

import type { PlannerLevel, ShelfPlannerState } from '../../api';

export interface DraftFixture extends FixtureLayout {
  /** The saved fixture's id, or null until the layout is saved. */
  readonly id: string | null;
}

export interface Draft {
  readonly floor: FloorPlan;
  readonly fixtures: readonly DraftFixture[];
}

export type Selection =
  { readonly kind: 'fixture'; readonly key: string } | { readonly kind: 'counter' } | null;

export function draftFromState(state: ShelfPlannerState): Draft | null {
  if (!state.floor) return null;
  return {
    floor: state.floor,
    fixtures: state.fixtures.map((fixture) => ({
      key: fixture.key,
      id: fixture.id,
      code: fixture.code,
      name: fixture.name,
      kind: fixture.kind,
      xCm: fixture.xCm,
      yCm: fixture.yCm,
      widthCm: fixture.widthCm,
      depthCm: fixture.depthCm,
      heightCm: fixture.heightCm,
      rotation: fixture.rotation,
      levelCount: fixture.levelCount,
      facingsPerLevel: fixture.facingsPerLevel,
      storageClass: fixture.storageClass,
      isSecured: fixture.isSecured,
    })),
  };
}

/** Comparable snapshot of what the server stores, to know whether there is anything to save. */
export function draftSignature(draft: Draft | null): string {
  if (!draft) return '';
  return JSON.stringify({
    floor: draft.floor,
    fixtures: draft.fixtures.map((fixture) => ({
      ...fixture,
      xCm: Math.round(fixture.xCm),
      yCm: Math.round(fixture.yCm),
    })),
  });
}

export function levelsByKey(
  state: ShelfPlannerState | undefined,
): ReadonlyMap<string, readonly PlannerLevel[]> {
  return new Map((state?.fixtures ?? []).map((fixture) => [fixture.key, fixture.levels]));
}

let sequence = 0;
export function temporaryKey(): string {
  sequence += 1;
  return `new-${Date.now().toString(36)}-${sequence}`;
}

/** A new fixture of this kind on the quickest free spot, or in the middle when nothing fits. */
export function createFixture(draft: Draft, kind: FixtureKind): DraftFixture {
  const defaults = FIXTURE_DEFAULTS[kind];
  const spot: PlacedBox = placeNewFixture(draft.floor, draft.fixtures, kind) ?? {
    xCm: Math.round(draft.floor.widthCm / 2),
    yCm: Math.round(draft.floor.depthCm / 3),
    widthCm: defaults.widthCm,
    depthCm: defaults.depthCm,
    rotation: 0,
  };
  return {
    ...spot,
    key: temporaryKey(),
    id: null,
    code: nextFixtureCode(new Set(draft.fixtures.map((fixture) => fixture.code))),
    name: defaults.label,
    kind,
    heightCm: defaults.heightCm,
    levelCount: defaults.levelCount,
    facingsPerLevel: defaults.facingsPerLevel,
    storageClass: defaults.storageClass,
    isSecured: defaults.isSecured,
  };
}

export function duplicateFixture(draft: Draft, source: DraftFixture): DraftFixture {
  const spot = placeNewFixture(
    draft.floor,
    draft.fixtures,
    source.kind === 'ISLAND_RACK' || source.kind === 'DISPLAY' ? source.kind : 'WALL_RACK',
  );
  return {
    ...source,
    ...(spot
      ? { xCm: spot.xCm, yCm: spot.yCm, rotation: spot.rotation }
      : { xCm: source.xCm + 20, yCm: source.yCm + 20 }),
    key: temporaryKey(),
    id: null,
    code: nextFixtureCode(new Set(draft.fixtures.map((fixture) => fixture.code))),
  };
}

export function rotated<T extends PlacedBox>(box: T): T {
  return { ...box, rotation: rotateClockwise(box.rotation) };
}

/** Seconds per pick from green (quick) through amber to red (slow). */
export function speedColor(seconds: number | undefined): string {
  if (seconds === undefined) return '#c9d4d0';
  if (seconds >= 600) return '#7d8b88';
  const share = Math.min(1, Math.max(0, (seconds - 4) / 12));
  const hue = Math.round(150 - share * 145);
  return `hsl(${hue} 58% ${share > 0.5 ? 50 : 42}%)`;
}

/** How full a shelf is: pale when empty, deep teal when full, red when over capacity. */
export function fillColor(used: number, capacity: number): string {
  if (capacity <= 0 || used <= 0) return '#e3ebe8';
  const share = used / capacity;
  if (share > 1) return '#c0473f';
  return `hsl(170 ${35 + share * 35}% ${82 - share * 50}%)`;
}

export const KIND_ICONS: Readonly<Record<FixtureKind, string>> = {
  WALL_RACK: '▤',
  ISLAND_RACK: '▥',
  FRIDGE: '❄',
  SECURED_CABINET: '🔒',
  DISPLAY: '◫',
};

export const STORAGE_LABELS: Readonly<Record<FixtureLayout['storageClass'], string>> = {
  AMBIENT: 'Normal (room temperature)',
  COLD: 'Fridge, 2 to 8 °C',
  FROZEN: 'Freezer',
  OTHER: 'Other special storage',
};
