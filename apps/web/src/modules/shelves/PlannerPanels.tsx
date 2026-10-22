import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ENTRANCE_WALLS,
  FIXTURE_DEFAULTS,
  FIXTURE_KINDS,
  SHELF_STORAGE_CLASSES,
  type EntranceWall,
  type FixtureKind,
  type FloorPlan,
  type LayoutIssue,
  type ShelfStorageClass,
} from '@pharmacy/shared';
import { useDeferredValue, useState } from 'react';

import {
  getShelfMedicines,
  placeMedicineOnShelf,
  removeMedicineFromShelf,
  searchPlannerMedicines,
  type PlannerLevel,
  type PlannerMedicine,
} from '../../api';
import { KIND_ICONS, STORAGE_LABELS, type DraftFixture } from './model';
import { formatLength, formatSeconds, fromUnit, toUnit, type LengthUnit } from './units';

interface LengthFieldProps {
  readonly label: string;
  readonly cm: number;
  readonly unit: LengthUnit;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onBegin: () => void;
  readonly onChange: (cm: number) => void;
}

/** A length typed in feet or centimetres; the draft only ever holds whole centimetres. */
function LengthField(props: LengthFieldProps): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(toUnit(props.cm, props.unit));
  return (
    <label className="planner-field">
      <span>
        {props.label} <small>({props.unit})</small>
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={props.unit === 'ft' ? 0.5 : 5}
        value={shown}
        disabled={props.disabled}
        onFocus={() => {
          setText(shown);
          props.onBegin();
        }}
        onBlur={() => setText(null)}
        onChange={(event) => {
          setText(event.target.value);
          const value = Number(event.target.value);
          if (!Number.isFinite(value) || event.target.value === '') return;
          const cm = fromUnit(value, props.unit);
          if (cm >= props.min && cm <= props.max) props.onChange(cm);
        }}
      />
    </label>
  );
}

interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}

