import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  createClientRequestId,
  minorUnitsToMoney,
  moneyToMinorUnits,
  PERMISSIONS,
  type CashSessionSummary,
  type SaleReceipt,
} from '@pharmacy/shared';

import {
  addCashMovement,
  approveCashVariance,
  cancelCashCounterOrder,
  claimCashCounterBill,
  clearCashCounterPayment,
  closeCashSession,
  getCashCounterQueue,
  getCounterSettings,
  getCurrentCashSession,
  getPendingCashVariances,
  getSaleReceipt,
  applySaleDiscount,
  openCashSession,
  type CashCounterOrder,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import { ReceiptDialog } from '../pos/ReceiptDialog';

const MONEY = /^\d{1,10}(?:\.\d{1,2})?$/;

function minutesAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return minutes === 0 ? 'just now' : minutes === 1 ? '1 min ago' : `${String(minutes)} min ago`;
}

function difference(counted: string, expected: string): { label: string; tone: string } | null {
  if (!MONEY.test(counted.trim())) return null;
  const delta = moneyToMinorUnits(counted.trim()) - moneyToMinorUnits(expected);
  if (delta === 0n) return { label: 'Exact — the drawer matches the system', tone: 'even' };
  const amount = formatPkrMoney(minorUnitsToMoney(delta < 0n ? -delta : delta));
  return delta > 0n
    ? { label: `${amount} more than the system`, tone: 'over' }
    : { label: `${amount} short of the system`, tone: 'short' };
}

function changeFor(received: string, total: string): string | null {
  if (!MONEY.test(received.trim())) return null;
  const change = moneyToMinorUnits(received.trim()) - moneyToMinorUnits(total);
  return change >= 0n ? minorUnitsToMoney(change) : null;
}

