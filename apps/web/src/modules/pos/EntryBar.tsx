import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { decimalToScaledInteger, formatDosage } from '@pharmacy/shared';

import { searchMedicines, type MedicineSearchResult } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatPkrMoney } from '../../money';
import { previewMedicines } from '../../preview-data';
import { parseQuantityEntry, parseTimingEntry } from './line-entry';
import { TimingPresets, timingPreview } from './TimingField';

export interface EntryBarHandle {
  focusSearch: () => void;
  reset: () => void;
}

export function wholeUnits(quantity: string): string {
  return quantity.replace(/\.0+$/, '');
}

export function isSellable(medicine: MedicineSearchResult): boolean {
  try {
    return (
      medicine.salePrice !== null && decimalToScaledInteger(medicine.availableQuantity, 3) > 0n
    );
  } catch {
    return false;
  }
}

function quantityHint(qtyText: string, timingText: string): string {
  const timing = parseTimingEntry(timingText);
  const schedule = 'schedule' in timing ? timing.schedule : null;
  const quantity = parseQuantityEntry(qtyText, schedule);
  if (!('quantity' in quantity)) return '';
  if (quantity.days)
    return `= ${String(quantity.quantity)} units for ${String(quantity.days)} days`;
  if (!schedule) return '';
  const milliPerDay = schedule.morning + schedule.evening + schedule.night;
  const days = Math.floor((quantity.quantity * 1000) / milliPerDay);
  return `= ${String(days)} day${days === 1 ? '' : 's'} of ${formatDosage({ ...schedule, meal: null })}`;
}