function Stepper(props: StepperProps): React.JSX.Element {
  return (
    <div className="planner-field">
      <span>{props.label}</span>
      <div className="planner-stepper">
        <button
          type="button"
          aria-label={`Fewer: ${props.label}`}
          disabled={props.disabled || props.value <= props.min}
          onClick={() => props.onChange(props.value - 1)}
        >
          −
        </button>
        <output aria-label={props.label}>{props.value}</output>
        <button
          type="button"
          aria-label={`More: ${props.label}`}
          disabled={props.disabled || props.value >= props.max}
          onClick={() => props.onChange(props.value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export interface FixtureInspectorProps {
  readonly fixture: DraftFixture;
  readonly unit: LengthUnit;
  readonly editable: boolean;
  readonly levels: readonly PlannerLevel[];
  readonly secondsOf: (level: number) => number | undefined;
  readonly walkCm: number | null;
  readonly selectedLevel: number | null;
  readonly unsaved: boolean;
  readonly token: string;
  readonly onBegin: () => void;
  readonly onChange: (patch: Partial<DraftFixture>) => void;
  readonly onCommit: (patch: Partial<DraftFixture>) => void;
  readonly onRotate: () => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
  readonly onSelectLevel: (level: number | null) => void;
  readonly onPlacementsChanged: () => void;
}

export function FixtureInspector(props: FixtureInspectorProps): React.JSX.Element {
  const { fixture, unit, editable } = props;
  const capacity = fixture.levelCount * fixture.facingsPerLevel;
  const used = props.levels.reduce((sum, level) => sum + level.used, 0);
  const selected = props.levels.find((level) => level.level === props.selectedLevel);
  const changeKind = (kind: FixtureKind) => {
    const defaults = FIXTURE_DEFAULTS[kind];
    props.onCommit({
      kind,
      name: fixture.name === FIXTURE_DEFAULTS[fixture.kind].label ? defaults.label : fixture.name,
      storageClass: defaults.storageClass,
      isSecured: defaults.isSecured,
    });
  };
  return (
    <section className="planner-panel" aria-label={`${fixture.name} ${fixture.code}`}>
      <header className="inspector-head">
        <span className={`code-badge kind-${fixture.kind.toLowerCase()}`}>{fixture.code}</span>
        <div>
          <strong>{fixture.name}</strong>
          <small>
            {KIND_ICONS[fixture.kind]} {FIXTURE_DEFAULTS[fixture.kind].label} ·{' '}
            {props.walkCm === null
              ? 'cannot reach'
              : `${formatLength(props.walkCm, unit)} from the counter`}
          </small>
        </div>
      </header>

      <div className="capacity-strip" aria-label="Capacity">
        <div>
          <span>Holds</span>
          <strong>{capacity}</strong>
          <small>medicines</small>
        </div>
        <div>
          <span>On it now</span>
          <strong>{used}</strong>
          <small>{capacity > 0 ? `${Math.round((used / capacity) * 100)}% full` : ''}</small>
        </div>
        <div>
          <span>Quickest level</span>
          <strong>
            {formatSeconds(
              Math.min(
                ...Array.from(
                  { length: fixture.levelCount },
                  (_, index) => props.secondsOf(index + 1) ?? 600,
                ),
              ),
            )}
          </strong>
          <small>per pick</small>
        </div>
      </div>

      <h3 className="planner-subhead">Levels (1 is the top shelf)</h3>
      <ol className="level-list">
        {Array.from({ length: fixture.levelCount }, (_, index) => index + 1).map((level) => {
          const info = props.levels.find((item) => item.level === level);
          const share = info ? Math.min(1, info.used / fixture.facingsPerLevel) : 0;
          return (
            <li key={level}>
              <button
                type="button"
                className={props.selectedLevel === level ? 'level-row active' : 'level-row'}
                onClick={() => props.onSelectLevel(props.selectedLevel === level ? null : level)}
              >
                <b>
                  {fixture.code}-{level}
                </b>
                <span className="level-fill" aria-hidden="true">
                  <i
                    style={{ width: `${share * 100}%` }}
                    className={info && info.used > fixture.facingsPerLevel ? 'over' : ''}
                  />
                </span>
                <span>
                  {info?.used ?? 0}/{fixture.facingsPerLevel}
                </span>
                <span className="level-seconds">
                  {formatSeconds(props.secondsOf(level) ?? 600)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {props.selectedLevel !== null ? (
        selected && !props.unsaved ? (
          <LevelMedicines
            key={selected.shelfId}
            shelf={selected}
            editable={editable}
            token={props.token}
            onChanged={props.onPlacementsChanged}
          />
        ) : (
          <p className="planner-hint">Save the layout first, then add medicines to this level.</p>
        )
      ) : null}

      <details className="planner-details" open={editable && fixture.id === null}>
        <summary>Size and type</summary>
        <div className="planner-form">
          <label className="planner-field wide">
            <span>Name</span>
            <input
              value={fixture.name}
              maxLength={60}
              disabled={!editable}
              onFocus={props.onBegin}
              onChange={(event) => props.onChange({ name: event.target.value })}
            />
          </label>
          <label className="planner-field">
            <span>Label</span>
            <input
              value={fixture.code}
              maxLength={6}
              disabled={!editable}
              onFocus={props.onBegin}
              onChange={(event) =>
                props.onChange({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
              }
            />
          </label>
          <label className="planner-field">
            <span>Type</span>
            <select
              value={fixture.kind}
              disabled={!editable}
              onChange={(event) => changeKind(event.target.value as FixtureKind)}
            >
              {FIXTURE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {FIXTURE_DEFAULTS[kind].label}
                </option>
              ))}
            </select>
          </label>
          <LengthField
            label="Width"
            cm={fixture.widthCm}
            unit={unit}
            min={20}
            max={2000}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(widthCm) => props.onChange({ widthCm })}
          />
          <LengthField
            label="Depth"
            cm={fixture.depthCm}
            unit={unit}
            min={20}
            max={400}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(depthCm) => props.onChange({ depthCm })}
          />
          <LengthField
            label="Height"
            cm={fixture.heightCm}
            unit={unit}
            min={30}
            max={400}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(heightCm) => props.onChange({ heightCm })}
          />
          <Stepper
            label="Levels"
            value={fixture.levelCount}
            min={1}
            max={12}
            disabled={!editable}
            onChange={(levelCount) => props.onCommit({ levelCount })}
          />
          <Stepper
            label="Medicines per level"
            value={fixture.facingsPerLevel}
            min={1}
            max={200}
            disabled={!editable}
            onChange={(facingsPerLevel) => props.onCommit({ facingsPerLevel })}
          />
          <label className="planner-field wide">
            <span>Storage</span>
            <select
              value={fixture.storageClass}
              disabled={!editable}
              onChange={(event) =>
                props.onCommit({ storageClass: event.target.value as ShelfStorageClass })
              }
            >
              {SHELF_STORAGE_CLASSES.map((storage) => (
                <option key={storage} value={storage}>
                  {STORAGE_LABELS[storage]}
                </option>
              ))}
            </select>
          </label>
          <label className="planner-check wide">
            <input
              type="checkbox"
              checked={fixture.isSecured}
              disabled={!editable}
              onChange={(event) => props.onCommit({ isSecured: event.target.checked })}
            />
            Locked (for controlled medicines)
          </label>
        </div>
      </details>

      {editable ? (
        <div className="inspector-actions">
          <button type="button" className="secondary-button" onClick={props.onRotate}>
            ⟳ Turn <kbd>R</kbd>
          </button>
          <button type="button" className="secondary-button" onClick={props.onDuplicate}>
            Copy <kbd>Ctrl D</kbd>
          </button>
          <button type="button" className="secondary-button danger" onClick={props.onRemove}>
            Remove <kbd>Del</kbd>
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface LevelMedicinesProps {
  readonly shelf: PlannerLevel;
  readonly editable: boolean;
  readonly token: string;
  readonly onChanged: () => void;
}

function LevelMedicines({
  shelf,
  editable,
  token,
  onChanged,
}: LevelMedicinesProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deferred = useDeferredValue(query.trim());
  const medicines = useQuery({
    queryKey: ['shelf-medicines', shelf.shelfId],
    queryFn: () => getShelfMedicines(token, shelf.shelfId),
  });
  const results = useQuery({
    queryKey: ['planner-search', deferred],
    queryFn: () => searchPlannerMedicines(token, deferred),
    enabled: editable && deferred.length >= 2,
    staleTime: 10_000,
  });
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['shelf-medicines'] });
      await queryClient.invalidateQueries({ queryKey: ['planner-search'] });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };
  const place = (medicine: PlannerMedicine) =>
    run(async () => {
      await placeMedicineOnShelf(token, medicine.id, shelf.shelfId);
      setQuery('');
    });
  const candidates = (results.data ?? []).filter((medicine) => medicine.shelfId !== shelf.shelfId);
  return (
    <section className="level-medicines" aria-label={`Medicines on ${shelf.code}`}>
      <h3>
        On shelf {shelf.code} <span>{medicines.data?.length ?? shelf.used}</span>
      </h3>
      {editable ? (
        <div className="level-add">
          <input
            type="search"
            value={query}
            placeholder="Type a medicine name to put it here"
            aria-label={`Add a medicine to ${shelf.code}`}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && candidates[0]) {
                event.preventDefault();
                void place(candidates[0]);
              }
            }}
          />
          {deferred.length >= 2 && candidates.length > 0 ? (
            <ul className="level-results" aria-label="Matching medicines">
              {candidates.slice(0, 8).map((medicine) => (
                <li key={medicine.id}>
                  <button type="button" disabled={busy} onClick={() => void place(medicine)}>
                    <strong>
                      {medicine.name} {medicine.strength ?? ''}
                    </strong>
                    <small>
                      {medicine.company ?? 'No company'}
                      {medicine.shelfCode
                        ? ` · move from ${medicine.shelfCode}`
                        : ' · not on a shelf'}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
      {medicines.isLoading ? <p className="planner-hint">Loading…</p> : null}
      <ul className="level-medicine-list">
        {(medicines.data ?? []).map((medicine) => (
          <li key={medicine.id}>
            <span>
              <strong>
                {medicine.name} {medicine.strength ?? ''}
              </strong>
              <small>
                {medicine.company ?? 'No company'} · {Number(medicine.stock ?? 0)} in stock
              </small>
            </span>
            {editable ? (
              <button
                type="button"
                className="link-button"
                disabled={busy}
                aria-label={`Take ${medicine.name} off ${shelf.code}`}
                onClick={() => void run(() => removeMedicineFromShelf(token, medicine.id))}
              >
                Take off
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {medicines.data?.length === 0 ? <p className="planner-hint">This shelf is empty.</p> : null}
    </section>
  );
}

interface CounterPanelProps {
  readonly floor: FloorPlan;
  readonly unit: LengthUnit;
  readonly editable: boolean;
  readonly onBegin: () => void;
  readonly onChange: (floor: FloorPlan) => void;
  readonly onRotate: () => void;
}

export function CounterPanel(props: CounterPanelProps): React.JSX.Element {
  const { floor, unit, editable } = props;
  return (
    <section className="planner-panel" aria-label="Counter">
      <header className="inspector-head">
        <span className="code-badge counter">C</span>
        <div>
          <strong>Counter</strong>
          <small>Staff stand behind it; walking is measured from there.</small>
        </div>
      </header>
      <div className="planner-form">
        <LengthField
          label="Length"
          cm={floor.counter.widthCm}
          unit={unit}
          min={40}
          max={2000}
          disabled={!editable}
          onBegin={props.onBegin}
          onChange={(widthCm) =>
            props.onChange({ ...floor, counter: { ...floor.counter, widthCm } })
          }
        />
        <LengthField
          label="Depth"
          cm={floor.counter.depthCm}
          unit={unit}
          min={30}
          max={400}
          disabled={!editable}
          onBegin={props.onBegin}
          onChange={(depthCm) =>
            props.onChange({ ...floor, counter: { ...floor.counter, depthCm } })
          }
        />
      </div>
      {editable ? (
        <div className="inspector-actions">
          <button type="button" className="secondary-button" onClick={props.onRotate}>
            ⟳ Turn customers' side <kbd>R</kbd>
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface ShopPanelProps {
  readonly floor: FloorPlan;
  readonly unit: LengthUnit;
  readonly editable: boolean;
  readonly issues: readonly LayoutIssue[];
  readonly stats: { readonly stocked: number; readonly placed: number; readonly unplaced: number };
  readonly capacity: number;
  readonly fixtureCount: number;
  readonly onBegin: () => void;
  readonly onChange: (floor: FloorPlan) => void;
  readonly onPickIssue: (issue: LayoutIssue) => void;
}

const WALL_NAMES: Readonly<Record<EntranceWall, string>> = {
  NORTH: 'Back wall (top)',
  EAST: 'Right wall',
  SOUTH: 'Front wall (bottom)',
  WEST: 'Left wall',
};

export function ShopPanel(props: ShopPanelProps): React.JSX.Element {
  const { floor, unit, editable, issues } = props;
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return (
    <section className="planner-panel" aria-label="Shop">
      <div className="capacity-strip">
        <div>
          <span>In stock</span>
          <strong>{props.stats.stocked}</strong>
          <small>medicines</small>
        </div>
        <div>
          <span>On a shelf</span>
          <strong>{props.stats.placed}</strong>
          <small>{props.stats.unplaced} still need a place</small>
        </div>
        <div>
          <span>Shelf space</span>
          <strong>{props.capacity}</strong>
          <small>{props.fixtureCount} racks</small>
        </div>
      </div>

      {errors.length + warnings.length === 0 ? (
        <p className="planner-ok">✓ Every rack can be reached and nothing overlaps.</p>
      ) : (
        <ul className="issue-list" aria-label="Problems">
          {[...errors, ...warnings].map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={issue.severity}>
              <button type="button" onClick={() => props.onPickIssue(issue)}>
                <b>{issue.severity === 'error' ? 'Must fix' : 'Check'}</b> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="planner-details" open={editable}>
        <summary>Shop size and door</summary>
        <div className="planner-form">
          <LengthField
            label="Width"
            cm={floor.widthCm}
            unit={unit}
            min={150}
            max={5000}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(widthCm) => props.onChange({ ...floor, widthCm })}
          />
          <LengthField
            label="Length"
            cm={floor.depthCm}
            unit={unit}
            min={150}
            max={5000}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(depthCm) => props.onChange({ ...floor, depthCm })}
          />
          <label className="planner-field wide">
            <span>Door is on the</span>
            <select
              value={floor.entrance.wall}
              disabled={!editable}
              onFocus={props.onBegin}
              onChange={(event) =>
                props.onChange({
                  ...floor,
                  entrance: {
                    ...floor.entrance,
                    wall: event.target.value as EntranceWall,
                    offsetCm: 0,
                  },
                })
              }
            >
              {ENTRANCE_WALLS.map((wall) => (
                <option key={wall} value={wall}>
                  {WALL_NAMES[wall]}
                </option>
              ))}
            </select>
          </label>
          <LengthField
            label="Door starts at"
            cm={floor.entrance.offsetCm}
            unit={unit}
            min={0}
            max={5000}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(offsetCm) =>
              props.onChange({ ...floor, entrance: { ...floor.entrance, offsetCm } })
            }
          />
          <LengthField
            label="Door width"
            cm={floor.entrance.widthCm}
            unit={unit}
            min={60}
            max={1000}
            disabled={!editable}
            onBegin={props.onBegin}
            onChange={(widthCm) =>
              props.onChange({ ...floor, entrance: { ...floor.entrance, widthCm } })
            }
          />
        </div>
      </details>
    </section>
  );
}
