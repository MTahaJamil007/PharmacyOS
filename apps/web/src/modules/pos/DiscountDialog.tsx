import { minorUnitsToMoney, moneyToMinorUnits } from '@pharmacy/shared';
import { useMemo, useRef, useState } from 'react';

import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  MoneyInput,
  Segmented,
  Select,
} from '../../components/ui';
import { formatMoney } from '../../format';

export interface DiscountRequest {
  readonly amount: string;
  readonly reason: string;
  readonly approverUsername?: string;
  readonly approverPassword?: string;
}

const REASONS = [
  'Regular customer',
  'Senior citizen',
  'Staff purchase',
  'Bulk purchase',
  'Price match',
  'Damaged packaging',
] as const;

const MONEY = /^\d+(?:\.\d{1,2})?$/;
const PERCENT = /^\d{1,2}(?:\.\d{1,2})?$|^100$/;

/**
 * An invoice-level discount. The server decides whether the cashier's own limit covers it;
 * above the limit a supervisor signs in here and the approval is recorded against them.
 */
export function DiscountDialog({
  subtotal,
  initial,
  onApply,
  onClose,
}: {
  readonly subtotal: string;
  readonly initial: DiscountRequest | null;
  readonly onApply: (discount: DiscountRequest | null) => void;
  readonly onClose: () => void;
}) {
  const valueInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [value, setValue] = useState(initial?.amount ?? '');
  const initialReason = initial?.reason ?? REASONS[0];
  const [reasonChoice, setReasonChoice] = useState<string>(
    (REASONS as readonly string[]).includes(initialReason) ? initialReason : 'OTHER',
  );
  const [otherReason, setOtherReason] = useState(
    (REASONS as readonly string[]).includes(initialReason) ? '' : initialReason,
  );
  const [supervisor, setSupervisor] = useState(initial?.approverUsername ?? '');
  const [password, setPassword] = useState('');

  const amount = useMemo((): string | null => {
    const text = value.trim();
    if (!text) return null;
    try {
      if (mode === 'AMOUNT')
        return MONEY.test(text) ? minorUnitsToMoney(moneyToMinorUnits(text)) : null;
      if (!PERCENT.test(text)) return null;
      const [whole = '0', fraction = ''] = text.split('.');
      const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
      const minor = (moneyToMinorUnits(subtotal) * basisPoints + 5_000n) / 10_000n;
      return minorUnitsToMoney(minor);
    } catch {
      return null;
    }
  }, [mode, subtotal, value]);
  const tooLarge = amount !== null && moneyToMinorUnits(amount) >= moneyToMinorUnits(subtotal);
  const reason = reasonChoice === 'OTHER' ? otherReason.trim() : reasonChoice;
  const valid =
    amount !== null && moneyToMinorUnits(amount) > 0n && !tooLarge && reason.length >= 3;
  const supervisorPair = supervisor.trim() && password;

  return (
    <Dialog
      title="Discount"
      description={`On a sale of ${formatMoney(subtotal)}. Discounts above your limit need a supervisor.`}
      size="sm"
      initialFocus={valueInput}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <Button variant="ghost" onClick={() => onApply(null)}>
              Remove discount
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() =>
              amount &&
              onApply({
                amount,
                reason,
                ...(supervisorPair
                  ? { approverPassword: password, approverUsername: supervisor.trim() }
                  : {}),
              })
            }
          >
            Apply discount
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Segmented
          label="Discount type"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setValue('');
          }}
          options={[
            { label: 'Amount (Rs)', value: 'AMOUNT' },
            { label: 'Percent (%)', value: 'PERCENT' },
          ]}
        />
        <Field
          label={mode === 'AMOUNT' ? 'Discount amount' : 'Discount percent'}
          error={
            value.trim() && amount === null
              ? 'Enter a valid number'
              : tooLarge
                ? 'The discount must leave something to pay'
                : undefined
          }
          hint={amount && mode === 'PERCENT' ? `= ${formatMoney(amount)}` : undefined}
        >
          <MoneyInput
            ref={valueInput}
            className="input-lg"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label="Reason">
          <Select value={reasonChoice} onChange={(event) => setReasonChoice(event.target.value)}>
            {REASONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value="OTHER">Other…</option>
          </Select>
        </Field>
        {reasonChoice === 'OTHER' ? (
          <Field label="Describe the reason">
            <Input value={otherReason} onChange={(event) => setOtherReason(event.target.value)} />
          </Field>
        ) : null}
        <p className="form-section-title">Supervisor approval (only above your limit)</p>
        <div className="form-grid">
          <Field label="Supervisor username" optional>
            <Input
              autoComplete="off"
              value={supervisor}
              onChange={(event) => setSupervisor(event.target.value)}
            />
          </Field>
          <Field label="Supervisor password" optional>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
        <Alert tone="info">
          The discount is checked and recorded when you take payment. Wrong supervisor passwords
          count toward locking that supervisor&apos;s account.
        </Alert>
      </div>
    </Dialog>
  );
}
