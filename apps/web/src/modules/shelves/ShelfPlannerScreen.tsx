import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyFixtureChanges,
  boxBounds,
  buildWalkMap,
  FIXTURE_DEFAULTS,
  FIXTURE_KINDS,
  pickPoint,
  PERMISSIONS,
  slotTimings,
  starterLayout,
  validateLayout,
  walkDistanceCm,
  type FixtureKind,
  type FloorPlan,
  type LayoutIssue,
  type PlacedBox,
  type PlacementGrouping,
  type PlanMode,
} from '@pharmacy/shared';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyShelfProposal,
  createShelfProposal,
  getCurrentShelfProposal,
  getShelfPlanner,
  rejectShelfProposal,
  saveShelfLayout,
  searchPlannerMedicines,
  type ShelfPlannerState,
  type ShelfProposal,
} from '../../api';
import { usePharmacyStore } from '../../store';
import { FloorPlanEditor } from './FloorPlanEditor';
import { Shop3DView } from './Shop3DView';
import {
  createFixture,
  draftFromState,
  draftSignature,
  duplicateFixture,
  fillColor,
  KIND_ICONS,
  levelsByKey,
  rotated,
  speedColor,
  type Draft,
  type DraftFixture,
  type Selection,
} from './model';
import { CounterPanel, FixtureInspector, ShopPanel } from './PlannerPanels';
import {
  chosenMoves,
  DonePanel,
  initialChoices,
  ProposalPanel,
  SuggestPanel,
  targetOf,
  type ProposalChoices,
} from './ProposalPanel';
import {
  formatLength,
  formatSeconds,
  fromUnit,
  loadUnit,
  saveUnit,
  toUnit,
  type LengthUnit,
} from './units';

type Panel = 'shop' | 'suggest' | 'proposal' | 'done';
type View = 'plan' | '3d';
type ColorMode = 'speed' | 'fill';

interface Done {
  readonly proposal: ShelfProposal;
  readonly choices: ProposalChoices;
  readonly moves: number;
  readonly fixtureChanges: number;
}

