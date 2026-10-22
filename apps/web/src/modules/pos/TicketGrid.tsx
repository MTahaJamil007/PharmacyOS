import { memo, useEffect, useRef, useState } from 'react';
import { decimalToScaledInteger, formatDosage } from '@pharmacy/shared';

import { formatPkrMoney } from '../../money';
import type { CartLine } from '../../store';
import type { DiscountedLine, DiscountSpec } from './discount';
import { wholeUnits } from './EntryBar';
import {
  discountShorthand,
  MAX_LINE_QUANTITY,
  parseDiscountShorthand,
  parseTimingEntry,
} from './line-entry';
import { timingPreview } from './TimingField';

export interface TicketGridActions {
  readonly onToggle: (medicineId: string) => void;
  readonly onToggleAll: (ticked: boolean) => void;
  readonly onSelect: (medicineId: string) => void;
  readonly onSetQuantity: (medicineId: string, quantity: number) => void;
  readonly onChangeQuantity: (medicineId: string, delta: number) => void;
  readonly onSetDosage: (medicineIds: readonly string[], dosage: string | null) => void;
  readonly onSetDiscount: (medicineIds: readonly string[], spec: DiscountSpec | null) => void;
  readonly onRemove: (medicineIds: readonly string[]) => void;
  readonly onNotice: (message: string) => void;
}

function exceedsStock(line: CartLine): boolean {
  try {
    return (
      BigInt(line.quantity) * 1000n > decimalToScaledInteger(line.medicine.availableQuantity, 3)
    );
  } catch {
    return false;
  }
}

