import { boxBounds, type FloorPlan, type PlacedBox } from '@pharmacy/shared';
import { useEffect, useRef, useState } from 'react';

import type { DraftFixture, Selection } from './model';

interface Camera {
  readonly tilt: number;
  readonly spin: number;
  readonly zoom: number;
  /** Screen pixels the whole shop is moved by. */
  readonly panX: number;
  readonly panY: number;
  /** The floor point the camera turns around; null is the middle of the shop. */
  readonly focusX: number | null;
  readonly focusY: number | null;
}

const DEFAULT_CAMERA: Camera = {
  tilt: 56,
  spin: -24,
  zoom: 1,
  panX: 0,
  panY: 0,
  focusX: null,
  focusY: null,
};
const COUNTER_HEIGHT_CM = 95;
const WALL_HEIGHT_CM = 45;

interface Props {
  readonly floor: FloorPlan;
  readonly fixtures: readonly DraftFixture[];
  readonly levelColor: (fixture: DraftFixture, level: number) => string;
  readonly levelTitle: (fixture: DraftFixture, level: number) => string;
  readonly highlightKeys: ReadonlySet<string>;
  readonly ghosts: readonly PlacedBox[];
  readonly selection: Selection;
  readonly selectedLevel: number | null;
  readonly onSelect: (selection: Selection, level?: number) => void;
}

interface BoxProps {
  readonly box: PlacedBox;
  readonly heightCm: number;
  readonly scale: number;
  readonly className: string;
  readonly front?: React.ReactNode;
  readonly top?: React.ReactNode;
}

/**
 * A solid box from six faces. The wrapper sits on the floor at the box's footprint and turns with
 * it; faces fold up from its edges, so the open front of a rack always faces where it does on the
 * plan.
 */
function Box3D({ box, heightCm, scale, className, front, top }: BoxProps): React.JSX.Element {
  const width = box.widthCm * scale;
  const depth = box.depthCm * scale;
  const height = heightCm * scale;
  return (
    <div
      className={`box3d ${className}`}
      style={{
        left: (box.xCm - box.widthCm / 2) * scale,
        top: (box.yCm - box.depthCm / 2) * scale,
        width,
        height: depth,
        transform: `rotateZ(${box.rotation}deg)`,
      }}
    >
      <div
        className="face face-top"
        style={{ width, height: depth, transform: `translateZ(${height}px)` }}
      >
        {top}
      </div>
      <div
        className="face face-front"
        style={{
          width,
          height,
          top: depth - height,
          transformOrigin: 'bottom',
          transform: 'rotateX(-90deg)',
        }}
      >
        {front}
      </div>
      <div
        className="face face-back"
        style={{
          width,
          height,
          top: -height,
          transformOrigin: 'bottom',
          transform: 'rotateX(-90deg)',
        }}
      />
      <div
        className="face face-side"
        style={{
          width: height,
          height: depth,
          left: -height,
          transformOrigin: 'right',
          transform: 'rotateY(90deg)',
        }}
      />
      <div
        className="face face-side"
        style={{
          width: height,
          height: depth,
          left: width,
          transformOrigin: 'left',
          transform: 'rotateY(-90deg)',
        }}
      />
    </div>
  );
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const SIMPLE_KEY = 'pharmacy-3d-simple';

interface Gesture {
  readonly kind: 'orbit' | 'pan' | 'pinch';
  readonly camera: Camera;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

function clampCamera(camera: Camera): Camera {
  return {
    ...camera,
    tilt: Math.min(85, Math.max(0, camera.tilt)),
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom)),
  };
}

const VIEWS: ReadonlyArray<readonly [string, Partial<Camera>]> = [
  ['Top', { tilt: 0, spin: 0 }],
  ['Front', { tilt: 70, spin: 0 }],
  ['Left', { tilt: 66, spin: 90 }],
  ['Right', { tilt: 66, spin: -90 }],
  ['Corner', { tilt: 56, spin: -24 }],
];

/**
 * The shop in 3D. Drag to turn it, right-drag (or Shift-drag) to move it, wheel or pinch to zoom,
 * double-click a rack to look straight at it; the arrow, +/−, WASD and 0 keys do the same from the
 * keyboard. "Simple graphics" drops the costly details for slow counter PCs.
 */
