import { boxBounds, type FloorPlan, type PlacedBox } from '@pharmacy/shared';
import { useEffect, useRef, useState } from 'react';

import type { DraftFixture, Selection } from './model';

interface Camera {
  readonly tilt: number;
  readonly spin: number;
  readonly zoom: number;
}

const DEFAULT_CAMERA: Camera = { tilt: 56, spin: -24, zoom: 1 };
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

export function Shop3DView(props: Props): React.JSX.Element {
  const { floor, fixtures, selection } = props;
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [animated, setAnimated] = useState(true);
  const orbit = useRef<{ x: number; y: number; camera: Camera; pointerId: number } | null>(null);

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
      setCamera((current) => ({
        ...current,
        zoom: Math.min(2.6, Math.max(0.45, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))),
      }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, []);

  // The camera turns the shop, so fit its longest side; tilting shortens what the eye sees.
  const scale =
    (Math.min(size.width, size.height * 1.35) * 0.74 * camera.zoom) /
    Math.max(floor.widthCm, floor.depthCm);
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
  const nudge = (change: Partial<Camera>) => {
    setAnimated(true);
    setCamera((current) => ({
      tilt: Math.min(85, Math.max(0, change.tilt ?? current.tilt)),
      spin: change.spin ?? current.spin,
      zoom: Math.min(2.6, Math.max(0.45, change.zoom ?? current.zoom)),
    }));
  };

  return (
    <div className="shop3d-wrap">
      <div
        ref={container}
        className="shop3d"
        role="application"
        aria-label="3D view of the shop. Drag to turn it, scroll to zoom."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
          orbit.current = {
            x: event.clientX,
            y: event.clientY,
            camera,
            pointerId: event.pointerId,
          };
        }}
        onPointerMove={(event) => {
          const start = orbit.current;
          if (!start || start.pointerId !== event.pointerId) return;
          setAnimated(false);
          setCamera({
            ...start.camera,
            spin: start.camera.spin + (event.clientX - start.x) * 0.35,
            tilt: Math.min(85, Math.max(0, start.camera.tilt - (event.clientY - start.y) * 0.25)),
          });
        }}
        onPointerUp={() => {
          orbit.current = null;
        }}
        onPointerCancel={() => {
          orbit.current = null;
        }}
      >
        <div
          className={`shop3d-stage${animated ? ' animated' : ''}`}
          style={{
            width: floor.widthCm * scale,
            height: floor.depthCm * scale,
            transform: `translate(-50%, -50%) rotateX(${camera.tilt}deg) rotateZ(${camera.spin}deg)`,
          }}
        >
          <div
            className="shop3d-floor"
            style={{ backgroundSize: `${100 * scale}px ${100 * scale}px` }}
            aria-hidden="true"
          />
          {wallBoxes.map((wall, index) => (
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
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onSelect({ kind: 'fixture', key: fixture.key })}
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
                      >
                        {scale * fixture.heightCm > 140 ? `${fixture.code}-${level}` : ''}
                      </button>
                    ))}
                    <span className="plinth3d" />
                  </div>
                }
              />
            );
          })}
        </div>
      </div>
      <div className="shop3d-controls" aria-label="Camera">
        <button
          type="button"
          onClick={() => nudge({ spin: camera.spin - 45 })}
          aria-label="Turn left"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => nudge({ spin: camera.spin + 45 })}
          aria-label="Turn right"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={() => nudge({ zoom: camera.zoom * 1.2 })}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => nudge({ zoom: camera.zoom / 1.2 })}
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" onClick={() => nudge({ tilt: 0, spin: 0 })}>
          Top
        </button>
        <button type="button" onClick={() => nudge({ tilt: 70, spin: 0 })}>
          Front
        </button>
        <button type="button" onClick={() => nudge(DEFAULT_CAMERA)}>
          Reset
        </button>
      </div>
    </div>
  );
}
