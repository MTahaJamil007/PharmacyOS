import { minorUnitsToMoney, moneyToMinorUnits, type SalePaymentInput } from '@pharmacy/shared';
import { Banknote, BookUser, CreditCard, Landmark } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Alert, Button, Dialog, Field, Input, MoneyInput } from '../../components/ui';
import { formatMoney } from '../../format';
import { createPaymentInputs, paymentSummary, type TenderForm } from './payment';

const initialTender = (total: string): TenderForm => ({
  bankAmount: '',
  bankReference: '',
  cardAmount: '',
  cardReference: '',
  cashAmount: total,
  cashTendered: total,
  creditAmount: '',
});

/** Pakistani notes a customer is likely to hand over, above the cash due. */
function quickTenders(cashDue: string): readonly string[] {
  let due: bigint;
  try {
    due = moneyToMinorUnits(cashDue);
  } catch {
    return [];
  }
  if (due <= 0n) return [];
  const suggestions = new Set<string>();
  for (const step of [10_00n, 50_00n, 100_00n, 500_00n, 1000_00n, 5000_00n]) {
    const rounded = ((due + step - 1n) / step) * step;
    if (rounded > due) suggestions.add(minorUnitsToMoney(rounded));
  }
  return [...suggestions].slice(0, 5);
}

