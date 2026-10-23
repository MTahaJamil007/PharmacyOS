import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createClientRequestId,
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
  completeCounterInvoice,
  getCounterSettings,
  getCurrentCashSession,
  getSaleReceipt,
  reserveSaleDraft,
  searchCustomers,
  searchMedicines,
  sendToCashCounter,
  getCashCounters,
  type FinalizedSale,
  type MedicineSearchResult,
} from './api';
import { AppShell } from './components/AppShell';
import { useClock } from './hooks/useClock';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useI18n } from './i18n';
import { formatPkrMoney } from './money';
import { previewMedicines } from './preview-data';
import { MAX_HELD_CARTS, usePharmacyStore } from './store';
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
  discountRequestBody,
  discountSignature,
  type DiscountSpec,
} from './modules/pos/discount';
import { EntryBar, isSellable, type EntryBarHandle } from './modules/pos/EntryBar';
import { PaymentDialog } from './modules/pos/PaymentDialog';
import { ReceiptDialog } from './modules/pos/ReceiptDialog';
import { CollectionTicketDialog } from './modules/pos/CollectionTicketDialog';
import { ReprintDialog } from './modules/pos/ReprintDialog';
import { WedgeScannerBuffer } from './modules/pos/scanner';
import { useFeatures } from './features';
import { BudgetBox, DiscountBox, type SupervisorApproval } from './modules/pos/SidePanel';
import { TicketGrid, type TicketGridActions } from './modules/pos/TicketGrid';
import { useBudgetPlan } from './modules/pos/useBudgetPlan';

const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
const NO_APPROVAL: SupervisorApproval = { username: '', password: '' };

/** Isolated so its periodic tick never re-renders the ticket. */
function CounterClock({ timeZone }: { readonly timeZone: string | undefined }): React.JSX.Element {
  const now = useClock(timeZone);
  const options = timeZone ? { timeZone } : {};
  return (
    <span className="clock-label">
      {new Intl.DateTimeFormat('en-PK', {
        ...options,
        day: '2-digit',
        month: 'short',
        weekday: 'short',
      }).format(now)}{' '}
      <strong>
        {new Intl.DateTimeFormat('en-PK', {
          ...options,
          hour: 'numeric',
          minute: '2-digit',
        }).format(now)}
      </strong>
    </span>
  );
}

const TARGET_COUNTER_KEY = 'pharmacy-target-cash-counter';

