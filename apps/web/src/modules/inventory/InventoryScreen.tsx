import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type StockStatus } from '@pharmacy/shared';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ClipboardList,
  LayoutGrid,
  PackageOpen,
  PackageX,
  Search,
  ShoppingBag,
  TrendingDown,
} from 'lucide-react';
import { useState } from 'react';

import {
  actOnExpiryItem,
  createDraftFromSuggestion,
  getExpiryRisk,
  getReorderSuggestions,
  getShelfRecommendations,
  getStockOverview,
  reviewReorderSuggestion,
  reviewShelfRecommendation,
  type ExpiryRiskItem,
} from '../../api';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  SearchInput,
  Select,
  Stat,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from '../../components/ui';
import { daysLabel, formatDate, formatMoney, formatQuantity, humanize } from '../../format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePermissions } from '../../hooks/useSession';
import { MedicineDrawer } from './MedicineDrawer';

type InventoryTab = 'STOCK' | 'EXPIRY' | 'REORDER' | 'SHELF';
type StockFilter = 'ALL' | 'LOW' | 'OUT' | 'EXPIRING';
const PAGE_SIZE = 50;

export const STOCK_STATUS: Record<StockStatus, { readonly label: string; readonly tone: Tone }> = {
  EXPIRING: { label: 'Expiring soon', tone: 'warning' },
  LOW: { label: 'Low stock', tone: 'warning' },
  OK: { label: 'In stock', tone: 'success' },
  OUT: { label: 'Out of stock', tone: 'danger' },
};

export function InventoryScreen(): React.JSX.Element {
  const can = usePermissions();
  const tabs = [
    ...(can(
      PERMISSIONS.INVENTORY_ADJUST,
      PERMISSIONS.INVENTORY_PURCHASE,
      PERMISSIONS.REPORTS_VIEW_BASIC,
    )
      ? [{ icon: Boxes, id: 'STOCK' as const, label: 'Stock' }]
      : []),
    ...(can(PERMISSIONS.INVENTORY_EXPIRY_READ)
      ? [{ icon: CalendarClock, id: 'EXPIRY' as const, label: 'Expiry' }]
      : []),
    ...(can(PERMISSIONS.PROCUREMENT_REORDER_REVIEW)
      ? [{ icon: ShoppingBag, id: 'REORDER' as const, label: 'Reorder suggestions' }]
      : []),
    ...(can(PERMISSIONS.INVENTORY_SHELF_READ)
      ? [{ icon: LayoutGrid, id: 'SHELF' as const, label: 'Shelf placement' }]
      : []),
  ];
  const [tab, setTab] = useState<InventoryTab>(tabs[0]?.id ?? 'STOCK');
  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        description="What is on the shelves, what is running out, and what is about to expire."
      />
      <Tabs label="Inventory views" tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'STOCK' ? <StockTab /> : null}
      {tab === 'EXPIRY' ? <ExpiryTab /> : null}
      {tab === 'REORDER' ? <ReorderTab /> : null}
      {tab === 'SHELF' ? <ShelfTab /> : null}
    </div>
  );
}

