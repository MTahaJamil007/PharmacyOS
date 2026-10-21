import { useQuery, useQueryClient } from '@tanstack/react-query';
import { decimalToScaledInteger, moneyToMinorUnits, PERMISSIONS } from '@pharmacy/shared';
import { ClipboardCheck, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  adjustBatchStock,
  getMedicineStock,
  listPurchasableSuppliers,
  setReorderPolicy,
  updateBatchPrice,
  type MedicineStockDetail,
} from '../../api';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  MoneyInput,
  Select,
  useToast,
} from '../../components/ui';
import {
  daysLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  humanize,
} from '../../format';
import { usePermissions, useRequestId } from '../../hooks/useSession';
import { STOCK_STATUS } from './InventoryScreen';

type Batch = MedicineStockDetail['batches'][number];
type BatchAction = 'COUNT' | 'SCRAP' | 'PRICE';

const QUANTITY = /^\d+(?:\.\d{1,3})?$/;
const MONEY = /^\d+(?:\.\d{1,2})?$/;

export function MedicineDrawer({
  medicineId,
  onClose,
}: {
  readonly medicineId: string;
  readonly onClose: () => void;
}) {
  const can = usePermissions();
  const detail = useQuery({
    queryKey: ['medicine-stock', medicineId],
    queryFn: () => getMedicineStock(medicineId),
  });
  const [action, setAction] = useState<{ batch: Batch; kind: BatchAction } | null>(null);
  const medicine = detail.data?.medicine;
  const canAdjust = can(PERMISSIONS.INVENTORY_ADJUST);
  return (
    <Drawer
      title={medicine ? `${medicine.name} ${medicine.strength ?? ''}` : 'Loading…'}
      description={
        medicine
          ? [
              medicine.genericName,
              medicine.manufacturer,
              medicine.sku ? `SKU ${medicine.sku}` : null,
              medicine.barcode,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      onClose={onClose}
    >
      <ErrorAlert error={detail.error} />
      {detail.data && medicine ? (
        <div className="stack">
          <div className="kv-grid">
            <div className="kv">
              <span>Available to sell</span>
              <strong>
                {formatQuantity(medicine.availableQuantity)} {medicine.unitName}
              </strong>
            </div>
            <div className="kv">
              <span>Status</span>
              <strong>
                <Badge tone={STOCK_STATUS[medicine.status].tone}>
                  {STOCK_STATUS[medicine.status].label}
                </Badge>
              </strong>
            </div>
            <div className="kv">
              <span>Sells per day</span>
              <strong>{formatQuantity(medicine.averageDailySales)}</strong>
            </div>
            <div className="kv">
              <span>Value at cost</span>
              <strong>{formatMoney(medicine.valueAtCost)}</strong>
            </div>
          </div>

          <Card title="Batches" description="First to expire is sold first." flush>
            <DataTable
              rows={detail.data.batches}
              rowKey={(batch) => batch.id}
              compact
              empty={<EmptyState title="No batches on record" />}
              columns={[
                {
                  header: 'Batch',
                  key: 'batch',
                  render: (batch) => (
                    <>
                      <span className="cell-primary mono">{batch.batchNumber}</span>
                      <span className="cell-sub">
                        {batch.source} · {formatDate(batch.receivedAt.slice(0, 10))}
                      </span>
                    </>
                  ),
                },
                {
                  header: 'Expiry',
                  key: 'expiry',
                  render: (batch) => (
                    <>
                      {formatDate(batch.expiryDate)}
                      <span
                        className={batch.daysToExpiry < 0 ? 'cell-sub text-danger' : 'cell-sub'}
                      >
                        {daysLabel(batch.daysToExpiry)}
                      </span>
                    </>
                  ),
                },
                {
                  header: 'State',
                  key: 'status',
                  render: (batch) => (
                    <Badge
                      tone={
                        batch.status === 'SELLABLE'
                          ? 'success'
                          : batch.status === 'DEPLETED'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {humanize(batch.status)}
                    </Badge>
                  ),
                },
                {
                  align: 'end',
                  header: 'Units',
                  key: 'qty',
                  render: (batch) => formatQuantity(batch.currentQuantity),
                },
                {
                  align: 'end',
                  header: 'Cost / Price',
                  key: 'price',
                  render: (batch) => (
                    <>
                      {formatMoney(batch.salePrice)}
                      <span className="cell-sub">
                        cost {formatMoney(batch.costPrice)}
                        {batch.maximumRetailPrice
                          ? ` · MRP ${formatMoney(batch.maximumRetailPrice)}`
                          : ''}
                      </span>
                    </>
                  ),
                },
                {
                  align: 'end',
                  header: '',
                  key: 'actions',
                  render: (batch) =>
                    canAdjust ? (
                      <div className="table-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={ClipboardCheck}
                          title="Record a physical count"
                          onClick={() => setAction({ batch, kind: 'COUNT' })}
                        >
                          Count
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Tag}
                          title="Change the selling price"
                          onClick={() => setAction({ batch, kind: 'PRICE' })}
                        >
                          Price
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          title="Write off damaged or expired units"
                          disabled={decimalToScaledInteger(batch.currentQuantity, 3) <= 0n}
                          onClick={() => setAction({ batch, kind: 'SCRAP' })}
                        >
                          Scrap
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>

          {can(PERMISSIONS.INVENTORY_PURCHASE) ? (
            <ReorderPolicyCard medicineId={medicineId} detail={detail.data} />
          ) : null}

          <Card
            title="Recent stock movements"
            description="Every change to stock, newest first."
            flush
          >
            <DataTable
              rows={detail.data.movements}
              rowKey={(movement) => movement.id}
              compact
              maxHeight={320}
              empty={<EmptyState title="No movements yet" />}
              columns={[
                {
                  header: 'When',
                  key: 'when',
                  render: (movement) => formatDateTime(movement.createdAt),
                },
                {
                  header: 'Type',
                  key: 'type',
                  render: (movement) => humanize(movement.movementType),
                },
                {
                  header: 'Batch',
                  key: 'batch',
                  render: (movement) => <span className="mono">{movement.batchNumber}</span>,
                },
                {
                  align: 'end',
                  header: 'Change',
                  key: 'delta',
                  render: (movement) => (
                    <span
                      className={
                        movement.quantityDelta.startsWith('-') ? 'text-danger' : 'text-success'
                      }
                    >
                      {movement.quantityDelta.startsWith('-') ? '' : '+'}
                      {formatQuantity(movement.quantityDelta)}
                    </span>
                  ),
                },
                {
                  align: 'end',
                  header: 'After',
                  key: 'after',
                  render: (movement) => formatQuantity(movement.quantityAfter),
                },
                {
                  header: 'By / reason',
                  key: 'reason',
                  render: (movement) => (
                    <>
                      {movement.performedBy ?? 'System'}
                      {movement.reason ? <span className="cell-sub">{movement.reason}</span> : null}
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      ) : null}
      {action ? (
        <BatchActionDialog
          medicineId={medicineId}
          batch={action.batch}
          kind={action.kind}
          onClose={() => setAction(null)}
        />
      ) : null}
    </Drawer>
  );
}

function ReorderPolicyCard({
  medicineId,
  detail,
}: {
  readonly medicineId: string;
  readonly detail: MedicineStockDetail;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const suppliers = useQuery({
    queryKey: ['purchasable-suppliers'],
    queryFn: listPurchasableSuppliers,
  });
  const policy = detail.policy;
  const [minimumStock, setMinimumStock] = useState(
    policy?.minimumStock.replace(/\.?0+$/, '') ?? '0',
  );
  const [supplierId, setSupplierId] = useState(policy?.preferredSupplierId ?? '');
  const [leadTime, setLeadTime] = useState(String(policy?.leadTimeDays ?? 2));
  const [coverage, setCoverage] = useState(String(policy?.targetCoverageDays ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid =
    QUANTITY.test(minimumStock.trim()) &&
    /^\d{1,3}$/.test(leadTime) &&
    /^\d{1,3}$/.test(coverage) &&
    Number(coverage) >= 1;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setReorderPolicy(medicineId, {
        leadTimeDays: Number(leadTime),
        minimumStock: minimumStock.trim(),
        preferredSupplierId: supplierId || null,
        targetCoverageDays: Number(coverage),
      });
      toast.success('Reorder level saved');
      await queryClient.invalidateQueries({ queryKey: ['medicine-stock', medicineId] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Reorder level"
      description="When available stock falls to this level the medicine is flagged as low and suggested for ordering."
      footer={
        <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>
          Save reorder level
        </Button>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <div className="form-grid four">
          <Field label={`Reorder at (${detail.medicine.unitName})`} hint="0 = no minimum">
            <Input
              inputMode="decimal"
              value={minimumStock}
              onChange={(event) => setMinimumStock(event.target.value)}
            />
          </Field>
          <Field label="Order enough for (days)">
            <Input
              inputMode="numeric"
              value={coverage}
              onChange={(event) => setCoverage(event.target.value)}
            />
          </Field>
          <Field label="Supplier delivers in (days)">
            <Input
              inputMode="numeric"
              value={leadTime}
              onChange={(event) => setLeadTime(event.target.value)}
            />
          </Field>
          <Field label="Preferred supplier" optional>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">None</option>
              {(suppliers.data ?? []).map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Card>
  );
}

const ACTION_COPY: Record<
  BatchAction,
  { title: string; confirm: string; reasons: readonly string[] }
> = {
  COUNT: {
    confirm: 'Save count',
    reasons: ['Monthly stock count', 'Spot check', 'Correction after audit'],
    title: 'Record a physical count',
  },
  PRICE: {
    confirm: 'Change price',
    reasons: ['New price from company', 'MRP revision', 'Pricing correction'],
    title: 'Change the selling price',
  },
  SCRAP: {
    confirm: 'Write off',
    reasons: ['Damaged pack', 'Expired', 'Broken bottle', 'Recalled by company'],
    title: 'Write off units',
  },
};

function BatchActionDialog({
  medicineId,
  batch,
  kind,
  onClose,
}: {
  readonly medicineId: string;
  readonly batch: Batch;
  readonly kind: BatchAction;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const copy = ACTION_COPY[kind];
  const [value, setValue] = useState(
    kind === 'COUNT'
      ? batch.currentQuantity.replace(/\.?0+$/, '') || '0'
      : kind === 'PRICE'
        ? batch.salePrice
        : '',
  );
  const [mrp, setMrp] = useState(batch.maximumRetailPrice ?? '');
  const [reason, setReason] = useState<string>(copy.reasons[0] ?? '');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valueValid = kind === 'PRICE' ? MONEY.test(value.trim()) : QUANTITY.test(value.trim());
  const mrpValid = !mrp.trim() || MONEY.test(mrp.trim());
  const overMrp =
    kind === 'PRICE' &&
    valueValid &&
    mrp.trim() &&
    mrpValid &&
    moneyToMinorUnits(value.trim()) > moneyToMinorUnits(mrp.trim());
  const scrapTooMuch =
    kind === 'SCRAP' &&
    valueValid &&
    decimalToScaledInteger(value.trim(), 3) > decimalToScaledInteger(batch.currentQuantity, 3);
  const valid =
    valueValid &&
    mrpValid &&
    !overMrp &&
    !scrapTooMuch &&
    reason.trim().length >= 3 &&
    !(kind === 'SCRAP' && decimalToScaledInteger(value.trim() || '0', 3) <= 0n);
  const difference = (() => {
    if (kind !== 'COUNT' || !valueValid) return null;
    const delta =
      decimalToScaledInteger(value.trim(), 3) - decimalToScaledInteger(batch.currentQuantity, 3);
    return delta;
  })();
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'PRICE') {
        await updateBatchPrice(batch.id, {
          clientRequestId: requestId,
          maximumRetailPrice: mrp.trim() ? mrp.trim() : null,
          reason: reason.trim(),
          salePrice: value.trim(),
        });
      } else if (kind === 'COUNT') {
        await adjustBatchStock(batch.id, {
          clientRequestId: requestId,
          countedQuantity: value.trim(),
          reason: reason.trim(),
          type: 'COUNT',
        });
      } else {
        await adjustBatchStock(batch.id, {
          clientRequestId: requestId,
          quantity: value.trim(),
          reason: reason.trim(),
          type: 'SCRAP',
        });
      }
      toast.success(
        kind === 'PRICE' ? 'Price changed' : kind === 'COUNT' ? 'Count saved' : 'Units written off',
        `Batch ${batch.batchNumber}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['medicine-stock', medicineId] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={copy.title}
      description={`Batch ${batch.batchNumber} · ${formatQuantity(batch.currentQuantity)} units on record · expires ${formatDate(batch.expiryDate)}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === 'SCRAP' ? 'danger' : 'primary'}
            loading={busy}
            disabled={!valid}
            onClick={() => void submit()}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        {kind === 'PRICE' ? (
          <div className="form-grid">
            <Field label="New selling price" error={overMrp ? 'Above the MRP' : undefined}>
              <MoneyInput
                className="input-lg"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  renew();
                }}
              />
            </Field>
            <Field
              label="MRP (printed price)"
              optional
              error={!mrpValid ? 'Enter an amount' : undefined}
            >
              <MoneyInput
                className="input-lg"
                value={mrp}
                onChange={(event) => {
                  setMrp(event.target.value);
                  renew();
                }}
              />
            </Field>
          </div>
        ) : (
          <Field
            label={kind === 'COUNT' ? 'Units counted on the shelf' : 'Units to write off'}
            error={scrapTooMuch ? 'More than the batch holds' : undefined}
            hint={
              difference === null
                ? undefined
                : difference === 0n
                  ? 'Matches the record — the count is still logged.'
                  : `${difference > 0n ? 'Surplus' : 'Shortage'} of ${formatQuantity(
                      (difference < 0n ? -difference : difference)
                        .toString()
                        .padStart(4, '0')
                        .replace(/(\d{3})$/, '.$1'),
                    )} units`
            }
          >
            <Input
              className="input-lg"
              inputMode="decimal"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                renew();
              }}
            />
          </Field>
        )}
        <Field label="Reason">
          <Select
            value={copy.reasons.includes(reason) ? reason : 'OTHER'}
            onChange={(event) => {
              setReason(event.target.value === 'OTHER' ? '' : event.target.value);
              renew();
            }}
          >
            {copy.reasons.map((option) => (
              <option key={option}>{option}</option>
            ))}
            <option value="OTHER">Other…</option>
          </Select>
        </Field>
        {!copy.reasons.includes(reason) ? (
          <Field label="Describe the reason">
            <Input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                renew();
              }}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
