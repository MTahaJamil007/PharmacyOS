import { useQuery, useQueryClient } from '@tanstack/react-query';
import { decimalToScaledInteger, moneyToMinorUnits, PERMISSIONS } from '@pharmacy/shared';
import {
  Ban,
  CheckCircle2,
  Inbox,
  ListChecks,
  ScanLine,
  Search,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  approveReturn,
  getCurrentCashSession,
  listReturns,
  lookupReturnByInvoice,
  lookupReturnByToken,
  refundReturn,
  rejectReturn,
  requestReturn,
  type RefundMethod,
  type ReturnDisposition,
  type ReturnLookup,
  type ReturnStatus,
  type ReturnSummary,
} from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from '../../components/ui';
import { formatDate, formatDateTime, formatMoney, formatQuantity, humanize } from '../../format';
import { usePermissions, useRequestId } from '../../hooks/useSession';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_REASONS = [
  'Wrong medicine dispensed',
  'Doctor changed the prescription',
  'Customer no longer needs it',
  'Damaged or defective pack',
  'Near or past expiry',
] as const;

const STATUS_TONES: Record<ReturnStatus, Tone> = {
  APPROVED: 'info',
  REFUNDED: 'success',
  REJECTED: 'neutral',
  REQUESTED: 'warning',
};

const METHOD_LABELS: Record<RefundMethod, string> = {
  BANK_TRANSFER: 'Bank / wallet',
  CARD: 'Card reversal',
  CASH: 'Cash from drawer',
  CUSTOMER_ACCOUNT: 'Credit to customer khata',
};

export function ReturnsScreen(): React.JSX.Element {
  const can = usePermissions();
  const canRequest = can(PERMISSIONS.RETURNS_LOOKUP) && can(PERMISSIONS.RETURNS_REQUEST);
  const [tab, setTab] = useState<'NEW' | 'QUEUE'>(canRequest ? 'NEW' : 'QUEUE');
  const pending = useQuery({
    queryKey: ['returns', 'pending-count'],
    queryFn: () => listReturns(),
  });
  const pendingCount = (pending.data ?? []).filter(
    (row) => row.status === 'REQUESTED' || row.status === 'APPROVED',
  ).length;
  return (
    <div className="page">
      <PageHeader
        title="Returns"
        description="Take back medicine against the original sale. Refunds never exceed what the customer paid."
      />
      <Tabs
        label="Returns"
        active={tab}
        onChange={setTab}
        tabs={[
          ...(canRequest ? [{ icon: Undo2, id: 'NEW' as const, label: 'New return' }] : []),
          { count: pendingCount, icon: ListChecks, id: 'QUEUE' as const, label: 'Return queue' },
        ]}
      />
      {tab === 'NEW' && canRequest ? (
        <NewReturn onCreated={() => setTab('QUEUE')} />
      ) : (
        <ReturnQueue />
      )}
    </div>
  );
}

