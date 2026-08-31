import { useEffect, useRef, useState } from 'react';
import type { SaleReceipt, SaleReceiptSearchResult } from '@pharmacy/shared';

import { findSalesForReceipt, reprintSaleReceipt } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { formatPkrMoney } from '../../money';

export function ReprintDialog({
  onClose,
  onReceipt,
  token,
}: {
  readonly onClose: () => void;
  readonly onReceipt: (receipt: SaleReceipt) => void;
  readonly token: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SaleReceiptSearchResult[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const debouncedQuery = useDebouncedValue(query, 180);
  useDialogFocus(dialog, searchInput, onClose);
  useEffect(() => {
    let active = true;
    void findSalesForReceipt(token, debouncedQuery)
      .then((sales) => {
        if (active) setResults(sales);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Receipt search failed');
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery, token]);
  const select = async (saleId: string): Promise<void> => {
    setBusyId(saleId);
    setError('');
    try {
      onReceipt(await reprintSaleReceipt(token, saleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Receipt reprint failed');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialog}
        className="reprint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reprint-title"
      >
        <header>
          <div>
            <p className="eyebrow">Past sales</p>
            <h2 id="reprint-title">Find and reprint receipt</h2>
          </div>
        </header>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Invoice number"
          />
        </label>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="receipt-search-results">
          {results.length === 0 ? (
            <p>No matching receipts.</p>
          ) : (
            results.map((sale) => (
              <button
                key={sale.id}
                onClick={() => void select(sale.id)}
                disabled={busyId === sale.id}
              >
                <span>
                  <strong>{sale.invoice_number}</strong>
                  <small>
                    {new Date(sale.created_at).toLocaleString('en-PK')} · {sale.cashier_name}
                  </small>
                </span>
                <b>{busyId === sale.id ? 'Opening…' : formatPkrMoney(sale.total)}</b>
              </button>
            ))
          )}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
