import { useQuery } from '@tanstack/react-query';
import { Pill, Search } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { searchMedicines, type MedicineSearchResult } from '../api';
import { formatMoney, formatQuantity } from '../format';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useDismiss } from './ui';

/**
 * Search-as-you-type medicine chooser for back-office forms. Arrow keys move through the
 * matches, Enter picks one, Escape closes the list. Scanning a barcode works too, because
 * the catalog search matches barcodes exactly.
 */
export function MedicinePicker({
  onSelect,
  label = 'Find a medicine',
  placeholder = 'Search by name, generic name, or barcode',
  disabled = false,
  showStock = true,
  focusOnMount = false,
}: {
  readonly onSelect: (medicine: MedicineSearchResult) => void;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly showStock?: boolean | undefined;
  readonly focusOnMount?: boolean | undefined;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);
  const debounced = useDebouncedValue(text.trim(), 200);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(container, open, close);
  const results = useQuery({
    queryKey: ['medicine-picker', debounced],
    queryFn: () => searchMedicines(debounced, 10),
    enabled: debounced.length > 0,
  });
  const matches = results.data ?? [];
  const choose = (medicine: MedicineSearchResult): void => {
    onSelect(medicine);
    setText('');
    setOpen(false);
    setActive(0);
  };
  return (
    <div className="picker" ref={container}>
      <div className="input-group">
        <Search aria-hidden />
        <input
          className="input"
          type="search"
          ref={field}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open && debounced.length > 0}
          aria-autocomplete="list"
          aria-label={label}
          placeholder={placeholder}
          autoComplete="off"
          value={text}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              const medicine = matches[active];
              if (medicine) {
                event.preventDefault();
                choose(medicine);
              }
            }
          }}
        />
      </div>
      {open && debounced ? (
        <div id={listId} className="picker-results" role="listbox" aria-label="Matching medicines">
          {matches.map((medicine, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={medicine.id}
              className={index === active ? 'active' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(medicine)}
            >
              <Pill aria-hidden />
              <span className="picker-main">
                <strong>{medicine.name}</strong>
                <span className="cell-sub">
                  {[medicine.genericName, medicine.strength, medicine.manufacturer]
                    .filter(Boolean)
                    .join(' · ') || 'No generic name recorded'}
                </span>
              </span>
              {showStock ? (
                <span className="num">
                  <span className="cell-sub">In stock</span>
                  {formatQuantity(medicine.availableQuantity)}
                  {medicine.salePrice ? (
                    <span className="cell-sub">{formatMoney(medicine.salePrice)}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          ))}
          {results.isFetching && matches.length === 0 ? (
            <div className="picker-note">Searching…</div>
          ) : null}
          {!results.isFetching && matches.length === 0 ? (
            <div className="picker-note">No medicine matches “{debounced}”.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