export function EntryBar({
  handleRef,
  token,
  previewMode,
  locked,
  onAdd,
  onSetActiveQuantity,
  onNotice,
}: {
  readonly handleRef: React.Ref<EntryBarHandle>;
  readonly token: string;
  readonly previewMode: boolean;
  readonly locked: boolean;
  readonly onAdd: (medicine: MedicineSearchResult, quantity: number, dosage: string | null) => void;
  readonly onSetActiveQuantity: (quantity: number) => void;
  readonly onNotice: (message: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState({ query: '', index: 0 });
  const [staged, setStaged] = useState<MedicineSearchResult | null>(null);
  const [qtyText, setQtyText] = useState('');
  const [timingText, setTimingText] = useState('');
  const [timingFocused, setTimingFocused] = useState(false);
  const [error, setError] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const qtyInput = useRef<HTMLInputElement>(null);
  const timingInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 120);

  const search = useQuery({
    queryKey: ['medicine-search', debounced],
    queryFn: () => searchMedicines(token, debounced),
    enabled: !previewMode && token !== '' && debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const results = previewMode
    ? previewMedicines.filter((medicine) =>
        `${medicine.name} ${medicine.genericName ?? ''} ${medicine.barcode ?? ''}`
          .toLowerCase()
          .includes(debounced.toLowerCase()),
      )
    : (search.data ?? []);
  const fresh = trimmed === debounced && !search.isFetching;
  const activeIndex =
    active.query === debounced ? Math.min(active.index, Math.max(results.length - 1, 0)) : 0;
  const showResults = !staged && trimmed !== '' && debounced !== '';

  useImperativeHandle(handleRef, () => ({
    focusSearch: () => {
      if (staged) qtyInput.current?.focus();
      else searchInput.current?.focus();
    },
    reset: () => {
      setQuery('');
      setStaged(null);
      setQtyText('');
      setTimingText('');
      setError('');
    },
  }));

  useEffect(() => {
    if (staged) qtyInput.current?.focus();
    else searchInput.current?.focus();
  }, [staged]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-result-index="${String(activeIndex)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const stage = (medicine: MedicineSearchResult): void => {
    if (locked) {
      onNotice('Release the reservation before changing this ticket');
      return;
    }
    if (!isSellable(medicine)) {
      setError(`${medicine.name} has no sellable stock or price at this branch`);
      return;
    }
    setError('');
    setQuery('');
    setQtyText('');
    setTimingText('');
    setStaged(medicine);
  };

  const unstage = (): void => {
    setStaged(null);
    setQtyText('');
    setTimingText('');
    setError('');
  };

  const commit = (): void => {
    if (!staged) {
      searchInput.current?.focus();
      return;
    }
    const timing = parseTimingEntry(timingText);
    if ('error' in timing) {
      setError(timing.error);
      timingInput.current?.focus();
      return;
    }
    const quantity = parseQuantityEntry(qtyText, timing.schedule);
    if ('error' in quantity) {
      setError(quantity.error);
      qtyInput.current?.focus();
      return;
    }
    onAdd(staged, quantity.quantity, timing.schedule ? formatDosage(timing.schedule) : null);
    unstage();
  };

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive({
        query: debounced,
        index: (activeIndex + step + results.length) % results.length,
      });
      return;
    }
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const multiplier = /^\*(\d{1,4})$/.exec(trimmed);
    if (multiplier) {
      onSetActiveQuantity(Number(multiplier[1]));
      setQuery('');
      return;
    }
    if (!trimmed) return;
    if (!fresh) {
      onNotice('Still searching — press Enter again when results appear');
      return;
    }
    const chosen = results[activeIndex];
    if (chosen) stage(chosen);
  };

  const qtyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape' || (event.key === 'Backspace' && qtyText === '')) {
      event.preventDefault();
      event.stopPropagation();
      unstage();
    }
  };

  const timingKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape' || (event.key === 'Backspace' && timingText === '')) {
      event.preventDefault();
      event.stopPropagation();
      qtyInput.current?.focus();
    }
  };

  const preview = timingPreview(timingText);
  const hint = quantityHint(qtyText, timingText);

  return (
    <div className="entry-bar">
      <div className="entry-row">
        <div className="entry-item">
          <span aria-hidden="true" className="entry-icon">
            ⌕
          </span>
          {staged ? (
            <div className="staged-item">
              <strong>
                {staged.name} <em>{staged.strength}</em>
              </strong>
              <small>
                {formatPkrMoney(staged.salePrice)} / unit · {wholeUnits(staged.availableQuantity)}{' '}
                in stock{staged.nearestExpiry ? ` · exp ${staged.nearestExpiry}` : ''}
              </small>
              <button type="button" aria-label="Change medicine" onClick={unstage}>
                ×
              </button>
            </div>
          ) : (
            <input
              ref={searchInput}
              aria-label="Search medicine"
              placeholder="Brand, generic, barcode or company"
              value={query}
              role="combobox"
              aria-expanded={showResults}
              aria-controls="medicine-results"
              aria-autocomplete="list"
              {...(showResults && results.length > 0
                ? { 'aria-activedescendant': `medicine-option-${String(activeIndex)}` }
                : {})}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive({ query: '', index: 0 });
                setError('');
              }}
              onKeyDown={searchKeyDown}
            />
          )}
          <kbd>/</kbd>
        </div>
        <label className="entry-field qty">
          <span>Qty</span>
          <input
            ref={qtyInput}
            aria-label="Quantity"
            inputMode="numeric"
            placeholder={staged ? '20 or 5d' : ''}
            disabled={!staged}
            value={qtyText}
            onChange={(event) => {
              setQtyText(event.target.value.slice(0, 8));
              setError('');
            }}
            onKeyDown={qtyKeyDown}
          />
        </label>
        <label className={preview.valid ? 'entry-field timing' : 'entry-field timing invalid'}>
          <span>Timing</span>
          <input
            ref={timingInput}
            aria-label="Timing"
            placeholder={staged ? 'optional · 101' : ''}
            disabled={!staged}
            value={timingText}
            autoComplete="off"
            onFocus={() => setTimingFocused(true)}
            onBlur={() => setTimingFocused(false)}
            onChange={(event) => {
              setTimingText(event.target.value.slice(0, 40));
              setError('');
            }}
            onKeyDown={timingKeyDown}
          />
        </label>
        <button
          type="button"
          className="primary-button entry-add"
          disabled={!staged}
          onClick={commit}
        >
          Add <kbd>↵</kbd>
        </button>
      </div>
      <div className="entry-status" aria-live="polite">
        {error ? (
          <span className="entry-error" role="alert">
            {error}
          </span>
        ) : staged ? (
          <span>
            {hint || 'Type units (20) or days (5d) · Tab for timing · Enter adds · Esc goes back'}
            {preview.label && preview.valid ? <b> · {preview.label}</b> : null}
          </span>
        ) : (
          <span>
            ↑ ↓ choose · Enter select · then quantity · <kbd>*N</kbd> sets the selected line
          </span>
        )}
        {showResults ? (
          <span className="entry-count">
            {search.isFetching ? 'Searching…' : `${String(results.length)} matches`}
          </span>
        ) : null}
      </div>
      {staged && (timingFocused || timingText) ? (
        <TimingPresets
          value={timingText}
          onPick={(text) => {
            setTimingText(text);
            timingInput.current?.focus();
          }}
        />
      ) : null}
      {showResults ? (
        <div
          className={fresh ? 'result-list' : 'result-list stale'}
          id="medicine-results"
          role="listbox"
          aria-label="Medicine results"
          ref={list}
        >
          {results.map((medicine, index) => {
            const sellable = isSellable(medicine);
            const expiringSoon = medicine.daysToExpiry !== null && medicine.daysToExpiry <= 90;
            const classes = ['result-option'];
            if (index === activeIndex) classes.push('active');
            if (!sellable) classes.push('unavailable');
            return (
              <div
                role="option"
                id={`medicine-option-${String(index)}`}
                tabIndex={-1}
                aria-selected={index === activeIndex}
                className={classes.join(' ')}
                key={medicine.id}
                data-result-index={index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => stage(medicine)}
                onKeyDown={() => undefined}
                onMouseEnter={() => setActive({ query: debounced, index })}
              >
                <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="result-name">
                  <strong>
                    {medicine.name} <em>{medicine.strength}</em>
                  </strong>
                  <small>
                    {[medicine.genericName, medicine.manufacturer].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="result-shelf">{medicine.shelf ?? '—'}</span>
                <span className={expiringSoon ? 'result-stock warning' : 'result-stock'}>
                  <b>
                    {sellable ? `${wholeUnits(medicine.availableQuantity)} in stock` : 'No stock'}
                  </b>
                  <small>{medicine.nearestExpiry ? `exp ${medicine.nearestExpiry}` : ''}</small>
                </span>
                <span className="result-price">
                  {medicine.salePrice ? formatPkrMoney(medicine.salePrice) : 'No price'}
                </span>
              </div>
            );
          })}
          {fresh && results.length === 0 ? (
            <p className="empty-results">
              No medicine matches “{debounced}”. Try the generic name or company.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
