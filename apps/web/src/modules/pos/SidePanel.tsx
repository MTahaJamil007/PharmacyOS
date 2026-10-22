import { useState } from 'react';

import { formatPkrMoney } from '../../money';
import {
  DISCOUNT_REASONS,
  describeDiscountSpec,
  type CartDiscounts,
  type DiscountPlan,
} from './discount';
import { discountShorthand, parseDiscountShorthand } from './line-entry';
import type { BudgetPlanState } from './useBudgetPlan';

export interface SupervisorApproval {
  readonly username: string;
  readonly password: string;
}

export function BudgetBox({
  plan,
  locked,
  inputRef,
  onApply,
}: {
  readonly plan: BudgetPlanState;
  readonly locked: boolean;
  readonly inputRef: React.Ref<HTMLInputElement>;
  readonly onApply: (quantities: Readonly<Record<string, number>>, days: number) => void;
}): React.JSX.Element {
  const ready = plan.current && 'quantities' in plan.current.planned ? plan.current : null;
  const apply = (): void => {
    if (!ready || !('quantities' in ready.planned)) return;
    onApply(ready.planned.quantities, ready.result.completeDays);
  };
  const scope =
    plan.otherLines.length > 0
      ? `${String(plan.planLines.length)} ticked line${plan.planLines.length === 1 ? '' : 's'}`
      : 'all lines';
  return (
    <section className="side-box budget-box" aria-labelledby="budget-box-title">
      <header>
        <h3 id="budget-box-title">
          Budget plan <kbd>F3</kbd>
        </h3>
        <small>Plans {scope}</small>
      </header>
      <div className="side-inline">
        <input
          ref={inputRef}
          aria-label="Customer budget (PKR)"
          inputMode="decimal"
          placeholder="Customer budget PKR"
          value={plan.budget}
          disabled={locked}
          onChange={(event) => plan.setBudget(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (ready) apply();
            else void plan.calculate();
          }}
        />
        {ready ? (
          <button type="button" className="primary-button compact" onClick={apply}>
            Apply ↵
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button compact"
            disabled={locked || plan.pending || plan.budget.trim() === ''}
            onClick={() => void plan.calculate()}
          >
            {plan.pending ? '…' : 'Plan ↵'}
          </button>
        )}
      </div>
      {plan.otherLines.length > 0 ? (
        <label className="check-field">
          <input
            type="checkbox"
            checked={plan.includeOtherItems}
            onChange={(event) => plan.setIncludeOtherItems(event.target.checked)}
          />
          <span>
            Also pays for {plan.otherLines.length} unticked ({formatPkrMoney(plan.otherItemsTotal)})
          </span>
        </label>
      ) : null}
      {plan.error ? <p className="side-error">{plan.error}</p> : null}
      {plan.current ? (
        <div className="budget-result" aria-live="polite">
          <strong>
            {plan.current.result.completeDays}
            <small> complete day{plan.current.result.completeDays === 1 ? '' : 's'}</small>
          </strong>
          <span>
            {formatPkrMoney(plan.current.result.totalCost)} planned · left{' '}
            {formatPkrMoney(plan.current.result.remainder)}
          </span>
          {'error' in plan.current.planned ? (
            <em className="side-error">
              {plan.current.planned.error}. One day costs{' '}
              {formatPkrMoney(plan.current.result.oneDayCost)}.
            </em>
          ) : (
            <em>Planned quantities show in the grid. Enter again applies them.</em>
          )}
        </div>
      ) : plan.stale ? (
        <p className="side-hint">Ticket changed — press Enter to plan again.</p>
      ) : (
        <p className="side-hint">
          {plan.untimedLines > 0
            ? `${String(plan.untimedLines)} line(s) without timing count as 1 a day.`
            : 'Daily units come from each line’s timing.'}{' '}
          Affordability only; never changes the dose.
        </p>
      )}
    </section>
  );
}

const OTHER_REASON = 'Other';

