import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  addCashMovement,
  approveCashVariance,
  closeCashSession,
  getCurrentCashSession,
  getPendingCashVariances,
  openCashSession,
  type CashSessionSummary,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

function MoneyCell({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatPkrMoney(value)}</dd>
    </div>
  );
}

export function CashSessionScreen(): React.JSX.Element {
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
                Counted {formatPkrMoney(cashSession.countedCash)}; variance{' '}
                {formatPkrMoney(cashSession.variance)}. Independent approval is required.
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
                  {formatPkrMoney(cashSession.varianceApprovalThreshold)}
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
                    Expected {formatPkrMoney(item.expectedCash)} · counted{' '}
                    {formatPkrMoney(item.countedCash)}
                  </small>
                  <p>Variance: {formatPkrMoney(item.variance)}</p>
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