export function PaymentDialog({
  busy,
  onClose,
  onPay,
  total,
  customerName,
  allowCredit,
  availableCredit,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPay: (payments: readonly SalePaymentInput[]) => Promise<void>;
  readonly total: string;
  readonly customerName?: string;
  readonly allowCredit: boolean;
  readonly availableCredit?: string;
}) {
  const cashTendered = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => initialTender(total));
  const [error, setError] = useState('');
  const summary = useMemo(() => {
    try {
      return paymentSummary(total, form);
    } catch {
      return {
        allocated: '0.00',
        change: '0.00',
        complete: false,
        overAllocated: false,
        remaining: total,
      };
    }
  }, [form, total]);
  const update = (key: keyof TenderForm, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }));

  /** Moving money between tenders keeps cash as the balancing figure. */
  const rebalanceCash = (next: TenderForm): TenderForm => {
    try {
      const others =
        (next.cardAmount.trim() ? moneyToMinorUnits(next.cardAmount) : 0n) +
        (next.bankAmount.trim() ? moneyToMinorUnits(next.bankAmount) : 0n) +
        (next.creditAmount?.trim() ? moneyToMinorUnits(next.creditAmount) : 0n);
      const cash = moneyToMinorUnits(total) - others;
      const cashAmount = cash > 0n ? minorUnitsToMoney(cash) : '';
      return { ...next, cashAmount, cashTendered: cashAmount };
    } catch {
      return next;
    }
  };

  const submit = useCallback(async (): Promise<void> => {
    setError('');
    try {
      await onPay(createPaymentInputs(total, form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment failed');
    }
  }, [form, onPay, total]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if (event.key !== 'F8' || busy || !summary.complete) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void submit();
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, [busy, submit, summary.complete]);

  const cashShort =
    form.cashAmount.trim() !== '' &&
    form.cashTendered.trim() !== '' &&
    (() => {
      try {
        return moneyToMinorUnits(form.cashTendered) < moneyToMinorUnits(form.cashAmount);
      } catch {
        return false;
      }
    })();

  return (
    <Dialog
      title="Take payment"
      description={customerName ? `Customer: ${customerName}` : 'Walk-in customer'}
      size="lg"
      initialFocus={cashTendered}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <span className="footer-note">Stock stays reserved while this window is open.</span>
          <Button onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!summary.complete}
            onClick={() => void submit()}
            shortcut="F8"
          >
            {busy ? 'Completing…' : 'Complete sale'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="payment-total">
          <span>Amount due</span>
          <strong>{formatMoney(total)}</strong>
        </div>

        <div className="tender-rows">
          <div className="tender-row" role="group" aria-label="Cash">
            <span className="tender-method">
              <Banknote aria-hidden /> Cash
            </span>
            <Field label="Cash for this sale">
              <MoneyInput
                value={form.cashAmount}
                onChange={(event) => update('cashAmount', event.target.value)}
              />
            </Field>
            <Field label="Customer gave" error={cashShort ? 'Less than the cash due' : undefined}>
              <MoneyInput
                ref={cashTendered}
                className="input-lg"
                value={form.cashTendered}
                onFocus={(event) => event.target.select()}
                onChange={(event) => update('cashTendered', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && summary.complete && !busy) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
            </Field>
          </div>
          <div className="tender-quick" aria-label="Quick cash amounts">
            <Button size="sm" onClick={() => update('cashTendered', form.cashAmount)}>
              Exact
            </Button>
            {quickTenders(form.cashAmount).map((amount) => (
              <Button key={amount} size="sm" onClick={() => update('cashTendered', amount)}>
                {formatMoney(amount)}
              </Button>
            ))}
          </div>

          <div className="tender-row" role="group" aria-label="Card">
            <span className="tender-method">
              <CreditCard aria-hidden /> Card
            </span>
            <Field label="Amount">
              <MoneyInput
                value={form.cardAmount}
                onChange={(event) =>
                  setForm((current) =>
                    rebalanceCash({ ...current, cardAmount: event.target.value }),
                  )
                }
              />
            </Field>
            <Field label="Card slip / approval no." optional>
              <Input
                value={form.cardReference}
                onChange={(event) => update('cardReference', event.target.value)}
              />
            </Field>
          </div>

          <div className="tender-row" role="group" aria-label="Bank / wallet">
            <span className="tender-method">
              <Landmark aria-hidden /> Bank / wallet
            </span>
            <Field label="Amount">
              <MoneyInput
                value={form.bankAmount}
                onChange={(event) =>
                  setForm((current) =>
                    rebalanceCash({ ...current, bankAmount: event.target.value }),
                  )
                }
              />
            </Field>
            <Field label="Transaction ID" optional>
              <Input
                value={form.bankReference}
                onChange={(event) => update('bankReference', event.target.value)}
              />
            </Field>
          </div>

          <div
            className={allowCredit ? 'tender-row' : 'tender-row disabled'}
            role="group"
            aria-label="Khata (credit)"
          >
            <span className="tender-method">
              <BookUser aria-hidden /> Khata (credit)
            </span>
            <Field label="Amount">
              <MoneyInput
                value={form.creditAmount ?? ''}
                disabled={!allowCredit}
                onChange={(event) =>
                  setForm((current) =>
                    rebalanceCash({ ...current, creditAmount: event.target.value }),
                  )
                }
              />
            </Field>
            <div className="field">
              <span className="field-hint">
                {allowCredit
                  ? `Charged to ${customerName ?? 'the customer'}${availableCredit ? `; credit left ${formatMoney(availableCredit)}` : ''}`
                  : 'Attach a customer to the sale to use their khata.'}
              </span>
              {allowCredit ? (
                <Button
                  size="sm"
                  onClick={() =>
                    setForm((current) =>
                      rebalanceCash({
                        ...current,
                        cardAmount: '',
                        bankAmount: '',
                        creditAmount: total,
                      }),
                    )
                  }
                >
                  Put all on khata
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={
            summary.overAllocated
              ? 'balance-line bad'
              : summary.complete
                ? 'balance-line ok'
                : 'balance-line'
          }
          aria-live="polite"
        >
          <span>
            {summary.overAllocated
              ? 'More than the amount due is allocated'
              : summary.complete
                ? 'Fully paid'
                : `Still to allocate: ${formatMoney(summary.remaining)}`}
          </span>
          <span>
            Change to return: <span className="change-due">{formatMoney(summary.change)}</span>
          </span>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
