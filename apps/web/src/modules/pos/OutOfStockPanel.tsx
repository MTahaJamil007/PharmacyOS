import { useQuery } from '@tanstack/react-query';
import type { ResolvedFeatures } from '@pharmacy/shared';
import { useEffect, useRef, useState } from 'react';

import { getSubstitutes, recordCustomerRequest, type MedicineSearchResult } from '../../api';
import { formatPkrMoney } from '../../money';

function identity(medicine: MedicineSearchResult): string {
  return [medicine.name, medicine.strength, medicine.dosageForm].filter(Boolean).join(' ');
}

/**
 * Shown when the order taker picks a medicine the shop cannot sell right now. It offers only
 * medicines with exactly the same generic, strength and form, each picked on purpose and
 * labelled with its company, and lets the order taker note that the customer asked for it.
 */
export function OutOfStockPanel({
  medicine,
  token,
  features,
  onPick,
  onClose,
  onNotice,
}: {
  readonly medicine: MedicineSearchResult;
  readonly token: string;
  readonly features: ResolvedFeatures;
  readonly onPick: (medicine: MedicineSearchResult) => void;
  readonly onClose: () => void;
  readonly onNotice: (message: string) => void;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const [noted, setNoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const alternatives = useQuery({
    queryKey: ['substitutes', medicine.id],
    queryFn: () => getSubstitutes(token, medicine.id),
    enabled: features.COUNTER_SUBSTITUTES.enabled && token !== '',
    staleTime: 15_000,
  });
  const options = alternatives.data?.data ?? [];

  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button[data-first]')?.focus();
  }, [alternatives.isSuccess]);

  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    element.addEventListener('keydown', escape);
    return () => element.removeEventListener('keydown', escape);
  }, [onClose]);

  const note = async () => {
    setBusy(true);
    try {
      const result = await recordCustomerRequest(token, {
        medicineId: medicine.id,
        requestedName: medicine.name,
      });
      setNoted(true);
      onNotice(
        result.counted
          ? `Noted: a customer asked for ${medicine.name}.`
          : `${medicine.name} was already noted a moment ago.`,
      );
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : 'Could not note the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={panel}
      className="out-of-stock"
      role="dialog"
      aria-label={`${medicine.name} is out of stock`}
    >
      <header>
        <div>
          <strong>{identity(medicine)}</strong>
          <span>is out of stock</span>
        </div>
        <button type="button" className="link-button" onClick={onClose}>
          Back <kbd>Esc</kbd>
        </button>
      </header>
      {features.COUNTER_SUBSTITUTES.enabled ? (
        <section aria-label="Same medicine from other companies">
          {alternatives.isLoading ? <p>Looking for the same medicine…</p> : null}
          {alternatives.data?.formulation && options.length > 0 ? (
            <p className="same-formula">
              Same medicine: <b>{alternatives.data.formulation}</b>. Tell the customer it is another
              company.
            </p>
          ) : null}
          {alternatives.isSuccess && options.length === 0 ? (
            <p className="no-alternative">
              {alternatives.data.formulation
                ? 'No exact alternative is in stock.'
                : 'This medicine has no complete generic, strength and form, so no alternative is offered.'}
            </p>
          ) : null}
          <ul className="alternatives">
            {options.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  {...(index === 0 ? { 'data-first': true } : {})}
                  onClick={() => onPick(option)}
                >
                  <span>
                    <strong>{identity(option)}</strong>
                    <small>
                      {option.manufacturer ?? 'No company'} ·{' '}
                      {option.availableQuantity.replace(/\.0+$/, '')} in stock
                      {option.shelf ? ` · ${option.shelf}` : ''}
                      {option.requiresPrescription ? ' · prescription' : ''}
                    </small>
                  </span>
                  <b>{option.salePrice ? formatPkrMoney(option.salePrice) : 'No price'}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {features.CUSTOMER_REQUESTS.enabled ? (
        <button
          type="button"
          className="secondary-button ask-button"
          disabled={busy || noted}
          {...(options.length === 0 ? { 'data-first': true } : {})}
          onClick={() => void note()}
        >
          {noted ? 'Noted ✓' : 'Customer asked for it'}
        </button>
      ) : null}
    </div>
  );
}
