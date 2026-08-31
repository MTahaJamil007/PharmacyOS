import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  getExpiryRisk,
  getInventoryAttention,
  getReorderSuggestions,
  getShelfRecommendations,
  reviewReorderSuggestion,
  reviewShelfRecommendation,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

export function InventoryIntelligence(): React.JSX.Element {
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
                  <b>{formatPkrMoney(item.value_at_risk)}</b>
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
