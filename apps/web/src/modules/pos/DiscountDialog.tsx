import { useMemo, useRef, useState } from 'react';

import { useDialogFocus } from '../../hooks/useDialogFocus';
import { formatPkrMoney } from '../../money';
import type { CartLine } from '../../store';
import {
  buildDiscountPlan,
  DISCOUNT_REASONS,
  parseDiscountSpec,
  type CartDiscounts,
  type DiscountMode,
  type DiscountSpec,
} from './discount';

export interface SupervisorApproval {
  readonly username: string;
  readonly password: string;
}

interface DraftEntry {
  readonly mode: DiscountMode;
  readonly text: string;
}

const OTHER_REASON = 'Other';

function draftFrom(spec: DiscountSpec | null | undefined): DraftEntry {
  return spec ? { mode: spec.mode, text: spec.value } : { mode: 'PERCENT', text: '' };
}

function ModeToggle({
  label,
  mode,
  onChange,
}: {
  readonly label: string;
  readonly mode: DiscountMode;
  readonly onChange: (mode: DiscountMode) => void;
}): React.JSX.Element {
  return (
    <span className="mode-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={mode === 'PERCENT'} onClick={() => onChange('PERCENT')}>
        %
      </button>
      <button type="button" aria-pressed={mode === 'AMOUNT'} onClick={() => onChange('AMOUNT')}>
        PKR
      </button>
    </span>
  );
}

