import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createClientRequestId,
  decimalToScaledInteger,
  PERMISSIONS,
  type CustomerSummary,
  type SalePaymentInput,
  type SaleReceipt,
} from '@pharmacy/shared';

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
} from './api';
import { AppShell } from './components/AppShell';
import { useClock } from './hooks/useClock';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useI18n } from './i18n';
import { formatPkrMoney } from './money';
import { previewMedicines } from './preview-data';
import { usePharmacyStore, type CartLine } from './store';
import type { RegimenEntry } from './modules/pos/budget-plan';
import { BudgetPlanDialog } from './modules/pos/BudgetPlanner';
import {
  cartSignature,
  clearCheckoutAttempt,
  createCheckoutAttempt,
  loadCheckoutAttempt,
  saveCheckoutAttempt,
  withCustomer,
  type CheckoutAttempt,
} from './modules/pos/checkout-attempt';
import {
  buildDiscountPlan,
  describeDiscountSpec,
  discountRequestBody,
  discountSignature,
} from './modules/pos/discount';
import { DiscountDialog, type SupervisorApproval } from './modules/pos/DiscountDialog';
import { PaymentDialog } from './modules/pos/PaymentDialog';
import { ReceiptDialog } from './modules/pos/ReceiptDialog';
import { ReprintDialog } from './modules/pos/ReprintDialog';
import { WedgeScannerBuffer } from './modules/pos/scanner';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
const NO_APPROVAL: SupervisorApproval = { username: '', password: '' };

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

function wholeUnits(quantity: string): string {
  return quantity.replace(/\.0+$/, '');
}

function isSellable(medicine: MedicineSearchResult): boolean {
  try {
    return (
      medicine.salePrice !== null && decimalToScaledInteger(medicine.availableQuantity, 3) > 0n
    );
  } catch {
    return false;
  }
}

function exceedsStock(line: CartLine): boolean {
  try {
    return (
      BigInt(line.quantity) * 1000n > decimalToScaledInteger(line.medicine.availableQuantity, 3)
    );
  } catch {
    return false;
  }
}

