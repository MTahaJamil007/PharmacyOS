import { useQuery } from '@tanstack/react-query';
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
  BadgePercent,
  Barcode,
  Clock,
  CreditCard,
  Minus,
  PauseCircle,
  Plus,
  ReceiptText,
  Search,
  ShoppingBasket,
  Trash2,
  Unlock,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  ApiError,
  applySaleDiscount,
  cancelSaleDraft,
  createSaleDraft,
  finalizeSale,
  getCurrentCashSession,
  getSaleReceipt,
  reserveSaleDraft,
  searchCustomers,
  searchMedicines,
  type FinalizedSale,
  type MedicineSearchResult,
} from '../../api';
import { Alert, Badge, Button, IconButton, useDismiss, useToast } from '../../components/ui';
import { daysLabel, formatMoney, formatQuantity, formatTime } from '../../format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePermissions, useSession } from '../../hooks/useSession';
import { useI18n } from '../../i18n';
import { calculateCartLineTotal, calculateCartTotal } from '../../money';
import { previewMedicines } from '../../preview-data';
import { usePharmacyStore, type CartLine } from '../../store';
import {
  cartSignature,
  clearCheckoutAttempt,
  createCheckoutAttempt,
  loadCheckoutAttempt,
  saveCheckoutAttempt,
  type CheckoutAttempt,
} from './checkout-attempt';
import { DiscountDialog, type DiscountRequest } from './DiscountDialog';
import { PaymentDialog } from './PaymentDialog';
import { ReceiptDialog } from './ReceiptDialog';
import { ReprintDialog } from './ReprintDialog';
import { WedgeScannerBuffer } from './scanner';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';

function hasStock(medicine: MedicineSearchResult): boolean {
  try {
    return Number.parseFloat(medicine.availableQuantity) > 0 && medicine.salePrice !== null;
  } catch {
    return false;
  }
}

/** Turns the server's structured shortage into a sentence that names the medicine. */
function describeCheckoutError(cause: unknown, cart: readonly CartLine[]): string {
  if (cause instanceof ApiError && typeof cause.details === 'object' && cause.details !== null) {
    const details = cause.details as Record<string, unknown>;
    if (typeof details.medicineId === 'string' && typeof details.shortage === 'string') {
      const line = cart.find((entry) => entry.medicine.id === details.medicineId);
      const name = line?.medicine.name ?? 'one medicine';
      return `Not enough stock of ${name}: short by ${formatQuantity(details.shortage)}. Reduce the quantity or remove it.`;
    }
    if (typeof details.expected === 'string') {
      return `${cause.message}: expected ${formatMoney(details.expected)}`;
    }
  }
  return cause instanceof Error ? cause.message : 'The sale could not be prepared';
}

