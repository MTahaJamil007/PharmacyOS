import { useMemo, useState } from 'react';
import { decimalToScaledInteger, sumMoney, type BudgetRegimenResult } from '@pharmacy/shared';

import { calculateBudgetRegimen } from '../../api';
import { formatPkrMoney } from '../../money';
import type { CartLine } from '../../store';
import {
  allocateBudget,
  calculateBudgetLocally,
  plannedQuantities,
  regimenEntryError,
  regimenForLine,
  type RegimenEntry,
} from './budget-plan';

const MAX_PLAN_ITEMS = 20;

export interface BudgetPlanOutcome {
  readonly quantities: Readonly<Record<string, number>>;
  readonly completeDays: number;
}

interface CalculatedPlan {
  readonly key: string;
  readonly result: BudgetRegimenResult;
  readonly otherItemsTotal: string;
  readonly includeOtherItems: boolean;
}

function shortfall(line: CartLine, quantity: number | undefined): string | null {
  if (quantity === undefined) return null;
  try {
    const available = decimalToScaledInteger(line.medicine.availableQuantity, 3);
    return BigInt(quantity) * 1000n > available
      ? `Only ${line.medicine.availableQuantity.replace(/\.0+$/, '')} in stock`
      : null;
  } catch {
    return null;
  }
}

