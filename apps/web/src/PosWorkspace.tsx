import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  createSaleDraft,
  finalizeCashSale,
  getCurrentCashSession,
  getSaleReceipt,
  logout,
  reserveSaleDraft,
  searchMedicines,
  type FinalizedSale,
  type SaleReceipt,
} from './api';
import { calculateCartLineTotal, calculateCartTotal, formatPkrMoney } from './money';
import { previewMedicines } from './preview-data';
import { usePharmacyStore } from './store';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
function PrintableReceipt({
  receipt,
  onClose,
}: {
  readonly receipt: SaleReceipt;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [qrUrl, setQrUrl] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(receipt.returnQrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    }).then(setQrUrl);
  }, [receipt.returnQrPayload]);
  return (
    <div className="receipt-overlay" role="dialog" aria-modal="true" aria-label="Sale receipt">
      <article className="printable-receipt">
        <header>
          <strong>{receipt.sale.branch_name}</strong>
          <span>{receipt.sale.branch_address}</span>
          <span>{receipt.sale.branch_phone}</span>
        </header>
        <div className="receipt-identifiers">
          <b>{receipt.sale.invoice_number}</b>
          <span>{new Date(receipt.sale.created_at).toLocaleString('en-PK')}</span>
          <span>Cashier: {receipt.sale.cashier_name}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.name} {item.strength}
                  <small>
                    Batch {item.batch_number} · exp {item.expiry_date}
                  </small>
                </td>
                <td>{item.quantity}</td>
                <td>{formatPkrMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatPkrMoney(receipt.sale.subtotal)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>{formatPkrMoney(receipt.sale.discount_total)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatPkrMoney(receipt.sale.total)}</dd>
          </div>
        </dl>
        <div className="receipt-qr">
          {qrUrl ? <img src={qrUrl} alt="Opaque return lookup token" /> : null}
          <strong>Scan for an authorized return lookup</strong>
          <small>No customer, medicine, or payment data is stored in this QR.</small>
        </div>
        <footer>
          <span>Fiscal status: {receipt.sale.fiscal_status}</span>
          {receipt.sale.fiscal_invoice_number ? (
            <span>Fiscal invoice: {receipt.sale.fiscal_invoice_number}</span>
          ) : null}
        </footer>
      </article>
      <div className="receipt-controls">
        <button className="secondary-button" onClick={onClose}>
          Close
        </button>
        <button className="primary-button" onClick={() => window.print()}>
          Print receipt
        </button>
      </div>
    </div>
  );
}