function QuantityField({
  line,
  disabled,
  onCommit,
}: {
  readonly line: CartLine;
  readonly disabled: boolean;
  readonly onCommit: (quantity: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={`${line.medicine.name} quantity`}
      inputMode="numeric"
      value={text ?? String(line.quantity)}
      disabled={disabled}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
        setText(digits);
        const quantity = Number(digits);
        if (digits && quantity >= 1) onCommit(quantity);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          setText(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function PosWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const discounts = usePharmacyStore((state) => state.discounts);
  const heldCart = usePharmacyStore((state) => state.heldCart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const changeQuantity = usePharmacyStore((state) => state.changeQuantity);
  const setQuantity = usePharmacyStore((state) => state.setQuantity);
  const applyQuantities = usePharmacyStore((state) => state.applyQuantities);
  const removeMedicine = usePharmacyStore((state) => state.removeMedicine);
  const removeMedicines = usePharmacyStore((state) => state.removeMedicines);
  const setDiscounts = usePharmacyStore((state) => state.setDiscounts);
  const clearCart = usePharmacyStore((state) => state.clearCart);
  const holdOrResumeCart = usePharmacyStore((state) => state.holdOrResumeCart);
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState({ query: '', index: 0 });
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(
    cart[0]?.medicine.id ?? null,
  );
  const [tickedIds, setTickedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [checkoutError, setCheckoutError] = useState('');
  const [counterNotice, setCounterNotice] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [receipt, setReceipt] = useState<FinalizedSale | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const [paymentTotal, setPaymentTotal] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [approval, setApproval] = useState<SupervisorApproval>(NO_APPROVAL);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [regimen, setRegimen] = useState<Record<string, RegimenEntry>>({});
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(() =>
    session ? loadCheckoutAttempt(session.user.terminalId, cart) : null,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const tickAll = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const scanner = useRef(new WedgeScannerBuffer());
  const debouncedQuery = useDebouncedValue(query.trim(), 180);
  const debouncedCustomerQuery = useDebouncedValue(customerQuery.trim(), 180);
  const now = useClock(session?.user.branchTimezone);
  const clock = clockLabel(now, session?.user.branchTimezone);
  const permissions = session?.user.permissions ?? [];
  const canDiscount = previewMode || permissions.includes(PERMISSIONS.SALE_DISCOUNT_BASIC);
  const canBudget = previewMode || permissions.includes(PERMISSIONS.SALES_BUDGET_REGIMEN_CALCULATE);

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
  const activeIndex =
    active.query === debouncedQuery ? Math.min(active.index, Math.max(results.length - 1, 0)) : 0;
  const customers = useQuery({
    queryKey: ['customer-search', debouncedCustomerQuery],
    queryFn: () => searchCustomers(session?.accessToken ?? '', debouncedCustomerQuery),
    enabled:
      !previewMode &&
      Boolean(session) &&
      debouncedCustomerQuery.length > 0 &&
      permissions.includes(PERMISSIONS.CUSTOMER_READ),
  });

  const plan = useMemo(() => buildDiscountPlan(cart, discounts), [cart, discounts]);
  const planById = useMemo(
    () => new Map(plan.lines.map((line) => [line.medicineId, line])),
    [plan.lines],
  );
  const tickedLines = cart.filter((line) => tickedIds.has(line.medicine.id));
  const targetLines = tickedLines.length > 0 ? tickedLines : cart;
  const targetIds = targetLines.map((line) => line.medicine.id);
  const unitCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const lockedCart = Boolean(attempt?.reservedTotal || attempt?.finalizedSaleId);
  const customerId = attempt?.customerId ?? selectedCustomer?.id;
  const customerName = attempt?.customerName ?? selectedCustomer?.name;
  const canUseCredit =
    Boolean(customerId) && (previewMode || permissions.includes(PERMISSIONS.CUSTOMER_CREDIT));
  const modalOpen = Boolean(
    paymentTotal || reprintOpen || printReceipt || discountOpen || budgetOpen,
  );

  useEffect(() => {
    if (!tickAll.current) return;
    tickAll.current.indeterminate = tickedLines.length > 0 && tickedLines.length < cart.length;
  }, [cart.length, tickedLines.length]);

  useEffect(() => {
    resultList.current
      ?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const updateAttempt = useCallback((next: CheckoutAttempt | null): void => {
    setAttempt(next);
    if (next) saveCheckoutAttempt(next);
  }, []);

  /** Best effort: an abandoned draft holds no stock, but cancelling keeps the audit trail honest. */
  const abandonDraft = useCallback(
    (draftId: string): void => {
      if (!session) return;
      void cancelSaleDraft(session.accessToken, draftId).catch(() => undefined);
    },
    [session],
  );

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
      if (lockedCart) {
        setCounterNotice('Release the reservation before changing this ticket');
        return;
      }
      if (!isSellable(medicine)) {
        setCheckoutError(`${medicine.name} has no sellable stock or price at this branch`);
        return;
      }
      setCheckoutError('');
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
      setCounterNotice('Release the reservation or complete the sale before starting a new one');
      return;
    }
    if (attempt?.draftId) abandonDraft(attempt.draftId);
    if (session) clearCheckoutAttempt(session.user.terminalId);
    clearCart();
    setAttempt(null);
    setPaymentTotal(null);
    setReceipt(null);
    setCheckoutError('');
    setCounterNotice('New sale ready');
    setSelectedCustomer(null);
    setCustomerQuery('');
    setTickedIds(new Set());
    setApproval(NO_APPROVAL);
    setApprovalRequired(false);
    setQuery('');
    searchInput.current?.focus();
  }, [abandonDraft, attempt, clearCart, lockedCart, session]);

  const toggleHeldCart = useCallback((): void => {
    if (lockedCart) {
      setCounterNotice('A reserved sale cannot be held');
      return;
    }
    if (attempt?.draftId) abandonDraft(attempt.draftId);
    if (session) clearCheckoutAttempt(session.user.terminalId);
    setAttempt(null);
    const outcome = holdOrResumeCart();
    if (outcome !== 'UNCHANGED') setTickedIds(new Set());
    setCounterNotice(
      outcome === 'HELD'
        ? 'Cart held on this terminal'
        : outcome === 'RESUMED'
          ? 'Held cart resumed'
          : 'Finish or clear the current cart first',
    );
  }, [abandonDraft, attempt, holdOrResumeCart, lockedCart, session]);

  const releaseReservation = useCallback(async (): Promise<void> => {
    if (!session || !attempt?.draftId || attempt.finalizedSaleId || checkoutPending) return;
    setCheckoutPending(true);
    setCheckoutError('');
    try {
      await cancelSaleDraft(session.accessToken, attempt.draftId);
      clearCheckoutAttempt(session.user.terminalId);
      setAttempt(null);
      setPaymentTotal(null);
      setCounterNotice('Reservation released. The ticket can be edited.');
    } catch (cause) {
      setCheckoutError(
        `${cause instanceof Error ? cause.message : 'Reservation could not be released'}. If payment was already taken, use Receipt search (F6); do not charge again.`,
      );
    } finally {
      setCheckoutPending(false);
    }
  }, [attempt, checkoutPending, session]);

  const openDiscount = useCallback((): void => {
    if (cart.length === 0 || lockedCart || !canDiscount) return;
    setDiscountOpen(true);
  }, [canDiscount, cart.length, lockedCart]);

  const openBudget = useCallback((): void => {
    if (cart.length === 0 || lockedCart || !canBudget) return;
    setBudgetOpen(true);
  }, [canBudget, cart.length, lockedCart]);

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
      if (plan.errors.length > 0) {
        setDiscountOpen(true);
        throw new Error(plan.errors[0]);
      }
      const reason = discounts.reason.trim();
      const signature = discountSignature(plan, reason);
      const customer = customerId && customerName ? { id: customerId, name: customerName } : null;
      // The server cannot set a discount back to zero, so dropping an applied one needs a new draft.
      const discountRemoved =
        Boolean(current?.draftId) &&
        !current?.reservedTotal &&
        Boolean(current?.discountAppliedSignature) &&
        signature === '';
      if (!current || current.cartSignature !== cartSignature(cart) || discountRemoved) {
        if (current?.draftId && !current.reservedTotal) abandonDraft(current.draftId);
        const cashSessionId = current?.cashSessionId;
        current = createCheckoutAttempt(session.user.terminalId, cart);
        if (cashSessionId) current = { ...current, cashSessionId };
      }
      current = withCustomer(current, customer);
      updateAttempt(current);
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
      if (signature && current.discountAppliedSignature !== signature && !current.reservedTotal) {
        if (!current.discountRequestId || current.discountRequestSignature !== signature) {
          current = {
            ...current,
            discountRequestSignature: signature,
            discountRequestId: createClientRequestId(),
          };
          updateAttempt(current);
        }
        const { discountRequestId, draftId } = current;
        if (!discountRequestId || !draftId)
          throw new Error('Discount request could not be resumed');
        try {
          const discounted = await applySaleDiscount(session.accessToken, draftId, {
            ...discountRequestBody(plan),
            reason,
            clientRequestId: discountRequestId,
            ...(approval.username.trim() && approval.password
              ? { approverUsername: approval.username.trim(), approverPassword: approval.password }
              : {}),
          });
          setCounterNotice(
            discounted.approvalLevel === 'OVERRIDE'
              ? 'Discount approved by supervisor'
              : 'Discount approved',
          );
        } catch (cause) {
          if (
            cause instanceof ApiError &&
            cause.status === 403 &&
            /supervisor/i.test(cause.message)
          ) {
            setApprovalRequired(true);
            setDiscountOpen(true);
          }
          throw cause;
        }
        current = { ...current, discountAppliedSignature: signature };
        updateAttempt(current);
        setApproval(NO_APPROVAL);
        setApprovalRequired(false);
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
        if (reservation.total !== plan.total) {
          setCounterNotice(
            `Server total ${formatPkrMoney(reservation.total)} differs from the screen estimate; current batch prices apply`,
          );
        }
      }
      if (!current.reservedTotal) throw new Error('Sale reservation total is unavailable');
      setPaymentTotal(current.reservedTotal);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'Sale reservation failed');
    } finally {
      setCheckoutPending(false);
    }
  }, [
    abandonDraft,
    approval,
    attempt,
    cart,
    checkoutPending,
    customerId,
    customerName,
    discounts.reason,
    plan,
    recoverReceipt,
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
        setTickedIds(new Set());
        setSelectedCustomer(null);
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
      if (event.altKey || event.ctrlKey || event.metaKey || modalOpen) return;
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
      } else if (event.key === 'F3') {
        event.preventDefault();
        openBudget();
      } else if (event.key === 'F4') {
        event.preventDefault();
        toggleHeldCart();
      } else if (event.key === 'F6') {
        event.preventDefault();
        setReprintOpen(true);
      } else if (event.key === 'F8') {
        event.preventDefault();
        void beginCheckout();
      } else if (event.key === 'F9') {
        event.preventDefault();
        openDiscount();
      } else if (
        event.key === 'Delete' &&
        selectedMedicineId &&
        !lockedCart &&
        !(event.target instanceof HTMLInputElement && event.target.type !== 'checkbox')
      ) {
        event.preventDefault();
        removeMedicine(selectedMedicineId);
      } else if (event.key === 'Escape') {
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
    modalOpen,
    openBudget,
    openDiscount,
    removeMedicine,
    resetSale,
    selectedMedicineId,
    toggleHeldCart,
  ]);

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive({
        query: debouncedQuery,
        index: (activeIndex + step + results.length) % results.length,
      });
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const multiplier = /^\*(\d{1,4})$/.exec(query.trim());
    if (multiplier) {
      if (selectedMedicineId && !lockedCart) setQuantity(selectedMedicineId, Number(multiplier[1]));
      setQuery('');
      return;
    }
    if (query.trim() !== debouncedQuery || search.isFetching) {
      setCounterNotice('Still searching — press Enter again when results appear');
      return;
    }
    const chosen = results[activeIndex];
    if (chosen) {
      addSearchResult(chosen);
      setQuery('');
    }
  };

  const toggleTicked = (medicineId: string): void =>
    setTickedIds((current) => {
      const next = new Set(current);
      if (next.has(medicineId)) next.delete(medicineId);
      else next.add(medicineId);
      return next;
    });

  const ticketState = attempt?.finalizedSaleId
    ? { tone: 'done', label: 'Finalized', detail: 'Receipt recovery' }
    : attempt?.reservedTotal
      ? {
          tone: 'reserved',
          label: 'Stock reserved',
          detail: attempt.reservedUntil
            ? `Until ${new Date(attempt.reservedUntil).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
            : 'Active',
        }
      : attempt?.draftId
        ? { tone: 'draft', label: 'Draft created', detail: 'Not reserved' }
        : { tone: 'new', label: 'New sale', detail: 'Stock not reserved' };
  const grandTotal = attempt?.reservedTotal ?? plan.total;
  const hasLineDiscount = plan.lineDiscountTotal !== '0.00';
  const hasInvoiceDiscount = plan.invoiceDiscount !== '0.00';
  const showMatches = !selectedCustomer && customerQuery.trim() !== '' && !lockedCart;

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
      {discountOpen ? (
        <DiscountDialog
          cart={cart}
          discounts={discounts}
          targetIds={tickedLines.map((line) => line.medicine.id)}
          approval={approval}
          approvalRequired={approvalRequired}
          onApprovalChange={setApproval}
          onClose={() => setDiscountOpen(false)}
          onApply={(next) => {
            setDiscounts(next);
            setDiscountOpen(false);
            setCheckoutError('');
            const nextPlan = buildDiscountPlan(cart, next);
            setCounterNotice(
              nextPlan.hasDiscount
                ? `Discount set: ${formatPkrMoney(nextPlan.discountTotal)} off (${nextPlan.discountPercent}%)`
                : 'Discounts removed',
            );
          }}
        />
      ) : null}
      {budgetOpen ? (
        <BudgetPlanDialog
          token={session?.accessToken ?? ''}
          previewMode={previewMode}
          planLines={targetLines}
          otherLines={cart.filter((line) => !targetIds.includes(line.medicine.id))}
          regimen={regimen}
          onRegimenChange={(medicineId, entry) =>
            setRegimen((current) => ({ ...current, [medicineId]: entry }))
          }
          onClose={() => setBudgetOpen(false)}
          onApply={({ quantities, completeDays }) => {
            applyQuantities(quantities);
            setBudgetOpen(false);
            setCounterNotice(
              `Budget plan set: ${completeDays} complete day${completeDays === 1 ? '' : 's'} for ${Object.keys(quantities).length} medicine${Object.keys(quantities).length === 1 ? '' : 's'}`,
            );
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
              aria-controls="medicine-results"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive({ query: '', index: 0 });
              }}
              onKeyDown={searchKeyDown}
            />
            <kbd>/</kbd>
          </label>
          <div className="search-caption">
            <span>{t('pos.scanHint')} · ↑ ↓ to choose, Enter to add</span>
            <span>
              {search.isFetching ? 'Searching…' : debouncedQuery ? `${results.length} matches` : ''}
            </span>
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
          {debouncedQuery && query.trim() ? (
            <div
              className="medicine-list"
              id="medicine-results"
              ref={resultList}
              aria-live="polite"
            >
              {results.length > 0 ? (
                <div className="medicine-list-head" aria-hidden="true">
                  <span>#</span>
                  <span>Medicine</span>
                  <span>Shelf</span>
                  <span>FEFO batch</span>
                  <span>Price</span>
                </div>
              ) : null}
              {results.map((medicine, index) => {
                const expiringSoon = medicine.daysToExpiry !== null && medicine.daysToExpiry <= 90;
                const sellable = isSellable(medicine);
                const classes = ['medicine-row'];
                if (index === activeIndex) classes.push('active');
                if (!sellable) classes.push('unavailable');
                return (
                  <button
                    type="button"
                    className={classes.join(' ')}
                    key={medicine.id}
                    data-result-index={index}
                    onClick={() => addSearchResult(medicine)}
                    onMouseEnter={() => setActive({ query: debouncedQuery, index })}
                  >
                    <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="medicine-identity">
                      <strong>
                        {medicine.name} <em>{medicine.strength}</em>
                      </strong>
                      <small>
                        {[medicine.genericName, medicine.manufacturer].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    <span className="shelf-code">
                      <small>Shelf</small>
                      <strong>{medicine.shelf ?? 'Not set'}</strong>
                    </span>
                    <span className={expiringSoon ? 'batch-status warning' : 'batch-status'}>
                      <small>{sellable ? 'In stock' : 'Unavailable'}</small>
                      <strong>{wholeUnits(medicine.availableQuantity)} units</strong>
                      <em>
                        {medicine.nearestExpiry ? `Exp ${medicine.nearestExpiry}` : 'No stock'}
                      </em>
                    </span>
                    <span className="result-price">
                      {medicine.salePrice ? formatPkrMoney(medicine.salePrice) : 'No price'}
                      <small>{sellable ? 'Enter to add' : 'Cannot sell'}</small>
                    </span>
                  </button>
                );
              })}
              {!search.isFetching && results.length === 0 ? (
                <p className="empty-results">
                  No medicine matches “{debouncedQuery}”. Try the generic name or company.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="counter-idle">
              {heldCart ? (
                <div className="held-card">
                  <div>
                    <p className="eyebrow">Held ticket</p>
                    <strong>
                      {heldCart.lines.length} line{heldCart.lines.length === 1 ? '' : 's'} · held{' '}
                      {new Date(heldCart.heldAt).toLocaleTimeString('en-PK', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                    <small>
                      {heldCart.lines
                        .slice(0, 3)
                        .map((line) => line.medicine.name)
                        .join(', ')}
                      {heldCart.lines.length > 3 ? '…' : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={cart.length > 0}
                    onClick={toggleHeldCart}
                  >
                    Resume <kbd>F4</kbd>
                  </button>
                </div>
              ) : null}
              <div className="idle-grid">
                <div>
                  <b>1</b>
                  <strong>Scan or search</strong>
                  <span>Brand, generic, company or barcode. ↑ ↓ then Enter adds.</span>
                </div>
                <div>
                  <b>2</b>
                  <strong>Tick lines</strong>
                  <span>Tick medicines on the ticket to plan a budget or discount them.</span>
                </div>
                <div>
                  <b>3</b>
                  <strong>Budget plan · F3</strong>
                  <span>
                    Customer has a fixed amount? Get complete days for the ticked medicines.
                  </span>
                </div>
                <div>
                  <b>4</b>
                  <strong>Pay · F8</strong>
                  <span>Stock is reserved only when payment starts.</span>
                </div>
              </div>
            </div>
          )}
          <footer className="shortcut-rail">
            <span>
              <kbd>F2</kbd> {t('pos.newSale')}
            </span>
            <span>
              <kbd>F3</kbd> Budget plan
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
              <kbd>F9</kbd> Discount
            </span>
            <span>
              <kbd>*N</kbd> Set quantity
            </span>
            <span>
              <kbd>Del</kbd> Remove line
            </span>
          </footer>
        </section>

        <aside className="cart-pane" aria-label="Current cart">
          <div className="cart-heading">
            <div>
              <p className="eyebrow">{t('pos.currentCart')}</p>
              <h2>Counter ticket</h2>
            </div>
            <div className="ticket-count">
              <strong>{cart.length}</strong>
              <small>
                line{cart.length === 1 ? '' : 's'} · {unitCount} unit{unitCount === 1 ? '' : 's'}
              </small>
            </div>
          </div>
          <div className={`ticket-meta ${ticketState.tone}`}>
            <span>{ticketState.label}</span>
            <span>{ticketState.detail}</span>
          </div>

          <div className="ticket-customer">
            {customerId ? (
              <div className="customer-chip">
                <span>Customer</span>
                <strong>{customerName}</strong>
                <button
                  type="button"
                  aria-label="Remove customer"
                  disabled={lockedCart}
                  onClick={() => {
                    setSelectedCustomer(null);
                    if (attempt) updateAttempt(withCustomer(attempt, null));
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="customer-search">
                <span className="sr-only">Customer account</span>
                <input
                  value={customerQuery}
                  placeholder="Attach customer — phone or name"
                  disabled={lockedCart}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                />
              </label>
            )}
            {showMatches ? (
              <div className="customer-matches">
                {(customers.data ?? []).slice(0, 4).map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setCustomerQuery('');
                      if (attempt) {
                        updateAttempt(
                          withCustomer(attempt, { id: customer.id, name: customer.name }),
                        );
                      }
                    }}
                  >
                    <strong>{customer.name}</strong>
                    <span>
                      {customer.phone ?? 'No phone'} · credit{' '}
                      {formatPkrMoney(customer.availableCredit)}
                    </span>
                  </button>
                ))}
                {customers.isFetched && (customers.data ?? []).length === 0 ? (
                  <p>No customer found</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {cart.length > 0 ? (
            <div className="ticket-toolbar">
              <label className="tick-all">
                <input
                  ref={tickAll}
                  type="checkbox"
                  aria-label="Tick all lines"
                  checked={tickedLines.length > 0 && tickedLines.length === cart.length}
                  disabled={lockedCart}
                  onChange={(event) =>
                    setTickedIds(
                      event.target.checked
                        ? new Set(cart.map((line) => line.medicine.id))
                        : new Set(),
                    )
                  }
                />
                <span>
                  {tickedLines.length > 0 ? `${tickedLines.length} ticked` : 'Tick lines'}
                </span>
              </label>
              <div className="toolbar-actions">
                <button
                  type="button"
                  disabled={lockedCart || !canBudget}
                  title={canBudget ? 'Budget plan (F3)' : 'You do not have budget plan access'}
                  onClick={openBudget}
                >
                  Budget plan
                  <small>{tickedLines.length > 0 ? tickedLines.length : 'all'}</small>
                </button>
                <button
                  type="button"
                  disabled={lockedCart || !canDiscount}
                  title={canDiscount ? 'Discount (F9)' : 'You do not have discount access'}
                  onClick={openDiscount}
                >
                  Discount
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={lockedCart || tickedLines.length === 0}
                  onClick={() => {
                    removeMedicines(tickedLines.map((line) => line.medicine.id));
                    setCounterNotice(
                      `${tickedLines.length} line${tickedLines.length === 1 ? '' : 's'} removed`,
                    );
                    setTickedIds(new Set());
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}

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
              cart.map((line) => {
                const amounts = planById.get(line.medicine.id);
                const lineDiscount = discounts.lines[line.medicine.id];
                const discounted = amounts !== undefined && amounts.discount !== '0.00';
                const overStock = exceedsStock(line);
                const classes = ['cart-line'];
                if (selectedMedicineId === line.medicine.id) classes.push('selected');
                if (tickedIds.has(line.medicine.id)) classes.push('ticked');
                return (
                  <div
                    className={classes.join(' ')}
                    key={line.medicine.id}
                    onFocusCapture={() => setSelectedMedicineId(line.medicine.id)}
                  >
                    <label className="line-identity">
                      <input
                        type="checkbox"
                        aria-label={`Tick ${line.medicine.name}`}
                        checked={tickedIds.has(line.medicine.id)}
                        disabled={lockedCart}
                        onChange={() => toggleTicked(line.medicine.id)}
                      />
                      <span>
                        <strong>{line.medicine.name}</strong>
                        <small>
                          {line.medicine.strength ? `${line.medicine.strength} · ` : ''}
                          {formatPkrMoney(line.medicine.salePrice ?? '0.00')} / unit
                        </small>
                        {lineDiscount || overStock ? (
                          <span className="line-tags">
                            {lineDiscount ? (
                              <em className="tag discount">
                                −{describeDiscountSpec(lineDiscount)}
                              </em>
                            ) : null}
                            {overStock ? (
                              <em className="tag warning">
                                Only {wholeUnits(line.medicine.availableQuantity)} in stock
                              </em>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </label>
                    <div className="quantity-control">
                      <button
                        type="button"
                        aria-label={`Remove one ${line.medicine.name}`}
                        disabled={lockedCart}
                        onClick={() => changeQuantity(line.medicine.id, -1)}
                      >
                        −
                      </button>
                      <QuantityField
                        line={line}
                        disabled={lockedCart}
                        onCommit={(quantity) => setQuantity(line.medicine.id, quantity)}
                      />
                      <button
                        type="button"
                        aria-label={`Add one ${line.medicine.name}`}
                        disabled={lockedCart}
                        onClick={() => changeQuantity(line.medicine.id, 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="line-amount">
                      {discounted ? <s>{formatPkrMoney(amounts.gross)}</s> : null}
                      <b>{formatPkrMoney(amounts?.net ?? '0.00')}</b>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{formatPkrMoney(plan.gross)}</strong>
            </div>
            {hasLineDiscount ? (
              <div className="discount-row">
                <span>Line discounts</span>
                <strong>−{formatPkrMoney(plan.lineDiscountTotal)}</strong>
              </div>
            ) : null}
            {hasInvoiceDiscount ? (
              <div className="discount-row">
                <span>
                  Invoice discount
                  {discounts.invoice ? ` (${describeDiscountSpec(discounts.invoice)})` : ''}
                </span>
                <strong>−{formatPkrMoney(plan.invoiceDiscount)}</strong>
              </div>
            ) : null}
            {plan.hasDiscount ? (
              <button
                type="button"
                className="discount-reason"
                disabled={lockedCart}
                onClick={openDiscount}
              >
                {plan.discountPercent}% off · {discounts.reason || 'reason needed'} · Edit
              </button>
            ) : null}
            <div className="grand-total">
              <span>{attempt?.reservedTotal ? 'Reserved total' : 'Total'}</span>
              <strong>{formatPkrMoney(grandTotal)}</strong>
            </div>
            <p>Final price and FEFO batches are confirmed by the server.</p>
          </div>
          <div className="cart-actions">
            {checkoutError ? (
              <p className="inline-error checkout-error" role="alert">
                {checkoutError}{' '}
                {attempt?.finalizedSaleId ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void recoverReceipt(attempt.finalizedSaleId!)}
                  >
                    Retry receipt
                  </button>
                ) : /cash session/i.test(checkoutError) ? (
                  <Link to="/cash">Manage cash session</Link>
                ) : null}
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
            <div className="secondary-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={lockedCart || (cart.length === 0 && !heldCart)}
                onClick={toggleHeldCart}
              >
                {cart.length === 0 && heldCart ? 'Resume held' : 'Hold'} <kbd>F4</kbd>
              </button>
              {lockedCart && !attempt?.finalizedSaleId ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={checkoutPending}
                  onClick={() => void releaseReservation()}
                >
                  Release &amp; edit
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={cart.length === 0 || lockedCart}
                  onClick={resetSale}
                >
                  Clear <kbd>F2</kbd>
                </button>
              )}
            </div>
            <button
              type="button"
              className="primary-button pay-button"
              disabled={cart.length === 0 || checkoutPending}
              onClick={() => void beginCheckout()}
            >
              <span>
                {checkoutPending ? 'Reserving…' : lockedCart ? 'Resume payment' : 'Take payment'}
                <kbd>F8</kbd>
              </span>
              <strong>{formatPkrMoney(grandTotal)}</strong>
            </button>
          </div>
        </aside>
      </main>
    </AppShell>
  );
}