function StockTab() {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<StockFilter>('ALL');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const debounced = useDebouncedValue(text.trim(), 250);
  const stock = useQuery({
    queryKey: ['stock', debounced, filter, page],
    queryFn: () =>
      getStockOverview({ filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE, query: debounced }),
    placeholderData: (previous) => previous,
  });
  const totals = stock.data?.totals;
  const choose = (next: StockFilter): void => {
    setFilter(next === filter ? 'ALL' : next);
    setPage(0);
  };
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat
          label="Stock value at cost"
          icon={Boxes}
          value={formatMoney(totals?.valueAtCost)}
          hint={`Retail value ${formatMoney(totals?.valueAtRetail)}`}
          onClick={() => choose('ALL')}
          selected={filter === 'ALL'}
        />
        <Stat
          label="Low stock"
          icon={TrendingDown}
          value={totals?.low ?? '—'}
          tone={totals?.low ? 'warning' : undefined}
          hint="At or below the reorder level"
          onClick={() => choose('LOW')}
          selected={filter === 'LOW'}
        />
        <Stat
          label="Out of stock"
          icon={PackageX}
          value={totals?.out ?? '—'}
          tone={totals?.out ? 'danger' : undefined}
          hint="Stocked before, none sellable now"
          onClick={() => choose('OUT')}
          selected={filter === 'OUT'}
        />
        <Stat
          label="Expiring soon"
          icon={AlertTriangle}
          value={totals?.expiring ?? '—'}
          tone={totals?.expiring ? 'warning' : undefined}
          hint="Nearest batch inside the expiry window"
          onClick={() => choose('EXPIRING')}
          selected={filter === 'EXPIRING'}
        />
      </div>
      <Card flush>
        <div className="card-body">
          <SearchInput
            icon={Search}
            aria-label="Search stock"
            placeholder="Medicine name, generic, SKU, or barcode"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <ErrorAlert error={stock.error} />
        <DataTable
          rows={stock.data?.data ?? []}
          loading={stock.isLoading}
          rowKey={(row) => row.medicineId}
          onRowClick={(row) => setSelected(row.medicineId)}
          empty={<EmptyState icon={PackageOpen} title="No medicines match" />}
          columns={[
            {
              header: 'Medicine',
              key: 'name',
              render: (row) => (
                <>
                  <span className="cell-primary">
                    {row.name} {row.strength ?? ''}
                  </span>
                  <span className="cell-sub">
                    {[row.genericName, row.manufacturer, row.sku].filter(Boolean).join(' · ') ||
                      '—'}
                  </span>
                </>
              ),
            },
            {
              align: 'end',
              header: 'Available',
              key: 'available',
              render: (row) => (
                <>
                  <span className="cell-primary">{formatQuantity(row.availableQuantity)}</span>
                  {row.reservedQuantity !== '0.000' ? (
                    <span className="cell-sub">
                      {formatQuantity(row.reservedQuantity)} held at counter
                    </span>
                  ) : null}
                  {row.quarantinedQuantity !== '0.000' || row.expiredQuantity !== '0.000' ? (
                    <span className="cell-sub text-warning">
                      +{formatQuantity(row.quarantinedQuantity)} quarantined,{' '}
                      {formatQuantity(row.expiredQuantity)} expired
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              header: 'Nearest expiry',
              key: 'expiry',
              render: (row) =>
                row.nearestExpiry ? (
                  <>
                    {formatDate(row.nearestExpiry)}
                    <span className="cell-sub">{daysLabel(row.daysToExpiry)}</span>
                  </>
                ) : (
                  '—'
                ),
            },
            {
              align: 'end',
              header: 'Sells / day',
              key: 'velocity',
              render: (row) => (
                <>
                  {formatQuantity(row.averageDailySales)}
                  {row.daysOfCover ? (
                    <span className="cell-sub">{row.daysOfCover} days cover</span>
                  ) : null}
                </>
              ),
            },
            {
              align: 'end',
              header: 'Reorder at',
              key: 'minimum',
              render: (row) =>
                row.minimumStock && row.minimumStock !== '0.000'
                  ? formatQuantity(row.minimumStock)
                  : '—',
            },
            {
              align: 'end',
              header: 'Value at cost',
              key: 'value',
              render: (row) => formatMoney(row.valueAtCost),
            },
            {
              align: 'end',
              header: 'Price',
              key: 'price',
              render: (row) => formatMoney(row.salePrice),
            },
            {
              header: 'Status',
              key: 'status',
              render: (row) => (
                <Badge tone={STOCK_STATUS[row.status].tone}>{STOCK_STATUS[row.status].label}</Badge>
              ),
            },
          ]}
        />
        <div className="pagination">
          <span>
            {totals ? `${String(totals.matching)} medicines` : ''}
            {totals && totals.matching > PAGE_SIZE
              ? ` · page ${String(page + 1)} of ${String(Math.ceil(totals.matching / PAGE_SIZE))}`
              : ''}
          </span>
          <div className="row">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={!totals || (page + 1) * PAGE_SIZE >= totals.matching}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
      {selected ? <MedicineDrawer medicineId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

const EXPIRY_ACTIONS = [
  { label: 'Mark reviewed', value: 'REVIEWED' },
  { label: 'Return to supplier', value: 'SUPPLIER_RETURN_CANDIDATE' },
  { label: 'Move to quarantine', value: 'QUARANTINED' },
  { label: 'Scrap (write off)', value: 'SCRAPPED' },
  { label: 'Resolved', value: 'RESOLVED' },
] as const;

function ExpiryTab() {
  const can = usePermissions();
  const [acting, setActing] = useState<ExpiryRiskItem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const expiry = useQuery({ queryKey: ['expiry-risk'], queryFn: getExpiryRisk });
  const rows = expiry.data ?? [];
  const expired = rows.filter((row) => row.days_to_expiry < 0);
  const value = (items: readonly ExpiryRiskItem[]): string => {
    let total = 0n;
    for (const item of items) {
      const [whole = '0', fraction = ''] = item.value_at_risk.split('.');
      total += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
    }
    return `${(total / 100n).toString()}.${(total % 100n).toString().padStart(2, '0')}`;
  };
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Stat
          label="Already expired"
          value={expired.length}
          tone={expired.length ? 'danger' : undefined}
          hint={`${formatMoney(value(expired))} at cost`}
        />
        <Stat
          label="Expiring within the window"
          value={rows.length - expired.length}
          tone={rows.length - expired.length ? 'warning' : undefined}
          hint={`${formatMoney(value(rows.filter((row) => row.days_to_expiry >= 0)))} at cost`}
        />
        <Stat
          label="Total value at risk"
          value={formatMoney(value(rows))}
          hint="Batch acquisition cost"
        />
      </div>
      <Card
        title="Expiry work queue"
        description="Oldest first. Quarantine or scrap to take stock off sale; mark supplier returns to claim credit."
        flush
      >
        <ErrorAlert error={expiry.error} />
        <DataTable
          rows={rows}
          loading={expiry.isLoading}
          rowKey={(row) => row.batch_id}
          empty={<EmptyState icon={CalendarClock} title="Nothing is close to expiry" />}
          columns={[
            {
              header: 'Medicine',
              key: 'medicine',
              render: (row) => (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ paddingInline: 0 }}
                  onClick={() => setSelected(row.medicine_id)}
                >
                  <span className="cell-primary">{row.medicine_name}</span>
                </button>
              ),
            },
            {
              header: 'Batch',
              key: 'batch',
              render: (row) => <span className="mono">{row.batch_number}</span>,
            },
            {
              header: 'Expiry',
              key: 'expiry',
              render: (row) => (
                <>
                  {formatDate(row.expiry_date)}
                  <span className={row.days_to_expiry < 0 ? 'cell-sub text-danger' : 'cell-sub'}>
                    {daysLabel(row.days_to_expiry)}
                  </span>
                </>
              ),
            },
            {
              align: 'end',
              header: 'Units',
              key: 'units',
              render: (row) => formatQuantity(row.quantity),
            },
            {
              align: 'end',
              header: 'Value at cost',
              key: 'value',
              render: (row) => formatMoney(row.value_at_risk),
            },
            {
              header: 'State',
              key: 'state',
              render: (row) => (
                <>
                  <Badge
                    tone={
                      row.status === 'SELLABLE'
                        ? row.days_to_expiry < 0
                          ? 'danger'
                          : 'warning'
                        : 'neutral'
                    }
                  >
                    {row.status === 'SELLABLE'
                      ? row.days_to_expiry < 0
                        ? 'Expired on shelf'
                        : 'On sale'
                      : humanize(row.status)}
                  </Badge>
                  {row.work_item_action ? (
                    <span className="cell-sub">{humanize(row.work_item_action)}</span>
                  ) : null}
                </>
              ),
            },
            {
              align: 'end',
              header: '',
              key: 'actions',
              render: (row) =>
                can(PERMISSIONS.INVENTORY_EXPIRY_MANAGE) ? (
                  <Button
                    size="sm"
                    disabled={!row.work_item_id}
                    title={
                      row.work_item_id
                        ? undefined
                        : 'Listed in the work queue after the next daily expiry review'
                    }
                    onClick={() => setActing(row)}
                  >
                    Act
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      {acting ? <ExpiryActionDialog item={acting} onClose={() => setActing(null)} /> : null}
      {selected ? <MedicineDrawer medicineId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function ExpiryActionDialog({
  item,
  onClose,
}: {
  readonly item: ExpiryRiskItem;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<(typeof EXPIRY_ACTIONS)[number]['value']>(
    item.days_to_expiry < 0 ? 'QUARANTINED' : 'SUPPLIER_RETURN_CANDIDATE',
  );
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (): Promise<void> => {
    if (!item.work_item_id) return;
    setBusy(true);
    setError(null);
    try {
      await actOnExpiryItem(item.work_item_id, { action, notes: notes.trim() });
      toast.success('Expiry action recorded', `${item.medicine_name} · ${item.batch_number}`);
      await queryClient.invalidateQueries({ queryKey: ['expiry-risk'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const destructive = action === 'SCRAPPED' || action === 'QUARANTINED';
  return (
    <Dialog
      title={`${item.medicine_name} · batch ${item.batch_number}`}
      description={`${formatQuantity(item.quantity)} units · ${formatMoney(item.value_at_risk)} at cost · expires ${formatDate(item.expiry_date)}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={action === 'SCRAPPED' ? 'danger' : 'primary'}
            loading={busy}
            disabled={notes.trim().length < 2}
            onClick={() => void submit()}
          >
            Record action
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Field label="Action">
          <Select
            value={action}
            onChange={(event) => setAction(event.target.value as typeof action)}
          >
            {EXPIRY_ACTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {destructive ? (
          <span className="field-hint">
            {action === 'SCRAPPED'
              ? 'All units of this batch leave stock and are written off at cost.'
              : 'All units of this batch are moved off sale into quarantine.'}
          </span>
        ) : null}
        <Field
          label="Notes"
          hint="For example the supplier contacted, or where the stock was placed."
        >
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function ReorderTab() {
  const can = usePermissions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const suggestions = useQuery({
    queryKey: ['reorder-suggestions'],
    queryFn: getReorderSuggestions,
  });
  const [busyId, setBusyId] = useState('');
  const act = async (id: string, kind: 'REVIEW' | 'DISMISS' | 'DRAFT'): Promise<void> => {
    setBusyId(id);
    try {
      if (kind === 'DRAFT') {
        const draft = await createDraftFromSuggestion(id, { clientRequestId: `reorder-${id}` });
        toast.success(
          `Draft purchase order ${draft.orderNumber} created`,
          'Review and send it from Purchasing.',
        );
      } else {
        await reviewReorderSuggestion(id, kind);
      }
      await queryClient.invalidateQueries({ queryKey: ['reorder-suggestions'] });
    } catch (cause) {
      toast.error('That did not work', cause);
    } finally {
      setBusyId('');
    }
  };
  return (
    <Card
      title="Reorder suggestions"
      description="Worked out each morning from recent sales, days out of stock, supplier lead time, and stock already held. Nothing is ordered automatically."
      flush
    >
      <ErrorAlert error={suggestions.error} />
      <DataTable
        rows={suggestions.data ?? []}
        loading={suggestions.isLoading}
        rowKey={(row) => row.id}
        empty={
          <EmptyState icon={ClipboardList} title="No reorder suggestions right now">
            Suggestions appear once medicines have sales history. Set reorder levels from the Stock
            tab.
          </EmptyState>
        }
        columns={[
          {
            header: 'Medicine',
            key: 'medicine',
            render: (row) => <span className="cell-primary">{row.medicine_name}</span>,
          },
          {
            align: 'end',
            header: 'On hand',
            key: 'stock',
            render: (row) => formatQuantity(row.current_sellable_stock),
          },
          {
            align: 'end',
            header: 'Lead time',
            key: 'lead',
            render: (row) => `${String(row.effective_lead_time_days)} days`,
          },
          {
            align: 'end',
            header: 'Suggested order',
            key: 'qty',
            render: (row) => (
              <span className="cell-primary">{formatQuantity(row.suggested_qty)}</span>
            ),
          },
          {
            header: 'Confidence',
            key: 'confidence',
            render: (row) => (
              <>
                <Badge
                  tone={
                    row.confidence === 'HIGH'
                      ? 'success'
                      : row.confidence === 'MEDIUM'
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {humanize(row.confidence)}
                </Badge>
                {row.expiry_risk_flag ? (
                  <span className="cell-sub text-warning">Near-expiry stock already on hand</span>
                ) : null}
              </>
            ),
          },
          { header: 'Status', key: 'status', render: (row) => humanize(row.status) },
          {
            align: 'end',
            header: '',
            key: 'actions',
            render: (row) => (
              <div className="table-actions">
                {can(PERMISSIONS.PROCUREMENT_PURCHASE_DRAFT_APPROVE) ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busyId === row.id}
                    onClick={() => void act(row.id, 'DRAFT')}
                  >
                    Draft order
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={busyId === row.id}
                    onClick={() => void act(row.id, 'REVIEW')}
                  >
                    Mark reviewed
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === row.id}
                  onClick={() => void act(row.id, 'DISMISS')}
                >
                  Dismiss
                </Button>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function ShelfTab() {
  const can = usePermissions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const shelves = useQuery({
    queryKey: ['shelf-recommendations'],
    queryFn: getShelfRecommendations,
  });
  const review = async (id: string, decision: 'APPLY' | 'DISMISS'): Promise<void> => {
    try {
      await reviewShelfRecommendation(id, decision);
      toast.success(decision === 'APPLY' ? 'Shelf location updated' : 'Suggestion dismissed');
      await queryClient.invalidateQueries({ queryKey: ['shelf-recommendations'] });
    } catch (cause) {
      toast.error('That did not work', cause);
    }
  };
  return (
    <Card
      title="Shelf placement"
      description="Fast movers belong on the easiest shelves. Suggestions are refreshed weekly from counter picks."
      flush
    >
      <ErrorAlert error={shelves.error} />
      <DataTable
        rows={shelves.data ?? []}
        loading={shelves.isLoading}
        rowKey={(row) => row.id}
        empty={<EmptyState icon={LayoutGrid} title="No placement changes suggested" />}
        columns={[
          {
            header: 'Medicine',
            key: 'medicine',
            render: (row) => <span className="cell-primary">{row.medicine_name}</span>,
          },
          {
            header: 'Demand',
            key: 'demand',
            render: (row) => (
              <>
                {row.demand_class === 'LOW_CONFIDENCE'
                  ? 'Not enough sales yet'
                  : `Class ${row.demand_class}`}
                <span className="cell-sub">{formatQuantity(row.pick_count)} picks</span>
              </>
            ),
          },
          {
            header: 'Now on',
            key: 'current',
            render: (row) => row.current_location ?? 'No shelf set',
          },
          {
            header: 'Move to',
            key: 'suggested',
            render: (row) => <span className="cell-primary">{row.suggested_location}</span>,
          },
          {
            align: 'end',
            header: '',
            key: 'actions',
            render: (row) =>
              can(PERMISSIONS.INVENTORY_SHELF_REVIEW) ? (
                <div className="table-actions">
                  <Button size="sm" variant="primary" onClick={() => void review(row.id, 'APPLY')}>
                    Moved it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void review(row.id, 'DISMISS')}>
                    Dismiss
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
