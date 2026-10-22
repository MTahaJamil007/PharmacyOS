import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import type { RegimenEntry } from '../pos/budget-plan';
import { BudgetPlanner } from '../pos/BudgetPlanner';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';

export function BudgetCalculator(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const applyQuantities = usePharmacyStore((state) => state.applyQuantities);
  const navigate = useNavigate();
  const [untickedIds, setUntickedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [regimen, setRegimen] = useState<Record<string, RegimenEntry>>({});
  const planLines = cart.filter((line) => !untickedIds.has(line.medicine.id));
  const otherLines = cart.filter((line) => untickedIds.has(line.medicine.id));

  return (
    <main className="operations-canvas narrow-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Affordability, not clinical advice</p>
          <h1>Complete-regimen budget plan</h1>
          <p>
            Tick the counter-ticket medicines the customer’s budget should cover. The plan keeps the
            regimen exactly as entered and maximises complete days only. It is also available at the
            counter with <kbd>F3</kbd>.
          </p>
        </div>
      </section>
      {cart.length === 0 ? (
        <article className="work-panel">
          <p className="empty-state">
            The counter ticket is empty. <Link to="/pos">Add medicines at the counter</Link>, then
            plan the budget there or here. Calculating never reserves stock.
          </p>
        </article>
      ) : (
        <>
          <article className="work-panel budget-ticket">
            <header>
              <div>
                <p className="eyebrow">Counter ticket</p>
                <h2>
                  {planLines.length} of {cart.length} medicines ticked
                </h2>
              </div>
            </header>
            <ul className="budget-ticket-lines">
              {cart.map((line) => (
                <li key={line.medicine.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!untickedIds.has(line.medicine.id)}
                      onChange={() =>
                        setUntickedIds((current) => {
                          const next = new Set(current);
                          if (next.has(line.medicine.id)) next.delete(line.medicine.id);
                          else next.add(line.medicine.id);
                          return next;
                        })
                      }
                    />
                    <strong>{line.medicine.name}</strong>
                    <small>
                      {line.quantity} on ticket ·{' '}
                      {formatPkrMoney(line.medicine.salePrice ?? '0.00')} / unit
                    </small>
                  </label>
                </li>
              ))}
            </ul>
          </article>
          <article className="work-panel budget-page-planner">
            <BudgetPlanner
              token={session?.accessToken ?? ''}
              previewMode={previewMode}
              planLines={planLines}
              otherLines={otherLines}
              regimen={regimen}
              onRegimenChange={(medicineId, entry) =>
                setRegimen((current) => ({ ...current, [medicineId]: entry }))
              }
              applyLabel="Apply to counter ticket"
              onApply={({ quantities }) => {
                applyQuantities(quantities);
                void navigate('/pos');
              }}
            />
          </article>
        </>
      )}
    </main>
  );
}