export function Shop3DView(props: Props): React.JSX.Element {
  const { floor, fixtures, selection } = props;
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [animated, setAnimated] = useState(true);
  const [simple, setSimple] = useState(() => {
    try {
      return localStorage.getItem(SIMPLE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const cameraRef = useRef(camera);
  const hovering = useRef(false);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const move = (next: Camera, smooth: boolean) => {
    const clamped = clampCamera(next);
    cameraRef.current = clamped;
    setAnimated(smooth);
    setCamera(clamped);
  };

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    // The wheel zooms the shop instead of scrolling the page.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setAnimated(false);
      setCamera((current) =>
        clampCamera({ ...current, zoom: current.zoom * (event.deltaY > 0 ? 0.9 : 1.1) }),
      );
    };
    // Keys steer the camera while the pointer is over the shop or focus is inside it, never
    // while someone is typing in a field.
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (!hovering.current && !element.contains(document.activeElement)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const current = cameraRef.current;
      const step: Record<string, Partial<Camera>> = {
        ArrowLeft: { spin: current.spin + 15 },
        ArrowRight: { spin: current.spin - 15 },
        ArrowUp: { tilt: current.tilt - 5 },
        ArrowDown: { tilt: current.tilt + 5 },
        '+': { zoom: current.zoom * 1.15 },
        '=': { zoom: current.zoom * 1.15 },
        '-': { zoom: current.zoom / 1.15 },
        a: { panX: current.panX + 40 },
        d: { panX: current.panX - 40 },
        w: { panY: current.panY + 40 },
        s: { panY: current.panY - 40 },
        '0': DEFAULT_CAMERA,
      };
      const change = step[event.key];
      if (!change) return;
      event.preventDefault();
      const next = clampCamera({ ...current, ...change });
      cameraRef.current = next;
      setAnimated(true);
      setCamera(next);
    };
    const menu = (event: MouseEvent) => event.preventDefault();
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keys);
    element.addEventListener('contextmenu', menu);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keys);
      element.removeEventListener('contextmenu', menu);
    };
  }, []);

  const startGesture = (shiftKey: boolean, button: number) => {
    const points = [...pointers.current.values()];
    const first = points[0];
    if (!first) {
      gesture.current = null;
      return;
    }
    if (points.length >= 2) {
      const second = points[1]!;
      gesture.current = {
        kind: 'pinch',
        camera: cameraRef.current,
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        distance: Math.hypot(first.x - second.x, first.y - second.y),
      };
      return;
    }
    gesture.current = {
      kind: button === 2 || button === 1 || shiftKey ? 'pan' : 'orbit',
      camera: cameraRef.current,
      x: first.x,
      y: first.y,
      distance: 0,
    };
  };

  const focusOn = (fixture: DraftFixture) =>
    move(
      {
        ...cameraRef.current,
        focusX: fixture.xCm,
        focusY: fixture.yCm,
        panX: 0,
        panY: 0,
        zoom: Math.max(cameraRef.current.zoom, 1.7),
      },
      true,
    );

  // The camera turns the shop, so fit its longest side; tilting shortens what the eye sees.
  const scale =
    (Math.min(size.width, size.height * 1.35) * 0.74 * camera.zoom) /
    Math.max(floor.widthCm, floor.depthCm);
  const focusX = camera.focusX ?? floor.widthCm / 2;
  const focusY = camera.focusY ?? floor.depthCm / 2;
  const wallBoxes: PlacedBox[] = [
    { xCm: floor.widthCm / 2, yCm: -4, widthCm: floor.widthCm + 16, depthCm: 8, rotation: 0 },
    { xCm: -4, yCm: floor.depthCm / 2, widthCm: 8, depthCm: floor.depthCm, rotation: 0 },
    {
      xCm: floor.widthCm + 4,
      yCm: floor.depthCm / 2,
      widthCm: 8,
      depthCm: floor.depthCm,
      rotation: 0,
    },
  ];
  const nudge = (change: Partial<Camera>) => move({ ...cameraRef.current, ...change }, true);
  const toggleSimple = () => {
    const next = !simple;
    setSimple(next);
    try {
      localStorage.setItem(SIMPLE_KEY, String(next));
    } catch {
      // A preference only.
    }
  };

  return (
    <div className={`shop3d-wrap${simple ? ' simple' : ''}`}>
      <div
        ref={container}
        className="shop3d"
        role="application"
        onPointerEnter={() => {
          hovering.current = true;
        }}
        onPointerLeave={() => {
          hovering.current = false;
        }}
        aria-label="3D view of the shop. Drag to turn it, right-drag to move it, scroll to zoom, double-click a rack to look at it."
        onPointerDown={(event) => {
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          startGesture(event.shiftKey, event.button);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const start = gesture.current;
          if (!start) return;
          const points = [...pointers.current.values()];
          if (start.kind === 'pinch' && points.length >= 2) {
            const [first, second] = [points[0]!, points[1]!];
            const distance = Math.hypot(first.x - second.x, first.y - second.y);
            move(
              {
                ...start.camera,
                zoom: start.camera.zoom * (distance / Math.max(1, start.distance)),
                panX: start.camera.panX + (first.x + second.x) / 2 - start.x,
                panY: start.camera.panY + (first.y + second.y) / 2 - start.y,
              },
              false,
            );
            return;
          }
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          move(
            start.kind === 'pan'
              ? { ...start.camera, panX: start.camera.panX + dx, panY: start.camera.panY + dy }
              : {
                  ...start.camera,
                  spin: start.camera.spin + dx * 0.35,
                  tilt: start.camera.tilt - dy * 0.25,
                },
            false,
          );
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          startGesture(false, 0);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          startGesture(false, 0);
        }}
      >
        <div
          className={`shop3d-stage${animated ? ' animated' : ''}`}
          style={{
            width: floor.widthCm * scale,
            height: floor.depthCm * scale,
            transform:
              `translate(-50%, -50%) translate(${camera.panX}px, ${camera.panY}px) ` +
              `rotateX(${camera.tilt}deg) rotateZ(${camera.spin}deg) ` +
              `translate3d(${(floor.widthCm / 2 - focusX) * scale}px, ${(floor.depthCm / 2 - focusY) * scale}px, 0)`,
          }}
        >
          <div
            className="shop3d-floor"
            style={{ backgroundSize: `${100 * scale}px ${100 * scale}px` }}
            aria-hidden="true"
          />
          {simple
            ? null
            : wallBoxes.map((wall, index) => (
                <Box3D
                  key={`wall-${index}`}
                  box={wall}
                  heightCm={WALL_HEIGHT_CM}
                  scale={scale}
                  className="wall3d"
                />
              ))}
          {props.ghosts.map((ghost, index) => {
            const bounds = boxBounds(ghost);
            return (
              <div
                key={`ghost-${index}`}
                className="ghost3d"
                style={{
                  left: bounds.minX * scale,
                  top: bounds.minY * scale,
                  width: (bounds.maxX - bounds.minX) * scale,
                  height: (bounds.maxY - bounds.minY) * scale,
                }}
              />
            );
          })}
          <Box3D
            box={floor.counter}
            heightCm={COUNTER_HEIGHT_CM}
            scale={scale}
            className={`counter3d${selection?.kind === 'counter' ? ' selected' : ''}`}
            top={<span className="top-label">Counter</span>}
          />
          {fixtures.map((fixture) => {
            const selected = selection?.kind === 'fixture' && selection.key === fixture.key;
            const levels = Array.from({ length: fixture.levelCount }, (_, index) => index + 1);
            return (
              <Box3D
                key={fixture.key}
                box={fixture}
                heightCm={fixture.heightCm}
                scale={scale}
                className={[
                  'fixture3d',
                  `kind-${fixture.kind.toLowerCase()}`,
                  selected ? 'selected' : '',
                  props.highlightKeys.has(fixture.key) ? 'highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                top={
                  <button
                    type="button"
                    className="top-label"
                    title="Double-click to look at this rack"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onSelect({ kind: 'fixture', key: fixture.key })}
                    onDoubleClick={() => focusOn(fixture)}
                  >
                    {fixture.code}
                  </button>
                }
                front={
                  <div className="levels3d">
                    {levels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={
                          selected && props.selectedLevel === level ? 'level3d active' : 'level3d'
                        }
                        style={{ background: props.levelColor(fixture, level) }}
                        title={props.levelTitle(fixture, level)}
                        aria-label={props.levelTitle(fixture, level)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onSelect({ kind: 'fixture', key: fixture.key }, level)}
                        onDoubleClick={() => focusOn(fixture)}
                      >
                        {!simple && scale * fixture.heightCm > 140
                          ? `${fixture.code}-${level}`
                          : ''}
                      </button>
                    ))}
                    <span className="plinth3d" />
                  </div>
                }
              />
            );
          })}
        </div>
        <p className="shop3d-hint" aria-hidden="true">
          Drag: turn · Right-drag: move · Wheel: zoom · Double-click a rack: look at it
        </p>
      </div>
      <div className="shop3d-controls" aria-label="Camera">
        <button
          type="button"
          onClick={() => nudge({ spin: camera.spin + 45 })}
          aria-label="Turn left"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => nudge({ spin: camera.spin - 45 })}
          aria-label="Turn right"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={() => nudge({ zoom: camera.zoom * 1.25 })}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => nudge({ zoom: camera.zoom / 1.25 })}
          aria-label="Zoom out"
        >
          −
        </button>
        {VIEWS.map(([label, change]) => (
          <button key={label} type="button" onClick={() => nudge(change)}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => nudge(DEFAULT_CAMERA)}>
          Fit
        </button>
        <button type="button" aria-pressed={simple} onClick={toggleSimple}>
          Simple graphics
        </button>
      </div>
    </div>
  );
}
