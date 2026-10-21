import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  decimalToScaledInteger,
  minorUnitsToMoney,
  moneyToMinorUnits,
  PERMISSIONS,
  scaledIntegerToDecimal,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from '@pharmacy/shared';
import {
  Ban,
  ClipboardList,
  PackageCheck,
  Plus,
  Scale,
  Send,
  Tags,
  Trash2,
  Truck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  addSupplierQuote,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  getSupplierComparison,
  listPurchasableSuppliers,
  listPurchaseOrders,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  type MedicineSearchResult,
  type PurchaseOrderDetail,
} from '../../api';
import { MedicinePicker } from '../../components/MedicinePicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorAlert,
  Field,
  IconButton,
  Input,
  MoneyInput,
  PageHeader,
  Segmented,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from '../../components/ui';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  humanize,
  isMoneyText,
  isPositiveQuantityText,
  isQuantityText,
  isoDateIn,
  normalizeMoney,
  shiftIsoDate,
} from '../../format';
import {
  usePermissions,
  usePayloadRequestId,
  useRequestId,
  useSession,
} from '../../hooks/useSession';
import {
  calculatePurchaseLineTotal,
  calculatePurchaseOrderTotal,
  outstandingOrderQuantity,
} from './purchase-order';

export const ORDER_STATUS: Record<
  PurchaseOrderStatus,
  { readonly label: string; readonly tone: Tone }
> = {
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ORDERED: { label: 'Awaiting delivery', tone: 'info' },
  PARTIALLY_RECEIVED: { label: 'Part received', tone: 'warning' },
  RECEIVED: { label: 'Received', tone: 'success' },
};

type OrderFilter = 'ALL' | PurchaseOrderStatus;
type ProcurementTab = 'ORDERS' | 'PRICES';

function safeLineTotal(line: {
  readonly unitCost: string;
  readonly orderedQuantity: string;
  readonly lineDiscount: string;
}): string | null {
  try {
    return calculatePurchaseLineTotal(line);
  } catch {
    return null;
  }
}

/**
 * Stored order lines keep cost at the database's 8-decimal scale; entered costs never have
 * more than two decimals, so normalising back to money is exact.
 */
function storedLineTotal(line: PurchaseOrderLine): string | null {
  return safeLineTotal({
    lineDiscount: normalizeMoney(line.line_discount) ?? '0.00',
    orderedQuantity: line.ordered_qty,
    unitCost: normalizeMoney(line.unit_cost) ?? '0.00',
  });
}

/** Cost of one base unit (tablet, ml…) the way the server values the received batch. */
function effectiveUnitCost(line: PurchaseOrderLine): string | null {
  const total = storedLineTotal(line);
  if (total === null) return null;
  const units =
    (decimalToScaledInteger(line.ordered_qty, 3) + decimalToScaledInteger(line.bonus_qty, 3)) *
    decimalToScaledInteger(line.base_units_per_order_unit, 3);
  if (units === 0n) return null;
  const minor = (moneyToMinorUnits(total) * 1_000_000n + units / 2n) / units;
  return minorUnitsToMoney(minor);
}

export function ProcurementScreen(): React.JSX.Element {
  const can = usePermissions();
  const canPurchase = can(PERMISSIONS.INVENTORY_PURCHASE);
  const canComparePrices = can(PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ);
  const tabs = [
    ...(canPurchase
      ? [{ icon: ClipboardList, id: 'ORDERS' as const, label: 'Purchase orders' }]
      : []),
    ...(canComparePrices || canPurchase
      ? [{ icon: Scale, id: 'PRICES' as const, label: 'Supplier prices' }]
      : []),
  ];
  const [tab, setTab] = useState<ProcurementTab>(tabs[0]?.id ?? 'ORDERS');
  const [creating, setCreating] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHeader
        title="Purchasing"
        description="Order from suppliers, receive deliveries into stock, and compare supplier prices."
        actions={
          canPurchase ? (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New purchase order
            </Button>
          ) : null
        }
      />
      {tabs.length > 1 ? (
        <Tabs label="Purchasing views" tabs={tabs} active={tab} onChange={setTab} />
      ) : null}
      {tab === 'ORDERS' && canPurchase ? (
        <OrdersTab onOpen={setOpenOrderId} selected={openOrderId} />
      ) : null}
      {tab === 'PRICES' ? <SupplierPricesTab /> : null}
      {creating ? (
        <NewOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setTab('ORDERS');
            setOpenOrderId(id);
          }}
        />
      ) : null}
      {openOrderId ? (
        <OrderDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
      ) : null}
    </div>
  );
}

/* ---------- Order list ---------- */

