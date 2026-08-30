import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  addCashMovement,
  approveReturn,
  approveCashVariance,
  askOwnerAssistant,
  calculateBudgetRegimen,
  closeCashSession,
  getExpiryRisk,
  getInventoryAttention,
  getCurrentCashSession,
  getPendingCashVariances,
  getReorderSuggestions,
  getShelfRecommendations,
  lookupReturn,
  openCashSession,
  refundReturn,
  requestReturn,
  reviewReorderSuggestion,
  reviewShelfRecommendation,
  type BudgetRegimenResult,
  type CashSessionSummary,
  type OwnerAnswer,
  type OwnerTool,
  type ReturnLookup,
  type ReturnCommandResult,
} from './api';
import { usePharmacyStore } from './store';

export type OperationalView = 'cash' | 'inventory' | 'budget' | 'returns' | 'owner';

const currency = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  minimumFractionDigits: 0,
});

const ownerQuestions: ReadonlyArray<{ readonly question: string; readonly tool: OwnerTool }> = [
  { question: 'What is most likely to run out soon?', tool: 'get_purchase_suggestions' },
  { question: 'Which batches need expiry action first?', tool: 'get_expiry_risk' },
  { question: 'Summarize sales for the last 30 days.', tool: 'get_sales_summary' },
  {
    question: 'Which shelf changes would save the most picking time?',
    tool: 'get_shelf_recommendations',
  },
];