/** Owner's shelf planner: draw the shop, see it in 3D, place medicines, accept suggestions. */
export function ShelfPlannerScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const permissions = session?.user.permissions ?? [];
  const queryClient = useQueryClient();
  const [unit, setUnitState] = useState<LengthUnit>(loadUnit);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>('shop');
  const [choices, setChoices] = useState<ProposalChoices | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const planner = useQuery({
    queryKey: ['shelf-planner'],
    queryFn: () => getShelfPlanner(token),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const proposal = useQuery({
    queryKey: ['shelf-proposal'],
    queryFn: () => getCurrentShelfProposal(token),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const setUnit = (next: LengthUnit) => {
    setUnitState(next);
    saveUnit(next);
  };

  if (planner.isLoading)
    return <main className="shelf-planner route-loading">Opening the shop plan…</main>;
  if (planner.error || !planner.data) {
    return (
      <main className="shelf-planner">
        <p className="inline-error">
          {planner.error instanceof Error
            ? planner.error.message
            : 'The shelf planner is unavailable.'}
        </p>
      </main>
    );
  }
  return (
    <PlannerWorkspace
      key={planner.data.version}
      state={planner.data}
      token={token}
      canManage={permissions.includes(PERMISSIONS.INVENTORY_SHELF_MANAGE)}
      canReview={
        permissions.includes(PERMISSIONS.INVENTORY_SHELF_MANAGE) ||
        permissions.includes(PERMISSIONS.INVENTORY_SHELF_REVIEW)
      }
      unit={unit}
      notice={notice}
      panel={panel}
      proposal={proposal.data ?? null}
      choices={choices}
      done={done}
      onUnit={setUnit}
      onNotice={setNotice}
      onPanel={setPanel}
      onChoices={setChoices}
      onDone={setDone}
      onProposal={(next) => queryClient.setQueryData(['shelf-proposal'], next)}
      onReload={async () => {
        await queryClient.invalidateQueries({ queryKey: ['shelf-planner'] });
      }}
    />
  );
}

interface WorkspaceProps {
  readonly state: ShelfPlannerState;
  readonly token: string;
  readonly canManage: boolean;
  readonly canReview: boolean;
  readonly unit: LengthUnit;
  readonly notice: string;
  readonly panel: Panel;
  readonly proposal: ShelfProposal | null;
  readonly choices: ProposalChoices | null;
  readonly done: Done | null;
  readonly onUnit: (unit: LengthUnit) => void;
  readonly onNotice: (notice: string) => void;
  readonly onPanel: (panel: Panel) => void;
  readonly onChoices: (choices: ProposalChoices | null) => void;
  readonly onDone: (done: Done | null) => void;
  readonly onProposal: (proposal: ShelfProposal | null) => void;
  readonly onReload: () => Promise<void>;
}

function PlannerWorkspace(props: WorkspaceProps): React.JSX.Element {
  const { state, token, canManage, unit } = props;
  const [draft, setDraftState] = useState<Draft | null>(() => draftFromState(state));
  const draftRef = useRef(draft);
  const [past, setPast] = useState<readonly Draft[]>([]);
  const [future, setFuture] = useState<readonly Draft[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [view, setView] = useState<View>('plan');
  const [colorMode, setColorMode] = useState<ColorMode>('speed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const savedSignature = useMemo(() => draftSignature(draftFromState(state)), [state]);
  const dirty = draft !== null && draftSignature(draft) !== savedSignature;

  const setDraft = (next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const checkpoint = () => {
    const current = draftRef.current;
    if (!current) return;
    setPast((items) => [...items.slice(-59), current]);
    setFuture([]);
  };
  const commit = (next: Draft) => {
    checkpoint();
    setDraft(next);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous || !draft) return;
    setPast(past.slice(0, -1));
    setFuture([draft, ...future]);
    setDraft(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next || !draft) return;
    setFuture(future.slice(1));
    setPast([...past, draft]);
    setDraft(next);
  };

  // Proposal preview: the accepted rack changes applied to the current racks.
  const proposalOpen =
    props.panel === 'proposal' && props.proposal !== null && props.choices !== null;
  const proposalChanges = useMemo(
    () =>
      proposalOpen
        ? props.proposal.fixtureChanges.filter((change) =>
            props.choices!.acceptedChanges.has(change.id),
          )
        : [],
    [proposalOpen, props.proposal, props.choices],
  );
  const shown: readonly DraftFixture[] = useMemo(() => {
    if (!draft) return [];
    if (!proposalOpen) return draft.fixtures;
    return applyFixtureChanges(draft.fixtures, proposalChanges).map((fixture) => ({
      ...fixture,
      id: 'id' in fixture ? (fixture as DraftFixture).id : null,
    }));
  }, [draft, proposalOpen, proposalChanges]);
  const ghosts: PlacedBox[] = useMemo(() => {
    if (!draft || !proposalOpen) return [];
    const after = new Map(shown.map((fixture) => [fixture.key, fixture]));
    return draft.fixtures.filter((fixture) => {
      const moved = after.get(fixture.key);
      return (
        moved &&
        (moved.xCm !== fixture.xCm ||
          moved.yCm !== fixture.yCm ||
          moved.rotation !== fixture.rotation)
      );
    });
  }, [draft, proposalOpen, shown]);

  const floor = draft?.floor ?? null;
  const walkMap = useMemo(() => (floor ? buildWalkMap(floor, shown) : null), [floor, shown]);
  const issues: LayoutIssue[] = useMemo(
    () => (floor && walkMap ? validateLayout(floor, shown, { walkMap }) : []),
    [floor, shown, walkMap],
  );
  const seconds = useMemo(() => {
    const map = new Map<string, number>();
    if (floor && walkMap) {
      for (const timing of slotTimings(floor, shown, walkMap)) {
        map.set(`${timing.fixtureKey}#${timing.level}`, timing.secondsPerPick);
      }
    }
    return map;
  }, [floor, shown, walkMap]);
  const levels = useMemo(() => levelsByKey(state), [state]);
  const usedBySlot = useMemo(() => {
    const used = new Map<string, number>();
    for (const [key, items] of levels) {
      for (const item of items) used.set(`${key}#${item.level}`, item.used);
    }
    if (proposalOpen) {
      for (const move of chosenMoves(props.proposal, props.choices)) {
        if (move.from) {
          const from = `${move.from.fixtureKey}#${move.from.level}`;
          used.set(from, Math.max(0, (used.get(from) ?? 0) - 1));
        }
        const target = targetOf(move, props.choices);
        const to = `${target.fixtureKey}#${target.level}`;
        used.set(to, (used.get(to) ?? 0) + 1);
      }
    }
    return used;
  }, [levels, proposalOpen, props.proposal, props.choices]);

  const averageSeconds = (fixture: DraftFixture): number | undefined => {
    const values = Array.from(
      { length: fixture.levelCount },
      (_, index) => seconds.get(`${fixture.key}#${index + 1}`) ?? 600,
    );
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : undefined;
  };
  const usedOn = (fixture: DraftFixture): number =>
    Array.from(
      { length: fixture.levelCount },
      (_, index) => usedBySlot.get(`${fixture.key}#${index + 1}`) ?? 0,
    ).reduce((sum, value) => sum + value, 0);
  const fixtureColor = (fixture: DraftFixture): string =>
    colorMode === 'speed'
      ? speedColor(averageSeconds(fixture))
      : fillColor(usedOn(fixture), fixture.levelCount * fixture.facingsPerLevel);
  const problemKeys = new Set(issues.flatMap((issue) => issue.fixtureKeys));
  const highlightKeys = new Set<string>([
    ...(focusKey ? [focusKey] : []),
    ...proposalChanges.flatMap((change) =>
      change.type === 'ADD'
        ? [change.fixture.key]
        : change.type === 'SWAP'
          ? [change.fixtureKey, change.otherKey]
          : [change.fixtureKey],
    ),
  ]);
  const selectedFixture =
    selection?.kind === 'fixture'
      ? shown.find((fixture) => fixture.key === selection.key)
      : undefined;
  const editable = canManage && !proposalOpen;
  const capacity = shown.reduce(
    (sum, fixture) => sum + fixture.levelCount * fixture.facingsPerLevel,
    0,
  );

  const updateFixture = (key: string, patch: Partial<DraftFixture>, withHistory: boolean) => {
    if (!draft) return;
    const next = {
      ...draft,
      fixtures: draft.fixtures.map((fixture) =>
        fixture.key === key ? { ...fixture, ...patch } : fixture,
      ),
    };
    if (withHistory) commit(next);
    else setDraft(next);
  };
  const addFixture = (kind: FixtureKind) => {
    if (!draft) return;
    const fixture = createFixture(draft, kind);
    commit({ ...draft, fixtures: [...draft.fixtures, fixture] });
    setSelection({ kind: 'fixture', key: fixture.key });
    setSelectedLevel(null);
  };
  const removeSelected = () => {
    if (!draft || !selectedFixture) return;
    const held = (levels.get(selectedFixture.key) ?? []).reduce(
      (sum, level) => sum + level.used,
      0,
    );
    if (held > 0) {
      setError(
        `${selectedFixture.name} (${selectedFixture.code}) still holds ${held} medicines. Move them first.`,
      );
      return;
    }
    commit({
      ...draft,
      fixtures: draft.fixtures.filter((fixture) => fixture.key !== selectedFixture.key),
    });
    setSelection(null);
  };
  const rotateSelected = () => {
    if (!draft) return;
    if (selection?.kind === 'counter')
      commit({ ...draft, floor: { ...draft.floor, counter: rotated(draft.floor.counter) } });
    else if (selectedFixture)
      updateFixture(selectedFixture.key, { rotation: rotated(selectedFixture).rotation }, true);
  };
  const duplicateSelected = () => {
    if (!draft || !selectedFixture) return;
    const copy = duplicateFixture(draft, selectedFixture);
    commit({ ...draft, fixtures: [...draft.fixtures, copy] });
    setSelection({ kind: 'fixture', key: copy.key });
  };
  const nudge = (dx: number, dy: number) => {
    if (!draft) return;
    if (selection?.kind === 'counter') {
      commit({
        ...draft,
        floor: {
          ...draft.floor,
          counter: {
            ...draft.floor.counter,
            xCm: draft.floor.counter.xCm + dx,
            yCm: draft.floor.counter.yCm + dy,
          },
        },
      });
    } else if (selectedFixture) {
      updateFixture(
        selectedFixture.key,
        { xCm: selectedFixture.xCm + dx, yCm: selectedFixture.yCm + dy },
        true,
      );
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const result = await saveShelfLayout(token, state.version, draft.floor, draft.fixtures);
      props.onNotice(
        result.warnings.length > 0
          ? `Saved. ${result.warnings.length} things to check are listed on the right.`
          : 'Saved. Counter search now uses these shelf codes.',
      );
      props.onProposal(null);
      await props.onReload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The layout could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (mode: PlanMode, grouping: PlacementGrouping) => {
    setBusy(true);
    setError('');
    try {
      const created = await createShelfProposal(token, mode, grouping);
      props.onProposal(created);
      props.onChoices(initialChoices(created));
      props.onPanel('proposal');
      setSelection(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No suggestion could be made.');
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!props.proposal || !props.choices) return;
    const current = props.proposal;
    const currentChoices = props.choices;
    setBusy(true);
    setError('');
    try {
      const moves = chosenMoves(current, currentChoices).map((move) => {
        const target = targetOf(move, currentChoices);
        return { medicineId: move.medicineId, fixtureKey: target.fixtureKey, level: target.level };
      });
      const changeIds = props.canManage ? [...currentChoices.acceptedChanges] : [];
      const result = await applyShelfProposal(token, current.id, changeIds, moves);
      props.onDone({
        proposal: current,
        choices: currentChoices,
        moves: result.moves,
        fixtureChanges: result.fixtureChanges,
      });
      props.onPanel('done');
      props.onProposal(null);
      await props.onReload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suggestion could not be applied.');
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!props.proposal) return;
    setBusy(true);
    setError('');
    try {
      await rejectShelfProposal(token, props.proposal.id);
      props.onProposal(null);
      props.onChoices(null);
      props.onPanel('shop');
      props.onNotice('Suggestion rejected. Nothing was changed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suggestion could not be rejected.');
    } finally {
      setBusy(false);
    }
  };

  // Keyboard: arrows nudge, R turns, Delete removes, Ctrl+Z / Ctrl+Y undo and redo.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (!editable || !draft) return;
      const step = event.shiftKey ? 30 : 5;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (ctrl && key === 'y') {
        event.preventDefault();
        redo();
      } else if (ctrl && key === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (ctrl && key === 's') {
        event.preventDefault();
        if (dirty && !busy) void save();
      } else if (!ctrl && key === 'r' && selection) {
        rotateSelected();
      } else if ((key === 'delete' || key === 'backspace') && selectedFixture) {
        event.preventDefault();
        removeSelected();
      } else if (key === 'escape') {
        setSelection(null);
      } else if (selection && key.startsWith('arrow')) {
        event.preventDefault();
        nudge(
          key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0,
          key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0,
        );
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!draft) {
    return (
      <SetupWizard
        unit={unit}
        canManage={canManage}
        onUnit={props.onUnit}
        onStart={(next) => {
          setDraft(next);
          props.onNotice(
            'Your starting layout is ready. Drag racks to match your shop, then press Save.',
          );
        }}
      />
    );
  }

  const selectSomething = (next: Selection, level?: number) => {
    setSelection(next);
    setSelectedLevel(level ?? null);
    setFocusKey(null);
    if (next && props.panel === 'done') props.onPanel('shop');
  };
  const blockedReason = dirty
    ? 'Save your changes first.'
    : draft.fixtures.length === 0
      ? 'Add at least one rack first.'
      : null;

  return (
    <main className="shelf-planner">
      <header className="planner-toolbar">
        <div className="planner-title">
          <p className="eyebrow">Shelf planner</p>
          <h1>Your shop, rack by rack</h1>
        </div>
        <FindMedicine
          token={token}
          onFound={(code) => {
            const split = code.lastIndexOf('-');
            const fixture = shown.find((item) => item.code === code.slice(0, split));
            if (!fixture) {
              props.onNotice(
                `That medicine is on ${code}, an older shelf that is not on the plan.`,
              );
              return;
            }
            setSelection({ kind: 'fixture', key: fixture.key });
            setSelectedLevel(Number(code.slice(split + 1)));
            setFocusKey(fixture.key);
          }}
        />
        <div className="planner-toggles">
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
              Plan
            </button>
            <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
              3D
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Colour racks by">
            <button
              type="button"
              aria-pressed={colorMode === 'speed'}
              onClick={() => setColorMode('speed')}
            >
              Speed
            </button>
            <button
              type="button"
              aria-pressed={colorMode === 'fill'}
              onClick={() => setColorMode('fill')}
            >
              How full
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Units">
            <button type="button" aria-pressed={unit === 'ft'} onClick={() => props.onUnit('ft')}>
              ft
            </button>
            <button type="button" aria-pressed={unit === 'cm'} onClick={() => props.onUnit('cm')}>
              cm
            </button>
          </div>
        </div>
        {canManage ? (
          <div className="planner-save">
            <button
              type="button"
              className="icon-button"
              disabled={past.length === 0 || !editable}
              onClick={undo}
              aria-label="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={future.length === 0 || !editable}
              onClick={redo}
              aria-label="Redo"
            >
              ↷
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!dirty || busy || issues.some((issue) => issue.severity === 'error')}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : dirty ? 'Save layout' : 'Saved ✓'}
            </button>
          </div>
        ) : null}
        {props.canReview ? (
          <button
            type="button"
            className="suggest-button"
            onClick={() => {
              setSelection(null);
              props.onPanel(props.proposal ? 'proposal' : 'suggest');
              if (props.proposal && !props.choices) props.onChoices(initialChoices(props.proposal));
            }}
          >
            ✦ {props.proposal ? 'Review suggestion' : 'Suggest a better layout'}
          </button>
        ) : null}
      </header>

      {props.notice ? (
        <p className="planner-notice" role="status">
          {props.notice}
          <button type="button" className="link-button" onClick={() => props.onNotice('')}>
            Dismiss
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="inline-error planner-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className={`planner-body${editable ? '' : ' read-only'}`}>
        {editable ? (
          <nav className="planner-palette" aria-label="Add to the shop">
            <p>Add</p>
            {FIXTURE_KINDS.map((kind) => (
              <button key={kind} type="button" onClick={() => addFixture(kind)}>
                <span aria-hidden="true">{KIND_ICONS[kind]}</span>
                {FIXTURE_DEFAULTS[kind].label}
              </button>
            ))}
            <p className="palette-tip">Drag to move · R to turn · arrows to nudge</p>
          </nav>
        ) : null}

        <section className="planner-canvas" aria-label={view === 'plan' ? 'Floor plan' : '3D view'}>
          {view === 'plan' && walkMap ? (
            <FloorPlanEditor
              floor={draft.floor}
              fixtures={shown}
              unit={unit}
              colorOf={fixtureColor}
              secondsOf={(fixture) => {
                const values = Array.from(
                  { length: fixture.levelCount },
                  (_, index) => seconds.get(`${fixture.key}#${index + 1}`) ?? 600,
                );
                return values.length ? Math.min(...values) : undefined;
              }}
              problemKeys={problemKeys}
              highlightKeys={highlightKeys}
              ghosts={ghosts}
              selection={selection}
              walkMap={walkMap}
              editable={editable}
              onSelect={selectSomething}
              onDragStart={checkpoint}
              onDrag={(target, xCm, yCm) => {
                const current = draftRef.current;
                if (!current) return;
                if (target === 'counter') {
                  setDraft({
                    ...current,
                    floor: { ...current.floor, counter: { ...current.floor.counter, xCm, yCm } },
                  });
                } else {
                  setDraft({
                    ...current,
                    fixtures: current.fixtures.map((fixture) =>
                      fixture.key === target ? { ...fixture, xCm, yCm } : fixture,
                    ),
                  });
                }
              }}
            />
          ) : (
            <Shop3DView
              floor={draft.floor}
              fixtures={shown}
              highlightKeys={highlightKeys}
              ghosts={ghosts}
              selection={selection}
              selectedLevel={selectedLevel}
              levelColor={(fixture, level) =>
                colorMode === 'speed'
                  ? speedColor(seconds.get(`${fixture.key}#${level}`))
                  : fillColor(
                      usedBySlot.get(`${fixture.key}#${level}`) ?? 0,
                      fixture.facingsPerLevel,
                    )
              }
              levelTitle={(fixture, level) =>
                `${fixture.code}-${level}: ${usedBySlot.get(`${fixture.key}#${level}`) ?? 0} of ${fixture.facingsPerLevel} · ${formatSeconds(seconds.get(`${fixture.key}#${level}`) ?? 600)} per pick`
              }
              onSelect={selectSomething}
            />
          )}
          <Legend colorMode={colorMode} />
        </section>

        <aside className="planner-side">
          {props.panel === 'suggest' ? (
            <SuggestPanel
              busy={busy}
              blockedReason={blockedReason}
              pending={props.proposal}
              onGenerate={(mode, grouping) => void generate(mode, grouping)}
              onReview={() => {
                if (props.proposal) props.onChoices(initialChoices(props.proposal));
                props.onPanel('proposal');
              }}
              onClose={() => props.onPanel('shop')}
            />
          ) : proposalOpen ? (
            <ProposalPanel
              proposal={props.proposal}
              choices={props.choices}
              canMoveRacks={canManage}
              busy={busy}
              onChoices={props.onChoices}
              onFocusFixture={(key) => {
                setFocusKey(key);
                setSelection({ kind: 'fixture', key });
              }}
              onApply={() => void apply()}
              onReject={() => void reject()}
              onClose={() => {
                props.onPanel('shop');
                setFocusKey(null);
                setSelection(null);
              }}
            />
          ) : props.panel === 'done' && props.done ? (
            <DonePanel
              proposal={props.done.proposal}
              choices={props.done.choices}
              moves={props.done.moves}
              fixtureChanges={props.done.fixtureChanges}
              onClose={() => {
                props.onDone(null);
                props.onPanel('shop');
                setFocusKey(null);
                setSelection(null);
              }}
            />
          ) : selectedFixture ? (
            <FixtureInspector
              key={selectedFixture.key}
              fixture={selectedFixture}
              unit={unit}
              editable={editable}
              levels={levels.get(selectedFixture.key) ?? []}
              secondsOf={(level) => seconds.get(`${selectedFixture.key}#${level}`)}
              walkCm={walkMap ? walkDistanceCm(walkMap, pickPoint(selectedFixture)) : null}
              selectedLevel={selectedLevel}
              unsaved={dirty || selectedFixture.id === null}
              token={token}
              onBegin={checkpoint}
              onChange={(patch) => updateFixture(selectedFixture.key, patch, false)}
              onCommit={(patch) => updateFixture(selectedFixture.key, patch, true)}
              onRotate={rotateSelected}
              onDuplicate={duplicateSelected}
              onRemove={removeSelected}
              onSelectLevel={setSelectedLevel}
              onPlacementsChanged={() => void props.onReload()}
            />
          ) : selection?.kind === 'counter' ? (
            <CounterPanel
              floor={draft.floor}
              unit={unit}
              editable={editable}
              onBegin={checkpoint}
              onChange={(next) => setDraft({ ...draft, floor: next })}
              onRotate={rotateSelected}
            />
          ) : (
            <ShopPanel
              floor={draft.floor}
              unit={unit}
              editable={editable}
              issues={issues}
              stats={state.stats}
              capacity={capacity}
              fixtureCount={shown.length}
              onBegin={checkpoint}
              onChange={(next) => setDraft({ ...draft, floor: next })}
              onPickIssue={(issue) => {
                const key = issue.fixtureKeys[0];
                if (key) selectSomething({ kind: 'fixture', key });
              }}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

function Legend({ colorMode }: { readonly colorMode: ColorMode }): React.JSX.Element {
  return colorMode === 'speed' ? (
    <p className="planner-legend">
      <i style={{ background: speedColor(4) }} /> quick to reach
      <i style={{ background: speedColor(10) }} /> a few steps
      <i style={{ background: speedColor(16) }} /> slow: far, low, or high
      <span>Seconds count the walk from the counter and back, plus bending or reaching.</span>
    </p>
  ) : (
    <p className="planner-legend">
      <i style={{ background: fillColor(0, 10) }} /> empty
      <i style={{ background: fillColor(5, 10) }} /> half full
      <i style={{ background: fillColor(10, 10) }} /> full
      <i style={{ background: fillColor(11, 10) }} /> over full
    </p>
  );
}

function FindMedicine({
  token,
  onFound,
}: {
  readonly token: string;
  readonly onFound: (code: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const deferred = useDeferredValue(query.trim());
  const results = useQuery({
    queryKey: ['planner-search', deferred],
    queryFn: () => searchPlannerMedicines(token, deferred),
    enabled: deferred.length >= 2,
    staleTime: 10_000,
  });
  const items = results.data ?? [];
  return (
    <div className="find-medicine">
      <input
        type="search"
        value={query}
        placeholder="Where is…? type a medicine"
        aria-label="Find where a medicine is kept"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          const first = items.find((item) => item.shelfCode);
          if (event.key === 'Enter' && first?.shelfCode) {
            onFound(first.shelfCode);
            setOpen(false);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open && deferred.length >= 2 && items.length > 0 ? (
        <ul className="find-results">
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={!item.shelfCode}
                onClick={() => {
                  if (item.shelfCode) onFound(item.shelfCode);
                  setOpen(false);
                }}
              >
                <strong>
                  {item.name} {item.strength ?? ''}
                </strong>
                <span>{item.shelfCode ?? 'not on a shelf yet'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const PRESETS: ReadonlyArray<{
  readonly label: string;
  readonly width: number;
  readonly depth: number;
}> = [
  { label: '10 × 20 ft', width: 305, depth: 610 },
  { label: '12 × 30 ft', width: 366, depth: 914 },
  { label: '15 × 40 ft', width: 457, depth: 1219 },
  { label: '20 × 20 ft', width: 610, depth: 610 },
];

function SetupWizard(props: {
  readonly unit: LengthUnit;
  readonly canManage: boolean;
  readonly onUnit: (unit: LengthUnit) => void;
  readonly onStart: (draft: Draft) => void;
}): React.JSX.Element {
  const [width, setWidth] = useState(305);
  const [depth, setDepth] = useState(610);
  const valid = width >= 150 && width <= 5000 && depth >= 150 && depth <= 5000;
  const starter = useMemo(
    () => (valid ? starterLayout(width, depth) : null),
    [valid, width, depth],
  );
  if (!props.canManage) {
    return (
      <main className="shelf-planner">
        <section className="planner-wizard">
          <h1>The shop has not been drawn yet</h1>
          <p>Ask the owner or the inventory manager to draw the shop in the shelf planner.</p>
        </section>
      </main>
    );
  }
  const start = (withRacks: boolean) => {
    if (!starter) return;
    const fixtures = withRacks ? starter.fixtures.map((fixture) => ({ ...fixture, id: null })) : [];
    props.onStart({ floor: starter.floor, fixtures });
  };
  const field = (label: string, cm: number, set: (cm: number) => void) => (
    <label className="planner-field big">
      <span>
        {label} ({props.unit})
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={props.unit === 'ft' ? 5 : 150}
        step={props.unit === 'ft' ? 0.5 : 10}
        defaultValue={toUnit(cm, props.unit)}
        key={`${label}-${props.unit}-${cm}`}
        onBlur={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value > 0) set(fromUnit(value, props.unit));
        }}
      />
    </label>
  );
  return (
    <main className="shelf-planner">
      <section className="planner-wizard">
        <p className="eyebrow">Shelf planner · step 1 of 2</p>
        <h1>How big is your shop?</h1>
        <p>
          Measure wall to wall inside the shop. You can change everything later. Then drag racks to
          match your shop and press Save.
        </p>
        <div className="wizard-presets" role="group" aria-label="Common shop sizes">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={width === preset.width && depth === preset.depth}
              onClick={() => {
                setWidth(preset.width);
                setDepth(preset.depth);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="wizard-fields">
          {field('Width (front wall)', width, setWidth)}
          {field('Length (front to back)', depth, setDepth)}
          <div className="segmented" role="group" aria-label="Units">
            <button
              type="button"
              aria-pressed={props.unit === 'ft'}
              onClick={() => props.onUnit('ft')}
            >
              ft
            </button>
            <button
              type="button"
              aria-pressed={props.unit === 'cm'}
              onClick={() => props.onUnit('cm')}
            >
              cm
            </button>
          </div>
        </div>
        {starter ? (
          <WizardPreview floor={starter.floor} fixtures={starter.fixtures} unit={props.unit} />
        ) : null}
        {!valid ? (
          <p className="inline-error">A shop must be between 5 and 160 feet each way.</p>
        ) : null}
        <div className="wizard-actions">
          <button
            type="button"
            className="primary-button big-action"
            disabled={!valid}
            onClick={() => start(true)}
          >
            Start with racks on the walls
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!valid}
            onClick={() => start(false)}
          >
            Start with an empty shop
          </button>
        </div>
      </section>
    </main>
  );
}

function WizardPreview(props: {
  readonly floor: FloorPlan;
  readonly fixtures: readonly DraftFixture[] | ReturnType<typeof starterLayout>['fixtures'];
  readonly unit: LengthUnit;
}): React.JSX.Element {
  const { floor } = props;
  const counter = boxBounds(floor.counter);
  return (
    <figure className="wizard-preview">
      <svg
        viewBox={`-20 -20 ${floor.widthCm + 40} ${floor.depthCm + 40}`}
        role="img"
        aria-label="Starting layout preview"
      >
        <rect className="plan-floor" width={floor.widthCm} height={floor.depthCm} />
        {props.fixtures.map((fixture) => {
          const bounds = boxBounds(fixture);
          return (
            <rect
              key={fixture.key}
              className={`preview-fixture kind-${fixture.kind.toLowerCase()}`}
              x={bounds.minX}
              y={bounds.minY}
              width={bounds.maxX - bounds.minX}
              height={bounds.maxY - bounds.minY}
            />
          );
        })}
        <rect
          className="preview-counter"
          x={counter.minX}
          y={counter.minY}
          width={counter.maxX - counter.minX}
          height={counter.maxY - counter.minY}
        />
      </svg>
      <figcaption>
        {formatLength(floor.widthCm, props.unit)} × {formatLength(floor.depthCm, props.unit)} ·{' '}
        {props.fixtures.filter((fixture) => fixture.kind === 'WALL_RACK').length} wall racks, a
        fridge and a locked cabinet
      </figcaption>
    </figure>
  );
}