function OrdersTab({
  onOpen,
  selected,
}: {
  readonly onOpen: (id: string) => void;
  readonly selected: string | null;
}) {
  const [filter, setFilter] = useState<OrderFilter>('ALL');
  const orders = useQuery({
    queryKey: ['purchase-orders', filter],
    queryFn: () => listPurchaseOrders(filter === 'ALL' ? undefined : filter),
  });
  return (
    <Card
      title="Purchase orders"
      description="Most recent 100 orders. Open one to place it with the supplier or receive goods."
      actions={
        <Segmented
          label="Filter orders by status"
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Drafts', value: 'DRAFT' },
            { label: 'Awaiting delivery', value: 'ORDERED' },
            { label: 'Part received', value: 'PARTIALLY_RECEIVED' },
            { label: 'Received', value: 'RECEIVED' },
            { label: 'Cancelled', value: 'CANCELLED' },
          ]}
        />
      }
      flush
    >
      <ErrorAlert error={orders.error} />
      <DataTable
        caption="Purchase orders"
        rows={orders.data ?? []}
        rowKey={(order) => order.id}
        loading={orders.isLoading}
        onRowClick={(order) => onOpen(order.id)}
        selectedKey={selected}
        empty={
          <EmptyState icon={ClipboardList} title="No purchase orders here">
            Create a purchase order, or turn a reorder suggestion from Inventory into a draft.
          </EmptyState>
        }
        columns={[
          {
            header: 'Order',
            key: 'order',
            render: (order) => (
              <>
                <span className="cell-primary mono">{order.order_number}</span>
                <span className="cell-sub">Created {formatDate(order.created_at)}</span>
              </>
            ),
          },
          {
            header: 'Supplier',
            key: 'supplier',
            render: (order) => (
              <>
                {order.supplier_name}
                {order.supplier_invoice_number ? (
                  <span className="cell-sub">Invoice {order.supplier_invoice_number}</span>
                ) : null}
              </>
            ),
          },
          {
            header: 'Status',
            key: 'status',
            render: (order) => (
              <Badge tone={ORDER_STATUS[order.status].tone}>
                {ORDER_STATUS[order.status].label}
              </Badge>
            ),
          },
          {
            align: 'end',
            header: 'Lines',
            key: 'lines',
            render: (order) => order.line_count,
          },
          {
            align: 'end',
            header: 'Received',
            key: 'received',
            render: (order) =>
              `${formatQuantity(order.received_quantity)} / ${formatQuantity(order.ordered_quantity)}`,
          },
          {
            align: 'end',
            header: 'Total cost',
            key: 'total',
            render: (order) => formatMoney(order.total_cost),
          },
          {
            header: 'Last activity',
            key: 'activity',
            render: (order) =>
              order.received_at
                ? `Received ${formatDate(order.received_at)}`
                : order.ordered_at
                  ? `Ordered ${formatDate(order.ordered_at)}`
                  : '—',
          },
        ]}
      />
    </Card>
  );
}

/* ---------- New order ---------- */

interface DraftLine {
  readonly medicineId: string;
  readonly medicineName: string;
  readonly detail: string;
  readonly orderedQuantity: string;
  readonly baseUnitsPerOrderUnit: string;
  readonly unitCost: string;
  readonly lineDiscount: string;
  readonly bonusQuantity: string;
}

function draftLineProblem(line: DraftLine): string | null {
  if (!isPositiveQuantityText(line.orderedQuantity)) return 'Enter how many packs to order';
  if (!isPositiveQuantityText(line.baseUnitsPerOrderUnit)) return 'Enter units per pack';
  if (!isMoneyText(line.unitCost)) return 'Enter the cost per pack';
  if (!isMoneyText(line.lineDiscount)) return 'Discount must be an amount like 150 or 0';
  if (!isQuantityText(line.bonusQuantity)) return 'Bonus must be a quantity like 0 or 2';
  if (safeLineTotal(line) === null) return 'Discount is larger than the line cost';
  return null;
}

function NewOrderDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const suppliers = useQuery({
    queryKey: ['purchasable-suppliers'],
    queryFn: listPurchasableSuppliers,
  });
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const payload = useMemo(
    () => ({
      items: lines.map((line) => ({
        baseUnitsPerOrderUnit: line.baseUnitsPerOrderUnit.trim(),
        bonusQuantity: line.bonusQuantity.trim() || '0',
        lineDiscount: line.lineDiscount.trim() || '0',
        medicineId: line.medicineId,
        orderedQuantity: line.orderedQuantity.trim(),
        unitCost: line.unitCost.trim(),
      })),
      supplierId,
      ...(invoiceNumber.trim() ? { supplierInvoiceNumber: invoiceNumber.trim() } : {}),
    }),
    [invoiceNumber, lines, supplierId],
  );
  const [requestId] = usePayloadRequestId(JSON.stringify(payload));
  const problems = lines.map(draftLineProblem);
  const valid =
    Boolean(supplierId) && lines.length > 0 && problems.every((problem) => problem === null);
  const total = valid ? calculatePurchaseOrderTotal(payload.items) : null;

  const addMedicine = (medicine: MedicineSearchResult): void => {
    if (lines.some((line) => line.medicineId === medicine.id)) {
      toast.info(`${medicine.name} is already on this order`);
      return;
    }
    setLines((current) => [
      ...current,
      {
        baseUnitsPerOrderUnit: '1',
        bonusQuantity: '0',
        detail: [medicine.strength, medicine.manufacturer].filter(Boolean).join(' · '),
        lineDiscount: '0',
        medicineId: medicine.id,
        medicineName: medicine.name,
        orderedQuantity: '1',
        unitCost: '',
      },
    ]);
  };
  const update = (medicineId: string, field: keyof DraftLine, value: string): void => {
    setLines((current) =>
      current.map((line) => (line.medicineId === medicineId ? { ...line, [field]: value } : line)),
    );
  };
  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPurchaseOrder({ ...payload, clientRequestId: requestId });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success(
        `Draft ${created.order_number} saved`,
        'Place the order once the supplier confirms.',
      );
      onCreated(created.id);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const activeSuppliers = (suppliers.data ?? []).filter((supplier) => supplier.isActive);
  return (
    <Dialog
      title="New purchase order"
      description="Saved as a draft. Nothing reaches stock until the delivery is received."
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          {total !== null ? (
            <span className="muted">
              Order total <strong className="num">{formatMoney(total)}</strong>
            </span>
          ) : null}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={ClipboardList}
            loading={busy}
            disabled={!valid}
            onClick={() => void submit()}
          >
            Save draft
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Supplier" hint={suppliers.isLoading ? 'Loading suppliers…' : undefined}>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Choose a supplier</option>
              {activeSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                  {supplier.leadTimeDays
                    ? ` — usually ${String(supplier.leadTimeDays)} day(s)`
                    : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier invoice or reference" optional>
            <Input
              value={invoiceNumber}
              maxLength={120}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </Field>
        </div>
        {suppliers.data && activeSuppliers.length === 0 ? (
          <Alert tone="warning" title="No active suppliers">
            Add a supplier under Settings before creating purchase orders.
          </Alert>
        ) : null}
        <MedicinePicker label="Add a medicine to this order" onSelect={addMedicine} focusOnMount />
        <DataTable
          caption="Order lines"
          compact
          rows={lines}
          rowKey={(line) => line.medicineId}
          empty={
            <EmptyState icon={Plus} title="No medicines yet">
              Search above to add the medicines you are ordering.
            </EmptyState>
          }
          columns={[
            {
              header: 'Medicine',
              key: 'medicine',
              render: (line) => {
                const problem = problems[lines.indexOf(line)];
                return (
                  <>
                    <span className="cell-primary">{line.medicineName}</span>
                    <span className={problem ? 'cell-sub text-danger' : 'cell-sub'}>
                      {problem ?? (line.detail || ' ')}
                    </span>
                  </>
                );
              },
            },
            {
              align: 'end',
              header: 'Packs',
              key: 'qty',
              width: 90,
              render: (line) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Packs of ${line.medicineName}`}
                  value={line.orderedQuantity}
                  onChange={(event) =>
                    update(line.medicineId, 'orderedQuantity', event.target.value)
                  }
                />
              ),
            },
            {
              align: 'end',
              header: 'Units / pack',
              key: 'units',
              width: 100,
              render: (line) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Units per pack of ${line.medicineName}`}
                  value={line.baseUnitsPerOrderUnit}
                  onChange={(event) =>
                    update(line.medicineId, 'baseUnitsPerOrderUnit', event.target.value)
                  }
                />
              ),
            },
            {
              align: 'end',
              header: 'Cost / pack',
              key: 'cost',
              width: 110,
              render: (line) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={`Cost per pack of ${line.medicineName}`}
                  value={line.unitCost}
                  onChange={(event) => update(line.medicineId, 'unitCost', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'Discount',
              key: 'discount',
              width: 100,
              render: (line) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Discount on ${line.medicineName}`}
                  value={line.lineDiscount}
                  onChange={(event) => update(line.medicineId, 'lineDiscount', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'Bonus packs',
              key: 'bonus',
              width: 100,
              render: (line) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Bonus packs of ${line.medicineName}`}
                  value={line.bonusQuantity}
                  onChange={(event) => update(line.medicineId, 'bonusQuantity', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'Line total',
              key: 'total',
              width: 120,
              render: (line) => {
                const lineTotal = isMoneyText(line.unitCost) ? safeLineTotal(line) : null;
                return lineTotal === null ? '—' : formatMoney(lineTotal);
              },
            },
            {
              header: <span className="sr-only">Remove</span>,
              key: 'remove',
              width: 44,
              render: (line) => (
                <IconButton
                  label={`Remove ${line.medicineName}`}
                  icon={Trash2}
                  onClick={() =>
                    setLines((current) =>
                      current.filter((item) => item.medicineId !== line.medicineId),
                    )
                  }
                />
              ),
            },
          ]}
        />
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}

/* ---------- Order detail ---------- */

function OrderDrawer({
  orderId,
  onClose,
}: {
  readonly orderId: string;
  readonly onClose: () => void;
}) {
  const can = usePermissions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: ['purchase-order', orderId],
    queryFn: () => getPurchaseOrder(orderId),
  });
  const [placeRequestId, renewPlaceRequestId] = useRequestId();
  const [confirmPlace, setConfirmPlace] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const canApprove = can(PERMISSIONS.PROCUREMENT_PURCHASE_DRAFT_APPROVE);
  const canReceive = can(PERMISSIONS.INVENTORY_PURCHASE);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchase-order', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
    ]);
  };
  const place = async (): Promise<void> => {
    setPlacing(true);
    try {
      await markPurchaseOrderOrdered(orderId, placeRequestId);
      renewPlaceRequestId();
      setConfirmPlace(false);
      await refresh();
      toast.success('Order placed', 'It is now waiting for delivery.');
    } catch (caught) {
      toast.error('Could not place the order', caught);
    } finally {
      setPlacing(false);
    }
  };

  const detail = order.data;
  const status = detail?.status;
  const openForReceipt = status === 'ORDERED' || status === 'PARTIALLY_RECEIVED';
  const cancellable = status === 'DRAFT' || status === 'ORDERED';
  return (
    <Drawer
      title={detail ? `Purchase order ${detail.order_number}` : 'Purchase order'}
      description={detail ? detail.supplier_name : undefined}
      onClose={onClose}
      footer={
        detail ? (
          <>
            {cancellable && canApprove ? (
              <Button variant="danger-outline" icon={Ban} onClick={() => setCancelling(true)}>
                Cancel order
              </Button>
            ) : null}
            <span className="spacer" />
            {status === 'DRAFT' && canApprove ? (
              <Button variant="primary" icon={Send} onClick={() => setConfirmPlace(true)}>
                Place order
              </Button>
            ) : null}
            {openForReceipt && canReceive ? (
              <Button variant="primary" icon={Truck} onClick={() => setReceiving(true)}>
                Receive delivery
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <ErrorAlert error={order.error} />
      {detail ? (
        <div className="stack">
          <div className="kv-grid">
            <div className="kv">
              <span>Status</span>
              <strong>
                <Badge tone={ORDER_STATUS[detail.status].tone}>
                  {ORDER_STATUS[detail.status].label}
                </Badge>
              </strong>
            </div>
            <div className="kv">
              <span>Order total</span>
              <strong>{formatMoney(detail.total_cost)}</strong>
            </div>
            <div className="kv">
              <span>Created</span>
              <strong>{formatDate(detail.created_at)}</strong>
            </div>
            <div className="kv">
              <span>Ordered</span>
              <strong>{detail.ordered_at ? formatDate(detail.ordered_at) : '—'}</strong>
            </div>
            <div className="kv">
              <span>Last received</span>
              <strong>
                {detail.receipts[0]
                  ? formatDate(
                      detail.receipts.reduce(
                        (latest, receipt) =>
                          receipt.received_at > latest ? receipt.received_at : latest,
                        detail.receipts[0].received_at,
                      ),
                    )
                  : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Supplier invoice</span>
              <strong>{detail.supplier_invoice_number ?? '—'}</strong>
            </div>
          </div>
          {detail.status === 'CANCELLED' ? (
            <Alert tone="danger" title={`Cancelled ${formatDateTime(detail.cancelled_at)}`}>
              {detail.cancel_reason ?? 'No reason recorded'}
            </Alert>
          ) : null}
          {status === 'DRAFT' ? (
            <Alert tone="info">
              This is a draft.{' '}
              {canApprove
                ? 'Place it once the supplier confirms prices and quantities.'
                : 'A manager needs to place it with the supplier.'}
            </Alert>
          ) : null}
          <Card title="Lines" flush>
            <DataTable
              caption="Order lines"
              compact
              rows={detail.items}
              rowKey={(line) => line.id}
              columns={[
                {
                  header: 'Medicine',
                  key: 'medicine',
                  render: (line) => (
                    <>
                      <span className="cell-primary">{line.medicine_name}</span>
                      <span className="cell-sub">
                        {formatQuantity(line.base_units_per_order_unit)} units per pack · cost per
                        unit {formatMoney(effectiveUnitCost(line))}
                      </span>
                    </>
                  ),
                },
                {
                  align: 'end',
                  header: 'Ordered',
                  key: 'ordered',
                  render: (line) => (
                    <>
                      {formatQuantity(line.ordered_qty)}
                      {decimalToScaledInteger(line.bonus_qty, 3) > 0n ? (
                        <span className="cell-sub">+{formatQuantity(line.bonus_qty)} bonus</span>
                      ) : null}
                    </>
                  ),
                },
                {
                  align: 'end',
                  header: 'Received',
                  key: 'received',
                  render: (line) => {
                    const outstanding = outstandingOrderQuantity(line);
                    return (
                      <>
                        {formatQuantity(line.received_qty)}
                        {decimalToScaledInteger(outstanding, 3) > 0n &&
                        detail.status !== 'CANCELLED' ? (
                          <span className="cell-sub text-warning">
                            {formatQuantity(outstanding)} to come
                          </span>
                        ) : null}
                      </>
                    );
                  },
                },
                {
                  align: 'end',
                  header: 'Cost / pack',
                  key: 'cost',
                  render: (line) => formatMoney(line.unit_cost),
                },
                {
                  align: 'end',
                  header: 'Discount',
                  key: 'discount',
                  render: (line) => formatMoney(line.line_discount),
                },
                {
                  align: 'end',
                  footer: <strong>{formatMoney(detail.total_cost)}</strong>,
                  header: 'Line total',
                  key: 'total',
                  render: (line) => formatMoney(storedLineTotal(line)),
                },
              ]}
            />
          </Card>
          <Card title="Deliveries received" flush>
            <DataTable
              caption="Goods receipts"
              compact
              rows={detail.receipts}
              rowKey={(receipt) => receipt.id}
              empty={<EmptyState icon={PackageCheck} title="Nothing received yet" />}
              columns={[
                {
                  header: 'Received',
                  key: 'at',
                  render: (receipt) => formatDateTime(receipt.received_at),
                },
                { header: 'By', key: 'by', render: (receipt) => receipt.received_by },
                {
                  header: 'Supplier invoice',
                  key: 'invoice',
                  render: (receipt) => receipt.supplier_invoice_number ?? '—',
                },
                {
                  align: 'end',
                  header: 'Units into stock',
                  key: 'units',
                  render: (receipt) => formatQuantity(receipt.received_base_quantity),
                },
              ]}
            />
          </Card>
        </div>
      ) : null}
      {confirmPlace && detail ? (
        <ConfirmDialog
          title={`Place ${detail.order_number}?`}
          confirmLabel="Place order"
          busy={placing}
          onConfirm={() => void place()}
          onClose={() => setConfirmPlace(false)}
        >
          The order for {formatMoney(detail.total_cost)} will be marked as sent to{' '}
          {detail.supplier_name}. Lines can no longer be edited after this.
        </ConfirmDialog>
      ) : null}
      {cancelling && detail ? (
        <CancelOrderDialog
          order={detail}
          onClose={() => setCancelling(false)}
          onDone={async () => {
            setCancelling(false);
            await refresh();
          }}
        />
      ) : null}
      {receiving && detail ? (
        <ReceiveDialog
          order={detail}
          onClose={() => setReceiving(false)}
          onDone={async () => {
            setReceiving(false);
            await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['stock'] })]);
          }}
        />
      ) : null}
    </Drawer>
  );
}