function WorkspaceHeader({ view }: { readonly view: OperationalView }): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const setSession = usePharmacyStore((state) => state.setSession);
  const links: ReadonlyArray<{ readonly key: OperationalView | 'pos'; readonly label: string }> = [
    { key: 'pos', label: 'Counter' },
    { key: 'cash', label: 'Cash session' },
    { key: 'inventory', label: 'Inventory intelligence' },
    { key: 'budget', label: 'Budget calculator' },
    { key: 'returns', label: 'Returns' },
    { key: 'owner', label: 'Owner assistant' },
  ];
  return (
    <header className="topbar operational-topbar">
      <div className="compact-brand">
        <span className="brand-mark">Rx</span>
        <strong>PharmacyOS</strong>
      </div>
      <nav aria-label="Primary navigation">
        {links.map((link) => (
          <a className={view === link.key ? 'active' : ''} href={`#${link.key}`} key={link.key}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="operator">
        <button onClick={() => setSession(null)}>
          {session?.user.displayName ?? 'Operator'} · Sign out
        </button>
      </div>
    </header>
  );
}

function MoneyCell({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{currency.format(Number(value))}</dd>
    </div>
  );
}

function CashSessionScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const canApprove = session?.user.permissions.includes('cash.approve_variance') ?? false;
  const current = useQuery({
    queryKey: ['cash-session-current'],
    queryFn: () => getCurrentCashSession(token),
  });
  const pending = useQuery({
    queryKey: ['cash-session-pending'],
    queryFn: () => getPendingCashVariances(token),
    enabled: canApprove,
  });
  const [openingFloat, setOpeningFloat] = useState('5000');
  const [movementType, setMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = async (): Promise<void> => {
    await Promise.all([current.refetch(), canApprove ? pending.refetch() : Promise.resolve()]);
  };
  const act = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      setWorking(true);
      setActionError('');
      await operation();
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Cash-session action failed');
    } finally {
      setWorking(false);
    }
  };
  const cashSession = current.data;
  const queryError = current.error ?? pending.error;

  return (
    <main className="operations-canvas cash-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Controlled till lifecycle</p>
          <h1>Cash session and reconciliation</h1>
          <p>
            Sales, refunds and signed cash movements produce the expected balance. Large variances
            require independent approval.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void refresh()}>
          Refresh balance
        </button>
      </section>
      {queryError ? <p className="inline-error">{queryError.message}</p> : null}
      {actionError ? <p className="inline-error">{actionError}</p> : null}

      {!current.isLoading && !cashSession ? (
        <section className="work-panel cash-open-panel">
          <header>
            <div>
              <p className="eyebrow">Start of shift</p>
              <h2>Open this terminal’s till</h2>
            </div>
          </header>
          <label>
            Opening float (PKR)
            <input
              inputMode="decimal"
              value={openingFloat}
              onChange={(event) => setOpeningFloat(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            disabled={working}
            onClick={() => void act(() => openCashSession(token, openingFloat))}
          >
            Open cash session
          </button>
        </section>
      ) : null}

      {cashSession ? (
        <section className="cash-session-grid">
          <article className="work-panel cash-summary-panel">
            <header>
              <div>
                <p className="eyebrow">Session {cashSession.id}</p>
                <h2>{cashSession.status.replaceAll('_', ' ')}</h2>
              </div>
              <span>{cashSession.cashierName}</span>
            </header>
            <dl className="cash-ledger">
              <MoneyCell label="Opening float" value={cashSession.openingFloat} />
              <MoneyCell label="Cash sales" value={cashSession.cashSales} />
              <MoneyCell label="Cash refunds" value={`-${cashSession.cashRefunds}`} />
              <MoneyCell label="Cash in" value={cashSession.cashIn} />
              <MoneyCell label="Cash out" value={`-${cashSession.cashOut}`} />
              <MoneyCell label="Expected cash" value={cashSession.expectedCash} />
            </dl>
            {cashSession.status === 'CLOSING' ? (
              <p className="variance-alert">
                Counted {currency.format(Number(cashSession.countedCash))}; variance{' '}
                {currency.format(Number(cashSession.variance))}. Independent approval is required.
              </p>
            ) : null}
          </article>

          {cashSession.status === 'OPEN' ? (
            <div className="cash-actions-stack">
              <article className="work-panel cash-action-card">
                <header>
                  <div>
                    <p className="eyebrow">Signed adjustment</p>
                    <h2>Record cash movement</h2>
                  </div>
                </header>
                <div className="cash-form-row">
                  <label>
                    Direction
                    <select
                      value={movementType}
                      onChange={(event) =>
                        setMovementType(event.target.value as 'CASH_IN' | 'CASH_OUT')
                      }
                    >
                      <option value="CASH_OUT">Cash out</option>
                      <option value="CASH_IN">Cash in</option>
                    </select>
                  </label>
                  <label>
                    Amount
                    <input
                      inputMode="decimal"
                      value={movementAmount}
                      onChange={(event) => setMovementAmount(event.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Reason
                  <input
                    value={movementReason}
                    onChange={(event) => setMovementReason(event.target.value)}
                    placeholder="Petty cash, bank deposit, till top-up…"
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={working || !movementAmount || movementReason.trim().length < 3}
                  onClick={() =>
                    void act(async () => {
                      await addCashMovement(token, cashSession.id, {
                        movementType,
                        amount: movementAmount,
                        reason: movementReason,
                      });
                      setMovementAmount('');
                      setMovementReason('');
                    })
                  }
                >
                  Record movement
                </button>
              </article>
              <article className="work-panel cash-action-card">
                <header>
                  <div>
                    <p className="eyebrow">End of shift</p>
                    <h2>Count and close</h2>
                  </div>
                </header>
                <label>
                  Counted cash (PKR)
                  <input
                    inputMode="decimal"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                  />
                </label>
                <label>
                  Closing notes
                  <textarea
                    value={closingNotes}
                    onChange={(event) => setClosingNotes(event.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={working || !countedCash}
                  onClick={() =>
                    void act(() =>
                      closeCashSession(
                        token,
                        cashSession.id,
                        countedCash,
                        closingNotes || undefined,
                      ),
                    )
                  }
                >
                  Submit count
                </button>
                <small>
                  Variance approval threshold:{' '}
                  {currency.format(Number(cashSession.varianceApprovalThreshold))}
                </small>
              </article>
            </div>
          ) : null}
        </section>
      ) : null}

      {canApprove ? (
        <section className="work-panel variance-queue">
          <header>
            <div>
              <p className="eyebrow">Separation of duties</p>
              <h2>Variance approvals</h2>
            </div>
            <span>{pending.data?.length ?? 0} waiting</span>
          </header>
          <div className="data-list">
            {(pending.data ?? []).map((item: CashSessionSummary) => (
              <div className="variance-row" key={item.id}>
                <div>
                  <strong>{item.cashierName}</strong>
                  <small>
                    Expected {currency.format(Number(item.expectedCash))} · counted{' '}
                    {currency.format(Number(item.countedCash))}
                  </small>
                  <p>Variance: {currency.format(Number(item.variance))}</p>
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
                  className="primary-button"
                  disabled={working || (approvalNotes[item.id] ?? '').trim().length < 3}
                  onClick={() =>
                    void act(() =>
                      approveCashVariance(token, item.id, approvalNotes[item.id] ?? ''),
                    )
                  }
                >
                  Approve variance
                </button>
              </div>
            ))}
            {!pending.isLoading && pending.data?.length === 0 ? (
              <p className="empty-state">No cash variance is awaiting approval.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function InventoryIntelligence(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const queryClient = useQueryClient();
  const attention = useQuery({
    queryKey: ['attention'],
    queryFn: () => getInventoryAttention(token),
  });
  const expiry = useQuery({ queryKey: ['expiry-risk'], queryFn: () => getExpiryRisk(token) });
  const shelves = useQuery({
    queryKey: ['shelf-recommendations'],
    queryFn: () => getShelfRecommendations(token),
  });
  const reorders = useQuery({
    queryKey: ['reorder-suggestions'],
    queryFn: () => getReorderSuggestions(token),
  });
  const [actionError, setActionError] = useState('');

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['attention'] });
    await queryClient.invalidateQueries({ queryKey: ['expiry-risk'] });
    await queryClient.invalidateQueries({ queryKey: ['shelf-recommendations'] });
    await queryClient.invalidateQueries({ queryKey: ['reorder-suggestions'] });
  };
  const shelfAction = async (id: string, decision: 'APPLY' | 'DISMISS'): Promise<void> => {
    try {
      setActionError('');
      await reviewShelfRecommendation(token, id, decision);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Shelf action failed');
    }
  };
  const reorderAction = async (id: string, decision: 'REVIEW' | 'DISMISS'): Promise<void> => {
    try {
      setActionError('');
      await reviewReorderSuggestion(token, id, decision);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Reorder action failed');
    }
  };
  const queryError = attention.error ?? expiry.error ?? shelves.error ?? reorders.error;

  return (
    <main className="operations-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Morning control desk</p>
          <h1>Act on stock risk, in order.</h1>
          <p>
            Every number comes from finalized sales, batch stock, or saved recommendation inputs.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void refresh()}>
          Refresh local data
        </button>
      </section>
      {queryError ? <p className="inline-error">{queryError.message}</p> : null}
      {actionError ? <p className="inline-error">{actionError}</p> : null}
      <section className="attention-ledger" aria-label="Inventory attention counts">
        {[
          ['Expired batches', attention.data?.expired ?? '—', 'critical'],
          ['0–30 day risk', attention.data?.critical_expiry ?? '—', 'warning'],
          ['Open reorders', attention.data?.open_reorders ?? '—', 'standard'],
          ['Shelf reviews', attention.data?.pending_shelf ?? '—', 'standard'],
        ].map(([label, value, tone]) => (
          <article className={`attention-cell ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="operations-grid">
        <article className="work-panel expiry-panel">
          <header>
            <div>
              <p className="eyebrow">01 · Loss prevention</p>
              <h2>Expiry work queue</h2>
            </div>
            <span>Acquisition cost basis</span>
          </header>
          <div className="data-list">
            {(expiry.data ?? []).slice(0, 12).map((item) => (
              <div className="data-row" key={item.batch_id}>
                <span className={`risk-mark ${item.risk_bucket.toLowerCase()}`} />
                <div>
                  <strong>{item.medicine_name}</strong>
                  <small>
                    Batch {item.batch_number} · {item.expiry_date}
                  </small>
                </div>
                <div>
                  <small>{item.quantity} units</small>
                  <b>{currency.format(Number(item.value_at_risk))}</b>
                </div>
              </div>
            ))}
            {!expiry.isLoading && expiry.data?.length === 0 ? (
              <p className="empty-state">No batch is inside the configured 90-day risk window.</p>
            ) : null}
          </div>
        </article>

        <article className="work-panel">
          <header>
            <div>
              <p className="eyebrow">02 · Placement</p>
              <h2>Shelf recommendations</h2>
            </div>
            <span>Human approval required</span>
          </header>
          <div className="data-list">
            {(shelves.data ?? []).slice(0, 8).map((item) => (
              <div className="decision-row" key={item.id}>
                <div>
                  <strong>{item.medicine_name}</strong>
                  <small>
                    {item.demand_class} demand · {item.pick_count} picks ·{' '}
                    {item.confidence.toLowerCase()} confidence
                  </small>
                  <p>
                    {item.current_location ?? 'No primary shelf'} → {item.suggested_location}
                  </p>
                </div>
                <div className="mini-actions">
                  <button onClick={() => void shelfAction(item.id, 'DISMISS')}>Dismiss</button>
                  <button onClick={() => void shelfAction(item.id, 'APPLY')}>Apply</button>
                </div>
              </div>
            ))}
            {!shelves.isLoading && shelves.data?.length === 0 ? (
              <p className="empty-state">
                No shelf change currently clears the configured improvement threshold.
              </p>
            ) : null}
          </div>
        </article>

        <article className="work-panel reorder-panel">
          <header>
            <div>
              <p className="eyebrow">03 · Procurement</p>
              <h2>Explainable reorder queue</h2>
            </div>
            <span>No supplier order is sent automatically</span>
          </header>
          <div className="data-list">
            {(reorders.data ?? []).slice(0, 10).map((item) => (
              <div className="decision-row" key={item.id}>
                <div>
                  <strong>{item.medicine_name}</strong>
                  <small>
                    {item.current_sellable_stock} available · {item.effective_lead_time_days} day
                    lead time · {item.confidence.toLowerCase()} confidence
                  </small>
                  <p>
                    Suggested order: <b>{item.suggested_qty}</b>
                    {item.expiry_risk_flag ? ' · expiry risk flagged' : ''}
                  </p>
                </div>
                <div className="mini-actions">
                  <button onClick={() => void reorderAction(item.id, 'DISMISS')}>Dismiss</button>
                  <button onClick={() => void reorderAction(item.id, 'REVIEW')}>
                    Mark reviewed
                  </button>
                </div>
              </div>
            ))}
            {!reorders.isLoading && reorders.data?.length === 0 ? (
              <p className="empty-state">
                No active reorder suggestion. The daily worker generates these from demand and
                availability history.
              </p>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}

function BudgetCalculator(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const cart = usePharmacyStore((state) => state.cart);
  const [budget, setBudget] = useState('1000');
  const [dailyUnits, setDailyUnits] = useState<Record<string, string>>({});
  const [increments, setIncrements] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BudgetRegimenResult | null>(null);
  const [error, setError] = useState('');
  const calculate = async (): Promise<void> => {
    try {
      setError('');
      const response = await calculateBudgetRegimen(session?.accessToken ?? '', {
        budget,
        items: cart.map((line) => ({
          medicineId: line.medicine.id,
          prescribedBaseUnitsPerDay: dailyUnits[line.medicine.id] ?? '1',
          minimumSaleIncrement: increments[line.medicine.id] ?? '1',
        })),
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calculation failed');
    }
  };
  return (
    <main className="operations-canvas narrow-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Affordability, not clinical advice</p>
          <h1>Complete-regimen budget calculator</h1>
          <p>Uses the regimen exactly as entered and maximizes complete days only.</p>
        </div>
      </section>
      <section className="calculator-layout">
        <article className="work-panel regimen-form">
          <header>
            <div>
              <p className="eyebrow">Entered regimen</p>
              <h2>Current cart medicines</h2>
            </div>
          </header>
          {cart.length === 0 ? (
            <p className="empty-state">
              Add medicines at the counter first. Calculating does not reserve stock.
            </p>
          ) : (
            cart.map((line) => (
              <div className="regimen-line" key={line.medicine.id}>
                <div>
                  <strong>{line.medicine.name}</strong>
                  <small>
                    {line.medicine.strength} · current unit price{' '}
                    {currency.format(Number(line.medicine.salePrice ?? 0))}
                  </small>
                </div>
                <label>
                  Units/day
                  <input
                    inputMode="decimal"
                    value={dailyUnits[line.medicine.id] ?? '1'}
                    onChange={(event) =>
                      setDailyUnits({ ...dailyUnits, [line.medicine.id]: event.target.value })
                    }
                  />
                </label>
                <label>
                  Sale increment
                  <input
                    inputMode="decimal"
                    value={increments[line.medicine.id] ?? '1'}
                    onChange={(event) =>
                      setIncrements({ ...increments, [line.medicine.id]: event.target.value })
                    }
                  />
                </label>
              </div>
            ))
          )}
          <label className="budget-input">
            Customer budget (PKR)
            <input
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          {error ? <p className="inline-error">{error}</p> : null}
          <button
            className="primary-button"
            disabled={cart.length === 0}
            onClick={() => void calculate()}
          >
            Calculate complete days
          </button>
        </article>
        <aside className="calculation-result">
          <p className="eyebrow">Safe result</p>
          <strong className="days-result">
            {result?.completeDays ?? '—'}
            <small>complete days</small>
          </strong>
          {result?.completeDays === 0 ? (
            <p>
              Budget is below one complete day. One complete day costs{' '}
              {currency.format(Number(result.oneDayCost))}.
            </p>
          ) : null}
          <dl>
            <div>
              <dt>Total</dt>
              <dd>{result ? currency.format(Number(result.totalCost)) : '—'}</dd>
            </div>
            <div>
              <dt>Budget left</dt>
              <dd>{result ? currency.format(Number(result.remainder)) : '—'}</dd>
            </div>
          </dl>
          {(result?.lines ?? []).map((line) => (
            <div className="result-line" key={line.medicineId}>
              <span>{line.medicineName}</span>
              <b>{line.requiredQuantity} units</b>
            </div>
          ))}
          <p className="safety-note">
            {result?.safetyMessage ??
              'The result will never suggest skipped doses, reduced frequency, or substitutions.'}
          </p>
        </aside>
      </section>
    </main>
  );
}

function ReturnLookupScreen(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const [receiptToken, setReceiptToken] = useState('');
  const [result, setResult] = useState<ReturnLookup | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<
    Record<string, 'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP'>
  >({});
  const [reason, setReason] = useState('');
  const [returnCommand, setReturnCommand] = useState<ReturnCommandResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const lookup = async (): Promise<void> => {
    try {
      setError('');
      const found = await lookupReturn(token, receiptToken.trim());
      setResult(found);
      setReturnCommand(null);
      setQuantities({});
      setDispositions({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Receipt lookup failed');
    }
  };
  const submitRequest = async (): Promise<void> => {
    if (!result) return;
    const items = result.items
      .filter((item) => Number(quantities[item.id] ?? 0) > 0)
      .map((item) => ({
        saleItemId: item.id,
        quantity: quantities[item.id] ?? '0',
        disposition: dispositions[item.id] ?? 'QUARANTINE',
      }));
    try {
      setWorking(true);
      setError('');
      setReturnCommand(await requestReturn(token, receiptToken.trim(), { reason, items }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Return request failed');
    } finally {
      setWorking(false);
    }
  };
  const approve = async (): Promise<void> => {
    if (!returnCommand) return;
    try {
      setWorking(true);
      setError('');
      setReturnCommand(await approveReturn(token, returnCommand.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Return approval failed');
    } finally {
      setWorking(false);
    }
  };
  const refund = async (): Promise<void> => {
    if (!returnCommand) return;
    try {
      setWorking(true);
      setError('');
      const cashSession = await getCurrentCashSession(token);
      if (!cashSession || cashSession.status !== 'OPEN')
        throw new Error('Open a cash session before issuing a cash refund');
      setReturnCommand(
        await refundReturn(token, returnCommand.id, {
          method: 'CASH',
          cashSessionId: cashSession.id,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund failed');
    } finally {
      setWorking(false);
    }
  };
  const canApprove = session?.user.permissions.includes('returns.approve') ?? false;
  const canRefund = session?.user.permissions.includes('returns.refund') ?? false;
  return (
    <main className="operations-canvas narrow-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Authenticated receipt scan</p>
          <h1>Return lookup</h1>
          <p>
            The QR carries only an opaque token. Invoice details resolve here after authorization.
          </p>
        </div>
      </section>
      <section className="return-search">
        <label>
          <span>Scan or paste receipt token</span>
          <input
            autoFocus
            value={receiptToken}
            onChange={(event) => setReceiptToken(event.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </label>
        <button className="primary-button" onClick={() => void lookup()}>
          Find receipt
        </button>
      </section>
      {error ? <p className="inline-error">{error}</p> : null}
      {result ? (
        <article className="work-panel receipt-result">
          <header>
            <div>
              <p className="eyebrow">Original finalized sale</p>
              <h2>{result.sale.invoice_number}</h2>
            </div>
            <strong>{currency.format(Number(result.sale.total))}</strong>
          </header>
          <div className="data-list">
            {result.items.map((item) => (
              <div className="return-item-row" key={item.id}>
                <div>
                  <strong>{item.medicine_name}</strong>
                  <small>Batch {item.batch_number}</small>
                </div>
                <div>
                  <small>Sold {item.sold_quantity}</small>
                  <b>{item.eligible_quantity} eligible</b>
                </div>
                <label>
                  Return quantity
                  <input
                    inputMode="decimal"
                    max={item.eligible_quantity}
                    value={quantities[item.id] ?? ''}
                    onChange={(event) =>
                      setQuantities({ ...quantities, [item.id]: event.target.value })
                    }
                  />
                </label>
                <label>
                  Disposition
                  <select
                    value={dispositions[item.id] ?? 'QUARANTINE'}
                    onChange={(event) =>
                      setDispositions({
                        ...dispositions,
                        [item.id]: event.target.value as
                          'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP',
                      })
                    }
                  >
                    <option value="QUARANTINE">Quarantine</option>
                    <option value="RESTOCK_SELLABLE">Restock sellable</option>
                    <option value="SCRAP">Scrap</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
          <div className="return-command-panel">
            <label>
              Return reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            {!returnCommand ? (
              <button
                className="primary-button"
                disabled={working || reason.trim().length < 3}
                onClick={() => void submitRequest()}
              >
                Submit return request
              </button>
            ) : (
              <div className="return-status-actions">
                <strong>Status: {returnCommand.status}</strong>
                {returnCommand.refundAmount ? (
                  <span>Refunded {currency.format(Number(returnCommand.refundAmount))}</span>
                ) : null}
                {returnCommand.status === 'REQUESTED' && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={working}
                    onClick={() => void approve()}
                  >
                    Approve return
                  </button>
                ) : null}
                {returnCommand.status === 'APPROVED' && canRefund ? (
                  <button
                    className="primary-button"
                    disabled={working}
                    onClick={() => void refund()}
                  >
                    Issue cash refund
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <p className="safety-note">
            Prior accepted/requested quantities are already deducted. A return never edits the
            original sale line.
          </p>
        </article>
      ) : null}
    </main>
  );
}

function OwnerAssistant(): React.JSX.Element {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState<OwnerAnswer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const current = ownerQuestions[selected] ?? ownerQuestions[0];
  const ask = async (): Promise<void> => {
    if (!current) return;
    try {
      setLoading(true);
      setError('');
      setAnswer(await askOwnerAssistant(token, current.question, current.tool));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Assistant is unavailable');
    } finally {
      setLoading(false);
    }
  };
  const factsText = useMemo(() => (answer ? JSON.stringify(answer.facts, null, 2) : ''), [answer]);
  return (
    <main className="operations-canvas assistant-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Owner-only · read-only</p>
          <h1>Ask about operations, never medicine.</h1>
          <p>
            Whitelisted local reports produce the facts. AI may explain them but cannot write,
            order, refund, or change stock.
          </p>
        </div>
      </section>
      <section className="assistant-layout">
        <aside className="question-rail">
          <p className="eyebrow">Suggested questions</p>
          {ownerQuestions.map((item, index) => (
            <button
              className={selected === index ? 'selected' : ''}
              key={item.tool}
              onClick={() => setSelected(index)}
            >
              {item.question}
            </button>
          ))}
        </aside>
        <article className="assistant-answer">
          <header>
            <span>Operational question</span>
            <h2>{current?.question}</h2>
            <button className="primary-button" disabled={loading} onClick={() => void ask()}>
              {loading ? 'Checking local facts…' : 'Get answer'}
            </button>
          </header>
          {error ? <p className="inline-error">{error}</p> : null}
          {answer ? (
            <>
              <section className="fact-block">
                <p className="eyebrow">Authoritative tool result</p>
                <pre>{factsText}</pre>
                <small>{answer.dataBasis}</small>
              </section>
              <section className="explanation-block">
                <p className="eyebrow">AI explanation</p>
                <p>
                  {answer.explanation ??
                    'AI is disabled. The deterministic result above remains available and authoritative.'}
                </p>
              </section>
            </>
          ) : (
            <p className="empty-state">
              Choose a question and get the current local facts. No customer-identifiable
              prescription or health data is sent to the provider.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

export function OperationalWorkspace({
  view,
}: {
  readonly view: OperationalView;
}): React.JSX.Element {
  return (
    <div className="workspace-shell">
      <WorkspaceHeader view={view} />
      {view === 'inventory' ? (
        <InventoryIntelligence />
      ) : view === 'cash' ? (
        <CashSessionScreen />
      ) : view === 'budget' ? (
        <BudgetCalculator />
      ) : view === 'returns' ? (
        <ReturnLookupScreen />
      ) : (
        <OwnerAssistant />
      )}
    </div>
  );
}
