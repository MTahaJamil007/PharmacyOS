import { useState } from 'react';
import type { BudgetRegimenResult } from '@pharmacy/shared';

import { calculateBudgetRegimen } from '../../api';
import type { CartLine } from '../../store';
import {
  allocateBudget,
  calculateBudgetLocally,
  plannedQuantities,
  regimenForLine,
} from './budget-plan';

const MAX_PLAN_ITEMS = 20;

interface Calculated {
  readonly key: string;
  readonly result: BudgetRegimenResult;
  readonly otherItemsTotal: string;
  readonly includesOtherItems: boolean;
  readonly planned:
    { readonly quantities: Readonly<Record<string, number>> } | { readonly error: string };
}

export interface BudgetPlanState {
  readonly budget: string;
  readonly setBudget: (value: string) => void;
  readonly includeOtherItems: boolean;
  readonly setIncludeOtherItems: (value: boolean) => void;
  readonly planLines: readonly CartLine[];
  readonly otherLines: readonly CartLine[];
  readonly otherItemsTotal: string;
  readonly untimedLines: number;
  readonly current: Calculated | null;
  readonly stale: boolean;
  readonly pending: boolean;
  readonly error: string;
  /** Planned quantities while the result still matches the ticket, for the grid to preview. */
  readonly preview: Readonly<Record<string, number>> | null;
  readonly calculate: () => Promise<void>;
  readonly clear: () => void;
}

/**
 * The counter's budget plan: ticked lines (or all lines) are planned in complete days, with each
 * line's daily units read from its timing and the unticked lines paid out of the budget first.
 */
export function useBudgetPlan(
  token: string,
  previewMode: boolean,
  cart: readonly CartLine[],
  tickedIds: ReadonlySet<string>,
): BudgetPlanState {
  const [budget, setBudgetText] = useState('');
  const [includeOtherItems, setIncludeOtherItems] = useState(true);
  const [calculated, setCalculated] = useState<Calculated | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const ticked = cart.filter((line) => tickedIds.has(line.medicine.id));
  const planLines = ticked.length > 0 ? ticked : cart;
  const planIds = new Set(planLines.map((line) => line.medicine.id));
  const otherLines = cart.filter((line) => !planIds.has(line.medicine.id));
  const otherItemsTotal = allocateBudget('0', otherLines, false).otherItemsTotal;
  const includesOther = includeOtherItems && otherLines.length > 0;
  const key = JSON.stringify({
    budget: budget.trim(),
    includesOther,
    plan: planLines.map((line) => [line.medicine.id, regimenForLine(line).unitsPerDay]),
    other: otherLines.map((line) => [line.medicine.id, line.quantity]),
  });
  const current = calculated && calculated.key === key ? calculated : null;

  const calculate = async (): Promise<void> => {
    setError('');
    if (planLines.length === 0) {
      setError('Add medicines to plan');
      return;
    }
    if (planLines.length > MAX_PLAN_ITEMS) {
      setError(`Plan at most ${String(MAX_PLAN_ITEMS)} medicines at a time`);
      return;
    }
    const allocation = allocateBudget(budget, otherLines, includesOther);
    if (allocation.error) {
      setError(allocation.error);
      return;
    }
    setPending(true);
    try {
      const regimen = Object.fromEntries(
        planLines.map((line) => [line.medicine.id, regimenForLine(line)]),
      );
      const result = previewMode
        ? calculateBudgetLocally(allocation.budgetForPlan, planLines, regimen)
        : await calculateBudgetRegimen(token, {
            budget: allocation.budgetForPlan,
            items: planLines.map((line) => ({
              medicineId: line.medicine.id,
              prescribedBaseUnitsPerDay: regimenForLine(line).unitsPerDay,
              minimumSaleIncrement: '1',
            })),
          });
      setCalculated({
        key,
        result,
        otherItemsTotal: allocation.otherItemsTotal,
        includesOtherItems: includesOther,
        planned: plannedQuantities(result),
      });
    } catch (cause) {
      setCalculated(null);
      setError(cause instanceof Error ? cause.message : 'Budget calculation failed');
    } finally {
      setPending(false);
    }
  };

  return {
    budget,
    setBudget: (value) => {
      setBudgetText(value.slice(0, 14));
      setError('');
    },
    includeOtherItems,
    setIncludeOtherItems,
    planLines,
    otherLines,
    otherItemsTotal,
    untimedLines: planLines.filter((line) => !line.dosage).length,
    current,
    stale: calculated !== null && current === null,
    pending,
    error,
    preview: current && 'quantities' in current.planned ? current.planned.quantities : null,
    calculate,
    clear: () => {
      setCalculated(null);
      setBudgetText('');
      setError('');
    },
  };
}