export function BudgetPlanner({
  token,
  previewMode,
  planLines,
  otherLines,
  regimen,
  onRegimenChange,
  onApply,
  onCancel,
  autoFocusRef,
  applyLabel = 'Set cart quantities',
}: {
  readonly token: string;
  readonly previewMode: boolean;
  /** The ticked lines whose quantities the plan will set. */
  readonly planLines: readonly CartLine[];
  /** Lines staying on the ticket at their current quantity. */
  readonly otherLines: readonly CartLine[];
  readonly regimen: Readonly<Record<string, RegimenEntry>>;
  readonly onRegimenChange: (medicineId: string, entry: RegimenEntry) => void;
  readonly onApply: (outcome: BudgetPlanOutcome) => void;
  readonly onCancel?: () => void;
  readonly autoFocusRef?: React.RefObject<HTMLInputElement | null>;
  readonly applyLabel?: string;
}): React.JSX.Element {
  const [budget, setBudget] = useState('');
  const [includeOtherItems, setIncludeOtherItems] = useState(true);
  const [calculated, setCalculated] = useState<CalculatedPlan | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const entries = planLines.map((line) => ({
    line,
    entry: regimen[line.medicine.id] ?? regimenForLine(line),
  }));
  const inputKey = JSON.stringify({
    budget: budget.trim(),
    includeOtherItems,
    plan: entries.map(({ line, entry }) => [
      line.medicine.id,
      entry.unitsPerDay,
      entry.saleIncrement,
    ]),
    other: otherLines.map((line) => [line.medicine.id, line.quantity]),
  });
  const stale = calculated !== null && calculated.key !== inputKey;
  const current = calculated && !stale ? calculated : null;
  const planned = useMemo(() => (current ? plannedQuantities(current.result) : null), [current]);
  const plannedById = planned && 'quantities' in planned ? planned.quantities : {};

  const calculate = async (): Promise<void> => {
    setError('');
    if (planLines.length === 0) {
      setError('Tick at least one medicine to plan');
      return;
    }
    if (planLines.length > MAX_PLAN_ITEMS) {
      setError(`Plan at most ${MAX_PLAN_ITEMS} medicines at a time`);
      return;
    }
    for (const { line, entry } of entries) {
      const entryError = regimenEntryError(entry);
      if (entryError) {
        setError(`${line.medicine.name}: ${entryError}`);
        return;
      }
    }
    const allocation = allocateBudget(
      budget,
      otherLines,
      includeOtherItems && otherLines.length > 0,
    );
    if (allocation.error) {
      setError(allocation.error);
      return;
    }
    setPending(true);
    try {
      const result = previewMode
        ? calculateBudgetLocally(allocation.budgetForPlan, planLines, regimen)
        : await calculateBudgetRegimen(token, {
            budget: allocation.budgetForPlan,
            items: entries.map(({ line, entry }) => ({
              medicineId: line.medicine.id,
              prescribedBaseUnitsPerDay: entry.unitsPerDay.trim(),
              minimumSaleIncrement: entry.saleIncrement.trim(),
            })),
          });
      setCalculated({
        key: inputKey,
        result,
        otherItemsTotal: allocation.otherItemsTotal,
        includeOtherItems: includeOtherItems && otherLines.length > 0,
      });
    } catch (cause) {
      setCalculated(null);
      setError(cause instanceof Error ? cause.message : 'Budget calculation failed');
    } finally {
      setPending(false);
    }
  };

  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void calculate();
  };

  const otherTotal = allocateBudget('0', otherLines, false).otherItemsTotal;
  const ticketTotal = current ? sumMoney([current.result.totalCost, otherTotal]) : null;

  return (
    <div className="budget-planner">
      <div className="planner-inputs">
        <label className="budget-field">
          Customer budget (PKR)
          <input
            ref={autoFocusRef}
            inputMode="decimal"
            placeholder="e.g. 2000"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </label>
        {otherLines.length > 0 ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={includeOtherItems}
              onChange={(event) => setIncludeOtherItems(event.target.checked)}
            />
            <span>
              Budget also pays for the {otherLines.length} unticked item
              {otherLines.length === 1 ? '' : 's'} ({formatPkrMoney(otherTotal)})
            </span>
          </label>
        ) : null}
        <table className="regimen-table">
          <thead>
            <tr>
              <th scope="col">Medicine</th>
              <th scope="col">Units / day</th>
              <th scope="col">Sale step</th>
              <th scope="col">Now</th>
              <th scope="col">Plan</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ line, entry }) => {
              const plannedQuantity = plannedById[line.medicine.id];
              const warning = shortfall(line, plannedQuantity);
              return (
                <tr key={line.medicine.id}>
                  <th scope="row">
                    {line.medicine.name} <em>{line.medicine.strength}</em>
                    <small>{formatPkrMoney(line.medicine.salePrice ?? '0.00')} / unit</small>
                  </th>
                  <td>
                    <input
                      aria-label={`${line.medicine.name} units per day`}
                      inputMode="decimal"
                      value={entry.unitsPerDay}
                      onChange={(event) =>
                        onRegimenChange(line.medicine.id, {
                          ...entry,
                          unitsPerDay: event.target.value,
                        })
                      }
                      onKeyDown={submitOnEnter}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${line.medicine.name} sale step`}
                      inputMode="numeric"
                      value={entry.saleIncrement}
                      onChange={(event) =>
                        onRegimenChange(line.medicine.id, {
                          ...entry,
                          saleIncrement: event.target.value,
                        })
                      }
                      onKeyDown={submitOnEnter}
                    />
                  </td>
                  <td>{line.quantity}</td>
                  <td>
                    <b>{plannedQuantity ?? '—'}</b>
                    {warning ? <small className="stock-warning">{warning}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="section-hint">
          Sale step is the smallest quantity you sell, e.g. 10 for a strip of 10 tablets. Units /
          day comes from the prescription.
        </p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="planner-result" aria-live="polite">
        <p className="eyebrow">{stale ? 'Inputs changed — recalculate' : 'Complete days'}</p>
        {current ? (
          <strong className="days-figure">{current.result.completeDays}</strong>
        ) : (
          <strong className="days-figure empty">Enter a budget and calculate</strong>
        )}
        <dl>
          <div>
            <dt>Planned medicines</dt>
            <dd>{current ? formatPkrMoney(current.result.totalCost) : '—'}</dd>
          </div>
          {current?.includeOtherItems ? (
            <div>
              <dt>Unticked items</dt>
              <dd>{formatPkrMoney(current.otherItemsTotal)}</dd>
            </div>
          ) : null}
          {otherLines.length > 0 ? (
            <div>
              <dt>Ticket total</dt>
              <dd>{ticketTotal ? formatPkrMoney(ticketTotal) : '—'}</dd>
            </div>
          ) : null}
          <div>
            <dt>Budget left</dt>
            <dd>{current ? formatPkrMoney(current.result.remainder) : '—'}</dd>
          </div>
          <div>
            <dt>One day costs</dt>
            <dd>{current ? formatPkrMoney(current.result.oneDayCost) : '—'}</dd>
          </div>
        </dl>
        {planned && 'error' in planned ? <p className="result-warning">{planned.error}</p> : null}
        <p className="safety-note">
          Affordability only. The plan never reduces the dose, frequency or strength and never
          substitutes a medicine. Prices are before discount.
        </p>
        <div className="planner-actions">
          {onCancel ? (
            <button type="button" className="secondary-button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button light"
            disabled={pending}
            onClick={() => void calculate()}
          >
            {pending ? 'Calculating…' : 'Calculate'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!current || !planned || 'error' in planned}
            onClick={() => {
              if (current && planned && 'quantities' in planned) {
                onApply({
                  quantities: planned.quantities,
                  completeDays: current.result.completeDays,
                });
              }
            }}
          >
            {applyLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}
