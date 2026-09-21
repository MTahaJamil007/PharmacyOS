import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createClientRequestId,
  PERMISSIONS,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from '@pharmacy/shared';
import { useState } from 'react';

import {
  addSupplierQuote,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  searchMedicines,
} from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatPkrMoney } from '../../money';
import { usePharmacyStore } from '../../store';
import {
  calculatePurchaseLineTotal,
  calculatePurchaseOrderTotal,
  outstandingOrderQuantity,
  selectSubmittableReceiptLines,
  type GoodsReceiptDraftLine,
} from './purchase-order';

const STATUSES: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
];

interface DraftLine {
  readonly key: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly orderedQuantity: string;
  readonly unitCost: string;
  readonly lineDiscount: string;
  readonly bonusQuantity: string;
  readonly baseUnitsPerOrderUnit: string;
}

const emptyReceiptLine = (item: PurchaseOrderLine): GoodsReceiptDraftLine => ({
  batchNumber: '',
  expiryDate: '',
  purchaseOrderItemId: item.id,
  receivedBonusQuantity: '0',
  receivedQuantity: outstandingOrderQuantity(item),
  salePricePerBaseUnit: '',
});

export function ProcurementScreen(): React.JSX.Element | null {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const permissions = session?.user.permissions ?? [];
  const canPurchase = permissions.includes(PERMISSIONS.INVENTORY_PURCHASE);
  const canApproveOrder = permissions.includes(PERMISSIONS.PROCUREMENT_PURCHASE_DRAFT_APPROVE);
  const canQuote = permissions.includes(PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ);
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [draftLines, setDraftLines] = useState<readonly DraftLine[]>([]);
  const [draftRequestId, setDraftRequestId] = useState(createClientRequestId);
  const [medicineQuery, setMedicineQuery] = useState('');
  const debouncedMedicineQuery = useDebouncedValue(medicineQuery, 250);

  const [orderRequestId, setOrderRequestId] = useState(createClientRequestId);
  const [receiptLines, setReceiptLines] = useState<readonly GoodsReceiptDraftLine[]>([]);
  const [receiptInvoiceNumber, setReceiptInvoiceNumber] = useState('');
  const [receiptRequestId, setReceiptRequestId] = useState(createClientRequestId);

  const [quote, setQuote] = useState({
    baseUnitsPerQuoteUnit: '1',
    medicineId: '',
    quoteUnit: 'PACK',
    quotedUnitCost: '',
    source: 'Supplier price list',
  });

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(token),
    enabled: canPurchase && Boolean(token),
  });
  const orders = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => listPurchaseOrders(token, statusFilter || undefined),
    enabled: canPurchase && Boolean(token),
  });
  const order = useQuery({
    queryKey: ['purchase-order', selectedId],
    queryFn: () => getPurchaseOrder(token, selectedId ?? ''),
    enabled: canPurchase && Boolean(token && selectedId),
  });
  const medicines = useQuery({
    queryKey: ['procurement-medicines', debouncedMedicineQuery],
    queryFn: () => searchMedicines(token, debouncedMedicineQuery),
    enabled: canPurchase && Boolean(token) && debouncedMedicineQuery.trim().length > 0,
  });

  if (!canPurchase) return null;

  const draftTotal = ((): string => {
    try {
      return calculatePurchaseOrderTotal(draftLines);
    } catch {
      return '0.00';
    }
  })();

  const lineTotal = (line: DraftLine): string => {
    try {
      return calculatePurchaseLineTotal(line);
    } catch {
      return '—';
    }
  };

  const openOrder = (id: string): void => {
    setSelectedId(id);
    setReceiptLines([]);
    setReceiptInvoiceNumber('');
    setOrderRequestId(createClientRequestId());
    setReceiptRequestId(createClientRequestId());
    setError('');
    setNotice('');
  };

  const addDraftLine = (medicine: { readonly id: string; readonly name: string }): void => {
    setDraftLines((current) =>
      current.some((line) => line.medicineId === medicine.id)
        ? current
        : [
            ...current,
            {
              baseUnitsPerOrderUnit: '1',
              bonusQuantity: '0',
              key: `${medicine.id}-${String(current.length)}`,
              lineDiscount: '0.00',
              medicineId: medicine.id,
              medicineName: medicine.name,
              orderedQuantity: '1',
              unitCost: '0.00',
            },
          ],
    );
    setMedicineQuery('');
  };

  const updateDraftLine = (key: string, field: keyof DraftLine, value: string): void => {
    setDraftLines((current) =>
      current.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );
  };

  const submitDraft = async (): Promise<void> => {
    if (!supplierId || draftLines.length === 0) {
      setError('Choose a supplier and at least one medicine before saving the order');
      return;
    }
    setBusy(true);
    try {
      setError('');
      const created = await createPurchaseOrder(
        token,
        {
          items: draftLines.map((line) => ({
            baseUnitsPerOrderUnit: line.baseUnitsPerOrderUnit,
            bonusQuantity: line.bonusQuantity,
            lineDiscount: line.lineDiscount,
            medicineId: line.medicineId,
            orderedQuantity: line.orderedQuantity,
            unitCost: line.unitCost,
          })),
          supplierId,
          ...(supplierInvoiceNumber.trim()
            ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() }
            : {}),
        },
        draftRequestId,
      );
      setDraftLines([]);
      setSupplierInvoiceNumber('');
      setDraftRequestId(createClientRequestId());
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      openOrder(created.id);
      setNotice(`Purchase order ${created.order_number} saved as a draft`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Purchase order could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const markOrdered = async (): Promise<void> => {
    if (!order.data) return;
    setBusy(true);
    try {
      setError('');
      await markPurchaseOrderOrdered(token, order.data.id, orderRequestId);
      setOrderRequestId(createClientRequestId());
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-order', order.data.id] });
      setNotice('Purchase order sent to the supplier');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Purchase order could not be ordered');
    } finally {
      setBusy(false);
    }
  };

  const startReceipt = (): void => {
    if (!order.data) return;
    setReceiptLines(order.data.items.map(emptyReceiptLine));
    setReceiptInvoiceNumber(order.data.supplier_invoice_number ?? '');
    setReceiptRequestId(createClientRequestId());
    setNotice('');
    setError('');
  };

  const updateReceiptLine = (
    itemId: string,
    field: keyof GoodsReceiptDraftLine,
    value: string,
  ): void => {
    setReceiptLines((current) =>
      current.map((line) =>
        line.purchaseOrderItemId === itemId ? { ...line, [field]: value } : line,
      ),
    );
  };

  const submitReceipt = async (): Promise<void> => {
    if (!order.data) return;
    const lines = selectSubmittableReceiptLines(receiptLines);
    if (lines.length === 0) {
      setError('Enter a batch number, expiry date, sale price, and quantity for at least one line');
      return;
    }
    setBusy(true);
    try {
      setError('');
      await receivePurchaseOrder(
        token,
        order.data.id,
        {
          lines,
          ...(receiptInvoiceNumber.trim()
            ? { supplierInvoiceNumber: receiptInvoiceNumber.trim() }
            : {}),
        },
        receiptRequestId,
      );
      setReceiptLines([]);
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-order', order.data.id] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
      await queryClient.invalidateQueries({ queryKey: ['attention'] });
      setNotice('Goods receipt posted; stock and the ledger are updated');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Goods receipt failed');
    } finally {
      setBusy(false);
    }
  };

  const submitQuote = async (): Promise<void> => {
    if (!supplierId || !quote.medicineId) {
      setError('Choose a supplier and a medicine before saving a quote');
      return;
    }
    setBusy(true);
    try {
      setError('');
      await addSupplierQuote(token, { ...quote, supplierId });
      setQuote((current) => ({ ...current, medicineId: '', quotedUnitCost: '' }));
      setNotice('Supplier quote recorded');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supplier quote could not be saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="operations-canvas procurement-canvas">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Purchasing · the only way stock enters the shop</p>
          <h1>Order from suppliers and receive goods into batches.</h1>
          <p>
            Every received line creates an acquisition batch with its own expiry, cost, and
            append-only stock movement.
          </p>
        </div>
      </section>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="counter-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="procurement-layout">
        <aside className="work-panel purchase-order-index">
          <header>
            <div>
              <p className="eyebrow">Purchase orders</p>
              <h2>Open book</h2>
            </div>
          </header>
          <label className="filter-row">
            Status
            <select
              aria-label="Purchase order status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PurchaseOrderStatus | '')}
            >
              <option value="">All</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <div className="data-list">
            {(orders.data ?? []).map((row) => (
              <button
                className={selectedId === row.id ? 'purchase-row selected' : 'purchase-row'}
                key={row.id}
                onClick={() => openOrder(row.id)}
              >
                <span>
                  <strong>{row.order_number}</strong>
                  <small>
                    {row.supplier_name} · {row.status.replaceAll('_', ' ')}
                  </small>
                </span>
                <span>
                  <b>{formatPkrMoney(row.total_cost)}</b>
                  <small>
                    {row.received_quantity}/{row.ordered_quantity} received
                  </small>
                </span>
              </button>
            ))}
            {orders.data && orders.data.length === 0 ? (
              <p className="empty-state">No purchase orders for this filter.</p>
            ) : null}
          </div>
        </aside>

        <article className="work-panel purchase-order-builder">
          <header>
            <div>
              <p className="eyebrow">New order</p>
              <h2>Build a purchase order</h2>
            </div>
            <strong>{formatPkrMoney(draftTotal)}</strong>
          </header>
          <div className="form-grid">
            <label>
              Supplier
              <select
                aria-label="Supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                <option value="">Select supplier</option>
                {(suppliers.data ?? [])
                  .filter((supplier) => supplier.isActive)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Supplier invoice number
              <input
                value={supplierInvoiceNumber}
                onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
              />
            </label>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              placeholder="Add medicine to the order"
              value={medicineQuery}
              onChange={(event) => setMedicineQuery(event.target.value)}
            />
          </label>
          {medicineQuery.trim() ? (
            <div className="data-list compact">
              {(medicines.data ?? []).map((medicine) => (
                <button
                  className="medicine-row"
                  key={medicine.id}
                  onClick={() => addDraftLine(medicine)}
                >
                  <span>
                    <strong>{medicine.name}</strong>
                    <small>{medicine.genericName ?? medicine.strength ?? '—'}</small>
                  </span>
                  <small>on hand {medicine.availableQuantity}</small>
                </button>
              ))}
            </div>
          ) : null}
          <div className="draft-line-list">
            {draftLines.map((line) => (
              <div className="draft-line" key={line.key}>
                <strong>{line.medicineName}</strong>
                <div className="draft-line-fields">
                  <label>
                    Qty
                    <input
                      inputMode="decimal"
                      value={line.orderedQuantity}
                      onChange={(event) =>
                        updateDraftLine(line.key, 'orderedQuantity', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Unit cost
                    <input
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) =>
                        updateDraftLine(line.key, 'unitCost', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Discount
                    <input
                      inputMode="decimal"
                      value={line.lineDiscount}
                      onChange={(event) =>
                        updateDraftLine(line.key, 'lineDiscount', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Bonus
                    <input
                      inputMode="decimal"
                      value={line.bonusQuantity}
                      onChange={(event) =>
                        updateDraftLine(line.key, 'bonusQuantity', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Base units / order unit
                    <input
                      inputMode="decimal"
                      value={line.baseUnitsPerOrderUnit}
                      onChange={(event) =>
                        updateDraftLine(line.key, 'baseUnitsPerOrderUnit', event.target.value)
                      }
                    />
                  </label>
                  <span className="draft-line-total">{lineTotal(line)}</span>
                  <button
                    aria-label={`Remove ${line.medicineName}`}
                    onClick={() =>
                      setDraftLines((current) => current.filter((item) => item.key !== line.key))
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {draftLines.length === 0 ? (
              <p className="empty-state">Search for a medicine to start the order.</p>
            ) : null}
          </div>
          <button className="primary-button" disabled={busy} onClick={() => void submitDraft()}>
            Save purchase order
          </button>
        </article>

        <article className="work-panel purchase-order-detail">
          {order.data ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">{order.data.supplier_name}</p>
                  <h2>{order.data.order_number}</h2>
                </div>
                <strong>{order.data.status.replaceAll('_', ' ')}</strong>
              </header>
              <div className="account-strip">
                <span>
                  Total <b>{formatPkrMoney(order.data.total_cost)}</b>
                </span>
                <span>
                  Invoice <b>{order.data.supplier_invoice_number ?? '—'}</b>
                </span>
                <span>Lines {order.data.items.length}</span>
              </div>
              <div className="purchase-detail-actions">
                {order.data.status === 'DRAFT' && canApproveOrder ? (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void markOrdered()}
                  >
                    Mark as ordered
                  </button>
                ) : null}
                {order.data.status === 'DRAFT' && !canApproveOrder ? (
                  <p className="empty-state">
                    A manager or owner must approve this draft before it can be ordered.
                  </p>
                ) : null}
                {order.data.status === 'ORDERED' || order.data.status === 'PARTIALLY_RECEIVED' ? (
                  <button disabled={busy} onClick={startReceipt}>
                    Receive goods
                  </button>
                ) : null}
              </div>
              <table className="purchase-line-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Outstanding</th>
                    <th>Unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {order.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.medicine_name}</td>
                      <td>{item.ordered_qty}</td>
                      <td>{item.received_qty}</td>
                      <td>{outstandingOrderQuantity(item)}</td>
                      <td>{formatPkrMoney(item.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {receiptLines.length > 0 ? (
                <section className="goods-receipt-form">
                  <h3>Goods receipt</h3>
                  <label>
                    Supplier invoice number
                    <input
                      value={receiptInvoiceNumber}
                      onChange={(event) => setReceiptInvoiceNumber(event.target.value)}
                    />
                  </label>
                  {order.data.items.map((item) => {
                    const draft = receiptLines.find((line) => line.purchaseOrderItemId === item.id);
                    if (!draft) return null;
                    return (
                      <div className="draft-line" key={item.id}>
                        <strong>{item.medicine_name}</strong>
                        <div className="draft-line-fields">
                          <label>
                            Received
                            <input
                              inputMode="decimal"
                              value={draft.receivedQuantity}
                              onChange={(event) =>
                                updateReceiptLine(item.id, 'receivedQuantity', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Bonus
                            <input
                              inputMode="decimal"
                              value={draft.receivedBonusQuantity}
                              onChange={(event) =>
                                updateReceiptLine(
                                  item.id,
                                  'receivedBonusQuantity',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Batch
                            <input
                              value={draft.batchNumber}
                              onChange={(event) =>
                                updateReceiptLine(item.id, 'batchNumber', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Expiry
                            <input
                              type="date"
                              value={draft.expiryDate}
                              onChange={(event) =>
                                updateReceiptLine(item.id, 'expiryDate', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Sale price / base unit
                            <input
                              inputMode="decimal"
                              value={draft.salePricePerBaseUnit}
                              onChange={(event) =>
                                updateReceiptLine(
                                  item.id,
                                  'salePricePerBaseUnit',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void submitReceipt()}
                  >
                    Post goods receipt
                  </button>
                </section>
              ) : null}
              {order.data.receipts.length > 0 ? (
                <div className="statement-list">
                  {order.data.receipts.map((receipt) => (
                    <div className="statement-row" key={receipt.id}>
                      <span>
                        <strong>{receipt.supplier_invoice_number ?? 'Goods receipt'}</strong>
                        <small>
                          {new Date(receipt.received_at).toLocaleString('en-PK')} ·{' '}
                          {receipt.received_by}
                        </small>
                      </span>
                      <b>{receipt.received_base_quantity} base units</b>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="empty-state">
              Select a purchase order to inspect its lines and post a goods receipt.
            </p>
          )}
        </article>
      </section>

      {canQuote ? (
        <section className="work-panel compact-form-panel">
          <header>
            <div>
              <p className="eyebrow">Supplier price list</p>
              <h2>Record a quote for comparison</h2>
            </div>
          </header>
          <div className="form-grid">
            <label>
              Medicine id
              <input
                value={quote.medicineId}
                onChange={(event) =>
                  setQuote((current) => ({ ...current, medicineId: event.target.value }))
                }
              />
            </label>
            <label>
              Quoted unit cost
              <input
                inputMode="decimal"
                value={quote.quotedUnitCost}
                onChange={(event) =>
                  setQuote((current) => ({ ...current, quotedUnitCost: event.target.value }))
                }
              />
            </label>
            <label>
              Quote unit
              <input
                value={quote.quoteUnit}
                onChange={(event) =>
                  setQuote((current) => ({ ...current, quoteUnit: event.target.value }))
                }
              />
            </label>
            <label>
              Base units per quote unit
              <input
                inputMode="decimal"
                value={quote.baseUnitsPerQuoteUnit}
                onChange={(event) =>
                  setQuote((current) => ({ ...current, baseUnitsPerQuoteUnit: event.target.value }))
                }
              />
            </label>
            <label>
              Source
              <input
                value={quote.source}
                onChange={(event) =>
                  setQuote((current) => ({ ...current, source: event.target.value }))
                }
              />
            </label>
          </div>
          <button disabled={busy} onClick={() => void submitQuote()}>
            Save quote for the selected supplier
          </button>
        </section>
      ) : null}
    </main>
  );
}