/** An inline box that edits a value as text and commits on Enter or blur. */
function CommitCell({
  label,
  value,
  placeholder,
  disabled,
  className,
  title,
  validate,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly className: string;
  readonly title?: string;
  readonly validate: (text: string) => string | null;
  readonly onCommit: (text: string) => boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const invalid = draft !== null && validate(draft) !== null;
  const finish = (): void => {
    if (draft === null) return;
    if (draft !== value && !onCommit(draft)) return;
    setDraft(null);
  };
  return (
    <input
      aria-label={label}
      className={invalid ? `${className} invalid` : className}
      title={invalid ? (validate(text) ?? undefined) : title}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value.slice(0, 40))}
      onBlur={() => {
        if (draft !== null && validate(draft) !== null) setDraft(null);
        else finish();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function QuantityCell({
  line,
  disabled,
  onCommit,
}: {
  readonly line: CartLine;
  readonly disabled: boolean;
  readonly onCommit: (quantity: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={`${line.medicine.name} quantity`}
      inputMode="numeric"
      className="qty-input"
      value={text ?? String(line.quantity)}
      disabled={disabled}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
        setText(digits);
        const quantity = Number(digits);
        if (digits && quantity >= 1 && quantity <= MAX_LINE_QUANTITY) onCommit(quantity);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          setText(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

const timingError = (text: string): string | null => {
  const parsed = parseTimingEntry(text);
  return 'error' in parsed ? parsed.error : null;
};

const discountError = (text: string): string | null => {
  const parsed = parseDiscountShorthand(text);
  return 'error' in parsed ? parsed.error : null;
};

const TicketRow = memo(function TicketRow({
  line,
  index,
  amounts,
  discount,
  ticked,
  selected,
  locked,
  planned,
  actions,
}: {
  readonly line: CartLine;
  readonly index: number;
  readonly amounts: DiscountedLine | undefined;
  readonly discount: DiscountSpec | undefined;
  readonly ticked: boolean;
  readonly selected: boolean;
  readonly locked: boolean;
  readonly planned: number | undefined;
  readonly actions: TicketGridActions;
}): React.JSX.Element {
  const id = line.medicine.id;
  const discounted = amounts !== undefined && amounts.discount !== '0.00';
  const classes = ['ticket-row'];
  if (selected) classes.push('selected');
  if (ticked) classes.push('ticked');
  return (
    <tr className={classes.join(' ')} onFocusCapture={() => actions.onSelect(id)}>
      <td className="col-tick">
        <input
          type="checkbox"
          aria-label={`Tick ${line.medicine.name}`}
          checked={ticked}
          disabled={locked}
          onChange={() => actions.onToggle(id)}
        />
      </td>
      <td className="col-index">{index + 1}</td>
      <th scope="row" className="col-medicine">
        <strong>
          {line.medicine.name} <em>{line.medicine.strength}</em>
        </strong>
        <small>
          {line.medicine.genericName ?? ''}
          {exceedsStock(line) ? (
            <b className="stock-flag">
              {' '}
              Only {wholeUnits(line.medicine.availableQuantity)} in stock
            </b>
          ) : null}
        </small>
      </th>
      <td className="col-timing">
        <CommitCell
          key={line.dosage ?? ''}
          label={`${line.medicine.name} timing`}
          className="cell-input timing-input"
          value={line.dosage ?? ''}
          placeholder="—"
          disabled={locked}
          title={line.dosage ? timingPreview(line.dosage).label : 'Optional timing, e.g. 101'}
          validate={timingError}
          onCommit={(text) => {
            const parsed = parseTimingEntry(text);
            if ('error' in parsed) return false;
            actions.onSetDosage([id], parsed.schedule ? formatDosage(parsed.schedule) : null);
            return true;
          }}
        />
      </td>
      <td className="col-qty">
        <div className="qty-stepper">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove one ${line.medicine.name}`}
            disabled={locked}
            onClick={() => actions.onChangeQuantity(id, -1)}
          >
            −
          </button>
          <QuantityCell
            line={line}
            disabled={locked}
            onCommit={(quantity) => actions.onSetQuantity(id, quantity)}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Add one ${line.medicine.name}`}
            disabled={locked}
            onClick={() => actions.onChangeQuantity(id, 1)}
          >
            +
          </button>
        </div>
        {planned !== undefined && planned !== line.quantity ? (
          <small className="planned-qty">plan → {planned}</small>
        ) : null}
      </td>
      <td className="col-rate">{formatPkrMoney(line.medicine.salePrice ?? '0.00')}</td>
      <td className="col-disc">
        <CommitCell
          key={discountShorthand(discount)}
          label={`${line.medicine.name} discount`}
          className="cell-input disc-input"
          value={discountShorthand(discount)}
          placeholder="—"
          disabled={locked}
          title="10 = 10% · 50r = Rs 50"
          validate={discountError}
          onCommit={(text) => {
            const parsed = parseDiscountShorthand(text);
            if ('error' in parsed) return false;
            actions.onSetDiscount([id], parsed.spec);
            return true;
          }}
        />
      </td>
      <td className="col-amount">
        {discounted ? <s>{formatPkrMoney(amounts.gross)}</s> : null}
        <b>{formatPkrMoney(amounts?.net ?? '0.00')}</b>
      </td>
      <td className="col-remove">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Delete ${line.medicine.name}`}
          disabled={locked}
          onClick={() => actions.onRemove([id])}
        >
          ×
        </button>
      </td>
    </tr>
  );
});

function BulkBar({
  ticked,
  actions,
}: {
  readonly ticked: readonly CartLine[];
  readonly actions: TicketGridActions;
}): React.JSX.Element {
  const [timing, setTiming] = useState('');
  const [discount, setDiscount] = useState('');
  const ids = ticked.map((line) => line.medicine.id);
  const applyTiming = (): void => {
    const parsed = parseTimingEntry(timing);
    if ('error' in parsed) {
      actions.onNotice(parsed.error);
      return;
    }
    actions.onSetDosage(ids, parsed.schedule ? formatDosage(parsed.schedule) : null);
    actions.onNotice(
      parsed.schedule
        ? `Timing ${formatDosage(parsed.schedule)} set on ${String(ids.length)} line(s)`
        : `Timing cleared on ${String(ids.length)} line(s)`,
    );
    setTiming('');
  };
  const applyDiscount = (): void => {
    const parsed = parseDiscountShorthand(discount);
    if ('error' in parsed) {
      actions.onNotice(parsed.error);
      return;
    }
    actions.onSetDiscount(ids, parsed.spec);
    actions.onNotice(`Discount updated on ${String(ids.length)} line(s)`);
    setDiscount('');
  };
  const submitOn =
    (apply: () => void) =>
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      apply();
    };
  return (
    <div className="bulk-bar" role="group" aria-label="Ticked lines">
      <b>{ticked.length} ticked</b>
      <label>
        Timing
        <input
          aria-label="Timing for ticked lines"
          placeholder="101"
          value={timing}
          onChange={(event) => setTiming(event.target.value.slice(0, 40))}
          onKeyDown={submitOn(applyTiming)}
        />
      </label>
      <button type="button" onClick={applyTiming}>
        Set
      </button>
      <label>
        Discount
        <input
          aria-label="Discount for ticked lines"
          placeholder="10 or 50r"
          value={discount}
          onChange={(event) => setDiscount(event.target.value.slice(0, 20))}
          onKeyDown={submitOn(applyDiscount)}
        />
      </label>
      <button type="button" onClick={applyDiscount}>
        Set
      </button>
      <span className="bulk-spacer" />
      <button type="button" className="danger" onClick={() => actions.onRemove(ids)}>
        Remove
      </button>
      <button type="button" onClick={() => actions.onToggleAll(false)}>
        Untick
      </button>
    </div>
  );
}

export function TicketGrid({
  cart,
  lineAmounts,
  lineDiscounts,
  tickedIds,
  selectedId,
  locked,
  budgetPreview,
  actions,
}: {
  readonly cart: readonly CartLine[];
  readonly lineAmounts: ReadonlyMap<string, DiscountedLine>;
  readonly lineDiscounts: Readonly<Record<string, DiscountSpec>>;
  readonly tickedIds: ReadonlySet<string>;
  readonly selectedId: string | null;
  readonly locked: boolean;
  readonly budgetPreview: Readonly<Record<string, number>> | null;
  readonly actions: TicketGridActions;
}): React.JSX.Element {
  const tickAll = useRef<HTMLInputElement>(null);
  const ticked = cart.filter((line) => tickedIds.has(line.medicine.id));
  useEffect(() => {
    if (tickAll.current) {
      tickAll.current.indeterminate = ticked.length > 0 && ticked.length < cart.length;
    }
  }, [cart.length, ticked.length]);

  if (cart.length === 0) {
    return (
      <div className="ticket-empty">
        <h3>No items yet</h3>
        <p>
          Search or scan a medicine, type its quantity, and press Enter. Timing is optional. Stock
          is reserved only when payment starts.
        </p>
      </div>
    );
  }

  return (
    <div className="ticket-grid-wrap">
      {ticked.length > 0 && !locked ? <BulkBar ticked={ticked} actions={actions} /> : null}
      <table className="ticket-grid">
        <thead>
          <tr>
            <th scope="col" className="col-tick">
              <input
                ref={tickAll}
                type="checkbox"
                aria-label="Tick all lines"
                checked={ticked.length > 0 && ticked.length === cart.length}
                disabled={locked}
                onChange={(event) => actions.onToggleAll(event.target.checked)}
              />
            </th>
            <th scope="col" className="col-index">
              #
            </th>
            <th scope="col">Medicine</th>
            <th scope="col">Timing</th>
            <th scope="col">Qty</th>
            <th scope="col" className="col-rate">
              Rate
            </th>
            <th scope="col">Disc</th>
            <th scope="col" className="col-amount">
              Amount
            </th>
            <th scope="col" className="col-remove">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cart.map((line, index) => (
            <TicketRow
              key={line.medicine.id}
              line={line}
              index={index}
              amounts={lineAmounts.get(line.medicine.id)}
              discount={lineDiscounts[line.medicine.id]}
              ticked={tickedIds.has(line.medicine.id)}
              selected={selectedId === line.medicine.id}
              locked={locked}
              planned={budgetPreview?.[line.medicine.id]}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
