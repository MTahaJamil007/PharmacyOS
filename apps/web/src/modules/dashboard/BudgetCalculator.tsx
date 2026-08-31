import { useState } from 'react';

import { calculateBudgetRegimen, type BudgetRegimenResult } from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

export function BudgetCalculator(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const [budget, setBudget] = useState('1000');
  const [dailyUnits, setDailyUnits] = useState<Record<string, string>>({});
  const [increments, setIncrements] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BudgetRegimenResult | null>(null);
  const [error, setError] = useState('');
  const calculate = async (): Promise<void> => {
    try {
      setError('');
      const response = await calculateBudgetRegimen(session?.accessToken ?? '', {
        budget,
        items: cart.map((line) => ({
          medicineId: line.medicine.id,
          prescribedBaseUnitsPerDay: dailyUnits[line.medicine.id] ?? '1',
          minimumSaleIncrement: increments[line.medicine.id] ?? '1',
        })),
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calculation failed');
    }
  };
  return (
    <main className="operations-canvas narrow-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Affordability, not clinical advice</p>
          <h1>Complete-regimen budget calculator</h1>
          <p>Uses the regimen exactly as entered and maximizes complete days only.</p>
        </div>
      </section>
      <section className="calculator-layout">
        <article className="work-panel regimen-form">
          <header>
            <div>
              <p className="eyebrow">Entered regimen</p>
              <h2>Current cart medicines</h2>
            </div>
          </header>
          {cart.length === 0 ? (
            <p className="empty-state">
              Add medicines at the counter first. Calculating does not reserve stock.
            </p>
          ) : (
            cart.map((line) => (
              <div className="regimen-line" key={line.medicine.id}>
                <div>
                  <strong>{line.medicine.name}</strong>
                  <small>
                    {line.medicine.strength} · current unit price{' '}
                    {formatPkrMoney(line.medicine.salePrice ?? '0.00')}
                  </small>
                </div>
                <label>
                  Units/day
                  <input
                    inputMode="decimal"
                    value={dailyUnits[line.medicine.id] ?? '1'}
                    onChange={(event) =>
                      setDailyUnits({ ...dailyUnits, [line.medicine.id]: event.target.value })
                    }
                  />
                </label>
                <label>
                  Sale increment
                  <input
                    inputMode="decimal"
                    value={increments[line.medicine.id] ?? '1'}
                    onChange={(event) =>
                      setIncrements({ ...increments, [line.medicine.id]: event.target.value })
                    }
                  />
                </label>
              </div>
            ))
          )}
          <label className="budget-input">
            Customer budget (PKR)
            <input
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          {error ? <p className="inline-error">{error}</p> : null}
          <button
            className="primary-button"
            disabled={cart.length === 0}
            onClick={() => void calculate()}
          >
            Calculate complete days
          </button>
        </article>
        <aside className="calculation-result">
          <p className="eyebrow">Safe result</p>
          <strong className="days-result">
            {result?.completeDays ?? '—'}
            <small>complete days</small>
          </strong>
          {result?.completeDays === 0 ? (
            <p>
              Budget is below one complete day. One complete day costs{' '}
              {formatPkrMoney(result.oneDayCost)}.
            </p>
          ) : null}
          <dl>
            <div>
              <dt>Total</dt>
              <dd>{result ? formatPkrMoney(result.totalCost) : '—'}</dd>
            </div>
            <div>
              <dt>Budget left</dt>
              <dd>{result ? formatPkrMoney(result.remainder) : '—'}</dd>
            </div>
          </dl>
          {(result?.lines ?? []).map((line) => (
            <div className="result-line" key={line.medicineId}>
              <span>{line.medicineName}</span>
              <b>{line.requiredQuantity} units</b>
            </div>
          ))}
          <p className="safety-note">
            {result?.safetyMessage ??
              'The result will never suggest skipped doses, reduced frequency, or substitutions.'}
          </p>
        </aside>
      </section>
    </main>
  );
}
