import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@pharmacy/shared';
import { useState } from 'react';

import {
  adjustInventoryStock,
  searchInventoryBatches,
  updateInventoryPrice,
  type InventoryBatchSummary,
} from '../../api';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';

export function InventoryOperations(): React.JSX.Element | null {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const allowed = session?.user.permissions.includes(PERMISSIONS.INVENTORY_ADJUST) ?? false;
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<InventoryBatchSummary | null>(null);
  const [mode, setMode] = useState<'COUNT' | 'SCRAP' | 'PRICE'>('COUNT');
  const [quantity, setQuantity] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [reason, setReason] = useState('Monthly cycle count');
  const [message, setMessage] = useState('');
  const batches = useQuery({
    queryKey: ['inventory-batches', query],
    queryFn: () => searchInventoryBatches(token, query),
    enabled: allowed && Boolean(token),
  });
  if (!allowed) return null;

  const choose = (batch: InventoryBatchSummary): void => {
    setSelected(batch);
    setQuantity(mode === 'COUNT' ? batch.currentQuantity : '');
    setSalePrice(batch.salePrice);
    setMrp(batch.maximumRetailPrice ?? '');
    setMessage('');
  };
  const submit = async (): Promise<void> => {
    if (!selected) return;
    try {
      setMessage('Saving…');
      if (mode === 'PRICE') {
        await updateInventoryPrice(token, selected.id, {
          salePrice,
          maximumRetailPrice: mrp.trim() ? mrp : null,
          reason,
        });
      } else if (mode === 'COUNT') {
        await adjustInventoryStock(token, selected.id, {
          type: 'COUNT',
          countedQuantity: quantity,
          reason,
        });
      } else {
        await adjustInventoryStock(token, selected.id, { type: 'SCRAP', quantity, reason });
      }
      await client.invalidateQueries({ queryKey: ['inventory-batches'] });
      await client.invalidateQueries({ queryKey: ['attention'] });
      setSelected(null);
      setMessage(`${mode === 'PRICE' ? 'Price' : 'Stock'} record saved`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Inventory operation failed');
    }
  };

  return (
    <section className="operations-canvas inventory-operations" aria-label="Inventory controls">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Physical truth and retail price</p>
          <h1>Count, price, or scrap by batch.</h1>
          <p>No direct quantity overwrite: every variance becomes an immutable movement.</p>
        </div>
      </section>
      {message ? (
        <p className={message.includes('failed') ? 'inline-error' : 'counter-notice'} role="status">
          {message}
        </p>
      ) : null}
      <section className="inventory-operation-layout">
        <article className="work-panel batch-browser">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              placeholder="Medicine or batch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="data-list">
            {(batches.data ?? []).map((batch) => (
              <button
                className={selected?.id === batch.id ? 'batch-row selected' : 'batch-row'}
                key={batch.id}
                onClick={() => choose(batch)}
              >
                <span>
                  <strong>{batch.medicineName}</strong>
                  <small>
                    Batch {batch.batchNumber} · exp {batch.expiryDate}
                  </small>
                </span>
                <span>
                  <b>{batch.currentQuantity}</b>
                  <small>{formatPkrMoney(batch.salePrice)}</small>
                </span>
              </button>
            ))}
          </div>
        </article>
        <article className="work-panel operation-editor">
          <header>
            <div>
              <p className="eyebrow">Controlled write</p>
              <h2>{selected?.medicineName ?? 'Select a batch'}</h2>
            </div>
          </header>
          <div className="segmented-control" role="group" aria-label="Inventory operation">
            {(['COUNT', 'SCRAP', 'PRICE'] as const).map((value) => (
              <button
                className={mode === value ? 'selected' : ''}
                key={value}
                onClick={() => {
                  setMode(value);
                  if (selected) {
                    setQuantity(value === 'COUNT' ? selected.currentQuantity : '');
                    setSalePrice(selected.salePrice);
                    setMrp(selected.maximumRetailPrice ?? '');
                    setMessage('');
                  }
                }}
              >
                {value}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="form-grid single-column">
              {mode === 'PRICE' ? (
                <>
                  <label>
                    Sale price
                    <input
                      inputMode="decimal"
                      value={salePrice}
                      onChange={(event) => setSalePrice(event.target.value)}
                    />
                  </label>
                  <label>
                    Maximum retail price
                    <input
                      inputMode="decimal"
                      value={mrp}
                      onChange={(event) => setMrp(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label>
                  {mode === 'COUNT' ? 'Counted quantity' : 'Quantity to scrap'}
                  <input
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
              )}
              <label>
                Reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button className="primary-button" onClick={() => void submit()}>
                Commit {mode.toLowerCase()}
              </button>
            </div>
          ) : (
            <p className="empty-state">
              Choose the exact acquisition batch before recording a physical or price change.
            </p>
          )}
        </article>
      </section>
    </section>
  );
}