export function DiscountDialog({
  cart,
  discounts,
  targetIds,
  approval,
  approvalRequired,
  onApprovalChange,
  onApply,
  onClose,
}: {
  readonly cart: readonly CartLine[];
  readonly discounts: CartDiscounts;
  /** The ticked lines, used by the "apply to ticked lines" shortcut. */
  readonly targetIds: readonly string[];
  readonly approval: SupervisorApproval;
  readonly approvalRequired: boolean;
  readonly onApprovalChange: (approval: SupervisorApproval) => void;
  readonly onApply: (discounts: CartDiscounts) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, firstField, onClose);

  const [lineDrafts, setLineDrafts] = useState<Record<string, DraftEntry>>(() =>
    Object.fromEntries(
      cart.map((line) => [line.medicine.id, draftFrom(discounts.lines[line.medicine.id])]),
    ),
  );
  const [bulk, setBulk] = useState<DraftEntry>({ mode: 'PERCENT', text: '' });
  const [invoice, setInvoice] = useState<DraftEntry>(() => draftFrom(discounts.invoice));
  const presetReason = (DISCOUNT_REASONS as readonly string[]).includes(discounts.reason)
    ? discounts.reason
    : discounts.reason
      ? OTHER_REASON
      : '';
  const [reasonChoice, setReasonChoice] = useState(presetReason);
  const [otherReason, setOtherReason] = useState(
    presetReason === OTHER_REASON ? discounts.reason : '',
  );
  const reason = reasonChoice === OTHER_REASON ? otherReason.trim() : reasonChoice;

  const targetLines = cart.filter((line) => targetIds.includes(line.medicine.id));
  const bulkParsed = parseDiscountSpec(bulk.mode, bulk.text);

  const candidate = useMemo(() => {
    const inputErrors: string[] = [];
    const lines: Record<string, DiscountSpec> = {};
    for (const line of cart) {
      const draft = lineDrafts[line.medicine.id];
      if (!draft) continue;
      const parsed = parseDiscountSpec(draft.mode, draft.text);
      if (parsed.error) inputErrors.push(`${line.medicine.name}: ${parsed.error}`);
      else if (parsed.spec) lines[line.medicine.id] = parsed.spec;
    }
    const invoiceParsed = parseDiscountSpec(invoice.mode, invoice.text);
    if (invoiceParsed.error) inputErrors.push(`Invoice: ${invoiceParsed.error}`);
    const next: CartDiscounts = { lines, invoice: invoiceParsed.spec, reason };
    return { next, inputErrors, plan: buildDiscountPlan(cart, next) };
  }, [cart, invoice, lineDrafts, reason]);
  const { plan } = candidate;
  const errors = [...candidate.inputErrors, ...plan.errors];
  const netById = new Map(plan.lines.map((line) => [line.medicineId, line]));

  const updateLine = (medicineId: string, next: Partial<DraftEntry>): void =>
    setLineDrafts((current) => ({
      ...current,
      [medicineId]: { ...(current[medicineId] ?? draftFrom(null)), ...next },
    }));

  const applyBulk = (): void => {
    if (!bulkParsed.spec) return;
    const spec = bulkParsed.spec;
    setLineDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        targetLines.map((line) => [line.medicine.id, { mode: spec.mode, text: spec.value }]),
      ),
    }));
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialog}
        className="payment-dialog discount-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discount-title"
      >
        <header>
          <div>
            <p className="eyebrow">Ticket discount</p>
            <h2 id="discount-title">Discount</h2>
          </div>
          <div className="dialog-figure">
            <small>New total</small>
            <strong>{formatPkrMoney(plan.total)}</strong>
          </div>
        </header>

        <section className="dialog-section" aria-labelledby="line-discount-heading">
          <div className="dialog-section-head">
            <h3 id="line-discount-heading">Line discounts</h3>
            <div className="bulk-discount">
              <span>
                Ticked lines <b>{targetLines.length}</b>
              </span>
              <ModeToggle
                label="Ticked lines discount type"
                mode={bulk.mode}
                onChange={(mode) => setBulk({ ...bulk, mode })}
              />
              <input
                ref={firstField}
                aria-label="Discount for ticked lines"
                inputMode="decimal"
                placeholder={bulk.mode === 'PERCENT' ? '10' : '50.00'}
                value={bulk.text}
                onChange={(event) => setBulk({ ...bulk, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyBulk();
                  }
                }}
              />
              <button
                type="button"
                className="secondary-button compact"
                disabled={!bulkParsed.spec || targetLines.length === 0}
                onClick={applyBulk}
              >
                Apply to {targetLines.length}
              </button>
            </div>
          </div>
          {bulkParsed.error ? <p className="field-error">{bulkParsed.error}</p> : null}
          <table className="discount-table">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Line value</th>
                <th scope="col">Discount</th>
                <th scope="col">After discount</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((line) => {
                const draft = lineDrafts[line.medicine.id] ?? draftFrom(null);
                const amounts = netById.get(line.medicine.id);
                return (
                  <tr
                    key={line.medicine.id}
                    className={targetIds.includes(line.medicine.id) ? 'ticked' : undefined}
                  >
                    <th scope="row">
                      {line.medicine.name}
                      <small>
                        {line.quantity} × {formatPkrMoney(line.medicine.salePrice ?? '0.00')}
                      </small>
                    </th>
                    <td>{formatPkrMoney(amounts?.gross ?? '0.00')}</td>
                    <td>
                      <span className="discount-entry">
                        <ModeToggle
                          label={`${line.medicine.name} discount type`}
                          mode={draft.mode}
                          onChange={(mode) => updateLine(line.medicine.id, { mode })}
                        />
                        <input
                          aria-label={`${line.medicine.name} discount`}
                          inputMode="decimal"
                          placeholder="0"
                          value={draft.text}
                          onChange={(event) =>
                            updateLine(line.medicine.id, { text: event.target.value })
                          }
                        />
                      </span>
                      {amounts && amounts.discount !== '0.00' ? (
                        <small className="discount-amount">
                          −{formatPkrMoney(amounts.discount)}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <b>{formatPkrMoney(amounts?.net ?? '0.00')}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="dialog-columns">
          <section className="dialog-section" aria-labelledby="invoice-discount-heading">
            <h3 id="invoice-discount-heading">Invoice discount</h3>
            <p className="section-hint">Taken off after line discounts.</p>
            <span className="discount-entry wide">
              <ModeToggle
                label="Invoice discount type"
                mode={invoice.mode}
                onChange={(mode) => setInvoice({ ...invoice, mode })}
              />
              <input
                aria-label="Invoice discount"
                inputMode="decimal"
                placeholder="0"
                value={invoice.text}
                onChange={(event) => setInvoice({ ...invoice, text: event.target.value })}
              />
            </span>
          </section>
          <section className="dialog-section" aria-labelledby="discount-reason-heading">
            <h3 id="discount-reason-heading">Reason</h3>
            <div
              className="reason-chips"
              role="radiogroup"
              aria-labelledby="discount-reason-heading"
            >
              {[...DISCOUNT_REASONS, OTHER_REASON].map((option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={reasonChoice === option}
                  key={option}
                  onClick={() => setReasonChoice(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            {reasonChoice === OTHER_REASON ? (
              <input
                className="reason-other"
                aria-label="Other discount reason"
                placeholder="Describe the reason"
                maxLength={500}
                value={otherReason}
                onChange={(event) => setOtherReason(event.target.value)}
              />
            ) : null}
          </section>
        </div>

        <details className="approval-details" open={approvalRequired}>
          <summary>
            Supervisor approval{' '}
            {approvalRequired ? (
              <b>required for this discount</b>
            ) : (
              <span>needed only above the branch limit</span>
            )}
          </summary>
          <div>
            <input
              aria-label="Supervisor username"
              value={approval.username}
              autoComplete="off"
              placeholder="Supervisor username"
              onChange={(event) => onApprovalChange({ ...approval, username: event.target.value })}
            />
            <input
              aria-label="Supervisor password"
              value={approval.password}
              type="password"
              autoComplete="new-password"
              placeholder="Supervisor password"
              onChange={(event) => onApprovalChange({ ...approval, password: event.target.value })}
            />
          </div>
        </details>

        <dl className="discount-summary">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatPkrMoney(plan.gross)}</dd>
          </div>
          <div>
            <dt>Line discounts</dt>
            <dd>−{formatPkrMoney(plan.lineDiscountTotal)}</dd>
          </div>
          <div>
            <dt>Invoice discount</dt>
            <dd>−{formatPkrMoney(plan.invoiceDiscount)}</dd>
          </div>
          <div>
            <dt>Total off</dt>
            <dd>{plan.discountPercent}%</dd>
          </div>
          <div className="summary-total">
            <dt>To pay</dt>
            <dd>{formatPkrMoney(plan.total)}</dd>
          </div>
        </dl>
        {errors.length > 0 ? (
          <ul className="inline-error error-list" role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        <footer>
          <button
            type="button"
            className="link-button danger"
            onClick={() => {
              onApply({ lines: {}, invoice: null, reason: '' });
            }}
          >
            Remove all discounts
          </button>
          <span className="footer-spacer" />
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={errors.length > 0}
            onClick={() => onApply(candidate.next)}
          >
            Apply discount
          </button>
        </footer>
      </div>
    </div>
  );
}
