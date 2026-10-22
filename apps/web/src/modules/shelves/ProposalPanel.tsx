import {
  MOVE_REASON_LABELS,
  slotId,
  type FixtureChange,
  type FixtureLayout,
  type PlacementGrouping,
  type PlanMode,
  type SlotRef,
} from '@pharmacy/shared';
import { useMemo, useRef, useState } from 'react';

import type { ProposalMove, ShelfProposal } from '../../api';
import { printElementInBrowser } from '../invoice/printers';
import { formatMonthlyTime } from './units';

export interface ProposalChoices {
  readonly acceptedChanges: ReadonlySet<string>;
  readonly skippedMoves: ReadonlySet<string>;
  readonly retargets: ReadonlyMap<string, SlotRef>;
}

export function initialChoices(proposal: ShelfProposal): ProposalChoices {
  return {
    acceptedChanges: new Set(proposal.fixtureChanges.map((change) => change.id)),
    skippedMoves: new Set(),
    retargets: new Map(),
  };
}

export function targetOf(move: ProposalMove, choices: ProposalChoices): SlotRef {
  return choices.retargets.get(move.medicineId) ?? move.to;
}

/** Moves that stay selected: ticked, and not onto a new rack the owner turned down. */
export function chosenMoves(proposal: ShelfProposal, choices: ProposalChoices): ProposalMove[] {
  const refused = new Set(
    proposal.fixtureChanges
      .filter((change) => change.type === 'ADD' && !choices.acceptedChanges.has(change.id))
      .map((change) => (change.type === 'ADD' ? change.fixture.key : '')),
  );
  return proposal.moves.filter(
    (move) =>
      !choices.skippedMoves.has(move.medicineId) &&
      !refused.has(targetOf(move, choices).fixtureKey),
  );
}

const MODE_TEXT: Readonly<Record<PlanMode, { title: string; detail: string }>> = {
  IMPROVE: {
    title: 'Improve what I have',
    detail:
      'Keeps your current arrangement. Only moves medicines that are on the wrong shelf, have no shelf, or sell fast but sit far away.',
  },
  FRESH: {
    title: 'Fresh arrangement',
    detail:
      'Plans every shelf again: fast sellers closest to the counter, everything else grouped so staff find it quickly.',
  },
};

const GROUPING_TEXT: Readonly<Record<PlacementGrouping, string>> = {
  COMPANY: 'By company',
  FORM: 'By form (tablets, syrups…)',
  NAME: 'A to Z',
};

interface SuggestPanelProps {
  readonly busy: boolean;
  readonly blockedReason: string | null;
  readonly pending: ShelfProposal | null;
  readonly onGenerate: (mode: PlanMode, grouping: PlacementGrouping) => void;
  readonly onReview: () => void;
  readonly onClose: () => void;
}

export function SuggestPanel(props: SuggestPanelProps): React.JSX.Element {
  const [mode, setMode] = useState<PlanMode>('IMPROVE');
  const [grouping, setGrouping] = useState<PlacementGrouping>('COMPANY');
  return (
    <section className="planner-panel suggest-panel" aria-label="Suggest a better arrangement">
      <header className="panel-title">
        <h2>Suggest a better arrangement</h2>
        <button type="button" className="link-button" onClick={props.onClose}>
          Close
        </button>
      </header>
      {props.pending ? (
        <button type="button" className="pending-proposal" onClick={props.onReview}>
          <strong>Open suggestion waiting</strong>
          <span>
            {props.pending.summary.moveCount} medicine moves ·{' '}
            {props.pending.summary.fixtureChangeCount} rack{' '}
            {props.pending.summary.fixtureChangeCount === 1 ? 'change' : 'changes'}. Review it →
          </span>
        </button>
      ) : null}
      <fieldset className="choice-cards">
        <legend>What should I do?</legend>
        {(['IMPROVE', 'FRESH'] as const).map((value) => (
          <label key={value} className={mode === value ? 'choice-card active' : 'choice-card'}>
            <input
              type="radio"
              name="plan-mode"
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <strong>{MODE_TEXT[value].title}</strong>
            <small>{MODE_TEXT[value].detail}</small>
          </label>
        ))}
      </fieldset>
      <fieldset className="choice-chips">
        <legend>Keep medicines together</legend>
        {(['COMPANY', 'FORM', 'NAME'] as const).map((value) => (
          <label key={value} className={grouping === value ? 'chip active' : 'chip'}>
            <input
              type="radio"
              name="plan-grouping"
              checked={grouping === value}
              onChange={() => setGrouping(value)}
            />
            {GROUPING_TEXT[value]}
          </label>
        ))}
      </fieldset>
      {props.blockedReason ? <p className="planner-hint warn">{props.blockedReason}</p> : null}
      <button
        type="button"
        className="primary-button big-action"
        disabled={props.busy || props.blockedReason !== null}
        onClick={() => props.onGenerate(mode, grouping)}
      >
        {props.busy ? 'Working it out…' : 'Make a suggestion'}
      </button>
      <p className="planner-hint">
        Nothing changes until you accept. You can untick anything you do not want.
      </p>
    </section>
  );
}