function NewReturn({ onCreated }: { readonly onCreated: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const searchInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [lookup, setLookup] = useState<ReturnLookup | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [searching, setSearching] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({});
  const [reasonChoice, setReasonChoice] = useState<string>(RETURN_REASONS[0]);
  const [otherReason, setOtherReason] = useState('');
  const [requestId, renew] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  const find = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    setSearching(true);
    setLookupError(null);
    try {
      const found = UUID.test(value)
        ? await lookupReturnByToken(value)
        : await lookupReturnByInvoice(value);
      setLookup(found);
      setQuantities({});
      setDispositions({});
      renew();
    } catch (cause) {
      setLookup(null);
      setLookupError(cause);
    } finally {
      setSearching(false);
    }
  };

  const selected = useMemo(() => {
    if (!lookup) return [];
    return lookup.items.flatMap((item) => {
      const value = quantities[item.id]?.trim() ?? '';
      if (!value) return [];
      try {
        const quantity = decimalToScaledInteger(value, 3);
        if (quantity <= 0n) return [];
        return [{ item, quantity: value, scaled: quantity }];
      } catch {
        return [];
      }
    });
  }, [lookup, quantities]);
  const invalidLine = lookup?.items.find((item) => {
    const value = quantities[item.id]?.trim();
    if (!value) return false;
    try {
      const quantity = decimalToScaledInteger(value, 3);
      return quantity < 0n || quantity > decimalToScaledInteger(item.eligibleQuantity, 3);
    } catch {
      return true;
    }
  });
  const reason = reasonChoice === 'OTHER' ? otherReason.trim() : reasonChoice;

  const submit = async (): Promise<void> => {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestReturn(lookup.sale.lookupToken, {
        clientRequestId: requestId,
        items: selected.map(({ item, quantity }) => ({
          disposition: dispositions[item.id] ?? (item.expired ? 'QUARANTINE' : 'RESTOCK_SELLABLE'),
          quantity,
          saleItemId: item.id,
        })),
        reason,
      });
      toast.success(
        `Return ${result.returnNumber ?? ''} requested`,
        result.refundAmount ? `Refund due ${formatMoney(result.refundAmount)}` : undefined,
      );
      renew();
      setLookup(null);
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      onCreated();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Card>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
        >
          <SearchInput
            ref={searchInput}
            icon={ScanLine}
            className="spacer"
            aria-label="Invoice number or receipt code"
            placeholder="Type the invoice number, or scan the QR code on the receipt"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            icon={Search}
            loading={searching}
            disabled={!text.trim()}
          >
            Find sale
          </Button>
        </form>
        {lookupError ? (
          <div style={{ marginBlockStart: 12 }}>
            <ErrorAlert error={lookupError} />
          </div>
        ) : null}
      </Card>

      {lookup ? (
        <>
          <Card
            title={`Invoice ${lookup.sale.invoiceNumber}`}
            description={`Sold ${formatDateTime(lookup.sale.createdAt)}${lookup.sale.customerName ? ` to ${lookup.sale.customerName}` : ''}`}
            actions={
              <>
                {lookup.payments.map((payment) => (
                  <Badge key={payment.method}>
                    {humanize(payment.method === 'CREDIT' ? 'KHATA' : payment.method)}{' '}
                    {formatMoney(payment.amount)}
                  </Badge>
                ))}
                <Badge tone="brand">Total {formatMoney(lookup.sale.total)}</Badge>
              </>
            }
            flush
          >
            <DataTable
              rows={lookup.items}
              rowKey={(item) => item.id}
              columns={[
                {
                  header: 'Medicine',
                  key: 'medicine',
                  render: (item) => (
                    <>
                      <span className="cell-primary">
                        {item.medicineName} {item.strength ?? ''}
                      </span>
                      <span className="cell-sub">
                        Batch {item.batchNumber} · expires {formatDate(item.expiryDate)}{' '}
                        {item.expired ? <Badge tone="danger">Expired</Badge> : null}
                      </span>
                    </>
                  ),
                },
                {
                  align: 'end',
                  header: 'Sold',
                  key: 'sold',
                  render: (item) => formatQuantity(item.soldQuantity),
                },
                {
                  align: 'end',
                  header: 'Already returned',
                  key: 'returned',
                  render: (item) => formatQuantity(item.returnedQuantity),
                },
                {
                  align: 'end',
                  header: 'Paid for line',
                  key: 'paid',
                  render: (item) => formatMoney(item.netPaid),
                },
                {
                  header: 'Return qty',
                  key: 'quantity',
                  width: 120,
                  render: (item) => (
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Return quantity for ${item.medicineName}`}
                      placeholder={`max ${formatQuantity(item.eligibleQuantity)}`}
                      disabled={decimalToScaledInteger(item.eligibleQuantity, 3) <= 0n}
                      value={quantities[item.id] ?? ''}
                      onChange={(event) => {
                        setQuantities((current) => ({ ...current, [item.id]: event.target.value }));
                        renew();
                      }}
                    />
                  ),
                },
                {
                  header: 'Put back as',
                  key: 'disposition',
                  width: 190,
                  render: (item) => (
                    <select
                      className="select"
                      aria-label={`Disposition for ${item.medicineName}`}
                      value={
                        dispositions[item.id] ?? (item.expired ? 'QUARANTINE' : 'RESTOCK_SELLABLE')
                      }
                      onChange={(event) => {
                        setDispositions((current) => ({
                          ...current,
                          [item.id]: event.target.value as ReturnDisposition,
                        }));
                        renew();
                      }}
                    >
                      <option value="RESTOCK_SELLABLE" disabled={item.expired}>
                        Back on the shelf
                      </option>
                      <option value="QUARANTINE">Quarantine (check later)</option>
                      <option value="SCRAP">Scrap (damaged)</option>
                    </select>
                  ),
                },
              ]}
            />
          </Card>

          <Card
            title="Reason and request"
            footer={
              <>
                {invalidLine ? (
                  <span className="footer-note text-danger">
                    The quantity for {invalidLine.medicineName} is more than can be returned.
                  </span>
                ) : (
                  <span className="footer-note">
                    {selected.length} line{selected.length === 1 ? '' : 's'} selected. The refund is
                    calculated from what was actually paid, including discounts.
                  </span>
                )}
                <Button
                  variant="primary"
                  icon={Undo2}
                  loading={busy}
                  disabled={selected.length === 0 || Boolean(invalidLine) || reason.length < 3}
                  onClick={() => void submit()}
                >
                  Request return
                </Button>
              </>
            }
          >
            <div className="form-grid">
              <Field label="Reason">
                <Select
                  value={reasonChoice}
                  onChange={(event) => {
                    setReasonChoice(event.target.value);
                    renew();
                  }}
                >
                  {RETURN_REASONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                  <option value="OTHER">Other…</option>
                </Select>
              </Field>
              {reasonChoice === 'OTHER' ? (
                <Field label="Describe the reason">
                  <Input
                    value={otherReason}
                    onChange={(event) => {
                      setOtherReason(event.target.value);
                      renew();
                    }}
                  />
                </Field>
              ) : null}
            </div>
            {error ? (
              <div style={{ marginBlockStart: 12 }}>
                <ErrorAlert error={error} />
              </div>
            ) : null}
          </Card>

          {lookup.returns.length > 0 ? (
            <Card title="Earlier returns on this sale" flush>
              <ReturnsTable rows={lookup.returns} />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ReturnsTable({
  rows,
  loading = false,
  onAction,
}: {
  readonly rows: readonly ReturnSummary[];
  readonly loading?: boolean;
  readonly onAction?: (row: ReturnSummary, action: 'APPROVE' | 'REJECT' | 'REFUND') => void;
}) {
  const can = usePermissions();
  return (
    <DataTable
      rows={rows}
      loading={loading}
      rowKey={(row) => row.id}
      empty={<EmptyState icon={Inbox} title="No returns here" />}
      columns={[
        {
          header: 'Return',
          key: 'return',
          render: (row) => (
            <>
              <span className="cell-primary mono">{row.returnNumber}</span>
              <span className="cell-sub">
                Invoice {row.invoiceNumber} · {formatDateTime(row.requestedAt)}
              </span>
            </>
          ),
        },
        {
          header: 'Reason',
          key: 'reason',
          render: (row) => (
            <>
              {row.reason}
              <span className="cell-sub">
                By {row.requestedBy}
                {row.customerName ? ` · customer ${row.customerName}` : ''}
                {row.rejectionReason ? ` · rejected: ${row.rejectionReason}` : ''}
              </span>
            </>
          ),
        },
        {
          header: 'Status',
          key: 'status',
          render: (row) => (
            <>
              <Badge tone={STATUS_TONES[row.status]}>{humanize(row.status)}</Badge>
              {row.refundMethod ? (
                <span className="cell-sub">{METHOD_LABELS[row.refundMethod]}</span>
              ) : null}
            </>
          ),
        },
        {
          align: 'end',
          header: 'Refund',
          key: 'amount',
          render: (row) => formatMoney(row.refundAmount),
        },
        {
          align: 'end',
          header: '',
          key: 'actions',
          render: (row) =>
            onAction ? (
              <div className="table-actions">
                {row.status === 'REQUESTED' && can(PERMISSIONS.RETURNS_APPROVE) ? (
                  <Button size="sm" icon={CheckCircle2} onClick={() => onAction(row, 'APPROVE')}>
                    Approve
                  </Button>
                ) : null}
                {(row.status === 'REQUESTED' || row.status === 'APPROVED') &&
                can(PERMISSIONS.RETURNS_APPROVE) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Ban}
                    onClick={() => onAction(row, 'REJECT')}
                  >
                    Reject
                  </Button>
                ) : null}
                {row.status === 'APPROVED' && can(PERMISSIONS.RETURNS_REFUND) ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Wallet}
                    onClick={() => onAction(row, 'REFUND')}
                  >
                    Refund
                  </Button>
                ) : null}
              </div>
            ) : null,
        },
      ]}
    />
  );
}

function ReturnQueue() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'OPEN' | ReturnStatus | 'ALL'>('OPEN');
  const returns = useQuery({
    queryKey: ['returns', filter],
    queryFn: () => listReturns(filter === 'OPEN' || filter === 'ALL' ? undefined : filter),
  });
  const rows = (returns.data ?? []).filter((row) =>
    filter === 'OPEN' ? row.status === 'REQUESTED' || row.status === 'APPROVED' : true,
  );
  const [refunding, setRefunding] = useState<ReturnSummary | null>(null);
  const [rejecting, setRejecting] = useState<ReturnSummary | null>(null);
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['returns'] });
  };
  const act = async (
    row: ReturnSummary,
    action: 'APPROVE' | 'REJECT' | 'REFUND',
  ): Promise<void> => {
    if (action === 'REFUND') {
      setRefunding(row);
      return;
    }
    if (action === 'REJECT') {
      setRejecting(row);
      return;
    }
    try {
      await approveReturn(row.id);
      toast.success(`Return ${row.returnNumber} approved`);
      await refresh();
    } catch (cause) {
      toast.error('Approval failed', cause);
    }
  };
  return (
    <Card
      title="Return queue"
      description="Requested returns wait for approval; approved returns wait for the refund."
      actions={
        <Segmented
          label="Filter returns"
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'Open', value: 'OPEN' },
            { label: 'Refunded', value: 'REFUNDED' },
            { label: 'Rejected', value: 'REJECTED' },
            { label: 'All', value: 'ALL' },
          ]}
        />
      }
      flush
    >
      <ErrorAlert error={returns.error} />
      <ReturnsTable
        rows={rows}
        loading={returns.isLoading}
        onAction={(row, action) => void act(row, action)}
      />
      {refunding ? (
        <RefundDialog
          row={refunding}
          onClose={() => setRefunding(null)}
          onDone={async () => {
            setRefunding(null);
            await refresh();
          }}
        />
      ) : null}
      {rejecting ? (
        <RejectDialog
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={async () => {
            setRejecting(null);
            await refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function RefundDialog({
  row,
  onClose,
  onDone,
}: {
  readonly row: ReturnSummary;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const can = usePermissions();
  const toast = useToast();
  const drawer = useQuery({ queryKey: ['cash-session-current'], queryFn: getCurrentCashSession });
  const amount = moneyToMinorUnits(row.refundAmount);
  const fits = (limit: string): boolean => moneyToMinorUnits(limit) >= amount;
  const options: ReadonlyArray<{ method: RefundMethod; enabled: boolean; note: string }> = [
    {
      enabled:
        fits(row.refundLimits.cashOrCard) &&
        can(PERMISSIONS.RETURNS_REFUND_CASH) &&
        drawer.data?.status === 'OPEN',
      method: 'CASH',
      note: !fits(row.refundLimits.cashOrCard)
        ? 'Part of the sale is still owed on khata'
        : !can(PERMISSIONS.RETURNS_REFUND_CASH)
          ? 'Your account cannot hand out cash refunds'
          : drawer.data?.status !== 'OPEN'
            ? 'Open your cash drawer first'
            : 'Paid from your drawer',
    },
    {
      enabled: fits(row.refundLimits.cashOrCard),
      method: 'CARD',
      note: fits(row.refundLimits.cashOrCard)
        ? 'Reverse on the card machine'
        : 'Part of the sale is still owed on khata',
    },
    {
      enabled: fits(row.refundLimits.cashOrCard),
      method: 'BANK_TRANSFER',
      note: fits(row.refundLimits.cashOrCard)
        ? 'Send to the customer’s account'
        : 'Part of the sale is still owed on khata',
    },
    {
      enabled: Boolean(row.customerId) && fits(row.refundLimits.customerAccount),
      method: 'CUSTOMER_ACCOUNT',
      note: !row.customerId
        ? 'The sale has no customer account'
        : fits(row.refundLimits.customerAccount)
          ? `Reduces what ${row.customerName ?? 'the customer'} owes`
          : 'More than the customer currently owes',
    },
  ];
  const firstEnabled = options.find((option) => option.enabled)?.method;
  const [chosen, setMethod] = useState<RefundMethod | undefined>(undefined);
  // The drawer state loads after the dialog opens, so the default follows what is available.
  const method =
    chosen && options.find((option) => option.method === chosen)?.enabled ? chosen : firstEnabled;
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (): Promise<void> => {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      const result = await refundReturn(row.id, {
        method,
        ...(method === 'CASH' && drawer.data ? { cashSessionId: drawer.data.id } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success(
        `Refunded ${formatMoney(result.refundAmount ?? row.refundAmount)}`,
        METHOD_LABELS[method],
      );
      await onDone();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Refund ${formatMoney(row.refundAmount)}`}
      description={`Return ${row.returnNumber} · invoice ${row.invoiceNumber}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!method} onClick={() => void submit()}>
            Refund now
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <fieldset className="form-stack" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBlockEnd: 6 }}>
            How is the money going back?
          </legend>
          {options.map((option) => (
            <label
              key={option.method}
              aria-label={METHOD_LABELS[option.method]}
              className="tender-row"
              style={{
                gridTemplateColumns: 'auto 1fr',
                cursor: option.enabled ? 'pointer' : 'not-allowed',
                opacity: option.enabled ? 1 : 0.55,
              }}
            >
              <input
                type="radio"
                name="refund-method"
                checked={method === option.method}
                disabled={!option.enabled}
                onChange={() => setMethod(option.method)}
              />
              <span>
                <strong>{METHOD_LABELS[option.method]}</strong>
                <span className="cell-sub">{option.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {method === 'CARD' || method === 'BANK_TRANSFER' ? (
          <Field label="Reference" optional>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
        ) : null}
        {!firstEnabled ? (
          <Alert tone="warning">
            No refund method is available right now. Check the drawer or customer account.
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

function RejectDialog({
  row,
  onClose,
  onDone,
}: {
  readonly row: ReturnSummary;
  readonly onClose: () => void;
  readonly onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await rejectReturn(row.id, reason.trim());
      toast.success(
        `Return ${row.returnNumber} rejected`,
        'The quantity can be returned again if needed.',
      );
      await onDone();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Reject return ${row.returnNumber}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            Reject return
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <ErrorAlert error={error} />
        <Field label="Why is it rejected?" hint="The customer may be shown this reason.">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
