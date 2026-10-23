import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FIXTURE_DEFAULTS, type FixtureKind } from '@pharmacy/shared';
import { useRef, useState } from 'react';

import {
  getAlphabetRanges,
  setShelfLabel,
  type AlphabetRangeRow,
  type PlannerLevel,
} from '../../api';
import { printElementInBrowser } from '../invoice/printers';
import { KIND_ICONS, type DraftFixture, type Selection } from './model';

const QUICK_ADD: readonly FixtureKind[] = ['WALL_RACK', 'FRIDGE', 'SECURED_CABINET', 'ISLAND_RACK'];

/**
 * The shop as a simple list, for owners who do not want to draw: racks with their labels and
 * names, each level with a short name and the A to Z range of medicines on it. Printing gives
 * big shelf labels so staff find a medicine from its name alone.
 */
export function RackList({
  fixtures,
  levels,
  token,
  editable,
  dirty,
  selection,
  selectedLevel,
  onChange,
  onBegin,
  onAdd,
  onSelect,
}: {
  readonly fixtures: readonly DraftFixture[];
  readonly levels: ReadonlyMap<string, readonly PlannerLevel[]>;
  readonly token: string;
  readonly editable: boolean;
  readonly dirty: boolean;
  readonly selection: Selection;
  readonly selectedLevel: number | null;
  readonly onChange: (key: string, patch: Partial<DraftFixture>) => void;
  readonly onBegin: () => void;
  readonly onAdd: (kind: FixtureKind) => void;
  readonly onSelect: (selection: Selection, level?: number) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const printable = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const ranges = useQuery({
    queryKey: ['alphabet-ranges'],
    queryFn: () => getAlphabetRanges(token),
    enabled: token !== '',
  });
  const rangeByShelf = new Map<string, AlphabetRangeRow>(
    (ranges.data ?? []).map((range) => [range.shelfId, range]),
  );
  const sorted = [...fixtures].sort((a, b) =>
    a.code.localeCompare(b.code, 'en', { numeric: true }),
  );
  const saveLabel = async (shelfId: string, label: string) => {
    try {
      await setShelfLabel(token, shelfId, label.trim() || null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['alphabet-ranges'] });
      await queryClient.invalidateQueries({ queryKey: ['shelf-planner'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The name was not saved');
    }
  };
  const describe = (range: AlphabetRangeRow | undefined) =>
    range?.first ? `${range.first} → ${range.last ?? range.first}` : 'empty';

  return (
    <div className="rack-list">
      <div className="rack-list-bar">
        {editable
          ? QUICK_ADD.map((kind) => (
              <button
                key={kind}
                type="button"
                className="secondary-button"
                onClick={() => onAdd(kind)}
              >
                <span aria-hidden="true">{KIND_ICONS[kind]}</span> Add{' '}
                {FIXTURE_DEFAULTS[kind].label.toLowerCase()}
              </button>
            ))
          : null}
        <button
          type="button"
          className="secondary-button"
          disabled={dirty}
          title={dirty ? 'Save the layout first' : undefined}
          onClick={() => {
            if (printable.current) printElementInBrowser(printable.current, 'A4');
          }}
        >
          Print shelf labels
        </button>
      </div>
      {dirty ? (
        <p className="planner-hint warn">Save the layout to name levels and print labels.</p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <table className="rack-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Rack name</th>
            <th>Levels</th>
            <th>Each level holds</th>
            <th>Level names and A to Z ranges</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((fixture) => {
            const fixtureLevels = levels.get(fixture.key) ?? [];
            const chosen = selection?.kind === 'fixture' && selection.key === fixture.key;
            return (
              <tr key={fixture.key} className={chosen ? 'chosen' : ''}>
                <td>
                  <input
                    className="rack-code"
                    aria-label={`Label of ${fixture.name}`}
                    value={fixture.code}
                    maxLength={6}
                    disabled={!editable}
                    onFocus={onBegin}
                    onChange={(event) =>
                      onChange(fixture.key, {
                        code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`Name of rack ${fixture.code}`}
                    value={fixture.name}
                    maxLength={60}
                    disabled={!editable}
                    onFocus={onBegin}
                    onChange={(event) => onChange(fixture.key, { name: event.target.value })}
                  />
                  <small>
                    {KIND_ICONS[fixture.kind]} {FIXTURE_DEFAULTS[fixture.kind].label}
                  </small>
                </td>
                <td>
                  <input
                    className="small-input"
                    type="number"
                    min={1}
                    max={12}
                    aria-label={`Levels of rack ${fixture.code}`}
                    value={fixture.levelCount}
                    disabled={!editable}
                    onFocus={onBegin}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value) && value >= 1 && value <= 12) {
                        onChange(fixture.key, { levelCount: value });
                      }
                    }}
                  />
                </td>
                <td>
                  <input
                    className="small-input"
                    type="number"
                    min={1}
                    max={200}
                    aria-label={`Medicines per level on rack ${fixture.code}`}
                    value={fixture.facingsPerLevel}
                    disabled={!editable}
                    onFocus={onBegin}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value) && value >= 1 && value <= 200) {
                        onChange(fixture.key, { facingsPerLevel: value });
                      }
                    }}
                  />
                </td>
                <td>
                  <ol className="level-names">
                    {fixtureLevels.map((level) => {
                      const range = rangeByShelf.get(level.shelfId);
                      return (
                        <li
                          key={level.shelfId}
                          className={chosen && selectedLevel === level.level ? 'active' : ''}
                        >
                          <button
                            type="button"
                            className="level-code"
                            onClick={() =>
                              onSelect({ kind: 'fixture', key: fixture.key }, level.level)
                            }
                          >
                            {level.code}
                          </button>
                          <input
                            aria-label={`Name of shelf ${level.code}`}
                            defaultValue={level.label ?? ''}
                            key={`${level.shelfId}-${level.label ?? ''}`}
                            placeholder="Name (optional)"
                            maxLength={60}
                            disabled={!editable || dirty}
                            onBlur={(event) => {
                              if (event.target.value.trim() !== (level.label ?? '')) {
                                void saveLabel(level.shelfId, event.target.value);
                              }
                            }}
                          />
                          <span className="level-range">{describe(range)}</span>
                          <small>
                            {level.used}/{fixture.facingsPerLevel}
                          </small>
                        </li>
                      );
                    })}
                    {fixtureLevels.length === 0 ? (
                      <li className="planner-hint">Save the layout to see its levels.</li>
                    ) : null}
                  </ol>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div ref={printable} className="move-list-print shelf-labels" aria-hidden="true">
        {sorted.flatMap((fixture) =>
          (levels.get(fixture.key) ?? []).map((level) => {
            const range = rangeByShelf.get(level.shelfId);
            return (
              <div key={level.shelfId} className="shelf-label">
                <strong>{level.code}</strong>
                <span>{level.label ?? fixture.name}</span>
                <em>{describe(range)}</em>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
