import {
  boxBounds,
  entranceZone,
  pickPoint,
  staffPoint,
  walkDistanceCm,
  walkPath,
  type Bounds,
  type FloorPlan,
  type PlacedBox,
  type WalkMap,
} from '@pharmacy/shared';
import { useRef, useState } from 'react';

import type { DraftFixture, Selection } from './model';
import { formatLength, formatSeconds, type LengthUnit } from './units';

const SNAP_CM = 10;

interface Props {
  readonly floor: FloorPlan;
  readonly fixtures: readonly DraftFixture[];
  readonly unit: LengthUnit;
  readonly colorOf: (fixture: DraftFixture) => string;
  readonly secondsOf: (fixture: DraftFixture) => number | undefined;
  readonly problemKeys: ReadonlySet<string>;
  readonly highlightKeys: ReadonlySet<string>;
  readonly ghosts: readonly PlacedBox[];
  readonly selection: Selection;
  readonly walkMap: WalkMap;
  readonly editable: boolean;
  readonly onSelect: (selection: Selection) => void;
  readonly onDragStart: () => void;
  readonly onDrag: (target: string, xCm: number, yCm: number) => void;
}

interface DragState {
  readonly target: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly originX: number;
  readonly originY: number;
  moved: boolean;
}

/** Pulls an edge onto a nearby wall or neighbouring edge so racks sit flush with one drag. */
function snap(
  box: PlacedBox,
  floor: FloorPlan,
  others: readonly Bounds[],
): { x: number; y: number } {
  const bounds = boxBounds(box);
  let x = Math.round(box.xCm / 5) * 5;
  let y = Math.round(box.yCm / 5) * 5;
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const halfDepth = (bounds.maxY - bounds.minY) / 2;
  const xLines = [0, floor.widthCm, ...others.flatMap((other) => [other.minX, other.maxX])];
  const yLines = [0, floor.depthCm, ...others.flatMap((other) => [other.minY, other.maxY])];
  const nearest = (edges: readonly number[], lines: readonly number[]): number | null => {
    let best: number | null = null;
    for (const edge of edges) {
      for (const line of lines) {
        const shift = line - edge;
        if (Math.abs(shift) <= SNAP_CM && (best === null || Math.abs(shift) < Math.abs(best))) {
          best = shift;
        }
      }
    }
    return best;
  };
  const shiftX = nearest([box.xCm - halfWidth, box.xCm + halfWidth], xLines);
  const shiftY = nearest([box.yCm - halfDepth, box.yCm + halfDepth], yLines);
  if (shiftX !== null) x = box.xCm + shiftX;
  if (shiftY !== null) y = box.yCm + shiftY;
  x = Math.min(Math.max(x, halfWidth), floor.widthCm - halfWidth);
  y = Math.min(Math.max(y, halfDepth), floor.depthCm - halfDepth);
  return { x: Math.round(x), y: Math.round(y) };
}

function Walls({
  floor,
  label,
}: {
  readonly floor: FloorPlan;
  readonly label: number;
}): React.JSX.Element {
  const door = entranceZone(floor);
  const { widthCm: w, depthCm: d } = floor;
  const segments: Array<[number, number, number, number]> = [];
  const wall = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    gapFrom?: number,
    gapTo?: number,
  ) => {
    if (gapFrom === undefined || gapTo === undefined) {
      segments.push([x1, y1, x2, y2]);
      return;
    }
    if (x1 === x2) {
      segments.push([x1, y1, x1, gapFrom], [x1, gapTo, x1, y2]);
    } else {
      segments.push([x1, y1, gapFrom, y1], [gapTo, y1, x2, y1]);
    }
  };
  const { wall: side } = floor.entrance;
  wall(0, 0, w, 0, ...(side === 'NORTH' ? [door.minX, door.maxX] : []));
  wall(0, d, w, d, ...(side === 'SOUTH' ? [door.minX, door.maxX] : []));
  wall(0, 0, 0, d, ...(side === 'WEST' ? [door.minY, door.maxY] : []));
  wall(w, 0, w, d, ...(side === 'EAST' ? [door.minY, door.maxY] : []));
  const doorLabel = {
    x:
      side === 'WEST'
        ? -label * 1.4
        : side === 'EAST'
          ? w + label * 1.4
          : (door.minX + door.maxX) / 2,
    y:
      side === 'NORTH'
        ? -label * 0.6
        : side === 'SOUTH'
          ? d + label * 1.3
          : (door.minY + door.maxY) / 2,
  };
  return (
    <g className="plan-walls">
      {segments.map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      <text
        className="plan-door"
        x={doorLabel.x}
        y={doorLabel.y}
        fontSize={label * 0.9}
        textAnchor="middle"
      >
        Door
      </text>
    </g>
  );
}