interface ProposalPanelProps {
  readonly proposal: ShelfProposal;
  readonly choices: ProposalChoices;
  readonly canMoveRacks: boolean;
  readonly busy: boolean;
  readonly onChoices: (choices: ProposalChoices) => void;
  readonly onFocusFixture: (key: string) => void;
  readonly onApply: () => void;
  readonly onReject: () => void;
  readonly onClose: () => void;
}

function changeTitle(change: FixtureChange, fixtures: ReadonlyMap<string, FixtureLayout>): string {
  if (change.type === 'ADD') return `Add ${change.fixture.name} ${change.fixture.code}`;
  const fixture = fixtures.get(change.fixtureKey);
  if (change.type === 'ROTATE') return `Turn ${fixture?.name ?? ''} ${fixture?.code ?? ''} around`;
  const other = fixtures.get(change.otherKey);
  return `Swap ${fixture?.code ?? ''} and ${other?.code ?? ''}`;
}

export function ProposalPanel(props: ProposalPanelProps): React.JSX.Element {
  const { proposal, choices } = props;
  const [open, setOpen] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const fixtures = useMemo(
    () => new Map(proposal.fixtures.map((fixture) => [fixture.key, fixture])),
    [proposal.fixtures],
  );
  const slots = useMemo(
    () =>
      proposal.fixtures.flatMap((fixture) =>
        Array.from({ length: fixture.levelCount }, (_, index) => ({
          fixtureKey: fixture.key,
          level: index + 1,
          label: `${fixture.code}-${index + 1}`,
        })),
      ),
    [proposal.fixtures],
  );
  const chosen = chosenMoves(proposal, choices);
  const chosenIds = new Set(chosen.map((move) => move.medicineId));
  const groups = new Map<string, ProposalMove[]>();
  for (const move of proposal.moves) {
    const key = targetOf(move, choices).fixtureKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(move);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    (fixtures.get(a)?.code ?? a).localeCompare(fixtures.get(b)?.code ?? b, 'en', { numeric: true }),
  );
  const setMoves = (ids: readonly string[], selected: boolean) => {
    const skipped = new Set(choices.skippedMoves);
    for (const id of ids) {
      if (selected) skipped.delete(id);
      else skipped.add(id);
    }
    props.onChoices({ ...choices, skippedMoves: skipped });
  };
  const toggleChange = (id: string) => {
    const accepted = new Set(choices.acceptedChanges);
    if (accepted.has(id)) accepted.delete(id);
    else accepted.add(id);
    props.onChoices({ ...choices, acceptedChanges: accepted });
  };
  const retarget = (move: ProposalMove, value: string) => {
    const slot = slots.find((item) => slotId(item) === value);
    if (!slot) return;
    const retargets = new Map(choices.retargets);
    if (slotId(slot) === slotId(move.to)) retargets.delete(move.medicineId);
    else retargets.set(move.medicineId, { fixtureKey: slot.fixtureKey, level: slot.level });
    props.onChoices({ ...choices, retargets });
  };
  const summary = proposal.summary;

  return (
    <section className="planner-panel proposal-panel" aria-label="Suggested arrangement">
      <header className="panel-title">
        <h2>Suggested arrangement</h2>
        <button type="button" className="link-button" onClick={props.onClose}>
          Close
        </button>
      </header>
      <div className="proposal-summary">
        <div>
          <span>Medicines to place or move</span>
          <strong>{summary.moveCount.toLocaleString('en-PK')}</strong>
          <small>{summary.newPlacements.toLocaleString('en-PK')} have no shelf today</small>
        </div>
        <div>
          <span>Walking saved</span>
          <strong>
            {summary.withSales > 0 ? formatMonthlyTime(summary.secondsSavedPerMonth) : '—'}
          </strong>
          <small>{summary.withSales > 0 ? 'every month' : 'needs sales history'}</small>
        </div>
        <div className={summary.unplacedCount > 0 ? 'warn' : ''}>
          <span>Do not fit</span>
          <strong>{summary.unplacedCount.toLocaleString('en-PK')}</strong>
          <small>{summary.unplacedCount > 0 ? 'need more shelf space' : 'everything fits'}</small>
        </div>
      </div>
      {summary.withSales === 0 ? (
        <p className="planner-hint">
          No sales in the last {summary.lookbackDays} days yet, so medicines are grouped and the
          quickest shelves are kept free for fast sellers. Ask again after a few weeks of sales.
        </p>
      ) : null}

      {proposal.fixtureChanges.length > 0 ? (
        <section className="proposal-section">
          <h3>Rack changes</h3>
          {!props.canMoveRacks ? (
            <p className="planner-hint">Only a manager with shelf rights can move racks.</p>
          ) : null}
          <ul className="change-list">
            {proposal.fixtureChanges.map((change) => (
              <li key={change.id}>
                <label aria-label={changeTitle(change, fixtures)}>
                  <input
                    type="checkbox"
                    checked={choices.acceptedChanges.has(change.id)}
                    disabled={!props.canMoveRacks}
                    onChange={() => toggleChange(change.id)}
                  />
                  <span>
                    <strong>{changeTitle(change, fixtures)}</strong>
                    <small>{change.reason}</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    props.onFocusFixture(
                      change.type === 'ADD' ? change.fixture.key : change.fixtureKey,
                    )
                  }
                >
                  Show
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="proposal-section">
        <h3>
          Medicines <span>{chosen.length.toLocaleString('en-PK')} selected</span>
        </h3>
        <div className="proposal-bulk">
          <button
            type="button"
            className="link-button"
            onClick={() =>
              setMoves(
                proposal.moves.map((move) => move.medicineId),
                true,
              )
            }
          >
            Select all
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() =>
              setMoves(
                proposal.moves.map((move) => move.medicineId),
                false,
              )
            }
          >
            Select none
          </button>
        </div>
        <ul className="move-groups">
          {ordered.map(([key, moves]) => {
            const fixture = fixtures.get(key);
            const selectedCount = moves.filter((move) => chosenIds.has(move.medicineId)).length;
            const expanded = open === key;
            return (
              <li key={key} className="move-group">
                <div className="move-group-head">
                  <input
                    type="checkbox"
                    aria-label={`All medicines for ${fixture?.code ?? key}`}
                    checked={selectedCount === moves.length}
                    ref={(element) => {
                      if (element)
                        element.indeterminate = selectedCount > 0 && selectedCount < moves.length;
                    }}
                    onChange={(event) =>
                      setMoves(
                        moves.map((move) => move.medicineId),
                        event.target.checked,
                      )
                    }
                  />
                  <button
                    type="button"
                    className="move-group-toggle"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpen(expanded ? null : key);
                      props.onFocusFixture(key);
                    }}
                  >
                    <b>{fixture?.code ?? '?'}</b> {fixture?.name ?? 'Rack'}
                    <span>
                      {selectedCount}/{moves.length}
                    </span>
                  </button>
                </div>
                {expanded ? (
                  <ul className="move-rows">
                    {moves.map((move) => {
                      const target = targetOf(move, choices);
                      return (
                        <li key={move.medicineId}>
                          <input
                            type="checkbox"
                            aria-label={`Move ${move.name}`}
                            checked={chosenIds.has(move.medicineId)}
                            onChange={(event) => setMoves([move.medicineId], event.target.checked)}
                          />
                          <span className="move-name">
                            <strong>{move.name}</strong>
                            <small>
                              {MOVE_REASON_LABELS[move.reason]}
                              {move.secondsSavedPerMonth > 0
                                ? ` · saves ${formatMonthlyTime(move.secondsSavedPerMonth)} a month`
                                : ''}
                            </small>
                          </span>
                          <span className="move-route">{move.fromLabel ?? 'no shelf'} →</span>
                          <select
                            aria-label={`New shelf for ${move.name}`}
                            value={slotId(target)}
                            onChange={(event) => retarget(move, event.target.value)}
                          >
                            {slots.map((slot) => (
                              <option key={slotId(slot)} value={slotId(slot)}>
                                {slot.label}
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {proposal.unplaced.length > 0 ? (
        <details className="proposal-section unplaced">
          <summary>{proposal.unplaced.length.toLocaleString('en-PK')} medicines do not fit</summary>
          <p className="planner-hint">
            Raise “medicines per level” on racks that hold small boxes, accept the new racks above,
            or keep these in the store room.
          </p>
          <ul>
            {proposal.unplaced.slice(0, 200).map((item) => (
              <li key={item.medicineId}>
                {item.name}{' '}
                <small>
                  {item.reason === 'NO_COLD_SPACE'
                    ? 'needs fridge space'
                    : item.reason === 'NO_LOCKED_SPACE'
                      ? 'needs locked space'
                      : item.group}
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="proposal-actions">
        <button
          type="button"
          className="primary-button big-action"
          disabled={props.busy || (chosen.length === 0 && choices.acceptedChanges.size === 0)}
          onClick={props.onApply}
        >
          {props.busy ? 'Applying…' : `Accept ${chosen.length.toLocaleString('en-PK')} moves`}
          {choices.acceptedChanges.size > 0
            ? ` and ${choices.acceptedChanges.size} rack ${choices.acceptedChanges.size === 1 ? 'change' : 'changes'}`
            : ''}
        </button>
        <div>
          <button
            type="button"
            className="secondary-button"
            disabled={chosen.length === 0}
            onClick={() => {
              if (printRef.current) printElementInBrowser(printRef.current, 'A4');
            }}
          >
            Print move list
          </button>
          <button
            type="button"
            className="secondary-button danger"
            disabled={props.busy}
            onClick={props.onReject}
          >
            Reject suggestion
          </button>
        </div>
      </footer>

      <MoveListPrint proposal={proposal} choices={choices} printRef={printRef} />
    </section>
  );
}

interface MoveListProps {
  readonly proposal: ShelfProposal;
  readonly choices: ProposalChoices;
  readonly printRef: React.RefObject<HTMLDivElement | null>;
}

/** The paper list a helper carries along the racks, sorted shelf by shelf. */
export function MoveListPrint({ proposal, choices, printRef }: MoveListProps): React.JSX.Element {
  const codes = new Map(proposal.fixtures.map((fixture) => [fixture.key, fixture.code]));
  const labelOf = (slot: SlotRef) => `${codes.get(slot.fixtureKey) ?? '?'}-${slot.level}`;
  const list = chosenMoves(proposal, choices).sort(
    (a, b) =>
      labelOf(targetOf(a, choices)).localeCompare(labelOf(targetOf(b, choices)), 'en', {
        numeric: true,
      }) || a.name.localeCompare(b.name, 'en'),
  );
  return (
    <div ref={printRef} className="move-list-print" aria-hidden="true">
      <h1>Shelf move list</h1>
      <p>
        {new Date().toLocaleDateString('en-PK')} · {list.length} medicines. Tick each one after
        moving it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Done</th>
            <th>Put on</th>
            <th>Medicine</th>
            <th>Take from</th>
          </tr>
        </thead>
        <tbody>
          {list.map((move) => (
            <tr key={move.medicineId}>
              <td>☐</td>
              <td>{labelOf(targetOf(move, choices))}</td>
              <td>{move.name}</td>
              <td>{move.fromLabel ?? 'Store room / new stock'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DonePanelProps {
  readonly proposal: ShelfProposal;
  readonly choices: ProposalChoices;
  readonly moves: number;
  readonly fixtureChanges: number;
  readonly onClose: () => void;
}

export function DonePanel(props: DonePanelProps): React.JSX.Element {
  const printRef = useRef<HTMLDivElement>(null);
  return (
    <section className="planner-panel done-panel" aria-label="Suggestion applied">
      <p className="done-tick" aria-hidden="true">
        ✓
      </p>
      <h2>Done</h2>
      <p>
        {props.moves.toLocaleString('en-PK')} medicines have their new shelf
        {props.fixtureChanges > 0
          ? ` and ${props.fixtureChanges} rack ${props.fixtureChanges === 1 ? 'change is' : 'changes are'} saved`
          : ''}
        . Counter search already shows the new places.
      </p>
      <p className="planner-hint">
        Print the move list and give it to a helper. They tick each medicine as they move it.
      </p>
      <button
        type="button"
        className="primary-button big-action"
        disabled={props.moves === 0}
        onClick={() => {
          if (printRef.current) printElementInBrowser(printRef.current, 'A4');
        }}
      >
        Print move list
      </button>
      <button type="button" className="secondary-button" onClick={props.onClose}>
        Back to the shop
      </button>
      <MoveListPrint proposal={props.proposal} choices={props.choices} printRef={printRef} />
    </section>
  );
}