export function DiscountBox({
  plan,
  discounts,
  locked,
  inputRef,
  approval,
  approvalRequired,
  onApprovalChange,
  onChange,
}: {
  readonly plan: DiscountPlan;
  readonly discounts: CartDiscounts;
  readonly locked: boolean;
  readonly inputRef: React.Ref<HTMLInputElement>;
  readonly approval: SupervisorApproval;
  readonly approvalRequired: boolean;
  readonly onApprovalChange: (approval: SupervisorApproval) => void;
  readonly onChange: (discounts: CartDiscounts) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [showApproval, setShowApproval] = useState(false);
  const presetReason = (DISCOUNT_REASONS as readonly string[]).includes(discounts.reason);
  const [otherChosen, setOtherChosen] = useState(false);
  const otherActive = otherChosen || (discounts.reason !== '' && !presetReason);
  const value = draft ?? discountShorthand(discounts.invoice);
  const parsed = draft === null ? null : parseDiscountShorthand(draft);
  const commit = (): void => {
    if (draft === null) return;
    const result = parseDiscountShorthand(draft);
    if ('error' in result) return;
    onChange({ ...discounts, invoice: result.spec });
    setDraft(null);
  };
  return (
    <section className="side-box discount-box" aria-labelledby="discount-box-title">
      <header>
        <h3 id="discount-box-title">
          Invoice discount <kbd>F9</kbd>
        </h3>
        <small>10 = 10% · 50r = Rs 50</small>
      </header>
      <div className="side-inline">
        <input
          ref={inputRef}
          aria-label="Invoice discount"
          placeholder="—"
          value={value}
          disabled={locked}
          className={parsed && 'error' in parsed ? 'invalid' : undefined}
          onChange={(event) => setDraft(event.target.value.slice(0, 20))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
        <span className="discount-figure">
          {plan.hasDiscount ? `−${formatPkrMoney(plan.discountTotal)}` : ''}
        </span>
      </div>
      {parsed && 'error' in parsed ? <p className="side-error">{parsed.error}</p> : null}
      {plan.hasDiscount ? (
        <>
          <div className="reason-chips" role="radiogroup" aria-label="Discount reason">
            {[...DISCOUNT_REASONS, OTHER_REASON].map((option) => {
              const checked =
                option === OTHER_REASON ? otherActive : !otherActive && discounts.reason === option;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  key={option}
                  disabled={locked}
                  onClick={() => {
                    if (option === OTHER_REASON) {
                      setOtherChosen(true);
                      if (presetReason) onChange({ ...discounts, reason: '' });
                    } else {
                      setOtherChosen(false);
                      onChange({ ...discounts, reason: option });
                    }
                  }}
                >
                  {option}
                </button>
              );
            })}
          </div>
          {otherActive ? (
            <input
              className="reason-other"
              aria-label="Other discount reason"
              placeholder="Describe the reason"
              maxLength={500}
              disabled={locked}
              value={presetReason ? '' : discounts.reason}
              onChange={(event) => onChange({ ...discounts, reason: event.target.value })}
            />
          ) : null}
          <p className="side-hint">
            {plan.discountPercent}% off
            {discounts.invoice ? ` · invoice ${describeDiscountSpec(discounts.invoice)}` : ''}
            {plan.lineDiscountTotal !== '0.00'
              ? ` · lines −${formatPkrMoney(plan.lineDiscountTotal)}`
              : ''}
          </p>
          {approvalRequired || showApproval ? (
            <div className="approval-inline">
              <p className={approvalRequired ? 'side-error' : 'side-hint'}>
                {approvalRequired
                  ? 'Above the branch limit: a supervisor must approve, then press F8 again.'
                  : 'Supervisor approval (only above the branch limit)'}
              </p>
              <input
                aria-label="Supervisor username"
                autoComplete="off"
                placeholder="Supervisor username"
                value={approval.username}
                onChange={(event) =>
                  onApprovalChange({ ...approval, username: event.target.value })
                }
              />
              <input
                aria-label="Supervisor password"
                type="password"
                autoComplete="new-password"
                placeholder="Supervisor password"
                value={approval.password}
                onChange={(event) =>
                  onApprovalChange({ ...approval, password: event.target.value })
                }
              />
            </div>
          ) : (
            <button type="button" className="link-button" onClick={() => setShowApproval(true)}>
              Add supervisor approval
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