export function PosWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const changeQuantity = usePharmacyStore((state) => state.changeQuantity);
  const clearCart = usePharmacyStore((state) => state.clearCart);
  const setSession = usePharmacyStore((state) => state.setSession);
  const [query, setQuery] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [receipt, setReceipt] = useState<FinalizedSale | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const signOut = (): void => {
    if (session) void logout(session.accessToken).catch(() => undefined);
    setSession(null);
  };

  useEffect(() => {
    searchInput.current?.focus();

    const focusSearch = (event: KeyboardEvent): void => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const search = useQuery({
    queryKey: ['medicine-search', query],
    queryFn: () => searchMedicines(session?.accessToken ?? '', query),
    enabled: !previewMode && Boolean(session) && query.trim().length > 0,
    staleTime: 10_000,
  });

  const results = previewMode
    ? previewMedicines.filter((medicine) =>
        `${medicine.name} ${medicine.genericName ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    : (search.data ?? []);
  const total = useMemo(
    () =>
      calculateCartTotal(
        cart.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.medicine.salePrice,
        })),
      ),
    [cart],
  );
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const checkout = async (): Promise<void> => {
    if (!session || cart.length === 0) return;
    try {
      setCheckoutPending(true);
      setCheckoutError('');
      setReceipt(null);
      const cashSession = await getCurrentCashSession(session.accessToken);
      if (!cashSession || cashSession.status !== 'OPEN') {
        throw new Error('Open a cash session for this terminal before finalizing a sale');
      }
      const draft = await createSaleDraft(
        session.accessToken,
        session.user.terminalId,
        cart.map((line) => ({
          medicineId: line.medicine.id,
          quantity: line.quantity.toString(),
        })),
      );
      const reservation = await reserveSaleDraft(session.accessToken, draft.id);
      const finalized = await finalizeCashSale(
        session.accessToken,
        cashSession.id,
        draft.id,
        reservation.total,
      );
      setReceipt(finalized);
      setPrintReceipt(await getSaleReceipt(session.accessToken, finalized.id));
      clearCart();
      setQuery('');
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Sale finalization failed');
    } finally {
      setCheckoutPending(false);
    }
  };

  return (
    <div className="workspace-shell">
      {printReceipt ? (
        <PrintableReceipt receipt={printReceipt} onClose={() => setPrintReceipt(null)} />
      ) : null}
      <header className="topbar">
        <div className="compact-brand">
          <span className="brand-mark">Rx</span>
          <strong>PharmacyOS</strong>
        </div>
        <nav aria-label="Primary navigation">
          <a className="active" href="#pos">
            Counter
          </a>
          <a href="#cash">Cash session</a>
          <a href="#inventory">Inventory intelligence</a>
          <a href="#budget">Budget calculator</a>
          <a href="#returns">Returns</a>
          <a href="#owner">Owner assistant</a>
        </nav>
        <div className="operator">
          <span>
            <i className="status-dot" /> LAN online
          </span>
          <button onClick={signOut}>
            {session?.user.displayName ?? 'Training user'} · Sign out
          </button>
        </div>
      </header>

      <main className="pos-layout" id="pos">
        <section className="catalog-pane">
          <div className="counter-heading">
            <div>
              <p className="eyebrow">Sales counter 01</p>
              <h1>Find medicine</h1>
            </div>
            <span className="clock-label">
              Thu · 20 Aug
              <br />
              <strong>12:42 PM</strong>
            </span>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInput}
              placeholder="Brand, generic, barcode or company"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="search-caption">
            <span>Scan a barcode or start typing</span>
            <span>{search.isFetching ? 'Searching…' : `${results.length} matches`}</span>
          </div>

          {search.error ? (
            <p className="inline-error" role="alert">
              Search is unavailable. Check the local API connection.
            </p>
          ) : null}
          <div className="medicine-list" aria-live="polite">
            {results.map((medicine, index) => {
              const expiringSoon = Boolean(
                medicine.nearestExpiry && medicine.nearestExpiry < '2026-12-01',
              );
              return (
                <button
                  className="medicine-row"
                  key={medicine.id}
                  onClick={() => addMedicine(medicine)}
                >
                  <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="medicine-identity">
                    <strong>
                      {medicine.name} <em>{medicine.strength}</em>
                    </strong>
                    <small>
                      {medicine.genericName} · {medicine.manufacturer}
                    </small>
                  </span>
                  <span className="shelf-code">
                    <small>Shelf</small>
                    <strong>{medicine.shelf ?? 'Not set'}</strong>
                  </span>
                  <span className={expiringSoon ? 'batch-status warning' : 'batch-status'}>
                    <small>FEFO batch</small>
                    <strong>{medicine.availableQuantity} units</strong>
                    <em>{medicine.nearestExpiry ?? 'No stock'}</em>
                  </span>
                  <span className="result-price">
                    {formatPkrMoney(medicine.salePrice ?? '0.00')}
                    <small>Space to add</small>
                  </span>
                </button>
              );
            })}
          </div>
          <footer className="shortcut-rail">
            <span>
              <kbd>F2</kbd> New sale
            </span>
            <span>
              <kbd>F4</kbd> Hold cart
            </span>
            <span>
              <kbd>F6</kbd> Cashier queue
            </span>
            <span>
              <kbd>Esc</kbd> Clear search
            </span>
          </footer>
        </section>

        <aside className="cart-pane" aria-label="Current cart">
          <div className="cart-heading">
            <div>
              <p className="eyebrow">Current cart</p>
              <h2>Counter ticket</h2>
            </div>
            <strong>{String(itemCount).padStart(2, '0')}</strong>
          </div>
          <div className="ticket-meta">
            <span>Draft</span>
            <span>Not reserved</span>
          </div>
          <div className="cart-lines">
            {cart.length === 0 ? (
              <div className="empty-cart">
                <span>+</span>
                <h3>No items yet</h3>
                <p>
                  Select a medicine or scan its barcode. Stock is reserved only when this cart goes
                  to the cashier.
                </p>
              </div>
            ) : (
              cart.map((line) => (
                <div className="cart-line" key={line.medicine.id}>
                  <div>
                    <strong>{line.medicine.name}</strong>
                    <small>
                      {line.medicine.strength} · {formatPkrMoney(line.medicine.salePrice ?? '0.00')}
                    </small>
                  </div>
                  <div className="quantity-control">
                    <button
                      aria-label={`Remove one ${line.medicine.name}`}
                      onClick={() => changeQuantity(line.medicine.id, -1)}
                    >
                      −
                    </button>
                    <output>{line.quantity}</output>
                    <button
                      aria-label={`Add one ${line.medicine.name}`}
                      onClick={() => changeQuantity(line.medicine.id, 1)}
                    >
                      +
                    </button>
                  </div>
                  <b>
                    {formatPkrMoney(
                      calculateCartLineTotal({
                        quantity: line.quantity,
                        unitPrice: line.medicine.salePrice,
                      }),
                    )}
                  </b>
                </div>
              ))
            )}
          </div>
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{formatPkrMoney(total)}</strong>
            </div>
            <div>
              <span>Discount</span>
              <strong>—</strong>
            </div>
            <div className="grand-total">
              <span>Estimated total</span>
              <strong>{formatPkrMoney(total)}</strong>
            </div>
            <p>Final price and FEFO batches are confirmed by the server.</p>
          </div>
          <div className="cart-actions">
            {checkoutError ? (
              <p className="inline-error checkout-error" role="alert">
                {checkoutError} <a href="#cash">Manage cash session</a>
              </p>
            ) : null}
            {receipt ? (
              <div className="sale-complete" role="status">
                <span>Sale finalized</span>
                <strong>{receipt.invoiceNumber}</strong>
                <small>
                  {formatPkrMoney(receipt.total)} · fiscal {receipt.fiscalStatus}
                </small>
                <a href="#returns">Return token {receipt.returnLookupToken.slice(0, 8)}…</a>
              </div>
            ) : null}
            <button className="secondary-button" disabled={cart.length === 0} onClick={clearCart}>
              Clear
            </button>
            <button
              className="primary-button"
              disabled={cart.length === 0 || checkoutPending}
              onClick={() => void checkout()}
            >
              {checkoutPending ? 'Finalizing…' : 'Reserve and take cash'} <span>→</span>
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