function OrderCard({
  order,
  busy,
  onClear,
  onCancel,
  onClaim,
  canDiscount,
  requiresManagerApproval,
  onDiscount,
}: {
  readonly order: CashCounterOrder;
  readonly busy: boolean;
  readonly onClear: (tendered: string | null) => void;
  readonly onCancel: () => void;
  readonly onClaim: () => void;
  readonly canDiscount: boolean;
  readonly requiresManagerApproval: boolean;
  readonly onDiscount: (input: {
    amount: string;
    reason: string;
    username: string;
    password: string;
  }) => void;
}): React.JSX.Element {
  const elsewhere = order.claimedBy && !order.claimedHere ? order.claimedBy : null;
  const [received, setReceived] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const change = changeFor(received, order.total);
  const short = received.trim() !== '' && MONEY.test(received.trim()) && change === null;
  const clear = (): void => onClear(received.trim() && change !== null ? received.trim() : null);
  return (
    <article
      className={[
        'bill-card',
        order.forThisCounter ? 'for-here' : '',
        elsewhere ? 'paid-elsewhere' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Bill #${order.id}`}
    >
      <header>
        <strong className="bill-number">#{order.id}</strong>
        <em className="bill-route">
          {order.forThisCounter
            ? 'For this counter'
            : order.cashCounterName
              ? `For ${order.cashCounterName}`
              : 'Any counter'}
        </em>
        <span>
          {order.orderTaker} · {order.counterName} · {minutesAgo(order.queuedAt)}
          {order.customerName ? ` · ${order.customerName}` : ''}
        </span>
      </header>
      <ul className="bill-items">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${String(index)}`}>
            <span>
              {item.name} {item.strength}
            </span>
            <b>× {item.quantity.replace(/\.?0+$/, '')}</b>
          </li>
        ))}
      </ul>
      <div className="bill-amount">
        <span>Bill</span>
        <strong>{formatPkrMoney(order.total)}</strong>
      </div>
      {canDiscount ? (
        <div className="bill-discount">
          {!discountOpen ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || Boolean(elsewhere)}
              onClick={() => setDiscountOpen(true)}
            >
              Apply discount / manager approval
            </button>
          ) : (
            <div className="movement-form">
              <label>
                Invoice discount total (PKR)
                <input
                  inputMode="decimal"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label>
                Reason
                <input
                  value={discountReason}
                  onChange={(event) => setDiscountReason(event.target.value)}
                  placeholder="Customer discount approved"
                />
              </label>
              {requiresManagerApproval ? (
                <>
                  <label>
                    Manager username
                    <input
                      autoComplete="username"
                      value={approverUsername}
                      onChange={(event) => setApproverUsername(event.target.value)}
                    />
                  </label>
                  <label>
                    Manager password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={approverPassword}
                      onChange={(event) => setApproverPassword(event.target.value)}
                    />
                  </label>
                  <small>Owner approval is required while cashier discounts are disabled.</small>
                </>
              ) : null}
              <div className="bill-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    busy ||
                    !MONEY.test(discount.trim()) ||
                    discountReason.trim().length < 3 ||
                    (requiresManagerApproval &&
                      (!approverUsername.trim() || approverPassword.length < 8))
                  }
                  onClick={() =>
                    onDiscount({
                      amount: discount.trim(),
                      reason: discountReason.trim(),
                      username: approverUsername.trim(),
                      password: approverPassword,
                    })
                  }
                >
                  Apply before payment
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDiscountOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {elsewhere ? (
        <p className="bill-elsewhere" role="status">
          Being paid at {elsewhere}
        </p>
      ) : null}
      <div className="bill-pay">
        <label>
          Cash received (optional)
          <input
            inputMode="decimal"
            value={received}
            placeholder="e.g. 2000"
            disabled={Boolean(elsewhere)}
            onFocus={onClaim}
            onChange={(event) => setReceived(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !short) {
                event.preventDefault();
                clear();
              }
            }}
          />
        </label>
        <div className={short ? 'bill-change short' : 'bill-change'} aria-live="polite">
          {short
            ? 'Less than the bill'
            : change !== null
              ? `Give back ${formatPkrMoney(change)}`
              : ''}
        </div>
      </div>
      <div className="bill-actions">
        <button
          type="button"
          className="primary-button bill-clear"
          disabled={busy || short || Boolean(elsewhere)}
          onClick={clear}
        >
          {busy ? 'Clearing…' : 'Payment received ✓'}
        </button>
        <button type="button" className="link-button danger" disabled={busy} onClick={onCancel}>
          Customer left — cancel order
        </button>
      </div>
    </article>
  );
}

/**
 * The cash counter as a Pakistani pharmacy runs it: count the wooden drawer and start the day,
 * clear each bill the order desk sends, and count again at closing so the system and the drawer
 * agree — the day's audit.
 */
export function CashCounterScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const permissions = session?.user.permissions ?? [];
  const canApprove = permissions.includes(PERMISSIONS.CASH_APPROVE_VARIANCE);
  const canClear = permissions.includes(PERMISSIONS.SALE_FINALIZE_PAYMENT);
  const hasDiscountAuthority =
    permissions.includes(PERMISSIONS.SALE_DISCOUNT_BASIC) ||
    permissions.includes(PERMISSIONS.SALE_DISCOUNT_OVERRIDE);
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ['counter-settings'],
    queryFn: () => getCounterSettings(token),
    staleTime: 60_000,
    retry: false,
  });
  const canOfferDiscount =
    hasDiscountAuthority ||
    permissions.includes(PERMISSIONS.POS_SEND_TO_CASHIER) ||
    settings.data?.cashierDiscountEnabled === true;
  const requiresManagerApproval =
    !hasDiscountAuthority && settings.data?.cashierDiscountEnabled !== true;
  const current = useQuery({
    queryKey: ['cash-session-current'],
    queryFn: () => getCurrentCashSession(token),
    refetchInterval: 10_000,
  });
  const day = current.data?.status === 'OPEN' ? current.data : null;
  const queue = useQuery({
    queryKey: ['cash-counter-queue'],
    queryFn: () => getCashCounterQueue(token),
    enabled: day !== null && canClear,
    refetchInterval: 3_000,
  });
  const pending = useQuery({
    queryKey: ['cash-session-pending'],
    queryFn: () => getPendingCashVariances(token),
    enabled: canApprove,
  });
  const requestIds = useRef(new Map<string, string>());
  const discountRequestIds = useRef(new Map<string, string>());
  const [openingFloat, setOpeningFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [movement, setMovement] = useState({
    type: 'CASH_OUT' as 'CASH_IN' | 'CASH_OUT',
    amount: '',
    reason: '',
  });
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [closedDay, setClosedDay] = useState<CashSessionSummary | null>(null);
  const [printReceipt, setPrintReceipt] = useState<SaleReceipt | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['cash-session-current'] });
    await client.invalidateQueries({ queryKey: ['cash-counter-queue'] });
    if (canApprove) await client.invalidateQueries({ queryKey: ['cash-session-pending'] });
  };
  const act = async (operation: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await operation();
      await refresh();
      if (done) setMessage(done);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.');
      return false;
    } finally {
      setWorking(false);
    }
  };

  const clearOrder = async (order: CashCounterOrder, tendered: string | null): Promise<void> => {
    if (!day) return;
    // One request id per bill, so a retry after a dropped connection never charges twice.
    const requestId = requestIds.current.get(order.id) ?? createClientRequestId();
    requestIds.current.set(order.id, requestId);
    setBusyOrder(order.id);
    setError('');
    setMessage('');
    try {
      const sale = await clearCashCounterPayment(token, order.id, {
        cashSessionId: day.id,
        clientRequestId: requestId,
        ...(tendered ? { tenderedAmount: tendered } : {}),
      });
      requestIds.current.delete(order.id);
      setMessage(
        `Bill #${order.id} cleared · invoice ${sale.invoiceNumber} · ${formatPkrMoney(sale.total)}`,
      );
      await refresh();
      setPrintReceipt(await getSaleReceipt(token, sale.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be cleared');
    } finally {
      setBusyOrder(null);
    }
  };

  const discountOrder = async (
    order: CashCounterOrder,
    input: { amount: string; reason: string; username: string; password: string },
  ): Promise<void> => {
    const requestId = discountRequestIds.current.get(order.id) ?? createClientRequestId();
    discountRequestIds.current.set(order.id, requestId);
    setBusyOrder(order.id);
    setError('');
    setMessage('');
    try {
      const result = await applySaleDiscount(token, order.id, {
        lineDiscounts: order.items
          .filter((item) => item.discountAmount !== '0.00')
          .map((item) => ({ medicineId: item.medicineId, amount: item.discountAmount })),
        invoiceDiscount: input.amount,
        reason: input.reason,
        clientRequestId: requestId,
        ...(input.username && input.password
          ? { approverUsername: input.username, approverPassword: input.password }
          : {}),
      });
      discountRequestIds.current.delete(order.id);
      await refresh();
      setMessage(
        `Discount applied to bill #${order.id}; new total ${formatPkrMoney(result.total)}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Discount could not be approved');
    } finally {
      setBusyOrder(null);
    }
  };

  const reprint = async (saleId: string): Promise<void> => {
    try {
      setPrintReceipt(await getSaleReceipt(token, saleId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invoice could not be loaded');
    }
  };

  const [findText, setFindText] = useState('');
  const allOrders = queue.data?.data ?? [];
  const wanted = findText.replace(/\D/g, '');
  const orders = wanted ? allOrders.filter((order) => order.id.includes(wanted)) : allOrders;
  // Tell other counters this bill is being paid here; the server also checks on clearing.
  const claim = (order: CashCounterOrder): void => {
    if (order.claimedHere) return;
    void claimCashCounterBill(token, order.id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'This bill is being paid elsewhere');
      void refresh();
    });
  };
  const recent = queue.data?.recent ?? [];
  const closingCheck = day ? difference(counted, day.expectedCash) : null;
  const sessionsOff = settings.data?.cashSessionsEnabled === false;

  return (
    <main className="operations-canvas cash-counter">
      {printReceipt ? (
        <ReceiptDialog
          key={printReceipt.sale.id}
          receipt={printReceipt}
          token={token}
          onClose={() => setPrintReceipt(null)}
        />
      ) : null}
      <section className="cash-counter-head">
        <div>
          <p className="eyebrow">{session?.user.terminalName ?? 'Cash counter'}</p>
          <h1>Cash counter</h1>
        </div>
        {day ? (
          <div className="day-chip">
            <span>Day started</span>
            <strong>
              {new Date(day.openedAt).toLocaleTimeString('en-PK', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </strong>
          </div>
        ) : null}
      </section>
      {message ? (
        <p className="counter-notice big-notice" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="inline-error big-notice" role="alert">
          {error}
        </p>
      ) : null}
      {current.error ? <p className="inline-error">{current.error.message}</p> : null}
      {pending.error ? (
        <p className="inline-error" role="alert">
          {pending.error.message}
        </p>
      ) : null}
      {current.data?.status === 'CLOSING' ? (
        <p className="counter-notice" role="status">
          This day is waiting for variance approval. Another authorized manager must review and
          approve the difference before you can start a new day.
        </p>
      ) : null}

      {sessionsOff ? (
        <section className="work-panel cash-explainer">
          <h2>This shop does not use a cash counter</h2>
          <p>
            The order desk prints the invoice and the customer pays against it. Sales are still
            totalled per counter and per day. The super admin can switch cash sessions on.
          </p>
        </section>
      ) : null}

      {!sessionsOff && !current.isLoading && !current.data ? (
        <section className="work-panel start-day">
          {closedDay ? (
            <div className="day-result">
              <h2>Day closed</h2>
              <dl>
                <div>
                  <dt>Should have been in the drawer</dt>
                  <dd>{formatPkrMoney(closedDay.expectedCash)}</dd>
                </div>
                <div>
                  <dt>Counted</dt>
                  <dd>{formatPkrMoney(closedDay.countedCash)}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd>{formatPkrMoney(closedDay.variance)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <h2>Start the day</h2>
          <label className="big-field">
            How much cash is in the drawer right now? (PKR)
            <input
              inputMode="decimal"
              value={openingFloat}
              placeholder="0"
              onChange={(event) => setOpeningFloat(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary-button big-button"
            disabled={working || !MONEY.test(openingFloat.trim() || '0')}
            onClick={() =>
              void act(async () => {
                await openCashSession(token, openingFloat.trim() || '0');
                setOpeningFloat('');
                setClosedDay(null);
              }, 'Day started. Bills from the order desk appear below.')
            }
          >
            Start day
          </button>
        </section>
      ) : null}

      {current.data?.status === 'CLOSING' ? (
        <section className="work-panel variance-alert big-notice">
          <h2>Day counted — waiting for the manager</h2>
          <p>
            Counted {formatPkrMoney(current.data.countedCash)} against{' '}
            {formatPkrMoney(current.data.expectedCash)} expected (difference{' '}
            {formatPkrMoney(current.data.variance)}). A manager approves the difference before a new
            day can start.
          </p>
        </section>
      ) : null}

      {day ? (
        <section className="cash-counter-grid">
          <div className="bill-queue">
            <h2>
              Waiting for payment <span>{allOrders.length}</span>
            </h2>
            {allOrders.length > 3 ? (
              <label className="find-bill">
                <span>Find bill #</span>
                <input
                  inputMode="numeric"
                  value={findText}
                  placeholder="Type the number on the slip"
                  onChange={(event) => setFindText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      document
                        .querySelector<HTMLInputElement>(
                          '.bill-card .bill-pay input:not(:disabled)',
                        )
                        ?.focus();
                    }
                  }}
                />
              </label>
            ) : null}
            {!canClear ? (
              <p className="inline-error">This account cannot take payments.</p>
            ) : orders.length === 0 ? (
              <p className="empty-bills">
                No bills waiting. New orders from the order desk appear here by themselves.
              </p>
            ) : (
              orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  busy={busyOrder === order.id}
                  onClear={(tendered) => void clearOrder(order, tendered)}
                  onClaim={() => claim(order)}
                  canDiscount={canOfferDiscount}
                  requiresManagerApproval={requiresManagerApproval}
                  onDiscount={(input) => void discountOrder(order, input)}
                  onCancel={() =>
                    void act(
                      () => cancelCashCounterOrder(token, order.id),
                      `Bill #${order.id} cancelled and its medicines released`,
                    )
                  }
                />
              ))
            )}
          </div>

          <aside className="drawer-panel">
            <section className="work-panel drawer-total">
              <h2>Today’s drawer</h2>
              <dl>
                <div>
                  <dt>Cash at start of day</dt>
                  <dd>{formatPkrMoney(day.openingFloat)}</dd>
                </div>
                <div>
                  <dt>Cash received for bills</dt>
                  <dd>{formatPkrMoney(day.cashSales)}</dd>
                </div>
                {day.accountPayments !== '0.00' ? (
                  <div>
                    <dt>Customer account payments</dt>
                    <dd>{formatPkrMoney(day.accountPayments)}</dd>
                  </div>
                ) : null}
                {day.cashRefunds !== '0.00' ? (
                  <div>
                    <dt>Refunds paid out</dt>
                    <dd>−{formatPkrMoney(day.cashRefunds)}</dd>
                  </div>
                ) : null}
                {day.cashIn !== '0.00' || day.cashOut !== '0.00' ? (
                  <div>
                    <dt>Cash added / removed</dt>
                    <dd>
                      +{formatPkrMoney(day.cashIn)} / −{formatPkrMoney(day.cashOut)}
                    </dd>
                  </div>
                ) : null}
                <div className="drawer-expected">
                  <dt>Should be in the drawer</dt>
                  <dd>{formatPkrMoney(day.expectedCash)}</dd>
                </div>
              </dl>
            </section>

            <section className="work-panel recent-payments">
              <h2>Recent payments</h2>
              {recent.length === 0 ? <p className="side-hint">None yet today.</p> : null}
              {recent.map((sale) => (
                <div key={sale.id}>
                  <span>
                    <strong>{formatPkrMoney(sale.total)}</strong>
                    <small>{sale.invoiceNumber}</small>
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => void reprint(sale.id)}
                  >
                    Print
                  </button>
                </div>
              ))}
            </section>

            <details className="work-panel cash-movement">
              <summary>Add or take out cash</summary>
              <div className="movement-form">
                <div className="choice-row" role="group" aria-label="Cash direction">
                  <button
                    type="button"
                    aria-pressed={movement.type === 'CASH_OUT'}
                    onClick={() => setMovement({ ...movement, type: 'CASH_OUT' })}
                  >
                    Take out
                  </button>
                  <button
                    type="button"
                    aria-pressed={movement.type === 'CASH_IN'}
                    onClick={() => setMovement({ ...movement, type: 'CASH_IN' })}
                  >
                    Add
                  </button>
                </div>
                <label>
                  Amount (PKR)
                  <input
                    inputMode="decimal"
                    value={movement.amount}
                    onChange={(event) => setMovement({ ...movement, amount: event.target.value })}
                  />
                </label>
                <label>
                  Reason
                  <input
                    value={movement.reason}
                    placeholder="Bank deposit, change from bank, petty cash…"
                    onChange={(event) => setMovement({ ...movement, reason: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    working ||
                    !MONEY.test(movement.amount.trim()) ||
                    movement.reason.trim().length < 3
                  }
                  onClick={() =>
                    void act(async () => {
                      await addCashMovement(token, day.id, {
                        movementType: movement.type,
                        amount: movement.amount.trim(),
                        reason: movement.reason.trim(),
                      });
                      setMovement({ ...movement, amount: '', reason: '' });
                    }, 'Cash movement recorded')
                  }
                >
                  Record
                </button>
              </div>
            </details>

            <section className="work-panel end-day">
              <h2>End the day</h2>
              <label className="big-field">
                Count the cash in the drawer (PKR)
                <input
                  inputMode="decimal"
                  value={counted}
                  placeholder="Counted cash"
                  onChange={(event) => setCounted(event.target.value)}
                />
              </label>
              {closingCheck ? (
                <p className={`closing-check ${closingCheck.tone}`} aria-live="polite">
                  {closingCheck.label}
                </p>
              ) : null}
              <label>
                Note (optional)
                <input
                  value={closingNotes}
                  onChange={(event) => setClosingNotes(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-button big-button"
                disabled={working || !MONEY.test(counted.trim()) || orders.length > 0}
                onClick={() =>
                  void act(async () => {
                    const result = await closeCashSession(
                      token,
                      day.id,
                      counted.trim(),
                      closingNotes.trim() || undefined,
                    );
                    setClosedDay(result);
                    setCounted('');
                    setClosingNotes('');
                  }, 'Day ended')
                }
              >
                End day
              </button>
              {orders.length > 0 ? (
                <p className="side-hint">
                  Clear or cancel the waiting bills before ending the day.
                </p>
              ) : null}
            </section>
          </aside>
        </section>
      ) : null}

      {canApprove && (pending.data?.length ?? 0) > 0 ? (
        <section className="work-panel variance-queue">
          <header>
            <div>
              <p className="eyebrow">Manager</p>
              <h2>Days waiting for approval</h2>
            </div>
          </header>
          <div className="data-list">
            {(pending.data ?? []).map((item) => (
              <div className="variance-row" key={item.id}>
                <div>
                  <strong>{item.cashierName}</strong>
                  <small>
                    Expected {formatPkrMoney(item.expectedCash)} · counted{' '}
                    {formatPkrMoney(item.countedCash)}
                  </small>
                  <p>Difference: {formatPkrMoney(item.variance)}</p>
                  {item.cashierUserId === session?.user.id ? (
                    <small>Another authorized manager must approve your drawer difference.</small>
                  ) : null}
                </div>
                <label>
                  Approval note
                  <input
                    value={approvalNotes[item.id] ?? ''}
                    onChange={(event) =>
                      setApprovalNotes({ ...approvalNotes, [item.id]: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    working ||
                    item.cashierUserId === session?.user.id ||
                    (approvalNotes[item.id] ?? '').trim().length < 3
                  }
                  onClick={() => {
                    const key = `variance:${item.id}`;
                    const requestId = requestIds.current.get(key) ?? createClientRequestId();
                    requestIds.current.set(key, requestId);
                    void act(
                      () =>
                        approveCashVariance(
                          token,
                          item.id,
                          approvalNotes[item.id] ?? '',
                          requestId,
                        ),
                      'Difference approved',
                    ).then((ok) => {
                      if (ok) requestIds.current.delete(key);
                    });
                  }}
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