export function FloorPlanEditor(props: Props): React.JSX.Element {
  const { floor, fixtures, unit, selection, walkMap, editable } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const size = Math.max(floor.widthCm, floor.depthCm);
  const label = Math.max(14, Math.round(size / 26));
  const grid = unit === 'ft' ? 30.48 : 50;
  const staff = staffPoint(floor);

  const toFloor = (event: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  const begin = (event: React.PointerEvent, target: string, box: PlacedBox) => {
    event.stopPropagation();
    props.onSelect(target === 'counter' ? { kind: 'counter' } : { kind: 'fixture', key: target });
    if (!editable || event.button !== 0) return;
    const start = toFloor(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      target,
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      originX: box.xCm,
      originY: box.yCm,
      moved: false,
    };
  };

  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = toFloor(event);
    const dx = point.x - current.startX;
    const dy = point.y - current.startY;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      current.moved = true;
      props.onDragStart();
      setDragging(current.target);
    }
    const box =
      current.target === 'counter'
        ? floor.counter
        : fixtures.find((fixture) => fixture.key === current.target);
    if (!box) return;
    const others = [
      ...(current.target === 'counter' ? [] : [boxBounds(floor.counter)]),
      ...fixtures
        .filter((fixture) => fixture.key !== current.target)
        .map((fixture) => boxBounds(fixture)),
    ];
    const next = snap(
      { ...box, xCm: current.originX + dx, yCm: current.originY + dy },
      floor,
      others,
    );
    props.onDrag(current.target, next.x, next.y);
  };

  const end = (event: React.PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
  };

  const selectedFixture =
    selection?.kind === 'fixture'
      ? fixtures.find((fixture) => fixture.key === selection.key)
      : undefined;
  const route = selectedFixture ? walkPath(walkMap, pickPoint(selectedFixture)) : [];
  const routeDistance = selectedFixture
    ? walkDistanceCm(walkMap, pickPoint(selectedFixture))
    : null;
  // The label sits halfway along the route so it never hides under the rack it points at.
  const routeMiddle = route[Math.floor(route.length / 2)];

  return (
    <svg
      ref={svgRef}
      className={`floor-plan${dragging ? ' is-dragging' : ''}`}
      viewBox={`${-label * 3} ${-label * 3} ${floor.widthCm + label * 6} ${floor.depthCm + label * 6}`}
      role="application"
      aria-label="Shop floor plan. Drag racks to move them."
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerDown={() => props.onSelect(null)}
    >
      <defs>
        <pattern id="plan-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
          <path d={`M ${grid} 0 L 0 0 0 ${grid}`} className="plan-grid-line" />
        </pattern>
      </defs>
      <rect className="plan-floor" width={floor.widthCm} height={floor.depthCm} />
      <rect width={floor.widthCm} height={floor.depthCm} fill="url(#plan-grid)" />
      <Walls floor={floor} label={label} />
      <text
        className="plan-dimension"
        x={floor.widthCm / 2}
        y={-label * 1.2}
        fontSize={label}
        textAnchor="middle"
      >
        {formatLength(floor.widthCm, unit)}
      </text>
      <text
        className="plan-dimension"
        x={-label * 1.2}
        y={floor.depthCm / 2}
        fontSize={label}
        textAnchor="middle"
        transform={`rotate(-90 ${-label * 1.2} ${floor.depthCm / 2})`}
      >
        {formatLength(floor.depthCm, unit)}
      </text>

      {props.ghosts.map((ghost, index) => {
        const bounds = boxBounds(ghost);
        return (
          <rect
            key={`ghost-${index}`}
            className="plan-ghost"
            x={bounds.minX}
            y={bounds.minY}
            width={bounds.maxX - bounds.minX}
            height={bounds.maxY - bounds.minY}
          />
        );
      })}

      <g
        className={`plan-counter${selection?.kind === 'counter' ? ' selected' : ''}`}
        transform={`translate(${floor.counter.xCm} ${floor.counter.yCm}) rotate(${floor.counter.rotation})`}
        role="button"
        tabIndex={0}
        aria-label="Counter"
        onPointerDown={(event) => begin(event, 'counter', floor.counter)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSelect({ kind: 'counter' });
        }}
      >
        <rect
          x={-floor.counter.widthCm / 2}
          y={-floor.counter.depthCm / 2}
          width={floor.counter.widthCm}
          height={floor.counter.depthCm}
        />
        <g transform={`rotate(${-floor.counter.rotation})`}>
          <text y={label * 0.35} fontSize={label} textAnchor="middle">
            Counter
          </text>
        </g>
      </g>
      <g className="plan-staff" transform={`translate(${staff.x} ${staff.y})`} aria-hidden="true">
        <circle r={label * 0.55} />
        <text y={-label * 0.9} fontSize={label * 0.75} textAnchor="middle">
          Staff stand here
        </text>
      </g>

      {fixtures.map((fixture) => {
        const selected = selection?.kind === 'fixture' && selection.key === fixture.key;
        const classes = [
          'plan-fixture',
          `kind-${fixture.kind.toLowerCase()}`,
          selected ? 'selected' : '',
          props.problemKeys.has(fixture.key) ? 'has-problem' : '',
          props.highlightKeys.has(fixture.key) ? 'highlighted' : '',
          dragging === fixture.key ? 'dragging' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const halfWidth = fixture.widthCm / 2;
        const halfDepth = fixture.depthCm / 2;
        // The code is drawn upright, so it must fit the fixture's on-screen width and height.
        const turned = fixture.rotation === 90 || fixture.rotation === 270;
        const across = turned ? fixture.depthCm : fixture.widthCm;
        const tall = turned ? fixture.widthCm : fixture.depthCm;
        const codeSize = Math.max(
          10,
          Math.min(label * 1.6, tall * 0.8, (across * 0.9) / (0.62 * fixture.code.length)),
        );
        return (
          <g
            key={fixture.key}
            className={classes}
            transform={`translate(${fixture.xCm} ${fixture.yCm}) rotate(${fixture.rotation})`}
            role="button"
            tabIndex={0}
            aria-label={`${fixture.name} ${fixture.code}`}
            aria-pressed={selected}
            onPointerDown={(event) => begin(event, fixture.key, fixture)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.onSelect({ kind: 'fixture', key: fixture.key });
              }
            }}
          >
            <rect
              x={-halfWidth}
              y={-halfDepth}
              width={fixture.widthCm}
              height={fixture.depthCm}
              fill={props.colorOf(fixture)}
            />
            <line
              className="plan-front"
              x1={-halfWidth}
              y1={halfDepth}
              x2={halfWidth}
              y2={halfDepth}
            />
            <g transform={`rotate(${-fixture.rotation})`}>
              <text
                className="plan-code"
                y={codeSize * 0.36}
                fontSize={codeSize}
                textAnchor="middle"
              >
                {fixture.code}
              </text>
            </g>
          </g>
        );
      })}
      {route.length > 1 ? (
        <g className="plan-route">
          <polyline points={route.map((point) => `${point.x},${point.y}`).join(' ')} />
          {routeMiddle && routeDistance !== null && selectedFixture ? (
            <text
              x={routeMiddle.x + label * 0.5}
              y={routeMiddle.y}
              fontSize={label * 0.85}
              textAnchor="start"
            >
              {formatLength(routeDistance, unit)} ·{' '}
              {formatSeconds(props.secondsOf(selectedFixture) ?? 0)}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
