import { decimalToScaledInteger } from '@pharmacy/shared';
import { Calculator, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  calculateBudgetRegimen,
  type BudgetRegimenResult,
  type MedicineSearchResult,
} from '../../api';
import { MedicinePicker } from '../../components/MedicinePicker';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorAlert,
  Field,
  IconButton,
  MoneyInput,
  PageHeader,
  Stat,
  useToast,
} from '../../components/ui';
import { formatMoney, formatQuantity, isMoneyText, isPositiveQuantityText } from '../../format';
import { usePharmacyStore } from '../../store';

interface RegimenLine {
  readonly medicine: MedicineSearchResult;
  readonly unitsPerDay: string;
  readonly saleIncrement: string;
}

const MAX_ITEMS = 20;

export function BudgetCalculator(): React.JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const cart = usePharmacyStore((state) => state.cart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const setQuantity = usePharmacyStore((state) => state.setQuantity);
  const [lines, setLines] = useState<readonly RegimenLine[]>(() =>
    cart
      .slice(0, MAX_ITEMS)
      .map((line) => ({ medicine: line.medicine, saleIncrement: '1', unitsPerDay: '1' })),
  );
  const [budget, setBudget] = useState('');
  const [result, setResult] = useState<BudgetRegimenResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const lineProblems = lines.map((line) =>
    !isPositiveQuantityText(line.unitsPerDay)
      ? 'Enter units per day'
      : !isPositiveQuantityText(line.saleIncrement)
        ? 'Enter the smallest quantity you sell'
        : null,
  );
  const valid =
    lines.length > 0 && isMoneyText(budget) && lineProblems.every((problem) => problem === null);

  const add = (medicine: MedicineSearchResult): void => {
    if (lines.some((line) => line.medicine.id === medicine.id)) return;
    if (lines.length >= MAX_ITEMS) {
      toast.error(`A regimen can have at most ${String(MAX_ITEMS)} medicines`);
      return;
    }
    setLines((current) => [...current, { medicine, saleIncrement: '1', unitsPerDay: '1' }]);
    setResult(null);
  };
  const update = (
    medicineId: string,
    field: 'unitsPerDay' | 'saleIncrement',
    value: string,
  ): void => {
    setLines((current) =>
      current.map((line) => (line.medicine.id === medicineId ? { ...line, [field]: value } : line)),
    );
    setResult(null);
  };
  const calculate = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await calculateBudgetRegimen({
          budget: budget.trim(),
          items: lines.map((line) => ({
            medicineId: line.medicine.id,
            minimumSaleIncrement: line.saleIncrement.trim(),
            prescribedBaseUnitsPerDay: line.unitsPerDay.trim(),
          })),
        }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  // The counter sells whole units; only offer the hand-off when every quantity is whole.
  const wholeQuantities =
    result !== null &&
    result.completeDays > 0 &&
    result.lines.every((line) => decimalToScaledInteger(line.requiredQuantity, 3) % 1000n === 0n);
  const sendToCounter = (): void => {
    if (!result) return;
    for (const line of result.lines) {
      const quantity = Number(decimalToScaledInteger(line.requiredQuantity, 3) / 1000n);
      const medicine = lines.find((item) => item.medicine.id === line.medicineId)?.medicine;
      if (!medicine) continue;
      if (cart.some((item) => item.medicine.id === line.medicineId))
        setQuantity(line.medicineId, quantity);
      else addMedicine(medicine, quantity);
    }
    toast.success('Quantities sent to the counter');
    void navigate('/pos');
  };

  return (
    <div className="page">
      <PageHeader
        title="Budget planner"
        description="How many complete days of a prescription fit the customer's budget. Affordability only — never clinical advice."
      />
      <div className="grid grid-sidebar">
        <Card
          title="Prescription as written"
          description="Enter the regimen exactly as prescribed. The planner never suggests skipping doses or substitutes."
          footer={
            <>
              <Field
                label="Customer budget"
                error={budget && !isMoneyText(budget) ? 'Enter an amount like 1500' : undefined}
              >
                <MoneyInput
                  value={budget}
                  onChange={(event) => {
                    setBudget(event.target.value);
                    setResult(null);
                  }}
                />
              </Field>
              <span className="spacer" />
              <Button
                variant="primary"
                icon={Calculator}
                loading={busy}
                disabled={!valid}
                onClick={() => void calculate()}
              >
                Calculate
              </Button>
            </>
          }
          flush
        >
          <div className="card-body">
            <MedicinePicker onSelect={add} label="Add a prescribed medicine" />
          </div>
          <DataTable
            caption="Prescribed medicines"
            compact
            rows={lines}
            rowKey={(line) => line.medicine.id}
            empty={
              <EmptyState icon={Calculator} title="No medicines yet">
                Search above, or add items at the counter first — the counter cart is brought in
                automatically.
              </EmptyState>
            }
            columns={[
              {
                header: 'Medicine',
                key: 'medicine',
                render: (line) => {
                  const problem = lineProblems[lines.indexOf(line)];
                  return (
                    <>
                      <span className="cell-primary">{line.medicine.name}</span>
                      <span className={problem ? 'cell-sub text-danger' : 'cell-sub'}>
                        {problem ??
                          `${formatMoney(line.medicine.salePrice)} per unit · ${formatQuantity(line.medicine.availableQuantity)} in stock`}
                      </span>
                    </>
                  );
                },
              },
              {
                align: 'end',
                header: 'Units per day',
                key: 'perDay',
                width: 120,
                render: (line) => (
                  <input
                    className="input cell-input"
                    inputMode="decimal"
                    aria-label={`Units per day of ${line.medicine.name}`}
                    value={line.unitsPerDay}
                    onChange={(event) =>
                      update(line.medicine.id, 'unitsPerDay', event.target.value)
                    }
                  />
                ),
              },
              {
                align: 'end',
                header: 'Sold in steps of',
                key: 'increment',
                width: 130,
                render: (line) => (
                  <input
                    className="input cell-input"
                    inputMode="decimal"
                    aria-label={`Smallest sale quantity of ${line.medicine.name}`}
                    value={line.saleIncrement}
                    onChange={(event) =>
                      update(line.medicine.id, 'saleIncrement', event.target.value)
                    }
                  />
                ),
              },
              {
                header: <span className="sr-only">Remove</span>,
                key: 'remove',
                width: 44,
                render: (line) => (
                  <IconButton
                    label={`Remove ${line.medicine.name}`}
                    icon={Trash2}
                    onClick={() => {
                      setLines((current) =>
                        current.filter((item) => item.medicine.id !== line.medicine.id),
                      );
                      setResult(null);
                    }}
                  />
                ),
              },
            ]}
          />
          <ErrorAlert error={error} />
        </Card>
        <div className="stack">
          <Stat
            label="Complete days affordable"
            icon={ShieldCheck}
            value={result ? String(result.completeDays) : '—'}
            hint={
              result
                ? `One full day costs ${formatMoney(result.oneDayCost)}`
                : 'Calculate to see the answer'
            }
            tone={result?.completeDays === 0 ? 'danger' : result ? 'success' : undefined}
          />
          {result ? (
            <Card
              title="What to sell"
              footer={
                wholeQuantities ? (
                  <Button variant="primary" icon={ShoppingCart} onClick={sendToCounter}>
                    Put these in the counter cart
                  </Button>
                ) : undefined
              }
              flush
            >
              <DataTable
                caption="Quantities for the affordable days"
                compact
                rows={result.lines}
                rowKey={(line) => line.medicineId}
                columns={[
                  { header: 'Medicine', key: 'name', render: (line) => line.medicineName },
                  {
                    align: 'end',
                    header: 'Units',
                    key: 'qty',
                    render: (line) => formatQuantity(line.requiredQuantity),
                  },
                  {
                    align: 'end',
                    footer: <strong>{formatMoney(result.totalCost)}</strong>,
                    header: 'Cost',
                    key: 'cost',
                    render: (line) => formatMoney(line.lineCost),
                  },
                ]}
              />
              <div className="card-body">
                <div className="row between">
                  <span className="muted">Budget left over</span>
                  <strong className="num">{formatMoney(result.remainder)}</strong>
                </div>
              </div>
            </Card>
          ) : null}
          <Alert tone="info">
            {result?.safetyMessage ??
              'Results only ever cover complete days at the prescribed dose. Refer dosing questions to the pharmacist.'}
          </Alert>
        </div>
      </div>
    </div>
  );
}