export function PosWorkspace(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const discounts = usePharmacyStore((state) => state.discounts);
  const heldCarts = usePharmacyStore((state) => state.heldCarts);
  const resumeHeldCart = usePharmacyStore((state) => state.resumeHeldCart);
  const deleteHeldCart = usePharmacyStore((state) => state.deleteHeldCart);
  const addMedicine = usePharmacyStore((state) => state.addMedicine);
  const changeQuantity = usePharmacyStore((state) => state.changeQuantity);
  const setQuantity = usePharmacyStore((state) => state.setQuantity);
  const setDosage = usePharmacyStore((state) => state.setDosage);
  const applyQuantities = usePharmacyStore((state) => state.applyQuantities);
  const removeMedicine = usePharmacyStore((state) => state.removeMedicine);
  const removeMedicines = usePharmacyStore((state) => state.removeMedicines);
  const setDiscounts = usePharmacyStore((state) => state.setDiscounts);
  const clearCart = usePharmacyStore((state) => state.clearCart);
  const holdOrResumeCart = usePharmacyStore((state) => state.holdOrResumeCart);
  const { t } = useI18n();
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(
    cart.at(-1)?.medicine.id ?? null,
  );
  const [tickedIds, setTickedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [checkoutError, setCheckoutError] = useState('');
  const [counterNotice, setCounterNotice] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [receipt, setReceipt] = useState<FinalizedSale | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const [collectionTicket, setCollectionTicket] = useState<{
    readonly orderNumber: string;
    readonly customerName: string | null;
    readonly total: string;
    readonly lines: typeof cart;
  } | null>(null);
  const [paymentTotal, setPaymentTotal] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [approval, setApproval] = useState<SupervisorApproval>(NO_APPROVAL);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(() =>
    session ? loadCheckoutAttempt(session.user.terminalId, cart) : null,
  );
  const entry = useRef<EntryBarHandle>(null);
  const budgetInput = useRef<HTMLInputElement>(null);
  const discountInput = useRef<HTMLInputElement>(null);
  const scanner = useRef(new WedgeScannerBuffer());
  const debouncedCustomerQuery = useDebouncedValue(customerQuery.trim(), 180);
  const permissions = session?.user.permissions ?? [];
  const canBudget = previewMode || permissions.includes(PERMISSIONS.SALES_BUDGET_REGIMEN_CALCULATE);
  const token = session?.accessToken ?? '';
  const canUseTill =
    permissions.includes(PERMISSIONS.CASH_OPEN_SESSION) ||
    permissions.includes(PERMISSIONS.SALE_FINALIZE_PAYMENT);
  const canSend = permissions.includes(PERMISSIONS.POS_SEND_TO_CASHIER);

  // How this desk finishes an order: the shop's cash-session mode, then whether this desk has a
  // started day. Both are cached so the F8 label is right before the first sale.
  const counterSettings = useQuery({
    queryKey: ['counter-settings'],
    queryFn: () => getCounterSettings(token),
    enabled: !previewMode && token !== '',
    staleTime: 60_000,
    retry: false,
  });
  const till = useQuery({
    queryKey: ['cash-session-current'],
    queryFn: () => getCurrentCashSession(token),
    enabled: !previewMode && token !== '' && canUseTill,
    staleTime: 15_000,
    retry: false,
  });
  const sessionsOn = counterSettings.data?.cashSessionsEnabled ?? true;
  const tillOpen = till.data?.status === 'OPEN';
  const canDiscount =
    previewMode ||
    permissions.includes(PERMISSIONS.SALE_DISCOUNT_BASIC) ||
    counterSettings.data?.orderTakerDiscountEnabled === true;
  const features = useFeatures();
  const routing = features.MULTI_COUNTER.enabled && sessionsOn && canSend && !tillOpen;
  const cashCounters = useQuery({
    queryKey: ['cash-counters'],
    queryFn: () => getCashCounters(token),
    enabled: !previewMode && token !== '' && routing,
    staleTime: 30_000,
    retry: false,
  });
  // Which cash counter this desk sends bills to; empty means any counter may take them.
  const [targetCounter, setTargetCounter] = useState<string>(() => {
    try {
      return localStorage.getItem(TARGET_COUNTER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const counterOptions = routing ? (cashCounters.data ?? []) : [];
  const chosenCounter = counterOptions.find((counter) => counter.id === targetCounter);
  const chooseCounter = (id: string) => {
    setTargetCounter(id);
    try {
      localStorage.setItem(TARGET_COUNTER_KEY, id);
    } catch {
      // Without storage the desk simply asks again after a reload.
    }
  };
  const checkoutLabel = !sessionsOn
    ? 'Print invoice'
    : tillOpen || !canSend
      ? 'Take payment'
      : 'Send to cash counter';

  const customers = useQuery({
    queryKey: ['customer-search', debouncedCustomerQuery],
    queryFn: () => searchCustomers(token, debouncedCustomerQuery),
    enabled:
      !previewMode &&
      Boolean(session) &&
      debouncedCustomerQuery.length > 0 &&
      permissions.includes(PERMISSIONS.CUSTOMER_READ),
  });

  const plan = useMemo(() => buildDiscountPlan(cart, discounts), [cart, discounts]);
  const lineAmounts = useMemo(
    () => new Map(plan.lines.map((line) => [line.medicineId, line])),
    [plan.lines],
  );
  const budget = useBudgetPlan(token, previewMode, cart, tickedIds);
  const unitCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const lockedCart = Boolean(attempt?.reservedTotal || attempt?.finalizedSaleId);
  const customerId = attempt?.customerId ?? selectedCustomer?.id;
  const customerName = attempt?.customerName ?? selectedCustomer?.name;
  const canUseCredit =
    Boolean(customerId) && (previewMode || permissions.includes(PERMISSIONS.CUSTOMER_CREDIT));
  const modalOpen = Boolean(paymentTotal || reprintOpen || printReceipt || collectionTicket);

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

  const addLine = useCallback(
    (medicine: MedicineSearchResult, quantity: number, dosage: string | null): void => {
      if (lockedCart) {
        setCounterNotice('Release the reservation before changing this ticket');
        return;
      }
      setCheckoutError('');
      addMedicine(medicine, quantity, dosage);
      setSelectedMedicineId(medicine.id);
      setCounterNotice(
        `${medicine.name} × ${String(quantity)} added${dosage ? ` · ${dosage}` : ''}`,
      );
    },
    [addMedicine, lockedCart],
  );

  /** A scan adds one unit, as at any till; repeat scans count up and the grid edits the rest. */
  const addBarcode = useCallback(
    async (barcode: string): Promise<void> => {
      setCheckoutError('');
      entry.current?.reset();
      try {
        const matches = previewMode
          ? previewMedicines.filter((medicine) => medicine.barcode === barcode)
          : await searchMedicines(token, barcode);
        // The server matched a pack code (including 2D codes) only by an exact barcode key.
        const exact =
          matches.find((medicine) => medicine.matchedBy === 'BARCODE') ??
          matches.find((medicine) => medicine.barcode === barcode);
        if (!exact) throw new Error(`Barcode ${barcode} has no exact medicine match`);
        if (!isSellable(exact)) {
          throw new Error(`${exact.name} has no sellable stock or price at this branch`);
        }
        if (lockedCart) {
          setCounterNotice('Release the reservation before changing this ticket');
          return;
        }
        addMedicine(exact, 1);
        setSelectedMedicineId(exact.id);
        setCounterNotice(`${exact.name} scanned`);
      } catch (cause) {
        setCheckoutError(cause instanceof Error ? cause.message : 'Barcode lookup failed');
      }
    },
    [addMedicine, lockedCart, token],
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
    budget.clear();
    entry.current?.reset();
    entry.current?.focusSearch();
  }, [abandonDraft, attempt, budget, clearCart, lockedCart, session]);

  const restoreHeldCart = useCallback(
    (id: string): void => {
      if (lockedCart || checkoutPending) return;
      const held = heldCarts.find((ticket) => ticket.id === id);
      try {
        if (!held || !resumeHeldCart(id)) {
          setCounterNotice('Hold or clear the current bill before reopening a held bill');
          return;
        }
        if (attempt?.draftId) abandonDraft(attempt.draftId);
        if (session) clearCheckoutAttempt(session.user.terminalId);
        setAttempt(null);
        setSelectedCustomer(held.customer ?? null);
        setSelectedMedicineId(held.lines.at(-1)?.medicine.id ?? null);
        setCustomerQuery('');
        budget.clear();
        setTickedIds(new Set());
        setApproval(NO_APPROVAL);
        setApprovalRequired(false);
        setCheckoutError('');
        setCounterNotice('Held cart resumed');
      } catch {
        setCheckoutError(
          'Could not save the counter. Free browser storage and try again; the held bill has been kept.',
        );
      }
    },
    [
      abandonDraft,
      attempt,
      budget,
      checkoutPending,
      heldCarts,
      lockedCart,
      resumeHeldCart,
      session,
    ],
  );

  const toggleHeldCart = useCallback((): void => {
    if (lockedCart || checkoutPending) {
      setCounterNotice('A reserved or processing sale cannot be held');
      return;
    }
    if (cart.length === 0) {
      const first = heldCarts[0];
      if (first) restoreHeldCart(first.id);
      return;
    }
    try {
      const outcome = holdOrResumeCart(selectedCustomer ?? undefined);
      if (outcome === 'FULL') {
        setCounterNotice('All 3 hold slots are full. Reopen or delete a held bill first.');
        return;
      }
      if (attempt?.draftId) abandonDraft(attempt.draftId);
      if (session) clearCheckoutAttempt(session.user.terminalId);
      setAttempt(null);
      setSelectedCustomer(null);
      setCustomerQuery('');
      budget.clear();
      setTickedIds(new Set());
      setApproval(NO_APPROVAL);
      setApprovalRequired(false);
      setCheckoutError('');
      setCounterNotice('Cart held on this terminal');
    } catch {
      setCheckoutError(
        'Could not save this bill. Free browser storage and try again; the current bill has been kept.',
      );
    }
  }, [
    abandonDraft,
    attempt,
    budget,
    cart.length,
    checkoutPending,
    heldCarts,
    holdOrResumeCart,
    lockedCart,
    restoreHeldCart,
    selectedCustomer,
    session,
  ]);

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
        discountInput.current?.focus();
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
      const shopRunsSessions =
        counterSettings.data?.cashSessionsEnabled ??
        (await getCounterSettings(token)
          .then((settings) => settings.cashSessionsEnabled)
          .catch(() => true));
      let mode: 'PAY_HERE' | 'SEND' | 'INVOICE' = shopRunsSessions ? 'PAY_HERE' : 'INVOICE';
      if (shopRunsSessions && !current.cashSessionId) {
        const cashSession = canUseTill
          ? await getCurrentCashSession(session.accessToken).catch((cause: unknown) => {
              // Taking payment without the till permission simply means no day of its own.
              if (cause instanceof ApiError && cause.status === 403) return null;
              throw cause;
            })
          : null;
        if (cashSession?.status === 'OPEN') {
          current = { ...current, cashSessionId: cashSession.id };
          updateAttempt(current);
        } else if (canSend) {
          mode = 'SEND';
        } else {
          throw new Error('Open a cash session for this terminal before taking payment');
        }
      }
      if (!current.draftId) {
        const draft = await createSaleDraft(
          session.accessToken,
          session.user.terminalId,
          cart.map((line) => ({
            medicineId: line.medicine.id,
            quantity: line.quantity.toString(),
            ...(line.dosage ? { dosageInstruction: line.dosage } : {}),
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
      const draftId = current.draftId;
      if (!draftId) throw new Error('Sale draft could not be resumed');
      if (mode === 'SEND') {
        const queuedLines = cart;
        const queuedCustomerName = customerName;
        const queuedTotal = current.reservedTotal;
        await sendToCashCounter(
          session.accessToken,
          draftId,
          current.customerId,
          chosenCounter?.id,
        );
        clearCheckoutAttempt(session.user.terminalId);
        setAttempt(null);
        setCollectionTicket({
          orderNumber: draftId,
          customerName: queuedCustomerName ?? null,
          total: queuedTotal,
          lines: queuedLines,
        });
        clearCart();
        setTickedIds(new Set());
        setSelectedCustomer(null);
        setCustomerQuery('');
        setCounterNotice(
          `Sent to ${chosenCounter?.name ?? 'the cash counter'} · order #${draftId} · ${formatPkrMoney(current.reservedTotal)}`,
        );
        entry.current?.focusSearch();
      } else if (mode === 'INVOICE') {
        const finalized = await completeCounterInvoice(
          session.accessToken,
          draftId,
          current.clientRequestId,
          current.customerId,
        );
        updateAttempt({ ...current, finalizedSaleId: finalized.id });
        setReceipt(finalized);
        clearCart();
        setTickedIds(new Set());
        setSelectedCustomer(null);
        await recoverReceipt(finalized.id);
      } else {
        setPaymentTotal(current.reservedTotal);
      }
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'Sale reservation failed');
    } finally {
      setCheckoutPending(false);
    }
  }, [
    abandonDraft,
    approval,
    attempt,
    canSend,
    canUseTill,
    cart,
    chosenCounter,
    checkoutPending,
    clearCart,
    counterSettings.data,
    customerId,
    customerName,
    discounts.reason,
    plan,
    recoverReceipt,
    session,
    token,
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

  const gridActions = useMemo<TicketGridActions>(
    () => ({
      onToggle: (medicineId) =>
        setTickedIds((current) => {
          const next = new Set(current);
          if (next.has(medicineId)) next.delete(medicineId);
          else next.add(medicineId);
          return next;
        }),
      onToggleAll: (ticked) =>
        setTickedIds(
          ticked
            ? new Set(usePharmacyStore.getState().cart.map((line) => line.medicine.id))
            : new Set(),
        ),
      onSelect: setSelectedMedicineId,
      onSetQuantity: setQuantity,
      onChangeQuantity: changeQuantity,
      onSetDosage: setDosage,
      onSetDiscount: (medicineIds: readonly string[], spec: DiscountSpec | null) => {
        const state = usePharmacyStore.getState().discounts;
        const lines = { ...state.lines };
        for (const medicineId of medicineIds) {
          if (spec) lines[medicineId] = spec;
          else delete lines[medicineId];
        }
        setDiscounts({ ...state, lines });
      },
      onRemove: (medicineIds) => {
        removeMedicines(medicineIds);
        setTickedIds((current) => {
          const next = new Set(current);
          for (const medicineId of medicineIds) next.delete(medicineId);
          return next;
        });
        setCounterNotice(
          `${String(medicineIds.length)} line${medicineIds.length === 1 ? '' : 's'} removed`,
        );
      },
      onNotice: setCounterNotice,
    }),
    [changeQuantity, removeMedicines, setDiscounts, setDosage, setQuantity],
  );

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
      const typing = event.target instanceof HTMLInputElement && event.target.type !== 'checkbox';
      if (event.key === 'F2') {
        event.preventDefault();
        resetSale();
      } else if (event.key === 'F3') {
        event.preventDefault();
        if (canBudget) budgetInput.current?.focus();
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
        if (canDiscount) discountInput.current?.focus();
      } else if (event.key === 'Delete' && selectedMedicineId && !lockedCart && !typing) {
        event.preventDefault();
        removeMedicine(selectedMedicineId);
      } else if ((event.key === 'Escape' || event.key === '/') && !typing) {
        event.preventDefault();
        entry.current?.focusSearch();
      }
    };
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, [
    addBarcode,
    beginCheckout,
    canBudget,
    canDiscount,
    lockedCart,
    modalOpen,
    removeMedicine,
    resetSale,
    selectedMedicineId,
    toggleHeldCart,
  ]);

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
  const showMatches = !selectedCustomer && customerQuery.trim() !== '' && !lockedCart;

  return (
    <AppShell>
      {collectionTicket ? (
        <CollectionTicketDialog
          {...collectionTicket}
          onClose={() => {
            setCollectionTicket(null);
            entry.current?.focusSearch();
          }}
        />
      ) : null}
      {printReceipt ? (
        <ReceiptDialog
          key={printReceipt.sale.id}
          receipt={printReceipt}
          token={token}
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
        <section className="counter-main">
          <div className="counter-heading">
            <p className="eyebrow">{session?.user.terminalName ?? 'Training counter'}</p>
            <h1>{t('pos.findMedicine')}</h1>
            {counterNotice ? (
              <p className="counter-notice" role="status">
                {counterNotice}
              </p>
            ) : (
              <span className="counter-notice-placeholder" />
            )}
            <CounterClock timeZone={session?.user.branchTimezone} />
          </div>
          <EntryBar
            handleRef={entry}
            token={token}
            previewMode={previewMode}
            locked={lockedCart}
            onAdd={addLine}
            onNotice={setCounterNotice}
            onSetActiveQuantity={(quantity) => {
              if (selectedMedicineId && !lockedCart) setQuantity(selectedMedicineId, quantity);
            }}
          />
          <TicketGrid
            cart={cart}
            lineAmounts={lineAmounts}
            lineDiscounts={discounts.lines}
            tickedIds={tickedIds}
            selectedId={selectedMedicineId}
            locked={lockedCart}
            budgetPreview={budget.preview}
            actions={gridActions}
          />
          {heldCarts.length > 0 ? (
            <section className="held-bills" aria-label="Held bills">
              <p className="eyebrow">
                Held bills {heldCarts.length}/{MAX_HELD_CARTS}
              </p>
              <small>
                Saved on this browser until reopened or deleted. Stock and prices are checked at
                checkout.
              </small>
              {heldCarts.map((held, index) => (
                <div className="held-card" key={held.id}>
                  <div>
                    <strong>
                      Held bill {index + 1} ·{' '}
                      {held.lines.map((line) => line.medicine.name).join(', ')}
                    </strong>
                    <small>
                      {held.lines.length} lines · {new Date(held.heldAt).toLocaleString()}
                      {held.customer ? ` · ${held.customer.name}` : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={lockedCart || checkoutPending}
                    onClick={() => restoreHeldCart(held.id)}
                  >
                    Reopen bill {index + 1}
                  </button>
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => {
                      if (!window.confirm(`Delete held bill ${index + 1}? This cannot be undone.`))
                        return;
                      try {
                        deleteHeldCart(held.id);
                      } catch {
                        setCheckoutError('Could not delete the held bill. Try again.');
                      }
                    }}
                  >
                    Delete bill {index + 1}
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          <footer className="shortcut-rail">
            <span>
              <kbd>/</kbd> Search
            </span>
            <span>
              <kbd>F2</kbd> {t('pos.newSale')}
            </span>
            <span>
              <kbd>F3</kbd> Budget
            </span>
            <span>
              <kbd>F4</kbd> {t('pos.holdCart')}{' '}
              {heldCarts.length > 0 ? `(${heldCarts.length})` : ''}
            </span>
            <span>
              <kbd>F6</kbd> {t('pos.reprint')}
            </span>
            <span>
              <kbd>F8</kbd> {checkoutLabel}
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

          <div className="side-scroll">
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

            {canBudget && cart.length > 0 ? (
              <BudgetBox
                plan={budget}
                locked={lockedCart}
                inputRef={budgetInput}
                onApply={(quantities, days) => {
                  applyQuantities(quantities);
                  const count = Object.keys(quantities).length;
                  setCounterNotice(
                    `Budget plan set: ${String(days)} complete day${days === 1 ? '' : 's'} for ${String(count)} medicine${count === 1 ? '' : 's'}`,
                  );
                }}
              />
            ) : null}
            {canDiscount && cart.length > 0 ? (
              <DiscountBox
                plan={plan}
                discounts={discounts}
                locked={lockedCart}
                inputRef={discountInput}
                approval={approval}
                approvalRequired={approvalRequired}
                onApprovalChange={setApproval}
                onChange={(next) => {
                  setDiscounts(next);
                  setCheckoutError('');
                }}
              />
            ) : null}
          </div>

          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{formatPkrMoney(plan.gross)}</strong>
            </div>
            {plan.hasDiscount ? (
              <div className="discount-row">
                <span>Discount ({plan.discountPercent}%)</span>
                <strong>−{formatPkrMoney(plan.discountTotal)}</strong>
              </div>
            ) : null}
            <div className="grand-total">
              <span>{attempt?.reservedTotal ? 'Reserved total' : 'Total'}</span>
              <strong>{formatPkrMoney(grandTotal)}</strong>
            </div>
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
                disabled={
                  lockedCart || checkoutPending || (cart.length === 0 && heldCarts.length === 0)
                }
                onClick={toggleHeldCart}
              >
                {cart.length === 0 && heldCarts.length > 0 ? 'Resume held' : 'Hold'} <kbd>F4</kbd>
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
            {checkoutLabel === 'Send to cash counter' && counterOptions.length > 1 ? (
              <div className="counter-choice" role="group" aria-label="Send bills to">
                <span>Send to</span>
                <button
                  type="button"
                  aria-pressed={!chosenCounter}
                  onClick={() => chooseCounter('')}
                >
                  Any counter
                </button>
                {counterOptions.map((counter) => (
                  <button
                    key={counter.id}
                    type="button"
                    aria-pressed={chosenCounter?.id === counter.id}
                    title={
                      counter.cashier ? `${counter.cashier} is taking money here` : 'Not started'
                    }
                    onClick={() => chooseCounter(counter.id)}
                  >
                    {counter.name}
                    {counter.waiting > 0 ? <small>{counter.waiting} waiting</small> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="primary-button pay-button"
              disabled={cart.length === 0 || checkoutPending}
              onClick={() => void beginCheckout()}
            >
              <span>
                {checkoutPending
                  ? 'Working…'
                  : lockedCart && checkoutLabel === 'Take payment'
                    ? 'Resume payment'
                    : checkoutLabel}
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
