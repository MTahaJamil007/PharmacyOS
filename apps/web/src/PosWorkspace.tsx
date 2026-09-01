import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createClientRequestId,
  minorUnitsToMoney,
  moneyToMinorUnits,
  PERMISSIONS,
  type CustomerSummary,
  type SalePaymentInput,
  type SaleReceipt,
} from '@pharmacy/shared';

import {
  createSaleDraft,
  applySaleDiscount,
  finalizeSale,
  getCurrentCashSession,
  getSaleReceipt,
  reserveSaleDraft,
  searchCustomers,
  searchMedicines,
  type FinalizedSale,
  type MedicineSearchResult,
} from './api';
import { AppShell } from './components/AppShell';
import { useClock } from './hooks/useClock';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useI18n } from './i18n';
import { calculateCartLineTotal, calculateCartTotal, formatPkrMoney } from './money';
import { previewMedicines } from './preview-data';
import { usePharmacyStore } from './store';
import {
  cartSignature,
  clearCheckoutAttempt,
  createCheckoutAttempt,
  loadCheckoutAttempt,
  saveCheckoutAttempt,
  type CheckoutAttempt,
} from './modules/pos/checkout-attempt';
import { PaymentDialog } from './modules/pos/PaymentDialog';
import { ReceiptDialog } from './modules/pos/ReceiptDialog';
import { ReprintDialog } from './modules/pos/ReprintDialog';
import { WedgeScannerBuffer } from './modules/pos/scanner';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';

function clockLabel(
  now: Date,
  timeZone?: string,
): { readonly date: string; readonly time: string } {
  const options = timeZone ? { timeZone } : {};
  return {
    date: new Intl.DateTimeFormat('en-PK', {
      ...options,
      day: '2-digit',
      month: 'short',
      weekday: 'short',
    }).format(now),
    time: new Intl.DateTimeFormat('en-PK', {
      ...options,
      hour: 'numeric',
      minute: '2-digit',
    }).format(now),
  };
}