export function PosScreen(): React.JSX.Element {
  const session = useSession();
  const can = usePermissions();
  const toast = useToast();
  const { t } = useI18n();
  const cart = usePharmacyStore((state) => state.cart);
  const heldCart = usePharmacyStore((state) => state.heldCart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const changeQuantity = usePharmacyStore((state) => state.changeQuantity);
  const setQuantity = usePharmacyStore((state) => state.setQuantity);
  const removeMedicine = usePharmacyStore((state) => state.removeMedicine);
  const clearCart = usePharmacyStore((state) => state.clearCart);
  const holdOrResumeCart = usePharmacyStore((state) => state.holdOrResumeCart);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(
    cart.at(-1)?.medicine.id ?? null,
  );
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [lastSale, setLastSale] = useState<FinalizedSale | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const [paymentTotal, setPaymentTotal] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<DiscountRequest | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(() =>
    session ? loadCheckoutAttempt(session.user.terminalId, cart) : null,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const scanner = useRef(new WedgeScannerBuffer());
  const debouncedQuery = useDebouncedValue(query.trim(), 150);

  const search = useQuery({
    queryKey: ['medicine-search', debouncedQuery],
    queryFn: () => searchMedicines(debouncedQuery),
    enabled: !previewMode && Boolean(session) && debouncedQuery.length > 0,
    staleTime: 5_000,
  });
  const results = useMemo(
    () =>
      previewMode
        ? previewMedicines.filter((medicine) =>
            `${medicine.name} ${medicine.genericName ?? ''} ${medicine.barcode ?? ''}`
              .toLowerCase()
              .includes(debouncedQuery.toLowerCase()),
          )
        : (search.data ?? []),
    [debouncedQuery, search.data],
  );
  const safeActiveIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const subtotal = useMemo(
    () =>
      calculateCartTotal(
        cart.map((line) => ({ quantity: line.quantity, unitPrice: line.medicine.salePrice })),
      ),
    [cart],
  );
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const lockedCart = Boolean(attempt?.reservedTotal || attempt?.finalizedSaleId);
  // A draft only locks the customer and discount while it still describes this cart; once
  // the cart is edited the next checkout starts a fresh attempt.
  const lockedDraft = Boolean(attempt?.draftId && attempt.cartSignature === cartSignature(cart));
  const customerId = attempt?.customerId ?? selectedCustomer?.id;
  const customerName = attempt?.customerName ?? selectedCustomer?.name;
  const canUseCredit = Boolean(customerId) && can(PERMISSIONS.CUSTOMER_CREDIT);
  const discountAmount = attempt?.discountAmount ?? discount?.amount ?? null;
  const estimatedTotal = useMemo(() => {
    if (!discountAmount) return subtotal;
    try {
      const value = moneyToMinorUnits(subtotal) - moneyToMinorUnits(discountAmount);
      return value >= 0n ? minorUnitsToMoney(value) : subtotal;
    } catch {
      return subtotal;
    }
  }, [discountAmount, subtotal]);

  const updateAttempt = useCallback((next: CheckoutAttempt | null): void => {
    setAttempt(next);
    if (next) saveCheckoutAttempt(next);
  }, []);

  const focusSearch = useCallback(() => {
    window.setTimeout(() => searchInput.current?.focus(), 0);
  }, []);

  const recoverReceipt = useCallback(
    async (saleId: string): Promise<void> => {
      if (!session) return;
      try {
        const recovered = await getSaleReceipt(saleId);
        setPrintReceipt(recovered);
        clearCheckoutAttempt(session.user.terminalId);
        setAttempt(null);
        setCheckoutError('');
      } catch {
        setCheckoutError(
          'The sale is complete, but its receipt could not be loaded. Use “Retry receipt” or Find receipt (F6). Do not charge the customer again.',
        );
      }
    },
    [session],
  );

  useEffect(() => {
    const finalizedSaleId = attempt?.finalizedSaleId;
    if (!finalizedSaleId) return;
    const timer = window.setTimeout(() => void recoverReceipt(finalizedSaleId), 0);
    return () => window.clearTimeout(timer);
  }, [attempt?.finalizedSaleId, recoverReceipt]);

  const addSearchResult = useCallback(
    (medicine: MedicineSearchResult, quantity = 1): void => {
      if (lockedCart) {
        toast.info('Release the reserved sale before changing it');
        return;
      }
      if (!hasStock(medicine)) {
        toast.error(
          `${medicine.name} is out of stock`,
          'Nothing sellable is on hand at this branch.',
        );
        return;
      }
      addMedicine(medicine, quantity);
      setSelectedMedicineId(medicine.id);
      setQuery('');
      setActiveIndex(0);
    },
    [addMedicine, lockedCart, toast],
  );

  const addBarcode = useCallback(
    async (barcode: string): Promise<void> => {
      setCheckoutError('');
      try {
        const matches = previewMode
          ? previewMedicines.filter((medicine) => medicine.barcode === barcode)
          : await searchMedicines(barcode, 5);
        const exact = matches.find((medicine) => medicine.barcode === barcode);
        if (!exact) {
          toast.error(
            'Barcode not found',
            `${barcode} does not match any medicine in the catalog.`,
          );
          return;
        }
        addSearchResult(exact);
      } catch (cause) {
        toast.error('Barcode lookup failed', cause);
      }
    },
    [addSearchResult, toast],
  );

  const resetSale = useCallback((): void => {
    if (lockedCart) {
      toast.info('Finish or release the reserved sale first');
      return;
    }
    if (session) clearCheckoutAttempt(session.user.terminalId);
    clearCart();
    setAttempt(null);
    setPaymentTotal(null);
    setCheckoutError('');
    setSelectedCustomer(null);
    setDiscount(null);
    setQuery('');
    focusSearch();
  }, [clearCart, focusSearch, lockedCart, session, toast]);

  const releaseReservation = useCallback(async (): Promise<void> => {
    if (!session || !attempt?.draftId || attempt.finalizedSaleId) return;
    setCheckoutPending(true);
    try {
      await cancelSaleDraft(attempt.draftId);
      clearCheckoutAttempt(session.user.terminalId);
      setAttempt(null);
      setPaymentTotal(null);
      setCheckoutError('');
      toast.info('Reserved stock released', 'You can change the sale now.');
    } catch (cause) {
      toast.error('Could not release the sale', cause);
    } finally {
      setCheckoutPending(false);
    }
  }, [attempt, session, toast]);

  const toggleHeldCart = useCallback((): void => {
    if (lockedCart) {
      toast.info('A reserved sale cannot be held');
      return;
    }
    const outcome = holdOrResumeCart();
    if (outcome === 'HELD') {
      setSelectedCustomer(null);
      setDiscount(null);
      toast.info('Sale put on hold', 'Press F4 again to bring it back.');
    } else if (outcome === 'RESUMED') {
      toast.info('Held sale resumed');
    } else {
      toast.info('Finish or clear the current sale before resuming the held one');
    }
  }, [holdOrResumeCart, lockedCart, toast]);

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
        current = {
          ...createCheckoutAttempt(session.user.terminalId, cart),
          ...(selectedCustomer
            ? { customerId: selectedCustomer.id, customerName: selectedCustomer.name }
            : {}),
          ...(discount ? { discountAmount: discount.amount } : {}),
        };
        updateAttempt(current);
      }
      if (!current.cashSessionId) {
        const cashSession = await getCurrentCashSession();
        if (!cashSession || cashSession.status !== 'OPEN') {
          throw new Error('Open the cash drawer for this terminal before taking payment.');
        }
        current = { ...current, cashSessionId: cashSession.id };
        updateAttempt(current);
      }
      if (!current.draftId) {
        const draft = await createSaleDraft(
          session.user.terminalId,
          cart.map((line) => ({
            medicineId: line.medicine.id,
            quantity: line.quantity.toString(),
          })),
        );
        current = { ...current, draftId: draft.id };
        updateAttempt(current);
      }
      const requestedDiscount = current.discountAmount ?? discount?.amount;
      if (
        requestedDiscount &&
        moneyToMinorUnits(requestedDiscount) > 0n &&
        !current.discountApplied
      ) {
        if (!current.discountRequestId) {
          current = {
            ...current,
            discountAmount: requestedDiscount,
            discountRequestId: createClientRequestId(),
          };
          updateAttempt(current);
        }
        const draftId = current.draftId;
        const discountRequestId = current.discountRequestId;
        if (!draftId || !discountRequestId) throw new Error('The discount could not be resumed');
        try {
          const discounted = await applySaleDiscount(draftId, {
            invoiceDiscount: requestedDiscount,
            reason: discount?.reason ?? 'Counter discount',
            clientRequestId: discountRequestId,
            ...(discount?.approverUsername && discount.approverPassword
              ? {
                  approverUsername: discount.approverUsername,
                  approverPassword: discount.approverPassword,
                }
              : {}),
          });
          current = { ...current, discountApplied: true };
          updateAttempt(current);
          setDiscount((value) => (value ? { ...value, approverPassword: '' } : value));
          if (discounted.approvalLevel === 'OVERRIDE')
            toast.success('Discount approved by supervisor');
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 403) {
            setDiscountOpen(true);
            throw new Error(
              'This discount is above your limit. Ask a supervisor to enter their username and password in the discount window.',
              { cause },
            );
          }
          throw cause;
        }
      }
      const reservationExpired =
        current.reservedUntil !== undefined && new Date(current.reservedUntil) <= new Date();
      if (!current.reservedTotal || reservationExpired) {
        const draftId = current.draftId;
        if (!draftId) throw new Error('The sale draft could not be resumed');
        const reservation = await reserveSaleDraft(draftId);
        current = {
          ...current,
          reservedTotal: reservation.total,
          reservedUntil: reservation.reservedUntil,
        };
        updateAttempt(current);
      }
      if (!current.reservedTotal) throw new Error('The reserved total is unavailable');
      setPaymentTotal(current.reservedTotal);
    } catch (cause) {
      setCheckoutError(describeCheckoutError(cause, cart));
    } finally {
      setCheckoutPending(false);
    }
  }, [
    attempt,
    cart,
    checkoutPending,
    discount,
    recoverReceipt,
    selectedCustomer,
    session,
    toast,
    updateAttempt,
  ]);

  const completePayment = useCallback(
    async (payments: readonly SalePaymentInput[]): Promise<void> => {
      if (!session || !attempt?.cashSessionId || !attempt.draftId) return;
      setCheckoutPending(true);
      setCheckoutError('');
      try {
        const finalized = await finalizeSale({
          cashSessionId: attempt.cashSessionId,
          clientRequestId: attempt.clientRequestId,
          draftId: attempt.draftId,
          payments,
          ...(attempt.customerId ? { customerId: attempt.customerId } : {}),
        });
        updateAttempt({ ...attempt, finalizedSaleId: finalized.id });
        setLastSale(finalized);
        setPaymentTotal(null);
        clearCart();
        setSelectedCustomer(null);
        setDiscount(null);
        await recoverReceipt(finalized.id);
      } catch (cause) {
        setCheckoutError(describeCheckoutError(cause, cart));
        throw cause;
      } finally {
        setCheckoutPending(false);
      }
    },
    [attempt, cart, clearCart, recoverReceipt, session, updateAttempt],
  );

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  const overlayOpen = Boolean(paymentTotal || reprintOpen || printReceipt || discountOpen);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!overlayOpen) {
        const barcode = scanner.current.push(event.key, event.timeStamp);
        if (barcode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void addBarcode(barcode);
          return;
        }
      }
      if (overlayOpen) return;
      const typing =
        event.target instanceof HTMLInputElement && event.target !== searchInput.current;
      if (event.key === 'F2') {
        event.preventDefault();
        resetSale();
      } else if (event.key === 'F4') {
        event.preventDefault();
        toggleHeldCart();
      } else if (event.key === 'F6') {
        event.preventDefault();
        setReprintOpen(true);
      } else if (event.key === 'F7') {
        event.preventDefault();
        if (!lockedDraft && cart.length > 0 && can(PERMISSIONS.SALE_DISCOUNT_BASIC))
          setDiscountOpen(true);
      } else if (event.key === 'F8') {
        event.preventDefault();
        void beginCheckout();
      } else if (event.key === 'Delete' && selectedMedicineId && !lockedCart && !typing) {
        event.preventDefault();
        removeMedicine(selectedMedicineId);
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
    can,
    cart.length,
    lockedCart,
    lockedDraft,
    overlayOpen,
    removeMedicine,
    resetSale,
    selectedMedicineId,
    toggleHeldCart,
  ]);

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Escape') {
      setQuery('');
      setActiveIndex(0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const multiplier = /^\*(\d{1,4})$/.exec(query.trim());
      if (multiplier && selectedMedicineId) {
        if (!lockedCart) setQuantity(selectedMedicineId, Number(multiplier[1]));
        setQuery('');
        return;
      }
      const chosen = results[safeActiveIndex];
      if (chosen) addSearchResult(chosen);
    }
  };

  const reservedUntil = attempt?.reservedUntil ? formatTime(attempt.reservedUntil) : null;

  return (
    <div className="pos">
      {printReceipt ? (
        <ReceiptDialog
          key={printReceipt.sale.id}
          receipt={printReceipt}
          onClose={() => {
            setPrintReceipt(null);
            focusSearch();
          }}
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
          {...(selectedCustomer ? { availableCredit: selectedCustomer.availableCredit } : {})}
        />
      ) : null}
      {reprintOpen ? (
        <ReprintDialog
          onClose={() => setReprintOpen(false)}
          onReceipt={(value) => {
            setReprintOpen(false);
            setPrintReceipt(value);
          }}
        />
      ) : null}
      {discountOpen ? (
        <DiscountDialog
          subtotal={subtotal}
          initial={discount}
          onClose={() => setDiscountOpen(false)}
          onApply={(value) => {
            setDiscount(value);
            setDiscountOpen(false);
          }}
        />
      ) : null}

      <section className="pos-catalog" aria-label={t('pos.findMedicine')}>
        <div className="pos-search">
          <Search aria-hidden />
          <input
            ref={searchInput}
            className="input"
            aria-label={t('pos.findMedicine')}
            placeholder={t('pos.searchPlaceholder')}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={searchKeyDown}
          />
          <span className="search-meta">
            {search.isFetching
              ? 'Searching…'
              : debouncedQuery
                ? `${String(results.length)} found`
                : null}
            <kbd>/</kbd>
          </span>
        </div>
        {search.error ? (
          <div style={{ marginBlockStart: 10 }}>
            <Alert tone="danger">
              Search is unavailable. Check the connection to the shop server.
            </Alert>
          </div>
        ) : null}
        <div className="pos-results" role="listbox" aria-label="Search results">
          {debouncedQuery.length === 0 ? (
            <div className="cart-empty">
              <Barcode aria-hidden />
              <strong>Scan a barcode or type a medicine name</strong>
              <span>
                Use ↑ ↓ to choose and Enter to add. Type <kbd>*</kbd> and a number, then Enter, to
                set the quantity of the selected line.
              </span>
              {heldCart ? (
                <Badge tone="warning">
                  A sale is on hold since {formatTime(heldCart.heldAt)} · press F4 to resume
                </Badge>
              ) : null}
            </div>
          ) : results.length === 0 && !search.isFetching ? (
            <div className="cart-empty">
              <Search aria-hidden />
              <strong>No medicine matches “{debouncedQuery}”</strong>
              <span>Try the generic name, part of the brand name, or the company.</span>
            </div>
          ) : (
            results.map((medicine, index) => {
              const available = hasStock(medicine);
              const expiringSoon = medicine.daysToExpiry !== null && medicine.daysToExpiry <= 90;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === safeActiveIndex}
                  className={[
                    'result-row',
                    index === safeActiveIndex ? 'active' : '',
                    available ? '' : 'unavailable',
                  ].join(' ')}
                  key={medicine.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => addSearchResult(medicine)}
                >
                  <span className="result-name">
                    <strong>{medicine.name}</strong>
                    {medicine.strength ? <em>{medicine.strength}</em> : null}
                    <small>
                      {[medicine.genericName, medicine.manufacturer].filter(Boolean).join(' · ') ||
                        'No generic recorded'}
                    </small>
                  </span>
                  <span className="result-meta result-shelf">
                    <small>Shelf</small>
                    {medicine.shelf ?? '—'}
                  </span>
                  <span className="result-meta">
                    <small>{available ? 'In stock' : 'Stock'}</small>
                    {available ? (
                      <>
                        {formatQuantity(medicine.availableQuantity)}{' '}
                        {expiringSoon ? (
                          <Badge
                            tone={
                              medicine.daysToExpiry !== null && medicine.daysToExpiry <= 30
                                ? 'danger'
                                : 'warning'
                            }
                          >
                            {daysLabel(medicine.daysToExpiry)}
                          </Badge>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="danger">Out of stock</Badge>
                    )}
                  </span>
                  <span className="result-price">{formatMoney(medicine.salePrice)}</span>
                </button>
              );
            })
          )}
        </div>
        <footer className="pos-shortcuts" aria-label="Keyboard shortcuts">
          <span>
            <kbd>F2</kbd> {t('pos.newSale')}
          </span>
          <span>
            <kbd>F4</kbd> {t('pos.holdCart')}
          </span>
          <span>
            <kbd>F6</kbd> {t('pos.reprint')}
          </span>
          <span>
            <kbd>F7</kbd> {t('pos.discount')}
          </span>
          <span>
            <kbd>F8</kbd> {t('pos.takePayment')}
          </span>
          <span>
            <kbd>Del</kbd> Remove line
          </span>
        </footer>
      </section>

      <aside className="pos-cart" aria-label={t('pos.currentCart')}>
        <header className="cart-header">
          <div>
            <h2>{t('pos.currentCart')}</h2>
            <span className="muted">
              {cart.length} {cart.length === 1 ? 'line' : 'lines'} · {itemCount} units
            </span>
          </div>
          <div className="row">
            <IconButton
              label="Hold or resume sale (F4)"
              icon={PauseCircle}
              onClick={toggleHeldCart}
            />
            <IconButton
              label="Find and reprint a receipt (F6)"
              icon={ReceiptText}
              onClick={() => setReprintOpen(true)}
            />
          </div>
        </header>

        <div className="cart-customer">
          <CustomerPicker
            disabled={lockedDraft}
            selected={
              selectedCustomer ??
              (attempt?.customerId && attempt.customerName
                ? ({ id: attempt.customerId, name: attempt.customerName } as CustomerSummary)
                : null)
            }
            onSelect={setSelectedCustomer}
          />
        </div>

        {lockedCart && !attempt?.finalizedSaleId ? (
          <div className="reservation-banner" role="status">
            <Clock aria-hidden /> Stock reserved{reservedUntil ? ` until ${reservedUntil}` : ''}.
            Take payment or release it to make changes.
          </div>
        ) : null}

        <div className="cart-lines">
          {cart.length === 0 ? (
            <div className="cart-empty">
              <ShoppingBasket aria-hidden />
              <strong>No items yet</strong>
              <span>Search or scan on the left. Stock is reserved only when you take payment.</span>
              {lastSale ? (
                <Badge tone="success">
                  Last sale {lastSale.invoiceNumber} · {formatMoney(lastSale.total)}
                </Badge>
              ) : null}
            </div>
          ) : (
            cart.map((line) => (
              <div
                key={line.medicine.id}
                className={
                  selectedMedicineId === line.medicine.id ? 'cart-line selected' : 'cart-line'
                }
              >
                <div className="cart-line-name">
                  <strong title={line.medicine.name}>
                    {line.medicine.name} {line.medicine.strength ?? ''}
                  </strong>
                  <span>
                    {formatMoney(line.medicine.salePrice)} each
                    {line.medicine.shelf ? ` · shelf ${line.medicine.shelf}` : ''}
                  </span>
                </div>
                <div className="cart-line-total">
                  {formatMoney(
                    calculateCartLineTotal({
                      quantity: line.quantity,
                      unitPrice: line.medicine.salePrice,
                    }),
                  )}
                </div>
                <div className="cart-line-controls">
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={`One less ${line.medicine.name}`}
                      disabled={lockedCart || line.quantity <= 1}
                      onClick={() => changeQuantity(line.medicine.id, -1)}
                    >
                      <Minus aria-hidden />
                    </button>
                    <input
                      aria-label={`${line.medicine.name} quantity`}
                      inputMode="numeric"
                      value={line.quantity}
                      disabled={lockedCart}
                      onFocus={(event) => {
                        setSelectedMedicineId(line.medicine.id);
                        event.target.select();
                      }}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isSafeInteger(value) && value > 0)
                          setQuantity(line.medicine.id, value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') searchInput.current?.focus();
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`One more ${line.medicine.name}`}
                      disabled={lockedCart}
                      onClick={() => changeQuantity(line.medicine.id, 1)}
                    >
                      <Plus aria-hidden />
                    </button>
                  </div>
                  <IconButton
                    label={`Remove ${line.medicine.name}`}
                    icon={Trash2}
                    disabled={lockedCart}
                    onClick={() => removeMedicine(line.medicine.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cart-summary">
          <div className="summary-line">
            <span>Subtotal</span>
            <strong>{formatMoney(subtotal)}</strong>
          </div>
          <div className="summary-line">
            <span>
              Discount
              {discount?.reason && discountAmount ? (
                <span className="muted"> · {discount.reason}</span>
              ) : null}
            </span>
            <strong>
              {discountAmount ? `− ${formatMoney(discountAmount)}` : formatMoney('0')}
            </strong>
          </div>
          <div className="summary-total">
            <span>Total</span>
            <strong>{formatMoney(attempt?.reservedTotal ?? estimatedTotal)}</strong>
          </div>
        </div>

        {checkoutError ? (
          <div style={{ padding: '10px 16px 0', background: 'var(--surface-muted)' }}>
            <Alert
              tone="danger"
              actions={
                attempt?.finalizedSaleId ? (
                  <Button size="sm" onClick={() => void recoverReceipt(attempt.finalizedSaleId!)}>
                    Retry receipt
                  </Button>
                ) : /cash drawer/i.test(checkoutError) ? (
                  <Link className="btn btn-sm btn-secondary" to="/cash">
                    Open drawer
                  </Link>
                ) : null
              }
            >
              {checkoutError}
            </Alert>
          </div>
        ) : null}

        <div className="cart-actions">
          {lockedCart && !attempt?.finalizedSaleId ? (
            <Button
              icon={Unlock}
              disabled={checkoutPending}
              onClick={() => void releaseReservation()}
            >
              Release
            </Button>
          ) : (
            <Button
              icon={X}
              disabled={cart.length === 0 || checkoutPending}
              onClick={resetSale}
              title="Clear sale (F2)"
            >
              Clear
            </Button>
          )}
          <Button
            icon={BadgePercent}
            disabled={lockedDraft || cart.length === 0 || !can(PERMISSIONS.SALE_DISCOUNT_BASIC)}
            onClick={() => setDiscountOpen(true)}
            title="Discount (F7)"
          >
            {t('pos.discount')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={CreditCard}
            loading={checkoutPending}
            disabled={cart.length === 0}
            onClick={() => void beginCheckout()}
            shortcut="F8"
          >
            {lockedCart ? 'Resume payment' : t('pos.takePayment')}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function CustomerPicker({
  selected,
  onSelect,
  disabled,
}: {
  readonly selected: CustomerSummary | null;
  readonly onSelect: (customer: CustomerSummary | null) => void;
  readonly disabled: boolean;
}) {
  const can = usePermissions();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(text.trim(), 200);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(container, open, close);
  const allowed = can(PERMISSIONS.CUSTOMER_READ);
  const customers = useQuery({
    queryKey: ['customer-search', debounced],
    queryFn: () => searchCustomers(debounced, 8),
    enabled: allowed && open && debounced.length > 0,
  });
  if (!allowed) return null;
  if (selected) {
    return (
      <div className="customer-chip">
        <UserRound aria-hidden width={18} height={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{selected.name}</strong>
          {selected.balance !== undefined ? (
            <span>
              Owes {formatMoney(selected.balance)} · credit left{' '}
              {formatMoney(selected.availableCredit)}
            </span>
          ) : (
            <span>Customer attached to this sale</span>
          )}
        </div>
        {!disabled ? (
          <IconButton label="Remove customer" icon={X} onClick={() => onSelect(null)} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="customer-picker" ref={container}>
      <div className="input-group">
        <UserRound aria-hidden />
        <input
          className="input"
          aria-label="Customer (optional)"
          placeholder="Customer phone or name (optional)"
          value={text}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && debounced ? (
        <div className="customer-results">
          {(customers.data ?? []).map((customer) => (
            <button
              type="button"
              key={customer.id}
              disabled={!customer.isActive}
              onClick={() => {
                onSelect(customer);
                setText('');
                setOpen(false);
              }}
            >
              <span>
                <strong>{customer.name}</strong>
                <span className="cell-sub">{customer.phone ?? 'No phone'}</span>
              </span>
              <span className="num">
                <span className="cell-sub">Owes</span>
                {formatMoney(customer.balance)}
              </span>
            </button>
          ))}
          {customers.data?.length === 0 ? (
            <div className="empty-state" style={{ padding: 14 }}>
              No customer matches. Add them under Customers.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
