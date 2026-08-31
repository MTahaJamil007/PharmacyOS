import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SalePaymentInput } from '@pharmacy/shared';

import { useDialogFocus } from '../../hooks/useDialogFocus';
import { formatPkrMoney } from '../../money';
import { createPaymentInputs, paymentSummary, type TenderForm } from './payment';

const initialTender = (total: string): TenderForm => ({
  bankAmount: '',
  bankReference: '',
  cardAmount: '',
  cardReference: '',
  cashAmount: total,
  cashTendered: total,
});

export function PaymentDialog({
  busy,
  onClose,
  onPay,
  total,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPay: (payments: readonly SalePaymentInput[]) => Promise<void>;
  readonly total: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cashTendered = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => initialTender(total));
  const [error, setError] = useState('');
  useDialogFocus(dialog, cashTendered, onClose);
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
  const submit = useCallback(async (): Promise<void> => {
    setError('');
    try {
      await onPay(createPaymentInputs(total, form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment failed');
    }
  }, [form, onPay, total]);
  useEffect(() => {
    const handleTenderShortcut = (event: KeyboardEvent): void => {
      if (event.key !== 'F8' || busy || !summary.complete) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void submit();
    };
    window.addEventListener('keydown', handleTenderShortcut, true);
    return () => window.removeEventListener('keydown', handleTenderShortcut, true);
  }, [busy, submit, summary.complete]);

  return (
    <div className="modal-backdrop">
      <div
        ref={dialog}
        className="payment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
      >
        <header>
          <div>
            <p className="eyebrow">Reserved sale</p>
            <h2 id="payment-title">Take payment</h2>
          </div>
          <strong>{formatPkrMoney(total)}</strong>
        </header>
        <div className="tender-grid">
          <fieldset>
            <legend>Cash</legend>
            <label>
              Applied to sale
              <input
                value={form.cashAmount}
                inputMode="decimal"
                onChange={(event) => update('cashAmount', event.target.value)}
              />
            </label>
            <label>
              Tendered
              <input
                ref={cashTendered}
                value={form.cashTendered}
                inputMode="decimal"
                onChange={(event) => update('cashTendered', event.target.value)}
              />
            </label>
            <output>
              Change <strong>{formatPkrMoney(summary.change)}</strong>
            </output>
          </fieldset>
          <fieldset>
            <legend>Card</legend>
            <label>
              Amount
              <input
                value={form.cardAmount}
                inputMode="decimal"
                onChange={(event) => update('cardAmount', event.target.value)}
              />
            </label>
            <label>
              Reference
              <input
                value={form.cardReference}
                onChange={(event) => update('cardReference', event.target.value)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>Bank transfer</legend>
            <label>
              Amount
              <input
                value={form.bankAmount}
                inputMode="decimal"
                onChange={(event) => update('bankAmount', event.target.value)}
              />
            </label>
            <label>
              Reference
              <input
                value={form.bankReference}
                onChange={(event) => update('bankReference', event.target.value)}
              />
            </label>
          </fieldset>
        </div>
        <div className="payment-balance" aria-live="polite">
          <span>Allocated {formatPkrMoney(summary.allocated)}</span>
          <strong>
            {summary.overAllocated
              ? 'Allocation exceeds total'
              : `Remaining ${formatPkrMoney(summary.remaining)}`}
          </strong>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => void submit()}
            disabled={!summary.complete || busy}
          >
            {busy ? 'Finalizing…' : 'Complete sale'} <kbd>F8</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