export function PosWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const heldCart = usePharmacyStore((state) => state.heldCart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const changeQuantity = usePharmacyStore((state) => state.changeQuantity);
  const setQuantity = usePharmacyStore((state) => state.setQuantity);
  const removeMedicine = usePharmacyStore((state) => state.removeMedicine);
  const clearCart = usePharmacyStore((state) => state.clearCart);
  const holdOrResumeCart = usePharmacyStore((state) => state.holdOrResumeCart);
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(
    cart[0]?.medicine.id ?? null,
  );
  const [checkoutError, setCheckoutError] = useState('');
  const [counterNotice, setCounterNotice] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [receipt, setReceipt] = useState<FinalizedSale | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const [paymentTotal, setPaymentTotal] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [invoiceDiscount, setInvoiceDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('Counter discount');
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(() =>
    session ? loadCheckoutAttempt(session.user.terminalId, cart) : null,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const scanner = useRef(new WedgeScannerBuffer());
  const debouncedQuery = useDebouncedValue(query.trim(), 180);
  const debouncedCustomerQuery = useDebouncedValue(customerQuery.trim(), 180);
  const now = useClock(session?.user.branchTimezone);
  const clock = clockLabel(now, session?.user.branchTimezone);

  const search = useQuery({
    queryKey: ['medicine-search', debouncedQuery],
    queryFn: () => searchMedicines(session?.accessToken ?? '', debouncedQuery),
    enabled: !previewMode && Boolean(session) && debouncedQuery.length > 0,
    staleTime: 10_000,
  });
  const results = previewMode
    ? previewMedicines.filter((medicine) =>
        `${medicine.name} ${medicine.genericName ?? ''} ${medicine.barcode ?? ''}`
          .toLowerCase()
          .includes(debouncedQuery.toLowerCase()),
      )
    : (search.data ?? []);
  const customers = useQuery({
    queryKey: ['customer-search', debouncedCustomerQuery],
    queryFn: () => searchCustomers(session?.accessToken ?? '', debouncedCustomerQuery),
    enabled:
      !previewMode &&
      Boolean(session) &&
      debouncedCustomerQuery.length > 0 &&
      (session?.user.permissions.includes(PERMISSIONS.CUSTOMER_READ) ?? false),
  });
  const total = useMemo(
    () =>
      calculateCartTotal(
        cart.map((line) => ({ quantity: line.quantity, unitPrice: line.medicine.salePrice })),
      ),
    [cart],
  );
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const lockedCart = Boolean(attempt?.reservedTotal || attempt?.finalizedSaleId);
  const lockedDraft = Boolean(attempt?.draftId);
  const customerId = attempt?.customerId ?? selectedCustomer?.id;
  const customerName = attempt?.customerName ?? selectedCustomer?.name;
  const canUseCredit =
    Boolean(customerId) &&
    (session?.user.permissions.includes(PERMISSIONS.CUSTOMER_CREDIT) ?? false);
  const estimatedTotal = useMemo(() => {
    try {
      const discount = invoiceDiscount.trim() ? moneyToMinorUnits(invoiceDiscount) : 0n;
      const value = moneyToMinorUnits(total) - discount;
      return value >= 0n ? minorUnitsToMoney(value) : total;
    } catch {
      return total;
    }
  }, [invoiceDiscount, total]);

  const updateAttempt = useCallback((next: CheckoutAttempt | null): void => {
    setAttempt(next);
    if (next) saveCheckoutAttempt(next);
  }, []);

  const recoverReceipt = useCallback(
    async (saleId: string): Promise<void> => {
      if (!session) return;
      try {
        const recovered = await getSaleReceipt(session.accessToken, saleId);
        setPrintReceipt(recovered);
        clearCheckoutAttempt(session.user.terminalId);
        setAttempt(null);
        setCheckoutError('');
      } catch {
        setCheckoutError(
          'Sale is finalized, but its receipt could not be loaded. Use Retry receipt or Receipt search; do not charge again.',
        );
      }
    },
    [session],
  );

  useEffect(() => {
    const finalizedSaleId = attempt?.finalizedSaleId;
    if (!finalizedSaleId) return;
    const recoveryTimer = window.setTimeout(() => void recoverReceipt(finalizedSaleId), 0);
    return () => window.clearTimeout(recoveryTimer);
  }, [attempt?.finalizedSaleId, recoverReceipt]);

  const addSearchResult = useCallback(
    (medicine: MedicineSearchResult, quantity = 1): void => {
      if (lockedCart) return;
      addMedicine(medicine, quantity);
      setSelectedMedicineId(medicine.id);
      setCounterNotice(`${medicine.name} added`);
    },
    [addMedicine, lockedCart],
  );

  const addBarcode = useCallback(
    async (barcode: string): Promise<void> => {
      setCheckoutError('');
      try {
        const matches = previewMode
          ? previewMedicines.filter((medicine) => medicine.barcode === barcode)
          : await searchMedicines(session?.accessToken ?? '', barcode);
        const exact = matches.find((medicine) => medicine.barcode === barcode);
        if (!exact) throw new Error(`Barcode ${barcode} has no exact medicine match`);
        addSearchResult(exact);
        setQuery('');
      } catch (cause) {
        setCheckoutError(cause instanceof Error ? cause.message : 'Barcode lookup failed');
      }
    },
    [addSearchResult, session],
  );

  const resetSale = useCallback((): void => {
    if (lockedCart) {
      setCounterNotice('Complete the reserved sale before starting a new one');
      return;
    }
    if (session) clearCheckoutAttempt(session.user.terminalId);
    clearCart();
    setAttempt(null);
    setPaymentTotal(null);
    setReceipt(null);
    setCheckoutError('');
    setCounterNotice('New sale ready');
    setSelectedCustomer(null);
    setCustomerQuery('');
    setInvoiceDiscount('');
    setApproverUsername('');
    setApproverPassword('');
    setQuery('');
    searchInput.current?.focus();
  }, [clearCart, lockedCart, session]);

  const toggleHeldCart = useCallback((): void => {
    if (lockedCart) {
      setCounterNotice('A reserved sale cannot be held');
      return;
    }
    const outcome = holdOrResumeCart();
    setCounterNotice(
      outcome === 'HELD'
        ? 'Cart held on this terminal'
        : outcome === 'RESUMED'
          ? 'Held cart resumed'
          : 'Finish or clear the current cart first',
    );
  }, [holdOrResumeCart, lockedCart]);

  const beginCheckout = useCallback(async (): Promise<void> => {
    if (!session || cart.length === 0 || checkoutPending) return;
    setCheckoutPending(true);
    setCheckoutError('');
    try {
      let current = attempt;
      if (current?.finalizedSaleId) {
        await recoverReceipt(current.finalizedSaleId);
        return;
      }
      if (!current || current.cartSignature !== cartSignature(cart)) {
        current = createCheckoutAttempt(session.user.terminalId, cart);
        current = {
          ...current,
          ...(selectedCustomer
            ? { customerId: selectedCustomer.id, customerName: selectedCustomer.name }
            : {}),
        };
        updateAttempt(current);
      }
      if (!current.cashSessionId) {
        const cashSession = await getCurrentCashSession(session.accessToken);
        if (!cashSession || cashSession.status !== 'OPEN') {
          throw new Error('Open a cash session for this terminal before taking payment');
        }
        current = { ...current, cashSessionId: cashSession.id };
        updateAttempt(current);
      }
      if (!current.draftId) {
        const draft = await createSaleDraft(
          session.accessToken,
          session.user.terminalId,
          cart.map((line) => ({
            medicineId: line.medicine.id,
            quantity: line.quantity.toString(),
          })),
        );
        current = { ...current, draftId: draft.id };
        updateAttempt(current);
      }
      const requestedDiscount = invoiceDiscount.trim();
      if (
        requestedDiscount &&
        moneyToMinorUnits(requestedDiscount) > 0n &&
        !current.discountApplied
      ) {
        if (current.discountAmount && current.discountAmount !== requestedDiscount) {
          throw new Error(
            'This checkout already has a different discount request; clear it and start again',
          );
        }
        if (!current.discountRequestId) {
          current = {
            ...current,
            discountAmount: requestedDiscount,
            discountRequestId: createClientRequestId(),
          };
          updateAttempt(current);
        }
        const discountRequestId = current.discountRequestId;
        const draftId = current.draftId;
        if (!discountRequestId || !draftId)
          throw new Error('Discount request could not be resumed');
        const discounted = await applySaleDiscount(session.accessToken, draftId, {
          invoiceDiscount: requestedDiscount,
          reason: discountReason,
          clientRequestId: discountRequestId,
          ...(approverUsername.trim() && approverPassword
            ? { approverUsername: approverUsername.trim(), approverPassword }
            : {}),
        });
        current = { ...current, discountApplied: true };
        updateAttempt(current);
        setCounterNotice(`${discounted.approvalLevel.toLowerCase()} discount approved`);
        setApproverPassword('');
      }
      const reservationExpired =
        current.reservedUntil !== undefined && new Date(current.reservedUntil) <= new Date();
      if (!current.reservedTotal || reservationExpired) {
        const draftId = current.draftId;
        if (!draftId) throw new Error('Sale draft could not be resumed');
        const reservation = await reserveSaleDraft(session.accessToken, draftId);
        current = {
          ...current,
          reservedTotal: reservation.total,
          reservedUntil: reservation.reservedUntil,
        };
        updateAttempt(current);
      }
      if (!current.reservedTotal) throw new Error('Sale reservation total is unavailable');
      setPaymentTotal(current.reservedTotal);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'Sale reservation failed');
    } finally {
      setCheckoutPending(false);
    }
  }, [
    approverPassword,
    approverUsername,
    attempt,
    cart,
    checkoutPending,
    discountReason,
    invoiceDiscount,
    recoverReceipt,
    selectedCustomer,
    session,
    updateAttempt,
  ]);

  const completePayment = useCallback(
    async (payments: readonly SalePaymentInput[]): Promise<void> => {
      if (!session || !attempt?.cashSessionId || !attempt.draftId) return;
      setCheckoutPending(true);
      setCheckoutError('');
      try {
        const finalized = await finalizeSale(
          session.accessToken,
          attempt.cashSessionId,
          attempt.draftId,
          attempt.clientRequestId,
          payments,
          attempt.customerId,
        );
        const finalizedAttempt = { ...attempt, finalizedSaleId: finalized.id };
        updateAttempt(finalizedAttempt);
        setReceipt(finalized);
        setPaymentTotal(null);
        clearCart();
        await recoverReceipt(finalized.id);
      } catch (cause) {
        setCheckoutError(cause instanceof Error ? cause.message : 'Sale finalization failed');
        throw cause;
      } finally {
        setCheckoutPending(false);
      }
    },
    [attempt, clearCart, recoverReceipt, session, updateAttempt],
  );

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const barcode = scanner.current.push(event.key, event.timeStamp);
      if (barcode) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void addBarcode(barcode);
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        resetSale();
      } else if (event.key === 'F4') {
        event.preventDefault();
        toggleHeldCart();
      } else if (event.key === 'F6') {
        event.preventDefault();
        setReprintOpen(true);
      } else if (event.key === 'F8' && !paymentTotal) {
        event.preventDefault();
        void beginCheckout();
      } else if (
        event.key === 'Delete' &&
        selectedMedicineId &&
        !lockedCart &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        removeMedicine(selectedMedicineId);
      } else if (event.key === 'Escape' && !paymentTotal && !reprintOpen && !printReceipt) {
        setQuery('');
        searchInput.current?.focus();
      } else if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, [
    addBarcode,
    beginCheckout,
    lockedCart,
    paymentTotal,
    printReceipt,
    removeMedicine,
    reprintOpen,
    resetSale,
    selectedMedicineId,
    toggleHeldCart,
  ]);

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const multiplier = /^\*(\d{1,4})$/.exec(query.trim());
    if (multiplier && selectedMedicineId) {
      setQuantity(selectedMedicineId, Number(multiplier[1]));
      setQuery('');
      return;
    }
    const first = results[0];
    if (first) {
      addSearchResult(first);
      setQuery('');
    }
  };

  const ticketState = attempt?.finalizedSaleId
    ? ['Finalized', 'Receipt recovery']
    : attempt?.reservedTotal
      ? [
          'Reserved',
          attempt.reservedUntil
            ? `Until ${new Date(attempt.reservedUntil).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
            : 'Active',
        ]
      : attempt?.draftId
        ? ['Draft created', 'Not reserved']
        : ['New sale', 'Stock not reserved'];

  return (
    <AppShell>
      {printReceipt ? (
        <ReceiptDialog
          key={printReceipt.sale.id}
          receipt={printReceipt}
          onClose={() => setPrintReceipt(null)}
        />
      ) : null}
      {paymentTotal ? (
        <PaymentDialog
          total={paymentTotal}
          busy={checkoutPending}
          onClose={() => setPaymentTotal(null)}
          onPay={completePayment}
          allowCredit={canUseCredit}
          {...(customerName ? { customerName } : {})}
        />
      ) : null}
      {reprintOpen && session ? (
        <ReprintDialog
          token={session.accessToken}
          onClose={() => setReprintOpen(false)}
          onReceipt={(value) => {
            setReprintOpen(false);
            setPrintReceipt(value);
          }}
        />
      ) : null}
      <main className="pos-layout" id="pos">
        <section className="catalog-pane">
          <div className="counter-heading">
            <div>
              <p className="eyebrow">{session?.user.terminalName ?? 'Training counter'}</p>
              <h1>{t('pos.findMedicine')}</h1>
            </div>
            <span className="clock-label">
              {clock.date}
              <br />
              <strong>{clock.time}</strong>
            </span>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInput}
              placeholder={t('pos.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={searchKeyDown}
            />
            <kbd>/</kbd>
          </label>
          <div className="search-caption">
            <span>{t('pos.scanHint')}</span>
            <span>{search.isFetching ? 'Searching…' : `${results.length} matches`}</span>
          </div>
          {search.error ? (
            <p className="inline-error" role="alert">
              Search is unavailable. Check the local API connection.
            </p>
          ) : null}
          {counterNotice ? (
            <p className="counter-notice" role="status">
              {counterNotice}
            </p>
          ) : null}
          <div className="medicine-list" aria-live="polite">
            {results.map((medicine, index) => {
              const expiringSoon = medicine.daysToExpiry !== null && medicine.daysToExpiry <= 90;
              return (
                <button
                  type="button"
                  className="medicine-row"
                  key={medicine.id}
                  onClick={() => addSearchResult(medicine)}
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
                    <small>Enter to add</small>
                  </span>
                </button>
              );
            })}
          </div>
          <footer className="shortcut-rail">
            <span>
              <kbd>F2</kbd> {t('pos.newSale')}
            </span>
            <span>
              <kbd>F4</kbd> {t('pos.holdCart')} {heldCart ? '•' : ''}
            </span>
            <span>
              <kbd>F6</kbd> {t('pos.reprint')}
            </span>
            <span>
              <kbd>F8</kbd> {t('pos.takePayment')}
            </span>
            <span>
              <kbd>*N</kbd> Set selected quantity
            </span>
            <span>
              <kbd>Del</kbd> Remove selected line
            </span>
          </footer>
        </section>

        <aside className="cart-pane" aria-label="Current cart">
          <div className="cart-heading">
            <div>
              <p className="eyebrow">{t('pos.currentCart')}</p>
              <h2>Counter ticket</h2>
            </div>
            <strong>{String(itemCount).padStart(2, '0')}</strong>
          </div>
          <div className="ticket-meta">
            <span>{ticketState[0]}</span>
            <span>{ticketState[1]}</span>
          </div>
          <section className="ticket-controls" aria-label="Customer and discount">
            <label>
              Customer account
              <input
                value={selectedCustomer ? selectedCustomer.name : customerQuery}
                placeholder="Phone or customer name"
                disabled={lockedDraft}
                onChange={(event) => {
                  setSelectedCustomer(null);
                  setCustomerQuery(event.target.value);
                }}
              />
            </label>
            {!selectedCustomer && customerQuery && !lockedDraft ? (
              <div className="customer-matches">
                {(customers.data ?? []).slice(0, 4).map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setCustomerQuery('');
                    }}
                  >
                    <strong>{customer.name}</strong>
                    <span>
                      {customer.phone ?? 'No phone'} · available{' '}
                      {formatPkrMoney(customer.availableCredit)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="discount-controls">
              <label>
                Invoice discount
                <input
                  value={invoiceDiscount}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={lockedDraft}
                  onChange={(event) => setInvoiceDiscount(event.target.value)}
                />
              </label>
              <label>
                Reason
                <input
                  value={discountReason}
                  disabled={lockedDraft}
                  onChange={(event) => setDiscountReason(event.target.value)}
                />
              </label>
            </div>
            {invoiceDiscount && !lockedDraft ? (
              <details className="approval-details">
                <summary>Supervisor credentials (only above policy limit)</summary>
                <input
                  value={approverUsername}
                  autoComplete="off"
                  placeholder="Supervisor username"
                  onChange={(event) => setApproverUsername(event.target.value)}
                />
                <input
                  value={approverPassword}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Supervisor password"
                  onChange={(event) => setApproverPassword(event.target.value)}
                />
              </details>
            ) : null}
          </section>
          <div className="cart-lines">
            {cart.length === 0 ? (
              <div className="empty-cart">
                <span>+</span>
                <h3>No items yet</h3>
                <p>
                  Select a medicine or scan its barcode. Stock is reserved only when payment starts.
                </p>
              </div>
            ) : (
              cart.map((line) => (
                <div
                  className={
                    selectedMedicineId === line.medicine.id ? 'cart-line selected' : 'cart-line'
                  }
                  key={line.medicine.id}
                >
                  <div>
                    <strong>{line.medicine.name}</strong>
                    <small>
                      {line.medicine.strength} · {formatPkrMoney(line.medicine.salePrice ?? '0.00')}
                    </small>
                  </div>
                  <div className="quantity-control">
                    <button
                      aria-label={`Remove one ${line.medicine.name}`}
                      disabled={lockedCart}
                      onClick={() => changeQuantity(line.medicine.id, -1)}
                    >
                      −
                    </button>
                    <input
                      aria-label={`${line.medicine.name} quantity`}
                      inputMode="numeric"
                      value={line.quantity}
                      disabled={lockedCart}
                      onFocus={() => setSelectedMedicineId(line.medicine.id)}
                      onChange={(event) =>
                        setQuantity(line.medicine.id, Number(event.target.value))
                      }
                    />
                    <button
                      aria-label={`Add one ${line.medicine.name}`}
                      disabled={lockedCart}
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
              <strong>{formatPkrMoney(invoiceDiscount || '0.00')}</strong>
            </div>
            <div className="grand-total">
              <span>Estimated total</span>
              <strong>{formatPkrMoney(attempt?.reservedTotal ?? estimatedTotal)}</strong>
            </div>
            <p>Final price and FEFO batches are confirmed by the server.</p>
          </div>
          <div className="cart-actions">
            {checkoutError ? (
              <p className="inline-error checkout-error" role="alert">
                {checkoutError}{' '}
                {attempt?.finalizedSaleId ? (
                  <button
                    className="link-button"
                    onClick={() => void recoverReceipt(attempt.finalizedSaleId!)}
                  >
                    Retry receipt
                  </button>
                ) : (
                  <Link to="/cash">Manage cash session</Link>
                )}
              </p>
            ) : null}
            {receipt ? (
              <div className="sale-complete" role="status">
                <span>Sale finalized</span>
                <strong>{receipt.invoiceNumber}</strong>
                <small>
                  {formatPkrMoney(receipt.total)} · fiscal {receipt.fiscalStatus}
                </small>
                <Link to="/returns">Return token {receipt.returnLookupToken.slice(0, 8)}…</Link>
              </div>
            ) : null}
            <button
              className="secondary-button"
              disabled={cart.length === 0 || lockedCart}
              onClick={resetSale}
            >
              Clear
            </button>
            <button
              className="primary-button"
              disabled={cart.length === 0 || checkoutPending}
              onClick={() => void beginCheckout()}
            >
              {checkoutPending
                ? 'Reserving…'
                : lockedCart
                  ? 'Resume payment'
                  : 'Reserve and take payment'}{' '}
              <span>→</span>
            </button>
          </div>
        </aside>
      </main>
    </AppShell>
  );
}