function CancelOrderDialog({
  order,
  onClose,
  onDone,
}: {
  readonly order: PurchaseOrderDetail;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId] = usePayloadRequestId(reason.trim());
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await cancelPurchaseOrder(order.id, reason.trim(), requestId);
      toast.success(`${order.order_number} cancelled`);
      await onDone();
    } catch (caught) {
      toast.error('Could not cancel the order', caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Cancel ${order.order_number}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Keep order
          </Button>
          <Button
            variant="danger"
            icon={Ban}
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            Cancel order
          </Button>
        </>
      }
    >
      <Field label="Reason" hint="Shown on the order and in the audit log.">
        <Textarea
          rows={3}
          value={reason}
          maxLength={500}
          placeholder="e.g. Supplier out of stock, ordered elsewhere"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/* ---------- Receive goods ---------- */

interface ReceiptRow {
  readonly item: PurchaseOrderLine;
  readonly receivedQuantity: string;
  readonly receivedBonusQuantity: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly salePrice: string;
  readonly maximumRetailPrice: string;
}

/** An editable quantity: exact, without grouping separators or trailing zeros. */
function plainQuantity(milli: bigint): string {
  return scaledIntegerToDecimal(milli > 0n ? milli : 0n, 3).replace(/\.?0+$/, '');
}

function remainingBonus(item: PurchaseOrderLine): string {
  return plainQuantity(
    decimalToScaledInteger(item.bonus_qty, 3) - decimalToScaledInteger(item.received_bonus_qty, 3),
  );
}

function receiptRowProblem(row: ReceiptRow, today: string): string | null {
  const quantity = row.receivedQuantity.trim() || '0';
  const bonus = row.receivedBonusQuantity.trim() || '0';
  if (!isQuantityText(quantity) || !isQuantityText(bonus))
    return 'Quantities must be numbers like 10 or 2.5';
  const quantityMilli = decimalToScaledInteger(quantity, 3);
  const bonusMilli = decimalToScaledInteger(bonus, 3);
  if (quantityMilli === 0n && bonusMilli === 0n) return null;
  if (quantityMilli === 0n) return 'Bonus can only be received together with paid packs';
  if (quantityMilli > decimalToScaledInteger(outstandingOrderQuantity(row.item), 3)) {
    return `Only ${formatQuantity(outstandingOrderQuantity(row.item))} packs are still to come`;
  }
  if (
    bonusMilli >
    decimalToScaledInteger(row.item.bonus_qty, 3) -
      decimalToScaledInteger(row.item.received_bonus_qty, 3)
  ) {
    return 'More bonus than the order allows';
  }
  if (!row.batchNumber.trim()) return 'Enter the batch number from the box';
  if (!row.expiryDate) return 'Enter the expiry date';
  if (row.expiryDate <= today) return 'This batch is already expired';
  if (!isMoneyText(row.salePrice)) return 'Enter the sale price per unit';
  if (row.maximumRetailPrice.trim()) {
    if (!isMoneyText(row.maximumRetailPrice)) return 'MRP must be an amount like 12.50';
    if (
      moneyToMinorUnits(row.salePrice.trim()) > moneyToMinorUnits(row.maximumRetailPrice.trim())
    ) {
      return 'Sale price is above the printed MRP';
    }
  }
  return null;
}

function isIncluded(row: ReceiptRow): boolean {
  const quantity = row.receivedQuantity.trim();
  return isQuantityText(quantity) && decimalToScaledInteger(quantity, 3) > 0n;
}

function ReceiveDialog({
  order,
  onClose,
  onDone,
}: {
  readonly order: PurchaseOrderDetail;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const session = useSession();
  const toast = useToast();
  const today = isoDateIn(session?.user.branchTimezone);
  const [invoiceNumber, setInvoiceNumber] = useState(order.supplier_invoice_number ?? '');
  const [rows, setRows] = useState<readonly ReceiptRow[]>(() =>
    order.items
      .filter((item) => decimalToScaledInteger(outstandingOrderQuantity(item), 3) > 0n)
      .map((item) => ({
        batchNumber: '',
        expiryDate: '',
        item,
        maximumRetailPrice: '',
        receivedBonusQuantity: remainingBonus(item),
        receivedQuantity: plainQuantity(decimalToScaledInteger(outstandingOrderQuantity(item), 3)),
        salePrice: '',
      })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problems = rows.map((row) => receiptRowProblem(row, today));
  const included = rows.filter(isIncluded);
  const valid = included.length > 0 && problems.every((problem) => problem === null);
  const lines = included.map((row) => ({
    batchNumber: row.batchNumber.trim(),
    expiryDate: row.expiryDate,
    purchaseOrderItemId: row.item.id,
    receivedBonusQuantity: row.receivedBonusQuantity.trim() || '0',
    receivedQuantity: row.receivedQuantity.trim(),
    salePricePerBaseUnit: row.salePrice.trim(),
    ...(row.maximumRetailPrice.trim()
      ? { maximumRetailPricePerBaseUnit: row.maximumRetailPrice.trim() }
      : {}),
  }));
  const [requestId] = usePayloadRequestId(JSON.stringify({ invoiceNumber, lines }));
  const update = (itemId: string, field: keyof Omit<ReceiptRow, 'item'>, value: string): void => {
    setRows((current) =>
      current.map((row) => (row.item.id === itemId ? { ...row, [field]: value } : row)),
    );
  };
  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await receivePurchaseOrder(order.id, {
        clientRequestId: requestId,
        lines,
        ...(invoiceNumber.trim() ? { supplierInvoiceNumber: invoiceNumber.trim() } : {}),
      });
      toast.success(
        'Delivery received',
        `${String(lines.length)} line(s) added to sellable stock.`,
      );
      await onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Receive delivery — ${order.order_number}`}
      description={`From ${order.supplier_name}. Quantities are in packs; prices are per single unit (tablet, ml, sachet).`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className="muted">
            {included.length} of {rows.length} line(s) will be received
          </span>
          <span className="spacer" />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={PackageCheck}
            loading={busy}
            disabled={!valid}
            onClick={() => void submit()}
          >
            Receive into stock
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Supplier invoice number" optional>
            <Input
              value={invoiceNumber}
              maxLength={120}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </Field>
          <Alert tone="info">
            Set a line to 0 packs to leave it for a later delivery. Expired batches are refused.
          </Alert>
        </div>
        <DataTable
          caption="Lines to receive"
          compact
          rows={rows}
          rowKey={(row) => row.item.id}
          empty={
            <EmptyState icon={PackageCheck} title="Everything on this order has been received" />
          }
          columns={[
            {
              header: 'Medicine',
              key: 'medicine',
              render: (row) => {
                const problem = problems[rows.indexOf(row)];
                const unitCost = effectiveUnitCost(row.item);
                const belowCost =
                  unitCost !== null &&
                  isMoneyText(row.salePrice) &&
                  moneyToMinorUnits(row.salePrice.trim()) < moneyToMinorUnits(unitCost);
                return (
                  <>
                    <span className="cell-primary">{row.item.medicine_name}</span>
                    <span
                      className={
                        problem
                          ? 'cell-sub text-danger'
                          : belowCost
                            ? 'cell-sub text-warning'
                            : 'cell-sub'
                      }
                    >
                      {problem ??
                        (belowCost
                          ? `Sale price is below cost (${formatMoney(unitCost)} per unit)`
                          : `${formatQuantity(outstandingOrderQuantity(row.item))} packs to come · ${formatQuantity(row.item.base_units_per_order_unit)} units/pack · cost ${formatMoney(unitCost)}/unit`)}
                    </span>
                  </>
                );
              },
            },
            {
              align: 'end',
              header: 'Packs',
              key: 'qty',
              width: 80,
              render: (row) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Packs received of ${row.item.medicine_name}`}
                  value={row.receivedQuantity}
                  onChange={(event) => update(row.item.id, 'receivedQuantity', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'Bonus',
              key: 'bonus',
              width: 70,
              render: (row) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  aria-label={`Bonus packs received of ${row.item.medicine_name}`}
                  value={row.receivedBonusQuantity}
                  onChange={(event) =>
                    update(row.item.id, 'receivedBonusQuantity', event.target.value)
                  }
                />
              ),
            },
            {
              header: 'Batch no.',
              key: 'batch',
              render: (row) => (
                <input
                  className="input cell-input text"
                  aria-label={`Batch number of ${row.item.medicine_name}`}
                  value={row.batchNumber}
                  maxLength={120}
                  onChange={(event) => update(row.item.id, 'batchNumber', event.target.value)}
                />
              ),
            },
            {
              header: 'Expiry',
              key: 'expiry',
              render: (row) => (
                <input
                  className="input cell-input date"
                  type="date"
                  min={shiftIsoDate(today, 1)}
                  aria-label={`Expiry date of ${row.item.medicine_name}`}
                  value={row.expiryDate}
                  onChange={(event) => update(row.item.id, 'expiryDate', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'Sale price / unit',
              key: 'price',
              width: 110,
              render: (row) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={`Sale price per unit of ${row.item.medicine_name}`}
                  value={row.salePrice}
                  onChange={(event) => update(row.item.id, 'salePrice', event.target.value)}
                />
              ),
            },
            {
              align: 'end',
              header: 'MRP / unit',
              key: 'mrp',
              width: 100,
              render: (row) => (
                <input
                  className="input cell-input"
                  inputMode="decimal"
                  placeholder="optional"
                  aria-label={`Printed MRP per unit of ${row.item.medicine_name}`}
                  value={row.maximumRetailPrice}
                  onChange={(event) =>
                    update(row.item.id, 'maximumRetailPrice', event.target.value)
                  }
                />
              ),
            },
          ]}
        />
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}

/* ---------- Supplier prices ---------- */

function SupplierPricesTab() {
  const can = usePermissions();
  const canCompare = can(PERMISSIONS.PROCUREMENT_SUPPLIER_PRICE_READ);
  const canRecord = can(PERMISSIONS.INVENTORY_PURCHASE);
  const [medicine, setMedicine] = useState<MedicineSearchResult | null>(null);
  const [recording, setRecording] = useState(false);
  const comparison = useQuery({
    queryKey: ['supplier-comparison', medicine?.id],
    queryFn: () => getSupplierComparison(medicine?.id ?? ''),
    enabled: canCompare && medicine !== null,
  });
  const cheapest = (comparison.data ?? []).reduce<bigint | null>((best, row) => {
    const cost = decimalToScaledInteger(row.effective_unit_cost, 8);
    return best === null || cost < best ? cost : best;
  }, null);
  return (
    <div className="stack">
      <Card
        title="Compare suppliers for a medicine"
        description="Current quotes and the most recent price actually paid, per single unit."
        actions={
          medicine && canRecord ? (
            <Button icon={Tags} onClick={() => setRecording(true)}>
              Record a supplier price
            </Button>
          ) : null
        }
      >
        <div className="stack">
          <MedicinePicker onSelect={setMedicine} showStock={false} />
          {medicine ? (
            <div className="row between">
              <div>
                <strong>{medicine.name}</strong>
                <span className="cell-sub">
                  {[medicine.genericName, medicine.strength, medicine.manufacturer]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {medicine.salePrice ? (
                <span className="muted">
                  Current sale price <strong>{formatMoney(medicine.salePrice)}</strong> per unit
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      {medicine && canCompare ? (
        <Card flush>
          <ErrorAlert error={comparison.error} />
          <DataTable
            caption="Supplier price comparison"
            rows={comparison.data ?? []}
            rowKey={(row) => `${row.supplier_id}-${row.source_type}`}
            loading={comparison.isLoading}
            empty={
              <EmptyState icon={Scale} title="No prices on record">
                No supplier has quoted or delivered this medicine yet.
              </EmptyState>
            }
            columns={[
              {
                header: 'Supplier',
                key: 'supplier',
                render: (row) => (
                  <>
                    <span className="cell-primary">{row.supplier_name}</span>
                    <span className="cell-sub">Lead time {row.lead_time_days} day(s)</span>
                  </>
                ),
              },
              {
                header: 'Source',
                key: 'source',
                render: (row) => (
                  <Badge tone={row.source_type === 'CURRENT_QUOTE' ? 'info' : 'neutral'}>
                    {row.source_type === 'CURRENT_QUOTE' ? 'Current quote' : 'Last paid'}
                  </Badge>
                ),
              },
              {
                header: 'As of',
                key: 'observed',
                render: (row) => (row.observed_at ? formatDate(row.observed_at) : '—'),
              },
              {
                align: 'end',
                header: 'Cost per unit',
                key: 'cost',
                render: (row) => (
                  <span className="row" style={{ justifyContent: 'flex-end' }}>
                    {decimalToScaledInteger(row.effective_unit_cost, 8) === cheapest ? (
                      <Badge tone="success">Lowest</Badge>
                    ) : null}
                    {formatMoney(row.effective_unit_cost)}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      ) : null}
      {!medicine ? (
        <EmptyState icon={Scale} title="Pick a medicine to compare">
          Search above to see what each supplier charges.
        </EmptyState>
      ) : null}
      {recording && medicine ? (
        <QuoteDialog medicine={medicine} onClose={() => setRecording(false)} />
      ) : null}
    </div>
  );
}

function QuoteDialog({
  medicine,
  onClose,
}: {
  readonly medicine: MedicineSearchResult;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const suppliers = useQuery({
    queryKey: ['purchasable-suppliers'],
    queryFn: listPurchasableSuppliers,
  });
  const [supplierId, setSupplierId] = useState('');
  const [cost, setCost] = useState('');
  const [quoteUnit, setQuoteUnit] = useState('PACK');
  const [unitsPerQuoteUnit, setUnitsPerQuoteUnit] = useState('1');
  const [source, setSource] = useState('Supplier price list');
  const [busy, setBusy] = useState(false);
  const valid =
    Boolean(supplierId) &&
    isMoneyText(cost) &&
    isPositiveQuantityText(unitsPerQuoteUnit) &&
    source.trim().length >= 2;
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await addSupplierQuote({
        baseUnitsPerQuoteUnit: unitsPerQuoteUnit.trim(),
        medicineId: medicine.id,
        quoteUnit,
        quotedUnitCost: cost.trim(),
        source: source.trim(),
        supplierId,
      });
      await queryClient.invalidateQueries({ queryKey: ['supplier-comparison', medicine.id] });
      toast.success('Supplier price recorded');
      onClose();
    } catch (caught) {
      toast.error('Could not record the price', caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Record a supplier price"
      description={medicine.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Save price
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Supplier" className="span-all">
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Choose a supplier</option>
            {(suppliers.data ?? [])
              .filter((supplier) => supplier.isActive)
              .map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="Price quoted"
          error={cost && !isMoneyText(cost) ? 'Enter an amount like 450 or 450.50' : undefined}
        >
          <MoneyInput value={cost} onChange={(event) => setCost(event.target.value)} />
        </Field>
        <Field label="Per">
          <Select value={quoteUnit} onChange={(event) => setQuoteUnit(event.target.value)}>
            {['PACK', 'BOX', 'STRIP', 'BOTTLE', 'UNIT'].map((unit) => (
              <option key={unit} value={unit}>
                {humanize(unit)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Units in one ${humanize(quoteUnit).toLowerCase()}`}
          hint="Tablets, capsules, ml or sachets — the unit you sell."
          error={
            unitsPerQuoteUnit && !isPositiveQuantityText(unitsPerQuoteUnit)
              ? 'Must be more than zero'
              : undefined
          }
        >
          <Input
            inputMode="decimal"
            value={unitsPerQuoteUnit}
            onChange={(event) => setUnitsPerQuoteUnit(event.target.value)}
          />
        </Field>
        <Field label="Source">
          <Input
            value={source}
            maxLength={160}
            onChange={(event) => setSource(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
